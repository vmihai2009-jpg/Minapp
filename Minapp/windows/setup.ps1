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
  if (-not (Test-Path $exe)) {
    Write-Host 'First run: downloading the player engine (about 120 MB). This only happens once...'
    $zip = Join-Path $root 'electron.zip'
    $tmp = Join-Path $root 'runtime.tmp'
    if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp }
    Get-File "https://github.com/electron/electron/releases/download/v$electronVersion/electron-v$electronVersion-win32-$arch.zip" $zip
    Write-Host 'Unpacking...'
    Expand-Archive -Path $zip -DestinationPath $tmp -Force
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

  # files from a downloaded zip carry a "blocked" mark that can make Windows or antivirus nag
  Get-ChildItem -Path $app -File -ErrorAction SilentlyContinue | Unblock-File -ErrorAction SilentlyContinue

  Start-Process -FilePath $exe -ArgumentList ('"' + $app + '"') -WorkingDirectory $app
}
catch {
  Write-Host ''
  Write-Host "Setup failed: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host 'If you are on a work or school network, it may block github.com or registry.npmjs.org.'
  exit 1
}
