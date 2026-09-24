typedef unsigned char u8;
typedef unsigned short u16;
typedef unsigned int u32;
typedef struct {int left, top, right, bottom;} Rect;
typedef struct {int pitch; u8 *pixels;} LockedRect;
typedef int (__stdcall *LockRect)(void *, u32, LockedRect *, const Rect *, u32);
typedef int (__stdcall *UnlockRect)(void *, u32);

static u32 read3(const u8 *source, u32 *bit) {
    u32 offset = *bit >> 3, shift = *bit & 7, value = source[offset];
    if (shift > 5) value |= (u32)source[offset + 1] << 8;
    *bit += 3;
    return (value >> shift) & 7;
}

static u32 blank_run(const u8 *source, u32 *bit) {
    u32 run = read3(source, bit);
    if (run) return run;
    run = read3(source, bit);
    if (run) return run + 7;
    run = read3(source, bit);
    if (run) return run + 14;
    run = read3(source, bit);
    run |= read3(source, bit) << 3;
    if (run) return run + 21;
    run = read3(source, bit);
    run |= read3(source, bit) << 3;
    run |= read3(source, bit) << 6;
    return run + 84;
}

/* Coverage is keyed by native glyph ID; advance widths remain in the native tables. */
static const u8 *coverage(const u8 *section, u32 type, u32 glyph, u32 *scale) {
    u32 language = *(const u32 *)0x00721708, offset, length, descriptor, count, table, end, pixels;
    const u8 *file, *extension;
    if (language >= 3) return 0;
    file = ((const u8 *const *)0x070CA828)[language];
    if (!file || section != file + ((const u32 *)file)[type]) return 0;
    offset = ((const u32 *)file)[3];
    if (offset < 16 || offset > 0x10000000) return 0;
    extension = file + offset;
    if (((const u32 *)extension)[0] != 0x46334853 || ((const u32 *)extension)[1] != 0x0031544E) return 0;
    length = ((const u32 *)extension)[2];
    if (length < 32 || length > 0x10000000 || ((const u32 *)extension)[3] != offset) return 0;
    descriptor = ((const u32 *)extension)[4 + type];
    if (descriptor < 32 || descriptor > length - 16) return 0;
    *scale = *(const u32 *)(extension + descriptor);
    count = *(const u32 *)(extension + descriptor + 4);
    table = *(const u32 *)(extension + descriptor + 8);
    end = *(const u32 *)(extension + descriptor + 12);
    if ((*scale != 2 && *scale != 4) || count > 32768 || glyph >= count || table != descriptor + 16 || table > length || count * 4 > length - table || end > length) return 0;
    pixels = *(const u32 *)(extension + table + glyph * 4);
    if (pixels < table + count * 4 || pixels > end || (type ? 16 * 24 : 20 * 30) * *scale * *scale > end - pixels) return 0;
    return extension + pixels;
}

__declspec(dllexport) int __cdecl font_upload(int unused, u32 offset_word, u32 glyph, u32 page, const u8 *section, int slot) {
    void *texture = *(void **)0x070CA844;
    u32 type = *(const u32 *)0x070C9354, x, y, dx, dy, scale = 1;
    u32 width, height, bit = 0, run = 0, original_width, value, rgba;
    const u8 *pixels, *source;
    Rect rect;
    LockedRect locked;
    void **methods;
    (void)unused;
    if (!texture || !section || type >= 2 || slot < 0 || slot >= 384) return slot;
    glyph &= 0xFFFF;
    width = ((const u16 *)0x00721700)[type * 2];
    height = ((const u16 *)0x00721700)[type * 2 + 1];
    if (width > 20 || height > 30) return slot;
    rect.left = (slot % 24) * 84; rect.top = (slot / 24) * 124;
    rect.right = rect.left + 84; rect.bottom = rect.top + 124;
    methods = *(void ***)texture;
    if (((LockRect)methods[16])(texture, 0, &locked, &rect, 0) < 0) return slot;
    for (y = 0; y < 124; y++) {
        volatile u32 *row = (volatile u32 *)(locked.pixels + y * locked.pitch);
        for (x = 0; x < 84; x++) row[x] = 0;
    }
    pixels = coverage(section, type, glyph, &scale);
    if (pixels) {
        u32 repeat = 4 / scale;
        for (y = 0; y < height * scale; y++) for (x = 0; x < width * scale; x++) {
            value = pixels[y * width * scale + x];
            rgba = value ? (value << 24) | 0xFFFFFF : 0;
            for (dy = 0; dy < repeat; dy++) {
                volatile u32 *row = (volatile u32 *)(locked.pixels + (y * repeat + dy) * locked.pitch);
                for (dx = 0; dx < repeat; dx++) row[x * repeat + dx] = rgba;
            }
        }
    } else if (offset_word) {
        source = section + 4 * (offset_word + (page << 16));
        original_width = glyph < 224 ? section[16 + glyph] : width;
        for (y = 0; y < height; y++) for (x = 0; x < original_width; x++) {
            if (run) {run--; value = 0;}
            else {value = read3(source, &bit); if (value == 7) {run = blank_run(source, &bit); value = 0;}}
            rgba = ((const u32 *)0x070A9330)[value];
            if (x < width) for (dy = 0; dy < 4; dy++) {
                volatile u32 *row = (volatile u32 *)(locked.pixels + (y * 4 + dy) * locked.pitch);
                for (dx = 0; dx < 4; dx++) row[x * 4 + dx] = rgba;
            }
        }
    }
    ((UnlockRect)methods[17])(texture, 0);
    return slot;
}
