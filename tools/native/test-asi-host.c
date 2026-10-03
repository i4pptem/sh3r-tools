#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <stdio.h>
#include <wchar.h>
__declspec(dllexport) DWORD TestPatchWords[3] = {0x53483354, 0x50415443, 0x54455354};
__declspec(dllexport) BOOLEAN WINAPI GetOverloadPathW(WCHAR *out, SIZE_T size) {
    DWORD length = GetModuleFileNameW(NULL, out, (DWORD)size);
    if (!length || length >= size) return FALSE;
    *wcsrchr(out, L'\\') = 0; wcscat_s(out, size, L"\\SH3Tools"); return TRUE;
}
int wmain(int argc, WCHAR **argv) {
    if (argc != 2) return 1;
    HMODULE dll = LoadLibraryW(argv[1]);
    if (!dll) return 2;
    void (__cdecl *initialize)(void) = (void (__cdecl *)(void))GetProcAddress(dll, "InitializeASI");
    if (!initialize) return 3;
    initialize(); initialize();
    int (__cdecl *generated)(void) = (int (__cdecl *)(void))(uintptr_t)TestPatchWords[0];
    if (generated() != 90 || !TestPatchWords[1] || TestPatchWords[2] != 12345) return 4;
    *(DWORD *)(uintptr_t)TestPatchWords[1] = 6789;
    printf("ASI runtime executed relocated code and writable storage; duplicate initialization is safe.\n");
    return 0;
}
