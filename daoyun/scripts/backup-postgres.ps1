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

    $candidates = @($env:ProgramFiles, ${env:ProgramFiles(x86)}) | Where-Object { $_ } | ForEach-Object { Join-Path $_ "PostgreSQL\16\bin\$Name.exe" } | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) }

    if ($candidates.Count -gt 0) {
        return @($candidates)[0]
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

# PostgreSQL diagnostics can contain connection details; expose only the exit code.
$previousErrorActionPreference = $ErrorActionPreference
try {
    $ErrorActionPreference = "Continue"
& $pgDump `
    --dbname=$DatabaseUrl `
    --format=custom `
    --no-owner `
    --no-acl `
    --file=$backupPath `
    *> $null
} finally {
    $ErrorActionPreference = $previousErrorActionPreference
}

if ($LASTEXITCODE -ne 0) {
    Remove-Item -LiteralPath $backupPath -Force -ErrorAction SilentlyContinue
    throw "pg_dump failed with exit code $LASTEXITCODE."
}

$hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $backupPath).Hash.ToLowerInvariant()
Set-Content -Encoding ASCII -NoNewline -LiteralPath "$backupPath.sha256" -Value "$hash  $(Split-Path -Leaf $backupPath)"
Write-Output $backupPath
