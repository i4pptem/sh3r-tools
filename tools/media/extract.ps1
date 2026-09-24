param([Parameter(Mandatory=$true)][string]$Archive, [Parameter(Mandatory=$true)][string]$Destination)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$taskDestination = [IO.Path]::GetFullPath($Destination).TrimEnd('\') + '\'
$taskZip = [IO.Compression.ZipFile]::OpenRead([IO.Path]::GetFullPath($Archive))
try {
    foreach ($taskEntry in $taskZip.Entries) {
        $taskTarget = [IO.Path]::GetFullPath([IO.Path]::Combine($taskDestination, $taskEntry.FullName))
        if (!$taskTarget.StartsWith($taskDestination, [StringComparison]::OrdinalIgnoreCase)) {
            throw 'Archive entry escapes the extraction directory.'
        }
    }
} finally { $taskZip.Dispose() }
[IO.Compression.ZipFile]::ExtractToDirectory([IO.Path]::GetFullPath($Archive), [IO.Path]::GetFullPath($Destination))
