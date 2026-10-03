param([switch]$TestBuild)
$ErrorActionPreference = 'Stop'
$taskRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$taskBuild = Join-Path $taskRoot 'build\asi'
New-Item -ItemType Directory -Force -Path $taskBuild | Out-Null
$taskVswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
$taskVs = & $taskVswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (!$taskVs) { throw 'Install the Visual Studio Desktop development with C++ workload.' }
Import-Module (Join-Path $taskVs 'Common7\Tools\Microsoft.VisualStudio.DevShell.dll')
Enter-VsDevShell -VsInstallPath $taskVs -SkipAutomaticLocation -DevCmdArguments '-arch=x86 -host_arch=x64' | Out-Null
Push-Location $taskBuild
try {
    $taskDefines = @('/DWIN32', '/D_WINDOWS')
    if ($TestBuild) { $taskDefines += '/DSH3TOOLS_TEST' }
    & cl.exe /nologo /LD /MT /O2 /W4 /Brepro @taskDefines /Fo:asi-runtime.obj (Join-Path $PSScriptRoot 'asi-runtime.c') /link /MACHINE:X86 /DYNAMICBASE /NXCOMPAT /Brepro /OUT:SH3Tools.dll /EXPORT:InitializeASI kernel32.lib user32.lib advapi32.lib
    if ($LASTEXITCODE -ne 0) { throw 'ASI runtime compilation failed.' }
    & cl.exe /nologo /LD /MT /O2 /W4 /Brepro /Fo:asi-loader.obj (Join-Path $PSScriptRoot 'asi-loader.c') /link /MACHINE:X86 /DYNAMICBASE /NXCOMPAT /Brepro /OUT:SH3ToolsLoader.asi /EXPORT:InitializeASI kernel32.lib user32.lib
    if ($LASTEXITCODE -ne 0) { throw 'DLL loader compilation failed.' }
    if (!$TestBuild) {
        & node (Join-Path $PSScriptRoot 'asi-profile.mjs') (Join-Path $taskBuild 'SH3Tools.dll') (Join-Path $taskBuild 'SH3ToolsLoader.asi')
        if ($LASTEXITCODE -ne 0) { throw 'ASI profile generation failed.' }
    }
} finally { Pop-Location }


