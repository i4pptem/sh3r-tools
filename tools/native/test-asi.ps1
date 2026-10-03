$ErrorActionPreference = 'Stop'
try {
    & (Join-Path $PSScriptRoot 'build-asi.ps1') -TestBuild
    $taskRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
    Push-Location $taskRoot
    try {
        & cl.exe /nologo /MT /O2 /W4 /Fo:build/asi/test-host.obj (Join-Path $PSScriptRoot 'test-asi-host.c') /link /MACHINE:X86 /DYNAMICBASE:NO /BASE:0x400000 /OUT:build/asi/test-asi-host.exe /EXPORT:GetOverloadPathW=_GetOverloadPathW@8
        if ($LASTEXITCODE -ne 0) { throw 'Native test host compilation failed.' }
        & node (Join-Path $PSScriptRoot 'test-asi-runtime.mjs')
        if ($LASTEXITCODE -ne 0) { throw 'Native ASI checks failed.' }
    } finally { Pop-Location }
} finally { & (Join-Path $PSScriptRoot 'build-asi.ps1') }
