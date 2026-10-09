# Spotify helper for Windows. Reads commands on stdin ("<id> <command>"), answers "<id> <json>".
# Tries Windows' media-session API first; falls back to the Spotify window title + media keys.
$ErrorActionPreference = 'Stop'
$logPath = Join-Path (Split-Path -Parent $PSScriptRoot) 'data\bridge.log'
function Log($m) { try { Add-Content -Path $logPath -Value ((Get-Date -Format s) + ' [helper] ' + $m) } catch {} }

# JSON with every non-ASCII character escaped, so any console encoding is safe
function To-AsciiJson($obj) {
  $json = ConvertTo-Json -Compress -InputObject $obj
  return [regex]::Replace($json, '[^\x00-\x7F]', [System.Text.RegularExpressions.MatchEvaluator]{
    param($m) ('\u{0:x4}' -f [int][char]$m.Value) })
}

# ---------- media-session API ----------
$smtc = $false
$asTask = $null; $mgr = $null; $propType = $null
function Await($op, $type) {
  $task = $asTask.MakeGenericMethod($type).Invoke($null, @($op))
  if ($task.Wait(5000)) { return $task.Result }
  return $null
}
try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
  [void][Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager,Windows.Media.Control,ContentType=WindowsRuntime]
  [void][Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties,Windows.Media.Control,ContentType=WindowsRuntime]
  [void][Windows.Media.MediaPlaybackAutoRepeatMode,Windows.Media,ContentType=WindowsRuntime]
  $mgrType  = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]
  $propType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties]
  $mgr = Await ($mgrType::RequestAsync()) $mgrType
  if ($null -eq $mgr) { throw 'RequestAsync returned nothing' }
  $smtc = $true
  Log 'media-session API ready'
} catch { Log ('media-session API unavailable: ' + $_.Exception.Message) }

$script:seenIds = ''
function Get-SpotifySession {
  if (-not $smtc) { return $null }
  $found = $null; $ids = @()
  foreach ($s in $mgr.GetSessions()) {
    $id = [string]$s.SourceAppUserModelId
    $ids += $id
    # anything Spotify, except this player's own (older builds registered one called SpotifySkin / WinampSkin)
    if ($null -eq $found -and $id -match 'Spotify' -and $id -notmatch 'SpotifySkin|WinampSkin') { $found = $s }
  }
  $joined = $ids -join ', '
  if ($joined -ne $script:seenIds) { $script:seenIds = $joined; Log ('media sessions: ' + $(if ($joined) { $joined } else { '(none)' }) + ' -> using ' + $(if ($found) { [string]$found.SourceAppUserModelId } else { 'none' })) }
  return $found
}

function Get-SmtcState($s) {
  $st = [string]$s.GetPlaybackInfo().PlaybackStatus
  if ($st -eq 'Closed' -or $st -eq 'Stopped') { return @{ status = 'stopped' } }
  $p = Await ($s.TryGetMediaPropertiesAsync()) $propType
  $t = $s.GetTimelineProperties()
  $dur = ($t.EndTime - $t.StartTime).TotalSeconds
  $pos = ($t.Position - $t.StartTime).TotalSeconds
  if ($st -eq 'Playing' -and $t.LastUpdatedTime.Year -gt 2000) {
    $pos += ([DateTimeOffset]::UtcNow - $t.LastUpdatedTime).TotalSeconds
  }
  if ($dur -gt 0 -and $pos -gt $dur) { $pos = $dur }
  if ($pos -lt 0) { $pos = 0 }
  $title = [string]$p.Title
  $artist = [string]$p.Artist
  $pi = $s.GetPlaybackInfo()
  $shuf = $null; $rep = $null
  try { if ($null -ne $pi.IsShuffleActive) { $shuf = [bool]$pi.IsShuffleActive } } catch {}
  try { if ($null -ne $pi.AutoRepeatMode) { $rep = ([string]$pi.AutoRepeatMode -ne 'None') } } catch {}
  $out = @{
    status   = $(if ($st -eq 'Playing') { 'playing' } else { 'paused' })
    title    = $title
    artist   = $artist
    id       = "$artist|$title|$([int]$dur)"
    duration = $dur
    position = $pos
    volume   = 0
    via      = 'media-session'
  }
  if ($null -ne $shuf) { $out.shuffle = $shuf }
  if ($null -ne $rep) { $out.repeat = $rep }
  return $out
}

# ---------- fallback: Spotify window title + media keys ----------
$script:fbTitle = ''; $script:fbArtist = ''; $script:fbPos = 0.0; $script:fbLast = Get-Date
$script:fbPlaying = $false
function Get-FallbackState {
  $p = Get-Process -Name Spotify -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle } | Select-Object -First 1
  if ($null -eq $p) { return @{ status = 'closed' } }
  $now = Get-Date
  $dt = ($now - $script:fbLast).TotalSeconds; $script:fbLast = $now
  $t = $p.MainWindowTitle
  if ($t -match '^Spotify(\s|$)') {
    $script:fbPlaying = $false          # idle or paused: the window title is just the product name
    if (-not $script:fbTitle) { return @{ status = 'stopped' } }
  } else {
    $script:fbPlaying = $true
    $artist = ''; $title = $t
    $i = $t.IndexOf(' - ')
    if ($i -gt 0) { $artist = $t.Substring(0, $i); $title = $t.Substring($i + 3) }
    if ($title -ne $script:fbTitle -or $artist -ne $script:fbArtist) { $script:fbTitle = $title; $script:fbArtist = $artist; $script:fbPos = 0.0 }
    elseif ($dt -lt 3) { $script:fbPos += $dt }
  }
  return @{
    status   = $(if ($script:fbPlaying) { 'playing' } else { 'paused' })
    title    = $script:fbTitle
    artist   = $script:fbArtist
    id       = "$($script:fbArtist)|$($script:fbTitle)"
    duration = 300          # unknown in this mode
    position = [Math]::Min($script:fbPos, 299)
    volume   = 0
    via      = 'window-title'
  }
}

$keysReady = $false
function Press-Key([int]$vk) {
  if (-not $script:keysReady) {
    Add-Type -Namespace Native -Name Keys -MemberDefinition '[DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, System.UIntPtr dwExtraInfo);'
    $script:keysReady = $true
  }
  [Native.Keys]::keybd_event([byte]$vk, 0, 0, [UIntPtr]::Zero)
  [Native.Keys]::keybd_event([byte]$vk, 0, 2, [UIntPtr]::Zero)
}


# ---------- Spotify's own volume (Windows Core Audio, per-app session) ----------
$volOk = $false
try {
  Add-Type -TypeDefinition @'
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;

namespace SkinVol {
  [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumeratorCom { }

  [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDeviceEnumerator {
    int EnumAudioEndpoints(int dataFlow, int stateMask, out IntPtr devices);
    int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice device);
  }
  [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDevice {
    int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object iface);
  }
  [ComImport, Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioSessionManager2 {
    int GetAudioSessionControl(IntPtr audioSessionGuid, int streamFlags, out IntPtr sessionControl);
    int GetSimpleAudioVolume(IntPtr audioSessionGuid, int streamFlags, out IntPtr audioVolume);
    int GetSessionEnumerator(out IAudioSessionEnumerator sessionEnum);
  }
  [ComImport, Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioSessionEnumerator {
    int GetCount(out int count);
    int GetSession(int index, out IAudioSessionControl2 session);
  }
  [ComImport, Guid("BFB7FF88-7239-4FC9-8FA2-07C950BE9C6D"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioSessionControl2 {
    int GetState(out int state);
    int GetDisplayName([MarshalAs(UnmanagedType.LPWStr)] out string name);
    int SetDisplayName([MarshalAs(UnmanagedType.LPWStr)] string name, ref Guid context);
    int GetIconPath([MarshalAs(UnmanagedType.LPWStr)] out string path);
    int SetIconPath([MarshalAs(UnmanagedType.LPWStr)] string path, ref Guid context);
    int GetGroupingParam(out Guid grouping);
    int SetGroupingParam(ref Guid grouping, ref Guid context);
    int RegisterAudioSessionNotification(IntPtr events);
    int UnregisterAudioSessionNotification(IntPtr events);
    int GetSessionIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string id);
    int GetSessionInstanceIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string id);
    int GetProcessId(out uint pid);
    int IsSystemSoundsSession();
    int SetDuckingPreference(bool optOut);
  }
  [ComImport, Guid("87CE5498-68D6-44E5-9215-6DA47EF883D8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface ISimpleAudioVolume {
    int SetMasterVolume(float level, ref Guid context);
    int GetMasterVolume(out float level);
    int SetMute(bool mute, ref Guid context);
    int GetMute(out bool mute);
  }

  public static class AppVolume {
    // level < 0 reads; level 0..1 writes. Returns the volume (0..100) of the first match, or -1.
    public static double Run(string processName, double level) {
      double result = -1;
      IAudioSessionEnumerator sessions = null;
      object mgrObj = null;
      try {
        IMMDeviceEnumerator en = (IMMDeviceEnumerator)new MMDeviceEnumeratorCom();
        IMMDevice dev;
        if (en.GetDefaultAudioEndpoint(0, 1, out dev) != 0) return -1;      // eRender, eMultimedia
        Guid iid = new Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F");
        dev.Activate(ref iid, 23, IntPtr.Zero, out mgrObj);                  // CLSCTX_ALL
        IAudioSessionManager2 mgr = (IAudioSessionManager2)mgrObj;
        if (mgr.GetSessionEnumerator(out sessions) != 0) return -1;
        int count; sessions.GetCount(out count);
        for (int i = 0; i < count; i++) {
          IAudioSessionControl2 ctl;
          if (sessions.GetSession(i, out ctl) != 0) continue;
          try {
            uint pid; ctl.GetProcessId(out pid);
            if (pid == 0) continue;
            string name;
            try { name = Process.GetProcessById((int)pid).ProcessName; } catch { continue; }
            if (!string.Equals(name, processName, StringComparison.OrdinalIgnoreCase)) continue;
            ISimpleAudioVolume vol = (ISimpleAudioVolume)ctl;
            Guid ctx = Guid.Empty;
            if (level >= 0) { vol.SetMasterVolume((float)Math.Max(0.0, Math.Min(1.0, level)), ref ctx); }
            float cur; vol.GetMasterVolume(out cur);
            if (result < 0) result = Math.Round(cur * 100.0);
          } finally { Marshal.ReleaseComObject(ctl); }
        }
      } catch { return -1; }
      finally {
        if (sessions != null) Marshal.ReleaseComObject(sessions);
        if (mgrObj != null) Marshal.ReleaseComObject(mgrObj);
      }
      return result;
    }
  }
}
'@
  $volOk = $true
  Log 'volume control ready'
} catch { Log ('volume control unavailable: ' + $_.Exception.Message) }
$script:volCache = -1.0; $script:volAt = [DateTime]::MinValue
# reading the volume walks the audio sessions: do it at most every 2 seconds, not on every poll
function Get-SpotifyVolume {
  if (-not $volOk) { return -1 }
  if (([DateTime]::UtcNow - $script:volAt).TotalSeconds -lt 2) { return $script:volCache }
  try { $script:volCache = [double][SkinVol.AppVolume]::Run('Spotify', -1.0) } catch { $script:volCache = -1.0 }
  $script:volAt = [DateTime]::UtcNow
  return $script:volCache
}
function Set-SpotifyVolume([double]$pct) { if (-not $volOk) { return }; try { $script:volCache = [double][SkinVol.AppVolume]::Run('Spotify', $pct / 100.0); $script:volAt = [DateTime]::UtcNow } catch {} }

# ---------- request handlers ----------
function Get-State {
  $s = Get-SpotifySession
  if ($null -ne $s) { $st = Get-SmtcState $s } else { $st = Get-FallbackState }
  if ($st.status -ne 'closed') { $st.volume = Get-SpotifyVolume }
  return $st
}

function Send-Command($name, $arg) {
  $s = Get-SpotifySession
  if ($null -ne $s) {
    switch ($name) {
      'play'      { [void](Await ($s.TryPlayAsync()) ([bool])) }
      'pause'     { [void](Await ($s.TryPauseAsync()) ([bool])) }
      'playpause' { [void](Await ($s.TryTogglePlayPauseAsync()) ([bool])) }
      'next'      { [void](Await ($s.TrySkipNextAsync()) ([bool])) }
      'previous'  { [void](Await ($s.TrySkipPreviousAsync()) ([bool])) }
      'shuffle'   { [void](Await ($s.TryChangeShuffleActiveAsync([bool][int]$arg)) ([bool])) }
      'repeat'    { $mode = $(if ([int]$arg) { [Windows.Media.MediaPlaybackAutoRepeatMode]::List } else { [Windows.Media.MediaPlaybackAutoRepeatMode]::None }); [void](Await ($s.TryChangeAutoRepeatModeAsync($mode)) ([bool])) }
      'seek'      { [void](Await ($s.TryChangePlaybackPositionAsync([int64]([double]$arg * 10000000))) ([bool])) }
    }
    return
  }
  switch ($name) {
    'play'      { if (-not $script:fbPlaying) { Press-Key 0xB3 } }
    'pause'     { if ($script:fbPlaying) { Press-Key 0xB3 } }
    'playpause' { Press-Key 0xB3 }
    'next'      { Press-Key 0xB0 }
    'previous'  { Press-Key 0xB1 }
  }
}

[Console]::Out.WriteLine('ready ' + (To-AsciiJson @{ smtc = $smtc; volume = $volOk }))

$lastErr = ''
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  $bits = $line.Trim() -split ' ', 3
  $id = $bits[0]
  $out = '{"status":"closed"}'
  try {
    if ($bits[1] -eq 'state') { $out = To-AsciiJson (Get-State) }
    elseif ($bits[1] -eq 'cmd')  { Send-Command $bits[2] $null; $out = '{"ok":true}' }
    elseif ($bits[1] -eq 'shuffle' -or $bits[1] -eq 'repeat') { Send-Command $bits[1] $bits[2]; $out = '{"ok":true}' }
    elseif ($bits[1] -eq 'skip') {
      # jump ahead N songs in one go: mute Spotify, skip quickly, put the volume back
      $n = [Math]::Max(0, [Math]::Min(40, [int]$bits[2]))
      $sess = Get-SpotifySession
      if ($null -ne $sess -and $n -gt 0) {
        $orig = -1.0
        if ($volOk) { try { $orig = [double][SkinVol.AppVolume]::Run('Spotify', -1.0) } catch {} }
        if ($orig -gt 0) { Set-SpotifyVolume 0 }
        try {
          for ($i = 0; $i -lt $n; $i++) {
            [void](Await ($sess.TrySkipNextAsync()) ([bool]))
            if ($i -lt $n - 1) { Start-Sleep -Milliseconds 90 }
          }
          Start-Sleep -Milliseconds 350   # let the last song start before the sound comes back
        } finally { if ($orig -gt 0) { Set-SpotifyVolume $orig } }
      }
      $out = '{"ok":true}'
    }
    elseif ($bits[1] -eq 'seek') { Send-Command 'seek' $bits[2]; $out = '{"ok":true}' }
    elseif ($bits[1] -eq 'vol')  { Set-SpotifyVolume ([double]::Parse($bits[2], [Globalization.CultureInfo]::InvariantCulture)); $out = '{"ok":true}' }
  } catch {
    $msg = $_.Exception.Message
    if ($msg -ne $lastErr) { Log ('request failed: ' + $msg); $lastErr = $msg }
  }
  [Console]::Out.WriteLine("$id $out")
}
