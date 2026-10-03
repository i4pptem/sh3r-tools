#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <wincrypt.h>
#include <tlhelp32.h>
#include <stdint.h>
#include <stdio.h>
#include <wchar.h>

#define MAX_REGIONS 16
#define MAX_WRITES 512
#define MAX_PLAN (4 * 1024 * 1024)
#define MAX_MEMORY (512 * 1024 * 1024)
typedef struct { const BYTE *next, *end; } Reader;
typedef struct { DWORD offset, target, addend, relative; } Relocation;
typedef struct { BYTE *memory; DWORD size, executable, dataSize, count; const BYTE *data; const Relocation *relocations; } Region;
typedef struct { BYTE *address; DWORD size, count, protection; const BYTE *expected; BYTE *data; const Relocation *relocations; } Write;
static HMODULE self;
static LONG started;
static WCHAR directory[MAX_PATH], logPath[MAX_PATH];
static Region regions[MAX_REGIONS];
static Write writes[MAX_WRITES];
static DWORD regionCount, writeCount;

static void logMessage(const char *text) {
    HANDLE file = CreateFileW(logPath, FILE_APPEND_DATA, FILE_SHARE_READ, NULL, OPEN_ALWAYS, FILE_ATTRIBUTE_NORMAL, NULL);
    if (file != INVALID_HANDLE_VALUE) { DWORD written; WriteFile(file, text, (DWORD)strlen(text), &written, NULL); WriteFile(file, "\r\n", 2, &written, NULL); CloseHandle(file); }
}

static void fail(const char *text) {
    logMessage(text);
#ifndef SH3TOOLS_TEST
    WCHAR message[1024];
    _snwprintf_s(message, 1024, _TRUNCATE, L"The ASI mod could not be activated.\n\n%hs\n\nThe game will close before loading modified assets. Original files were not changed.\n\nDetails: %s", text, logPath);
    MessageBoxW(NULL, message, L"Silent Hill 3 Tools", MB_OK | MB_ICONERROR);
#endif
    ExitProcess(86);
}

static const BYTE *take(Reader *r, DWORD size) {
    const BYTE *result = r->next;
    if ((SIZE_T)(r->end - r->next) < size) fail("Truncated runtime plan. Rebuild this mod.");
    r->next += size; return result;
}
static DWORD number(Reader *r) { DWORD value; memcpy(&value, take(r, 4), 4); return value; }

static void hashBytes(const BYTE *data, DWORD size, BYTE hash[32]) {
    HCRYPTPROV provider = 0; HCRYPTHASH context = 0; DWORD length = 32;
    if (!CryptAcquireContextW(&provider, NULL, NULL, PROV_RSA_AES, CRYPT_VERIFYCONTEXT) ||
        !CryptCreateHash(provider, CALG_SHA_256, 0, 0, &context) || !CryptHashData(context, data, size, 0) ||
        !CryptGetHashParam(context, HP_HASHVAL, hash, &length, 0)) fail("Windows could not verify the mod hash.");
    CryptDestroyHash(context); CryptReleaseContext(provider, 0);
}

static BYTE *readFile(const WCHAR *path, DWORD limit, DWORD *size) {
    LARGE_INTEGER length; DWORD read;
    HANDLE file = CreateFileW(path, GENERIC_READ, FILE_SHARE_READ, NULL, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, NULL);
    if (file == INVALID_HANDLE_VALUE) fail("A runtime file is missing or inaccessible. Reinstall the complete mod folder.");
    if (!GetFileSizeEx(file, &length) || length.QuadPart <= 0 || length.QuadPart > limit) fail("Invalid runtime file size.");
    *size = length.LowPart;
    BYTE *bytes = HeapAlloc(GetProcessHeap(), 0, *size);
    if (!bytes || !ReadFile(file, bytes, *size, &read, NULL) || read != *size) fail("Could not read a runtime file.");
    CloseHandle(file); return bytes;
}

static void verifyOverlay(void) {
    typedef BOOLEAN (WINAPI *GetPath)(WCHAR *, SIZE_T);
    MODULEENTRY32W module = {sizeof(module)};
    HANDLE snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPMODULE, GetCurrentProcessId());
    BOOL found = FALSE;
    if (snapshot == INVALID_HANDLE_VALUE) fail("Could not inspect the ASI loader.");
    if (Module32FirstW(snapshot, &module)) do {
        GetPath getPath = (GetPath)GetProcAddress(module.hModule, "GetOverloadPathW");
        WCHAR active[MAX_PATH], absolute[MAX_PATH];
        if (getPath && getPath(active, MAX_PATH) && GetFullPathNameW(active, MAX_PATH, absolute, NULL)) {
            SIZE_T length = wcslen(absolute);
            while (length && (absolute[length-1] == L'\\' || absolute[length-1] == L'/')) absolute[--length] = 0;
            if (!_wcsicmp(absolute, directory)) found = TRUE;
        }
    } while (Module32NextW(snapshot, &module));
    CloseHandle(snapshot);
    if (!found) fail("Ultimate ASI Loader 9.7.0+ must use this mod folder as its active OverloadFromFolder. Check existing loader settings; do not load two copies of this ASI.");
}

static const Relocation *readRelocations(Reader *r, DWORD count, DWORD size) {
    if (count > MAX_PLAN / sizeof(Relocation)) fail("Invalid relocation count.");
    const Relocation *items = (const Relocation *)take(r, count * sizeof(Relocation));
    for (DWORD i = 0; i < count; ++i) {
        const Relocation *item = items + i;
        if (size < 4 || item->offset > size - 4 || item->relative > 1 ||
            (item->target != 0xffffffff && item->target >= regionCount)) fail("Invalid runtime relocation.");
    }
    return items;
}

static void readRegions(Reader *r) {
    DWORD total = 0;
    for (DWORD i = 0; i < regionCount; ++i) {
        Region *region = regions + i;
        region->size = number(r); region->executable = number(r); region->dataSize = number(r); region->count = number(r);
        if (!region->size || region->size > MAX_MEMORY - total || region->dataSize > region->size || region->executable > 1) fail("Invalid runtime allocation.");
        total += region->size;
        region->data = take(r, region->dataSize);
        region->relocations = readRelocations(r, region->count, region->dataSize);
    }
}

static void readWrites(Reader *r, BYTE *image, DWORD imageSize) {
    DWORD previousEnd = 0;
    for (DWORD i = 0; i < writeCount; ++i) {
        Write *write = writes + i; DWORD rva = number(r);
        write->size = number(r); write->count = number(r);
        if (!write->size || write->size > 64 || rva < previousEnd || rva < 4096 || rva > imageSize || write->size > imageSize-rva) fail("Invalid executable patch range.");
        previousEnd = rva + write->size; write->address = image + rva;
        MEMORY_BASIC_INFORMATION memory;
        if (!VirtualQuery(write->address, &memory, sizeof(memory)) || memory.State != MEM_COMMIT || (memory.Protect & (PAGE_NOACCESS | PAGE_GUARD)) ||
            (BYTE *)memory.BaseAddress + memory.RegionSize < write->address + write->size) fail("Executable patch memory is unavailable.");
        write->expected = take(r, write->size);
        if (memcmp(write->address, write->expected, write->size)) {
            char message[256]; _snprintf_s(message, 256, _TRUNCATE, "Patch conflict at 0x%08lX. Another module changed a required instruction. Use the original executable and check other ASI mods.", (DWORD)(uintptr_t)write->address); fail(message);
        }
        write->data = HeapAlloc(GetProcessHeap(), 0, write->size);
        if (!write->data) fail("Not enough memory for the patch plan.");
        memcpy(write->data, take(r, write->size), write->size);
        write->relocations = readRelocations(r, write->count, write->size);
    }
}

static void relocate(BYTE *data, BYTE *base, const Relocation *items, DWORD count) {
    for (DWORD i = 0; i < count; ++i) {
        const Relocation *item = items + i;
        DWORD value = item->addend;
        if (item->target != 0xffffffff) {
            if (item->addend >= regions[item->target].size) fail("Relocation points outside runtime storage.");
            value += (DWORD)(uintptr_t)regions[item->target].memory;
        }
        if (item->relative) value -= (DWORD)(uintptr_t)(base + item->offset + 4);
        memcpy(data + item->offset, &value, 4);
    }
}

static void applyPlan(void) {
    for (DWORD i = 0; i < regionCount; ++i) {
        Region *region = regions + i;
        region->memory = VirtualAlloc(NULL, region->size, MEM_RESERVE | MEM_COMMIT, PAGE_READWRITE);
        if (!region->memory || (uintptr_t)region->memory + region->size > 0x80000000u) fail("Not enough low address space for the requested model/texture buffers.");
        memcpy(region->memory, region->data, region->dataSize);
    }
    for (DWORD i = 0; i < regionCount; ++i) {
        Region *region = regions + i; DWORD old;
        relocate(region->memory, region->memory, region->relocations, region->count);
        if (region->executable && !VirtualProtect(region->memory, region->size, PAGE_EXECUTE_READ, &old)) fail("Could not protect runtime code.");
        char message[160]; _snprintf_s(message, 160, _TRUNCATE, "Region %lu: 0x%08lX, %lu bytes, %s", i, (DWORD)(uintptr_t)region->memory, region->size, region->executable ? "RX" : "RW"); logMessage(message);
    }
    for (DWORD i = 0; i < writeCount; ++i) relocate(writes[i].data, writes[i].address, writes[i].relocations, writes[i].count);
    for (DWORD i = 0; i < writeCount; ++i) {
        Write *write = writes + i;
        if (!VirtualProtect(write->address, write->size, PAGE_EXECUTE_READWRITE, &write->protection)) fail("Could not make executable patch memory writable.");
        memcpy(write->address, write->data, write->size);
        DWORD unused;
        if (!VirtualProtect(write->address, write->size, write->protection, &unused)) fail("Could not restore executable protection.");
        HeapFree(GetProcessHeap(), 0, write->data);
    }
    FlushInstructionCache(GetCurrentProcess(), NULL, 0);
}

#include "asset-overlay.c"

__declspec(dllexport) void __cdecl InitializeASI(void) {
    if (InterlockedCompareExchange(&started, 1, 0)) return;
    WCHAR path[MAX_PATH]; DWORD size; BYTE hash[32];
    DWORD length = GetModuleFileNameW(self, directory, MAX_PATH);
    if (!length || length >= MAX_PATH || !wcsrchr(directory, L'\\')) fail("Unsupported ASI path.");
    *wcsrchr(directory, L'\\') = 0;
    if (wcscat_s(directory, MAX_PATH, L"\\SH3Tools")) fail("Plugin data path is too long.");
    _snwprintf_s(logPath, MAX_PATH, _TRUNCATE, L"%s\\SH3Tools.log", directory);
    logMessage("SH3 Tools ASI: initializing; original files remain unchanged.");
    verifyOverlay();
    _snwprintf_s(path, MAX_PATH, _TRUNCATE, L"%s\\SH3Tools.patch", directory);
    BYTE *file = readFile(path, MAX_PLAN, &size);
    if (size < 92) fail("Invalid runtime plan header.");
    hashBytes(file, size-32, hash);
    if (memcmp(hash, file+size-32, 32)) fail("Runtime plan checksum differs. Rebuild the complete mod.");
    Reader reader = {file, file+size-32};
    if (memcmp(take(&reader, 8), "SH3ASI1\0", 8) || number(&reader) != 1) fail("Unsupported runtime plan version.");
    DWORD imageBase = number(&reader), imageSize = number(&reader);
    regionCount = number(&reader); writeCount = number(&reader);
    if (regionCount > MAX_REGIONS || writeCount > MAX_WRITES) fail("Runtime plan exceeds supported limits.");
    const BYTE *expectedHash = take(&reader, 32);
    BYTE *image = (BYTE *)GetModuleHandleW(NULL);
    IMAGE_NT_HEADERS32 *headers = (IMAGE_NT_HEADERS32 *)(image + ((IMAGE_DOS_HEADER *)image)->e_lfanew);
    if ((DWORD)(uintptr_t)image != imageBase || headers->OptionalHeader.SizeOfImage != imageSize) fail("Executable layout differs. Restore the original sh3.exe used to build this mod.");
    length = GetModuleFileNameW(NULL, path, MAX_PATH);
    if (!length || length >= MAX_PATH) fail("Unsupported game path.");
    DWORD exeSize; BYTE *exe = readFile(path, 32 * 1024 * 1024, &exeSize);
    hashBytes(exe, exeSize, hash); HeapFree(GetProcessHeap(), 0, exe);
    if (memcmp(expectedHash, hash, 32)) fail("Executable checksum differs. Restore the original sh3.exe used to build this mod; do not combine with an on-disk SH3 Tools patch.");
    readRegions(&reader); readWrites(&reader, image, imageSize);
    if (reader.next != reader.end) fail("Unexpected runtime plan data.");
    applyPlan(); HeapFree(GetProcessHeap(), 0, file);
    initializeCompactAssets();
    char message[160]; _snprintf_s(message, 160, _TRUNCATE, "Activated: %lu runtime regions, %lu patched instructions. File overlay is provided by Ultimate ASI Loader.", regionCount, writeCount); logMessage(message);
}

BOOL WINAPI DllMain(HINSTANCE module, DWORD reason, LPVOID reserved) {
    (void)reserved;
    if (reason == DLL_PROCESS_ATTACH) {self = module; DisableThreadLibraryCalls(module);}
    return TRUE;
}

