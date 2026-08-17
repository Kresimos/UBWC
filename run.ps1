#Requires -Version 5.1
<#
    Start the kit app so a phone can open it. The Windows twin of run.sh.

      .\run.ps1            local network: your phone and this PC on the same wifi
      .\run.ps1 --share    public HTTPS link: works anywhere, share it with anyone
      .\run.ps1 --local    loopback only, http://127.0.0.1:8000, nothing exposed

    Both phone modes print the URL and a QR code to point a camera at. See
    TESTING.md for what to do when one of them will not connect.
#>
param([Parameter(ValueFromRemainingArguments = $true)] [string[]] $Rest)

$ErrorActionPreference = 'Stop'
Set-Location -Path $PSScriptRoot

$Port = if ($env:UBWC_PORT) { $env:UBWC_PORT } else { '8000' }

$Mode = 'lan'
foreach ($arg in $Rest) {
    switch -Regex ($arg) {
        '^--?share$' { $Mode = 'share' }
        '^--?local$' { $Mode = 'local' }
        default {
            Write-Error "usage: .\run.ps1 [--share|--local]"
            exit 2
        }
    }
}

# --------------------------------------------------------------------------- #
# Environment. Kept in .venv so a fresh clone needs nothing but Python 3.
# --------------------------------------------------------------------------- #
$PY = Join-Path $PSScriptRoot '.venv\Scripts\python.exe'

if (-not (Test-Path $PY)) {
    Write-Host "Creating .venv ..."
    # `py` is the launcher shipped with python.org installs; fall back to
    # whatever `python` is on PATH (Microsoft Store builds have no `py`).
    $bootstrap = if (Get-Command py -ErrorAction SilentlyContinue) { 'py' } else { 'python' }
    $launcherArgs = if ($bootstrap -eq 'py') { @('-3', '-m', 'venv', '.venv') } else { @('-m', 'venv', '.venv') }
    & $bootstrap @launcherArgs
    if (-not (Test-Path $PY)) {
        Write-Error "Could not create .venv. Install Python 3 from python.org and try again."
        exit 1
    }
}

# Re-install only when requirements.txt is newer than the last successful run,
# so the usual start is instant.
$stamp = Join-Path $PSScriptRoot '.venv\.requirements-stamp'
$needsInstall = $true
if (Test-Path $stamp) {
    $reqTime = (Get-Item 'requirements.txt').LastWriteTimeUtc
    $stampTime = (Get-Item $stamp).LastWriteTimeUtc
    $needsInstall = $reqTime -gt $stampTime
}
if ($needsInstall) {
    Write-Host "Installing dependencies ..."
    & $PY -m pip install --quiet --upgrade pip
    & $PY -m pip install --quiet -r requirements.txt
    # Pure-python, dev-only: draws the QR codes below. Never fatal if it fails.
    try { & $PY -m pip install --quiet qrcode } catch { }
    New-Item -ItemType File -Path $stamp -Force | Out-Null
}

# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
$QrScript = @'
import sys
try:
    import qrcode
except ImportError:
    sys.exit(0)
q = qrcode.QRCode(border=2)
q.add_data(sys.argv[1])
# invert=True renders light modules as blocks, which is what scans on a
# dark terminal. On a light terminal the printed URL is the fallback.
q.print_ascii(invert=True)
'@

function Write-Qr([string] $Url) {
    try { $QrScript | & $PY - $Url } catch { }
}

# The QR always encodes $Url; a second address, if given, is shown under it
# and explained by $Note below the code.
function Write-Banner([string] $Url, [string] $Second, [string] $Note) {
    Write-Host ""
    Write-Host "  ------------------------------------------------------------"
    Write-Host "  $Url"
    if ($Second) { Write-Host "  $Second" }
    Write-Host "  ------------------------------------------------------------"
    Write-Host ""
    Write-Qr $Url
    if ($Note) {
        Write-Host "  $Note"
        Write-Host ""
    }
    Write-Host "  Ctrl-C to stop."
    Write-Host ""
}

# This PC's address on the wifi. Skips VPN and virtual adapters, which
# otherwise hand out an address no phone on your wifi can reach.
function Get-LanIp {
    $skip = 'surfshark|openvpn|wireguard|tailscale|zerotier|hamachi|vmware|virtualbox|hyper-v|vethernet|loopback|bluetooth'
    $candidates = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Where-Object {
            $_.IPAddress -notlike '127.*' -and
            $_.IPAddress -notlike '169.254.*' -and
            $_.InterfaceAlias -notmatch $skip
        }
    # Prefer an interface that actually carries a default route, so a spare
    # NIC with a stale address does not win.
    $routed = Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue |
        Sort-Object RouteMetric | Select-Object -ExpandProperty InterfaceIndex
    foreach ($idx in $routed) {
        $hit = $candidates | Where-Object { $_.InterfaceIndex -eq $idx } | Select-Object -First 1
        if ($hit) { return $hit.IPAddress }
    }
    $fallback = $candidates | Select-Object -First 1
    if ($fallback) { return $fallback.IPAddress }
    return $null
}

# Windows only answers to <name>.local when Apple's Bonjour service is
# installed (it ships with iTunes). Without it the IP is the only way in.
function Get-MdnsHost {
    $svc = Get-Service -Name 'Bonjour Service' -ErrorAction SilentlyContinue
    if ($svc -and $svc.Status -eq 'Running') { return "$env:COMPUTERNAME.local" }
    return $null
}

# The Windows firewall is the usual reason a phone cannot connect, and it
# fails silently: the server looks fine from this PC either way. Warn early.
function Test-FirewallPath {
    $public = @(Get-NetConnectionProfile -ErrorAction SilentlyContinue |
        Where-Object { $_.NetworkCategory -eq 'Public' })
    $rule = Get-NetFirewallRule -DisplayName 'UBWC kit app' -ErrorAction SilentlyContinue

    if ($rule -and -not $public) { return }

    Write-Host ""
    Write-Host "  Note: Windows Firewall may block your phone." -ForegroundColor Yellow
    if ($public) {
        $names = ($public | ForEach-Object { $_.Name }) -join ', '
        Write-Host "  This network ($names) is set to Public, which blocks incoming"
        Write-Host "  connections. In an Administrator PowerShell:"
        Write-Host ""
        Write-Host "    Set-NetConnectionProfile -InterfaceAlias 'Wi-Fi' -NetworkCategory Private"
    }
    if (-not $rule) {
        Write-Host ""
        Write-Host "  There is no firewall rule for port $Port. In an Administrator PowerShell:"
        Write-Host ""
        Write-Host "    New-NetFirewallRule -DisplayName 'UBWC kit app' -Direction Inbound ``"
        Write-Host "      -Action Allow -Protocol TCP -LocalPort $Port -Profile Private"
    }
    Write-Host ""
}

# UBWC_DEV stops the phone caching stale CSS and JS between edits.
$env:UBWC_DEV = '1'
$env:UBWC_PORT = $Port

# --------------------------------------------------------------------------- #
# Loopback only
# --------------------------------------------------------------------------- #
if ($Mode -eq 'local') {
    $env:UBWC_HOST = '127.0.0.1'
    Write-Host ""
    Write-Host "  http://127.0.0.1:$Port"
    Write-Host ""
    & $PY server.py
    exit $LASTEXITCODE
}

# --------------------------------------------------------------------------- #
# Same-wifi: bind every interface and hand out this PC's address
# --------------------------------------------------------------------------- #
if ($Mode -eq 'lan') {
    $ip = Get-LanIp
    if (-not $ip) {
        Write-Host "No network address found. Are you connected to wifi?" -ForegroundColor Red
        Write-Host "You can still use:  .\run.ps1 --share"
        exit 1
    }
    $env:UBWC_HOST = '0.0.0.0'
    $mdns = Get-MdnsHost
    if ($mdns) {
        Write-Banner "http://${ip}:$Port" `
                     "http://${mdns}:$Port   (same server, stable address)" `
                     "The .local address survives this PC getting a new IP, so use it
  for a home-screen icon. Same wifi only, and a few networks block it."
    }
    else {
        Write-Banner "http://${ip}:$Port" $null $null
    }
    Test-FirewallPath
    & $PY server.py
    exit $LASTEXITCODE
}

# --------------------------------------------------------------------------- #
# Public link: a Cloudflare quick tunnel in front of the local server
# --------------------------------------------------------------------------- #
if (-not (Get-Command cloudflared -ErrorAction SilentlyContinue)) {
    Write-Host "--share needs cloudflared. Install it with:" -ForegroundColor Red
    Write-Host ""
    Write-Host "    winget install --id Cloudflare.cloudflared"
    Write-Host ""
    exit 1
}

$env:UBWC_HOST = '127.0.0.1'
$outLog = Join-Path $env:TEMP 'ubwc-tunnel.out'
$errLog = Join-Path $env:TEMP 'ubwc-tunnel.err'
$server = $null
$tunnel = $null

try {
    $server = Start-Process -FilePath $PY -ArgumentList 'server.py' -NoNewWindow -PassThru
    # Start-Process cannot point both streams at one file; cloudflared prints
    # the URL to stderr, so both are searched below.
    $tunnel = Start-Process -FilePath 'cloudflared' `
        -ArgumentList 'tunnel', '--url', "http://127.0.0.1:$Port" `
        -NoNewWindow -PassThru `
        -RedirectStandardOutput $outLog -RedirectStandardError $errLog

    Write-Host "Opening a public link ..."
    $url = $null
    foreach ($i in 1..40) {
        $text = @()
        foreach ($log in @($outLog, $errLog)) {
            if (Test-Path $log) { $text += Get-Content $log -ErrorAction SilentlyContinue }
        }
        $match = $text | Select-String -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' |
            Select-Object -First 1
        if ($match) {
            $url = $match.Matches[0].Value
            break
        }
        # Fail fast if either process died rather than waiting out the timeout.
        if ($server.HasExited) {
            Write-Host "Server exited:" -ForegroundColor Red
            $text | Write-Host
            exit 1
        }
        if ($tunnel.HasExited) {
            Write-Host "Tunnel exited:" -ForegroundColor Red
            $text | Write-Host
            exit 1
        }
        Start-Sleep -Milliseconds 500
    }

    if (-not $url) {
        Write-Host "Could not get a tunnel URL. cloudflared said:" -ForegroundColor Red
        foreach ($log in @($outLog, $errLog)) {
            if (Test-Path $log) { Get-Content $log | Write-Host }
        }
        exit 1
    }

    Write-Banner $url $null $null
    Write-Host "  This link is temporary and dies when you Ctrl-C. Anyone with it can"
    Write-Host "  reach the app, so do not post it anywhere public."
    Write-Host ""
    Wait-Process -Id $server.Id
}
finally {
    foreach ($proc in @($server, $tunnel)) {
        if ($proc -and -not $proc.HasExited) {
            Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
        }
    }
    Remove-Item $outLog, $errLog -ErrorAction SilentlyContinue
}
