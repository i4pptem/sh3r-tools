$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'build-asi.ps1')
$taskRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
Push-Location $taskRoot
try {
    & cl.exe /nologo /MT /O2 /W4 /Fo:build/asi/test-loader.obj (Join-Path $PSScriptRoot 'test-loader-host.c') /link /MACHINE:X86 /DYNAMICBASE:NO /BASE:0x400000 /OUT:build/asi/test-loader-host.exe dinput8.lib winmm.lib
    if ($LASTEXITCODE -ne 0) { throw 'Loader integration host compilation failed.' }
    & node (Join-Path $PSScriptRoot 'test-loader-runtime.mjs')
    if ($LASTEXITCODE -ne 0) { throw 'DLL loader integration failed.' }
} finally { Pop-Location }
