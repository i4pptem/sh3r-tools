#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <wchar.h>

static HMODULE self;
static LONG started;

__declspec(dllexport) void __cdecl InitializeASI(void) {
    if (InterlockedCompareExchange(&started, 1, 0)) return;
    WCHAR path[MAX_PATH];
    DWORD length = GetModuleFileNameW(self, path, MAX_PATH);
    if (length && length < MAX_PATH && wcsrchr(path, L'\\')) {
        *wcsrchr(path, L'\\') = 0;
        if (!wcscat_s(path, MAX_PATH, L"\\SH3Tools.dll")) {
            HMODULE runtime = LoadLibraryExW(path, NULL, LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR | LOAD_LIBRARY_SEARCH_SYSTEM32);
            void (__cdecl *initialize)(void) = runtime ? (void (__cdecl *)(void))GetProcAddress(runtime, "InitializeASI") : NULL;
            if (initialize) { initialize(); return; }
        }
    }
    MessageBoxW(NULL, L"Could not load plugins\\SH3Tools.dll. Reinstall the complete mod, including the DLL and plugins\\SH3Tools folder.", L"Silent Hill 3 Tools", MB_OK | MB_ICONERROR);
    ExitProcess(86);
}

BOOL WINAPI DllMain(HINSTANCE module, DWORD reason, LPVOID reserved) {
    (void)reserved;
    if (reason == DLL_PROCESS_ATTACH) {self = module; DisableThreadLibraryCalls(module);}
    return TRUE;
}
