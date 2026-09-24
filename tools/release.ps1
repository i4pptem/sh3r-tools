$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$taskRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$taskManifest = Get-Content -Raw -LiteralPath (Join-Path $taskRoot 'package.json') | ConvertFrom-Json
$taskVersion = $taskManifest.version
if ($taskVersion -notmatch '^\d+\.\d+\.\d+([.-][a-zA-Z0-9.-]+)?$') { throw 'Invalid release version.' }
$taskPortable = [IO.Path]::GetFullPath((Join-Path $taskRoot "dist\$taskVersion\Silent Hill 3 Tools-win32-x64"))
if (!$taskPortable.StartsWith($taskRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Portable path escapes repository.' }
if (!(Test-Path -LiteralPath (Join-Path $taskPortable 'Silent Hill 3 Tools.exe'))) { throw 'Run pnpm package first.' }
if (Test-Path -LiteralPath (Join-Path $taskPortable 'resources\app\tools\media\runtime')) { throw 'Public package must exclude the optional media runtime.' }
$taskOutput = Join-Path $taskRoot 'release-assets'
New-Item -ItemType Directory -Force -Path $taskOutput | Out-Null
$taskBinaryZip = Join-Path $taskOutput "Silent-Hill-3-Tools-$taskVersion-win-x64.zip"
$taskSourceZip = Join-Path $taskOutput "Silent-Hill-3-Tools-$taskVersion-source.zip"
foreach ($taskZipPath in @($taskBinaryZip, $taskSourceZip)) {
    if (Test-Path -LiteralPath $taskZipPath) { throw "Release already exists: $taskZipPath" }
}

function Get-ReleaseHash([string]$File) {
    $taskInput = [IO.File]::OpenRead($File)
    $taskHasher = [Security.Cryptography.SHA256]::Create()
    try { return [BitConverter]::ToString($taskHasher.ComputeHash($taskInput)).Replace('-', '') }
    finally { $taskInput.Dispose(); $taskHasher.Dispose() }
}

function Write-VerifiedZip([string]$Archive, [string]$Base, [string]$Prefix, [string[]]$Files) {
    $taskStream = [IO.File]::Open($Archive, [IO.FileMode]::CreateNew)
    $taskZip = New-Object IO.Compression.ZipArchive($taskStream, [IO.Compression.ZipArchiveMode]::Create)
    $taskExpected = @{}
    try {
        foreach ($taskRelative in $Files) {
            $taskFile = [IO.Path]::GetFullPath((Join-Path $Base $taskRelative))
            if (!$taskFile.StartsWith($Base.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'File escapes archive source.' }
            $taskName = $Prefix + '/' + $taskRelative.Replace('\', '/')
            [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($taskZip, $taskFile, $taskName, [IO.Compression.CompressionLevel]::Optimal) | Out-Null
            $taskExpected[$taskName] = (Get-ReleaseHash $taskFile)
        }
    } finally { $taskZip.Dispose(); $taskStream.Dispose() }
    $taskRead = [IO.Compression.ZipFile]::OpenRead($Archive)
    try {
        if ($taskRead.Entries.Count -ne $taskExpected.Count) { throw 'ZIP entry count mismatch.' }
        foreach ($taskEntry in $taskRead.Entries) {
            if (!$taskExpected.ContainsKey($taskEntry.FullName)) { throw 'Unexpected ZIP entry.' }
            $taskInput = $taskEntry.Open()
            $taskHasher = [Security.Cryptography.SHA256]::Create()
            try { $taskHash = [BitConverter]::ToString($taskHasher.ComputeHash($taskInput)).Replace('-', '') }
            finally { $taskInput.Dispose(); $taskHasher.Dispose() }
            if ($taskHash -ne $taskExpected[$taskEntry.FullName]) { throw "ZIP content mismatch: $($taskEntry.FullName)" }
        }
    } finally { $taskRead.Dispose() }
    Write-Host "Verified $($taskExpected.Count) files: $Archive"
}

Push-Location $taskRoot
try {
    & node tools/check-repository.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Source checks failed.' }
    $taskSourceFiles = & node tools/source-files.mjs --json
    if ($LASTEXITCODE -ne 0) { throw 'Source inventory failed.' }
    $taskSourceFiles = $taskSourceFiles | ConvertFrom-Json
    $taskPortableFiles = Get-ChildItem -LiteralPath $taskPortable -File -Recurse | ForEach-Object { $_.FullName.Substring($taskPortable.Length + 1) }
    Write-VerifiedZip $taskBinaryZip $taskPortable 'Silent Hill 3 Tools' $taskPortableFiles
    Write-VerifiedZip $taskSourceZip $taskRoot "sh3r-tools-$taskVersion" $taskSourceFiles
    $taskChecksums = foreach ($taskZipPath in @($taskBinaryZip, $taskSourceZip)) {
        ((Get-ReleaseHash $taskZipPath).ToLowerInvariant() + '  ' + [IO.Path]::GetFileName($taskZipPath))
    }
    [IO.File]::WriteAllText((Join-Path $taskOutput 'SHA256SUMS.txt'), ($taskChecksums -join "`n") + "`n", [Text.Encoding]::ASCII)
} finally { Pop-Location }
