[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$BackupFile,
    [string]$DatabaseUrl = $env:DATABASE_URL,
    [switch]$AllowDataLoss
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

if (-not $AllowDataLoss) {
    throw "Restoring can overwrite existing objects. Re-run with -AllowDataLoss after verifying the target database."
}
if ([string]::IsNullOrWhiteSpace($DatabaseUrl)) {
    throw "DATABASE_URL or -DatabaseUrl is required."
}

$pgRestore = Resolve-PostgresTool "pg_restore"
if (-not (Test-Path -LiteralPath $BackupFile -PathType Leaf)) {
    throw "Backup file was not found: $BackupFile"
}

$checksumFile = "$BackupFile.sha256"
if (Test-Path -LiteralPath $checksumFile -PathType Leaf) {
    $expected = (Get-Content -Raw -Encoding ASCII -LiteralPath $checksumFile).Trim().Split()[0].ToLowerInvariant()
    $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $BackupFile).Hash.ToLowerInvariant()
    if ($expected -ne $actual) {
        throw "Backup checksum does not match: $BackupFile"
    }
}

# PostgreSQL diagnostics can contain connection details; expose only the exit code.
$previousErrorActionPreference = $ErrorActionPreference
try {
    $ErrorActionPreference = "Continue"
& $pgRestore `
    --dbname=$DatabaseUrl `
    --clean `
    --if-exists `
    --exit-on-error `
    --no-owner `
    --no-acl `
    --single-transaction `
    $BackupFile `
    *> $null
} finally {
    $ErrorActionPreference = $previousErrorActionPreference
}

if ($LASTEXITCODE -ne 0) {
    throw "pg_restore failed with exit code $LASTEXITCODE."
}

Write-Output "Restored $BackupFile"
