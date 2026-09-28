param([string]$Python = 'python')
$ErrorActionPreference = 'Stop'
$taskRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$taskBuild = Join-Path $taskRoot 'build\native'
New-Item -ItemType Directory -Force -Path $taskBuild | Out-Null
$taskCl = (Get-Command cl.exe -ErrorAction Stop).Source
$taskLink = (Get-Command link.exe -ErrorAction Stop).Source
Push-Location $taskBuild
try {
    & $taskCl /nologo /c /O2 /GS- /Zl /arch:IA32 /Fo:model-textures.obj (Join-Path $PSScriptRoot 'model-textures.c')
    if ($LASTEXITCODE -ne 0) { throw 'Model texture extension compilation failed.' }
    & $taskLink /nologo /DLL /NOENTRY /NODEFAULTLIB /MACHINE:X86 /MERGE:.rdata=.text /SECTION:.text,ER /OUT:model-textures.dll model-textures.obj
    if ($LASTEXITCODE -ne 0) { throw 'Model texture extension linking failed. Use an x86 MSVC developer shell.' }
    & $Python (Join-Path $PSScriptRoot 'model-texture-profile.py') --dll (Join-Path $taskBuild 'model-textures.dll') --output (Join-Path $taskBuild 'model-texture-runtime-profile.json')
    if ($LASTEXITCODE -ne 0) { throw 'Model texture profile extraction failed.' }
} finally { Pop-Location }
Write-Host 'Candidate profile created in build/native. Validate before updating core/model-texture-runtime-profile.json.'
