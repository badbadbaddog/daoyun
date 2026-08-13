[CmdletBinding()]
param(
    [string]$DatabaseUrl = $env:DATABASE_URL,
    [string]$OutputDirectory = "backups/postgres"
)

$ErrorActionPreference = "Stop"

function Resolve-PostgresTool([string]$Name) {
    $command = Get-Command $Name -ErrorAction SilentlyContinue
    if ($null -ne $command) {
        return $command.Source
    }

    $candidates = @(
        (Join-Path $env:ProgramFiles "PostgreSQL\16\bin\$Name.exe"),
        (Join-Path ${env:ProgramFiles(x86)} "PostgreSQL\16\bin\$Name.exe")
    ) | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) }

    if ($candidates.Count -gt 0) {
        return $candidates[0]
    }

    throw "$Name was not found on PATH or in the default PostgreSQL 16 installation directory."
}

if ([string]::IsNullOrWhiteSpace($DatabaseUrl)) {
    throw "DATABASE_URL or -DatabaseUrl is required."
}

$pgDump = Resolve-PostgresTool "pg_dump"

New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
$timestamp = [DateTime]::UtcNow.ToString("yyyyMMddTHHmmssZ")
$backupPath = Join-Path $OutputDirectory "daoyun-$timestamp.dump"

& $pgDump `
    --dbname=$DatabaseUrl `
    --format=custom `
    --no-owner `
    --no-acl `
    --file=$backupPath

if ($LASTEXITCODE -ne 0) {
    Remove-Item -LiteralPath $backupPath -Force -ErrorAction SilentlyContinue
    throw "pg_dump failed with exit code $LASTEXITCODE."
}

$hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $backupPath).Hash.ToLowerInvariant()
Set-Content -Encoding ASCII -NoNewline -LiteralPath "$backupPath.sha256" -Value "$hash  $(Split-Path -Leaf $backupPath)"
Write-Output $backupPath
