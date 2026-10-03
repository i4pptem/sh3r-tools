$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'build-asi.ps1')
$taskRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
Push-Location $taskRoot
try {
    & cl.exe /nologo /MT /O2 /W4 /Fo:build/asi/test-compact.obj (Join-Path $PSScriptRoot 'test-compact-host.c') /link /MACHINE:X86 /OUT:build/asi/test-compact-host.exe kernel32.lib user32.lib advapi32.lib
    if ($LASTEXITCODE -ne 0) { throw 'Native compact asset test compilation failed.' }
    & node (Join-Path $PSScriptRoot 'test-compact-runtime.mjs')
    if ($LASTEXITCODE -ne 0) { throw 'Native compact asset verification failed.' }
} finally { Pop-Location }
