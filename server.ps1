$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$AppRoot = Join-Path $ProjectRoot "app"
$DataRoot = Join-Path $ProjectRoot "data"
$BackupRoot = Join-Path $DataRoot "backups"
$LogRoot = Join-Path $ProjectRoot "logs"
$DatabasePath = Join-Path $DataRoot "database.json"
$LogPath = Join-Path $LogRoot "server.log"
$Port = 8765
$Sessions = @{}
$SessionHours = 12
$LastDailyBackupDate = $null

New-Item -ItemType Directory -Force -Path $DataRoot, $BackupRoot, $LogRoot | Out-Null

function Write-Log {
    param([string]$Message)
    $line = "{0}  {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
    Add-Content -LiteralPath $LogPath -Value $line -Encoding UTF8
}

function Send-Json {
    param(
        [System.Net.HttpListenerContext]$Context,
        [int]$StatusCode,
        [object]$Value
    )
    $json = $Value | ConvertTo-Json -Depth 30 -Compress
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
    $Context.Response.StatusCode = $StatusCode
    $Context.Response.ContentType = "application/json; charset=utf-8"
    $Context.Response.ContentLength64 = $bytes.Length
    $Context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    $Context.Response.OutputStream.Close()
}

function Send-Text {
    param(
        [System.Net.HttpListenerContext]$Context,
        [int]$StatusCode,
        [string]$Text,
        [string]$ContentType = "text/plain; charset=utf-8"
    )
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($Text)
    $Context.Response.StatusCode = $StatusCode
    $Context.Response.ContentType = $ContentType
    $Context.Response.ContentLength64 = $bytes.Length
    $Context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    $Context.Response.OutputStream.Close()
}

function Save-Database {
    param([string]$Json)

    # Validate the payload before replacing the current database.
    $parsed = $Json | ConvertFrom-Json
    if ($null -eq $parsed.books -or $null -eq $parsed.sales -or $null -eq $parsed.settings) {
        throw "Invalid database structure."
    }

    $tempPath = "$DatabasePath.tmp"
    [System.IO.File]::WriteAllText($tempPath, $Json, [System.Text.UTF8Encoding]::new($false))
    Move-Item -LiteralPath $tempPath -Destination $DatabasePath -Force
}

function New-Backup {
    if (-not (Test-Path -LiteralPath $DatabasePath)) {
        return $null
    }

    $name = "database-{0}.json" -f (Get-Date -Format "yyyyMMdd-HHmmss-fff")
    $destination = Join-Path $BackupRoot $name
    Copy-Item -LiteralPath $DatabasePath -Destination $destination -Force

    # Keep the most recent 30 backups.
    Get-ChildItem -LiteralPath $BackupRoot -Filter "database-*.json" |
        Sort-Object LastWriteTime -Descending |
        Select-Object -Skip 30 |
        Remove-Item -Force

    return $destination
}

function Get-DatabaseRevision {
    if (-not (Test-Path -LiteralPath $DatabasePath)) { return "0" }
    $item = Get-Item -LiteralPath $DatabasePath
    return "{0}-{1}" -f $item.LastWriteTimeUtc.Ticks, $item.Length
}

function Get-DefaultUsers {
    return @(
        @{ id="U001"; username="owner"; name="System Owner"; role="owner"; salt="s01"; passwordHash="2dbab9e2692dc22862154db758fd08face95e6d15b5fb2390995dad66bd0452c"; active=$true },
        @{ id="U002"; username="manager"; name="System Manager"; role="manager"; salt="s02"; passwordHash="a29c2fcb2de4e5175719cb5dfed4043da44b9baa5a87430eba6d1223e488d563"; active=$true },
        @{ id="U003"; username="accountant"; name="Accountant"; role="accountant"; salt="s03"; passwordHash="6b44de984c5a4ce8691a0bef70b679e88135ad7f4d05a11ffef3cc04e8c76a85"; active=$true },
        @{ id="U004"; username="cashier"; name="Cashier"; role="cashier"; salt="s04"; passwordHash="440aade91695513e752ac4ce674d1639c3ed697d0c4d2806edc15bd073e0aa61"; active=$true },
        @{ id="U005"; username="warehouse"; name="Warehouse"; role="warehouse"; salt="s05"; passwordHash="5c37d675c0fffbedd0f6acd3d75d409ee5c3a336574a058b575de03aeda5e9fd"; active=$true },
        @{ id="U006"; username="shipping"; name="Shipping"; role="shipping"; salt="s06"; passwordHash="7a53924916afbcba18d1f58c093f7fe110f88539803186401fdb2f280a769000"; active=$true }
    )
}

function Get-Users {
    if (Test-Path -LiteralPath $DatabasePath) {
        try {
            $db = Get-Content -Raw -LiteralPath $DatabasePath -Encoding UTF8 | ConvertFrom-Json
            if ($null -ne $db.users -and $db.users.Count -gt 0) { return @($db.users) }
        } catch {}
    }
    return @(Get-DefaultUsers)
}

function Get-PasswordHash {
    param([string]$Salt, [string]$Password)
    $bytes = [System.Text.Encoding]::UTF8.GetBytes("$Salt`:$Password")
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try { return ([System.BitConverter]::ToString($sha.ComputeHash($bytes))).Replace("-", "").ToLowerInvariant() }
    finally { $sha.Dispose() }
}

function Get-SessionUser {
    param([System.Net.HttpListenerRequest]$Request)
    $token = $Request.Headers["X-Session-Token"]
    if ([string]::IsNullOrWhiteSpace($token) -or -not $Sessions.ContainsKey($token)) { return $null }
    $session = $Sessions[$token]
    if ($session.expires -lt (Get-Date)) {
        $Sessions.Remove($token)
        return $null
    }
    $session.expires = (Get-Date).AddHours($SessionHours)
    return $session.user
}

function Require-Auth {
    param([System.Net.HttpListenerContext]$Context, [string[]]$Roles = @())
    $user = Get-SessionUser $Context.Request
    if ($null -eq $user) {
        Send-Json $Context 401 @{ ok=$false; message="Authentication required." }
        return $null
    }
    if ($Roles.Count -gt 0 -and $Roles -notcontains $user.username) {
        Send-Json $Context 403 @{ ok=$false; message="Permission denied." }
        return $null
    }
    return $user
}

function Get-ContentType {
    param([string]$Path)
    switch ([System.IO.Path]::GetExtension($Path).ToLowerInvariant()) {
        ".html" { return "text/html; charset=utf-8" }
        ".js" { return "application/javascript; charset=utf-8" }
        ".css" { return "text/css; charset=utf-8" }
        ".json" { return "application/json; charset=utf-8" }
        ".png" { return "image/png" }
        ".jpg" { return "image/jpeg" }
        ".jpeg" { return "image/jpeg" }
        ".svg" { return "image/svg+xml" }
        ".ico" { return "image/x-icon" }
        default { return "application/octet-stream" }
    }
}

$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add("http://127.0.0.1:$Port/")

try {
    $listener.Start()
    if (Test-Path -LiteralPath $DatabasePath) {
        New-Backup | Out-Null
        $LastDailyBackupDate = (Get-Date).Date
    }
    Write-Log "Server started on http://127.0.0.1:$Port/"
} catch {
    Write-Log "Failed to start server: $($_.Exception.Message)"
    exit 1
}

try {
    while ($listener.IsListening) {
        $context = $listener.GetContext()
        try {
            $request = $context.Request
            $path = [System.Uri]::UnescapeDataString($request.Url.AbsolutePath)
            $method = $request.HttpMethod.ToUpperInvariant()

            if ($null -eq $LastDailyBackupDate -or $LastDailyBackupDate -lt (Get-Date).Date) {
                New-Backup | Out-Null
                $LastDailyBackupDate = (Get-Date).Date
            }

            if ($path -eq "/api/health" -and $method -eq "GET") {
                Send-Json $context 200 @{
                    ok = $true
                    database = (Test-Path -LiteralPath $DatabasePath)
                    time = (Get-Date).ToString("o")
                }
                continue
            }

            if ($path -eq "/api/login" -and $method -eq "POST") {
                $reader = [System.IO.StreamReader]::new($request.InputStream, $request.ContentEncoding)
                $payload = $reader.ReadToEnd() | ConvertFrom-Json
                $reader.Dispose()
                $user = Get-Users | Where-Object { $_.username -eq $payload.username -and $_.active -ne $false } | Select-Object -First 1
                if ($null -eq $user -or (Get-PasswordHash $user.salt $payload.password) -ne $user.passwordHash) {
                    Start-Sleep -Milliseconds 350
                    Send-Json $context 401 @{ ok=$false; message="Invalid username or password." }
                } else {
                    $token = [Guid]::NewGuid().ToString("N")
                    $safeUser = @{ id=$user.id; username=$user.username; name=$user.name; role=$user.role }
                    $Sessions[$token] = @{ user=$safeUser; expires=(Get-Date).AddHours($SessionHours) }
                    Send-Json $context 200 @{ ok=$true; token=$token; user=$safeUser }
                    Write-Log "Login: $($user.username)"
                }
                continue
            }

            if ($path -eq "/api/session" -and $method -eq "GET") {
                $user = Get-SessionUser $request
                if ($null -eq $user) { Send-Json $context 401 @{ ok=$false } }
                else { Send-Json $context 200 @{ ok=$true; user=$user } }
                continue
            }

            if ($path -eq "/api/logout" -and $method -eq "POST") {
                $token = $request.Headers["X-Session-Token"]
                if ($token) { $Sessions.Remove($token) }
                Send-Json $context 200 @{ ok=$true }
                continue
            }

            if ($path -eq "/api/db" -and $method -eq "GET") {
                $user = Require-Auth $context
                if ($null -eq $user) { continue }
                if (-not (Test-Path -LiteralPath $DatabasePath)) {
                    Send-Json $context 404 @{ ok = $false; message = "Database has not been initialized." }
                } else {
                    $json = [System.IO.File]::ReadAllText($DatabasePath, [System.Text.Encoding]::UTF8)
                    $context.Response.Headers["X-DB-Revision"] = Get-DatabaseRevision
                    Send-Text $context 200 $json "application/json; charset=utf-8"
                }
                continue
            }

            if ($path -eq "/api/db" -and $method -eq "PUT") {
                $user = Require-Auth $context
                if ($null -eq $user) { continue }
                $expectedRevision = $request.Headers["If-Match"]
                $currentRevision = Get-DatabaseRevision
                if ($expectedRevision -and $expectedRevision -ne $currentRevision) {
                    Send-Json $context 409 @{ ok=$false; message="Data was modified in another window. Reload before saving."; revision=$currentRevision }
                    continue
                }
                $reader = [System.IO.StreamReader]::new($request.InputStream, $request.ContentEncoding)
                $body = $reader.ReadToEnd()
                $reader.Dispose()

                if (Test-Path -LiteralPath $DatabasePath) {
                    New-Backup | Out-Null
                }
                Save-Database $body
                $context.Response.Headers["X-DB-Revision"] = Get-DatabaseRevision
                Send-Json $context 200 @{ ok = $true; message = "Database saved successfully."; revision=(Get-DatabaseRevision) }
                continue
            }

            if ($path -eq "/api/backup" -and $method -eq "POST") {
                $user = Require-Auth $context @("owner","manager","accountant")
                if ($null -eq $user) { continue }
                $backup = New-Backup
                if ($null -eq $backup) {
                    Send-Json $context 404 @{ ok = $false; message = "There is no database to back up." }
                } else {
                    Send-Json $context 200 @{ ok = $true; file = [System.IO.Path]::GetFileName($backup) }
                }
                continue
            }

            if ($path -eq "/api/backups" -and $method -eq "GET") {
                $user = Require-Auth $context @("owner","manager")
                if ($null -eq $user) { continue }
                $files = Get-ChildItem -LiteralPath $BackupRoot -Filter "database-*.json" |
                    Sort-Object LastWriteTime -Descending |
                    Select-Object -First 30 |
                    ForEach-Object { @{ name=$_.Name; date=$_.LastWriteTime.ToString("o"); size=$_.Length } }
                Send-Json $context 200 @{ ok=$true; backups=@($files) }
                continue
            }

            if ($path -eq "/api/restore" -and $method -eq "POST") {
                $user = Require-Auth $context @("owner","manager")
                if ($null -eq $user) { continue }
                $reader = [System.IO.StreamReader]::new($request.InputStream, $request.ContentEncoding)
                $payload = $reader.ReadToEnd() | ConvertFrom-Json
                $reader.Dispose()
                $fileName = [System.IO.Path]::GetFileName([string]$payload.file)
                $source = Join-Path $BackupRoot $fileName
                if (-not (Test-Path -LiteralPath $source)) {
                    Send-Json $context 404 @{ ok=$false; message="Backup not found." }
                } else {
                    New-Backup | Out-Null
                    Copy-Item -LiteralPath $source -Destination $DatabasePath -Force
                    Send-Json $context 200 @{ ok=$true; revision=(Get-DatabaseRevision) }
                    Write-Log "Database restored by $($user.username): $fileName"
                }
                continue
            }

            if ($path -eq "/api/reset" -and $method -eq "POST") {
                Send-Json $context 403 @{ ok = $false; message = "Database reset is disabled." }
                continue
            }

            if ($path.StartsWith("/api/")) {
                Send-Json $context 404 @{ ok = $false; message = "API route not found." }
                continue
            }

            $relative = if ($path -eq "/") { "index.html" } else { $path.TrimStart("/") }
            $candidate = Join-Path $AppRoot ($relative.Replace("/", [System.IO.Path]::DirectorySeparatorChar))
            $resolved = [System.IO.Path]::GetFullPath($candidate)
            $appResolved = [System.IO.Path]::GetFullPath($AppRoot)

            if (-not $resolved.StartsWith($appResolved, [System.StringComparison]::OrdinalIgnoreCase)) {
                Send-Text $context 403 "Forbidden"
                continue
            }

            if (-not (Test-Path -LiteralPath $resolved -PathType Leaf)) {
                Send-Text $context 404 "Not found"
                continue
            }

            $bytes = [System.IO.File]::ReadAllBytes($resolved)
            $context.Response.StatusCode = 200
            $context.Response.ContentType = Get-ContentType $resolved
            $context.Response.ContentLength64 = $bytes.Length
            $context.Response.Headers["Cache-Control"] = "no-cache"
            $context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
            $context.Response.OutputStream.Close()
        } catch {
            Write-Log "Request error: $($_.Exception.Message)"
            try {
                Send-Json $context 500 @{ ok = $false; message = "Internal server error."; detail = $_.Exception.Message }
            } catch {}
        }
    }
} finally {
    $listener.Stop()
    $listener.Close()
    Write-Log "Server stopped."
}
