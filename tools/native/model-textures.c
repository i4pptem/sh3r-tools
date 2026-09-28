typedef unsigned char u8;
typedef unsigned short u16;
typedef unsigned int u32;
#define SLOTS 32
#define MODELS 32
#define EXTRA_RESOURCES 1024
#define RESOURCE_BYTES 0x498
#define EXPORT __declspec(dllexport)
typedef struct {
    u32 created;
    void *resources[SLOTS];
    /* Legacy packet loops address combined primary/secondary run indices. */
    u32 legacy[2][SLOTS * 3];
    u16 starts[2][SLOTS + 1];
    u16 ids[2][SLOTS + 1];
} Tables;
static Tables models[MODELS];
static Tables *current;
static u32 extra_resources[EXTRA_RESOURCES][RESOURCE_BYTES / 4];
static u32 get32(const u8 *p, u32 offset) { return *(const u32 *)(p + offset); }
static void put32(u8 *p, u32 offset, u32 value) { *(u32 *)(p + offset) = value; }
static Tables *tables(u8 *info) { return &models[((u32)info - 0x07117E68) / 176]; }
static void clear_words(void *data, u32 count) {
    volatile u32 *p = (volatile u32 *)data;
    while (count--) *p++ = 0;
}
static void release_textures(u8 *info) {
    Tables *t = tables(info);
    u32 i;
    for (i = 0; i < t->created; ++i) {
        ((void (__cdecl *)(void *))0x45B050)(t->resources[i]);
        t->resources[i] = 0;
    }
    t->created = 0;
    for (i = 0; i < 6; ++i) put32(info, 0x98 + i * 4, 0);
}
static void upload_images(u8 *info, const u8 *file, Tables *t) {
    const u8 *batch = file + get32(file, 12), *image = batch + get32(batch, 8), *palette;
    u32 i, count = get32(batch, 20);
    for (i = 0; i < count; ++i) {
        palette = image + get32(image, 20);
        t->resources[i] = ((void *(__cdecl *)(const void *, const void *, const void *, u32))0x45BA00)
            (image, palette, file, *(const u16 *)(file + 4));
        ++t->created;
        if (i < 6) put32(info, 0x98 + i * 4, (u32)t->resources[i]);
        image = image[25] ? palette + get32(palette, 0) + 48 : palette;
    }
}
static u32 runs(Tables *t, const u8 *model, u32 group, u32 *previous) {
    u32 i, count = get32(model, 32 + group * 8), total = 0, texture;
    const u8 *part = model + get32(model, 36 + group * 8), *materials = model + get32(model, 60);
    for (i = 0; i < count; ++i) {
        texture = get32(materials, *(const short *)(part + get32(part, 56)) * 8);
        if (texture != *previous) {
            t->starts[group][total] = (u16)i;
            t->ids[group][total++] = (u16)texture;
            *previous = texture;
        }
        part += get32(part, 0);
    }
    t->starts[group][total] = (u16)count;
    t->ids[group][total] = 0xFFFF;
    return total;
}
static void register_textures(u8 *info) {
    Tables *t = tables(info);
    const u8 *file = (const u8 *)get32(info, 16), *model = file + get32(file, 20);
    u32 previous = 0xFFFF, primary, secondary = 0, i;
    release_textures(info);
    clear_words(t, sizeof(Tables) / 4);
    put32(info, 0x38, 0); put32(info, 0x3C, 0);
    put32(info, 0x58, 0); put32(info, 0x5C, 0);
    if (file[0]) return;
    if (get32(file, 12) == get32(file, 16)) upload_images(info, file, t);
    if (get32(file, 8) <= 1) {
        primary = 1;
        t->starts[0][1] = (u16)get32(model, 32);
        t->ids[0][1] = 0xFFFF;
        info[0x30] = 0;
    } else {
        primary = runs(t, model, 0, &previous);
        info[0x30] = get32(file, 8) > primary;
        if (info[0x30]) secondary = runs(t, model, 1, &previous);
        else { t->starts[1][0] = (u16)get32(model, 32); t->ids[1][0] = 0xFFFF; }
    }
    put32(info, 0x38, primary); put32(info, 0x58, secondary);
    for (i = 0; i < 6; ++i) {
        ((u16 *)(info + 0x40))[i] = t->starts[0][i];
        ((u16 *)(info + 0x4C))[i] = t->ids[0][i];
    }
    for (i = 0; i < 2; ++i) {
        ((u16 *)(info + 0x60))[i] = t->starts[1][i];
        ((u16 *)(info + 0x64))[i] = t->ids[1][i];
    }
}
static void select_tables(u8 *info) { current = tables(info); }
EXPORT __declspec(naked) void register_entry(void) {
    __asm { push esi }
    __asm { call register_textures }
    __asm { add esp, 4 }
    __asm { ret }
}
EXPORT __declspec(naked) void select_entry(void) {
    __asm {
        pushfd
        pushad
        mov eax, [esp + 40]
        push eax
        call select_tables
        add esp, 4
        popad
        popfd
        push esi
        mov esi, [esp + 8]
        push edi
        mov ecx, 44
        mov edi, 0x845660
        rep movsd
        pop edi
        pop esi
        ret
    }
}
EXPORT void *__cdecl resource_get(u32 slot) { return current->resources[slot]; }
EXPORT u32 *__cdecl legacy_address0(u32 slot) { return &current->legacy[0][slot]; }
EXPORT u32 __cdecl legacy_value0(u32 slot) { return current->legacy[0][slot]; }
EXPORT u32 *__cdecl legacy_address1(u32 slot) { return &current->legacy[1][slot]; }
EXPORT u32 __cdecl legacy_value1(u32 slot) { return current->legacy[1][slot]; }
EXPORT int __cdecl primary_starts(u32 run) { return (short)current->starts[0][run]; }
EXPORT int __cdecl primary_ids(u32 run) { return (short)current->ids[0][run]; }
EXPORT int __cdecl secondary_starts(u32 run) { return (short)current->starts[1][run]; }
EXPORT int __cdecl secondary_ids(u32 run) { return (short)current->ids[1][run]; }
EXPORT __declspec(naked) void release_one_entry(void) {
    __asm {
        push ebx
        pushad
        push esi
        call release_textures
        add esp, 4
        popad
        mov eax, 0x682F82
        jmp eax
    }
}
EXPORT __declspec(naked) void release_all_entry(void) {
    __asm {
        pushad
        push esi
        call release_textures
        add esp, 4
        popad
        mov eax, 0x683013
        jmp eax
    }
}
static void extend_resource_pool(void) {
    u8 *sentinel = (u8 *)0x84AC58, *resource, *previous;
    u32 i;
    clear_words(extra_resources, sizeof(extra_resources) / 4);
    clear_words(models, sizeof(models) / 4);
    current = &models[0];
    for (i = 0; i < EXTRA_RESOURCES; ++i) {
        resource = (u8 *)extra_resources[i];
        *(u16 *)resource = (u16)(96 + i);
        *(u16 *)(resource + 2) = 0xFFFF;
        previous = (u8 *)get32(sentinel, 0x18);
        put32(resource, 0x18, (u32)previous);
        put32(resource, 0x1C, (u32)sentinel);
        put32(previous, 0x1C, (u32)resource);
        put32(sentinel, 0x18, (u32)resource);
    }
}
EXPORT __declspec(naked) void pool_init_entry(void) {
    __asm {
        pushfd
        pushad
        call extend_resource_pool
        popad
        popfd
        mov eax, 0x45B750
        jmp eax
    }
}
