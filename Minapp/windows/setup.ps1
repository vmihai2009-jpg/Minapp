# Portable launcher: needs no install and no admin rights.
# First run downloads the player engine (Electron) and Webamp into this folder.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 -bor [Net.SecurityProtocolType]::Tls13 }
catch { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 }

# Downloads can drop on flaky networks: retry a few times and never keep a half-written file.
function Get-File($uri, $out) {
  for ($i = 1; $i -le 4; $i++) {
    try { Invoke-WebRequest -UseBasicParsing -Uri $uri -OutFile $out; return }
    catch {
      if (Test-Path $out) { Remove-Item -Force $out }
      if ($i -eq 4) { throw }
      Write-Host "Download failed ($($_.Exception.Message)). Retrying ($i/3)..."
      Start-Sleep -Seconds (2 * $i)
    }
  }
}

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$app  = Join-Path $root 'app'
$rt   = Join-Path $root 'runtime'
$electronVersion = '44.7.0'
$webampVersion   = '2.3.1'
$arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }

try {
  $exe = Join-Path $rt 'electron.exe'
  if (-not (Test-Path $exe) -and -not (Test-Path (Join-Path $rt 'Minapp.exe'))) {
    Write-Host 'First run: downloading the player engine (about 120 MB). This only happens once...'
    $zip = Join-Path $root 'electron.zip'
    $tmp = Join-Path $root 'runtime.tmp'
    if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp }
    Get-File "https://github.com/electron/electron/releases/download/v$electronVersion/electron-v$electronVersion-win32-$arch.zip" $zip
    Write-Host 'Unpacking...'
    # tar.exe (built into Windows 10+) unpacks the 120 MB archive in seconds; Expand-Archive takes a minute or more
    New-Item -ItemType Directory -Force $tmp | Out-Null
    & tar.exe -xf $zip -C $tmp
    if ($LASTEXITCODE -ne 0) { Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue; Expand-Archive -Path $zip -DestinationPath $tmp -Force }
    if (Test-Path $rt) { Remove-Item -Recurse -Force $rt }
    Move-Item $tmp $rt
    Remove-Item $zip
  }

  $wa = Join-Path $app 'node_modules\webamp'
  if (-not (Test-Path (Join-Path $wa 'built\webamp.bundle.min.js'))) {
    Write-Host 'First run: downloading Webamp...'
    $tgz = Join-Path $root 'webamp.tgz'
    $tmp = Join-Path $root 'webamp.tmp'
    if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp }
    New-Item -ItemType Directory -Force $tmp | Out-Null
    Get-File "https://registry.npmjs.org/webamp/-/webamp-$webampVersion.tgz" $tgz
    & tar.exe -xzf $tgz -C $tmp
    if ($LASTEXITCODE -ne 0) { throw 'Could not unpack Webamp (tar.exe failed).' }
    New-Item -ItemType Directory -Force (Join-Path $app 'node_modules') | Out-Null
    if (Test-Path $wa) { Remove-Item -Recurse -Force $wa }
    Move-Item (Join-Path $tmp 'package') $wa
    Remove-Item -Recurse -Force $tmp
    Remove-Item $tgz
  }

  # Brand the engine: name + icon inside the exe, and rename it to Minapp.exe, so the taskbar, Task Manager and
  # Alt-Tab say Minapp instead of Electron. Failure here only costs the label; the app still runs.
  $mx = Join-Path $rt 'Minapp.exe'
  if (-not (Test-Path $mx) -and (Test-Path $exe)) {
    try {
      $rc = Join-Path $root 'rcedit.exe'
      Get-File 'https://github.com/electron/rcedit/releases/download/v2.0.0/rcedit-x64.exe' $rc
      & $rc $exe --set-icon (Join-Path $app 'icon.ico') --set-version-string FileDescription 'Minapp' `
        --set-version-string ProductName 'Minapp' --set-version-string InternalName 'Minapp' `
        --set-version-string OriginalFilename 'Minapp.exe' --set-version-string CompanyName 'Minapp'
      if ($LASTEXITCODE -ne 0) { Write-Host 'Could not set the Minapp icon on the engine (continuing).' }
    } catch { Write-Host "Could not brand the engine: $($_.Exception.Message) (continuing)." }
    finally { Remove-Item -Force (Join-Path $root 'rcedit.exe') -ErrorAction SilentlyContinue }
    try { Rename-Item -Path $exe -NewName 'Minapp.exe' -ErrorAction Stop } catch { Write-Host 'Could not rename the engine (is Minapp still running?).' }
  }
  if (Test-Path $mx) { $exe = $mx }

  # files from a downloaded zip carry a "blocked" mark that can make Windows or antivirus nag
  Get-ChildItem -Path $app -File -ErrorAction SilentlyContinue | Unblock-File -ErrorAction SilentlyContinue
  Get-ChildItem -Path $root -File -ErrorAction SilentlyContinue | Unblock-File -ErrorAction SilentlyContinue

  Start-Process -FilePath $exe -ArgumentList ('"' + $app + '"') -WorkingDirectory $app
}
catch {
  try { New-Item -ItemType Directory -Force (Join-Path $root 'data') | Out-Null; Add-Content -Path (Join-Path $root 'data\setup.log') -Value ((Get-Date -Format s) + ' ' + $_.Exception.Message) } catch {}
  Write-Host ''
  Write-Host "Setup failed: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host 'If you are on a work or school network, it may block github.com or registry.npmjs.org.'
  exit 1
}
