# Executable patches

Build mod has two delivery modes. **Replace game files** creates a patched EXE when required, as described below. Experimental **ASI overlay** loads changed archive entries and loose files from `plugins/SH3Tools/data` and applies the same required extensions in memory through a separate DLL; it never outputs or rewrites a game executable. See [ASI overlay installation and limitations](ASI-OVERLAY.md). The extension requirements are shared between both modes. PE sections mentioned below describe the replacement-EXE mode; ASI uses dynamically allocated regions instead.

Build mod can generate an extended **32-bit Silent Hill 3 PC executable** from a supported executable supplied by the user. The editor itself is a Windows x64 application. This feature writes a new file into the mod output; it does not attach to the game or modify the source executable in place.

## When an executable is included

Requirements are triggered by **staged replacements**, not preview sliders. Character-file memory additionally uses the effective sizes in the complete game data catalog, including staged changes. With no staged requirement, Build mod emits no executable at all. An executable already installed in your game stays as it is; reverting a staged asset does not uninstall a previous patch.

| Patch | Required when | Result |
| --- | --- | --- |
| Model texture tables | More than six model images, five primary texture runs or one secondary run | 32 image slots per model, expanded run/auxiliary tables and 1,120 global texture descriptors; 14 checked redirects |
| Morph scratch | A model has more than 1,536 pooled morph nodes | 32,768 nodes × 24 bytes; a separate 768 KiB writable allocation in the PE image; 64 native references redirected |
| Primary INDEX32 | Primary group has more than 65,536 vertices | GPU index allocation, offsets and upload use 32-bit indices; six code patches. Serialized MDL indices are unchanged |
| Secondary mesh buffers | Secondary group has more than 1,024 vertices or 2,048 triangles | Storage for 65,536 vertices and 131,072 triangles; the native index representation stays 16-bit |
| Picture streaming | A recognized TEX replacement under `data/pic` is larger than `0x14C800` bytes (1,361,920 bytes) | Five 16 MiB slots, 80 MiB in total, with bounded slot assignment; seven patch spans, 67 modified code bytes |
| Character file storage | Changed character files leave insufficient space in the stock 40 MiB file arena | Separate 128 MiB storage, preserving up to 40 MiB of character cache; three checked code redirects |
| Background/MAP storage | The complete staged stage exceeds the stock primary background budget | Separate 256 MiB primary arena; the 12 MiB auxiliary arena is retained; one checked initializer CALL redirect |
| Transparent MAP queue | A staged MAP grows its transparent geometry, or has more than 2,730 transparent triangles | Three producer preflight hooks flush the native queue before selecting a descriptor |
| High-resolution fonts | A staged `fontdata_*.bin` contains a 2× or 4× font extension | An extended glyph uploader and a 2048×2048 glyph cache, retaining original logical text size and spacing |

These are separate constraints. A large face can need morph scratch; subdivided hair can additionally need secondary storage; a model with many primary vertices can need INDEX32. The builder combines the required extensions.

### Morphs and geometry

Morph capacity counts the pool of changing positions/normals, **not** the number of vertices in a single mesh or the sum of all shape-key vertices. The rebuilding code preserves native target ordering so original facial tracks continue to address the corresponding replacement shapes.

The secondary patch introduces a writable `.sh3mesh` section for vertex, triangle and index arrays (32-, 20- and 6-byte records respectively). Per-part staging still permits at most **682 secondary vertices**. The writer splits parts when required; removing this check would leave a different native overflow unresolved.

Remaining format limits include three nonzero influences per vertex, sixteen palette slots per part, 256 global bone pairs and signed native coordinate storage. Expanded buffers do not enable arbitrary rigs, unlimited meshes or unlimited morphs.

### Pictures

Full-size import is an **optional texture workflow**. The picture patch covers the identified `data/pic` loading path; it is not a general replacement for every texture allocator in the game. Other texture containers still have their own layout, palette, mip and hardware constraints. A successful import or preview is not a universal compatibility guarantee.

### Character files and embedded textures

This is independent of the picture patch and the GPU texture-size limit. Three 2048×2048 BGRA textures occupy 48 MiB before geometry. The native startup allocator uses a 40 MiB shared character arena; an oversized player model can underflow its cache count and crash before the main window appears.

Build mod calculates the largest player model, animation, shadow and jerky slots from the complete catalog, aligned to 8192 bytes. It includes the character patch when those reservations overflow stock storage or the remaining cache cannot fit a cataloged character asset. Open the complete data folder for these checks. This accounting does not predict every scene's simultaneous resource use.

The patch adds executable code in RX section `.sh3char` and zero-initialized storage in RW section `.sh3cbuf`. It redirects only the initialized character segment's base/size getters. Other segments, the original 96 MiB shared pool and its guards stay intact. The cache count is bounded to 5120 blocks, matching the original occupancy array. Startup reservations must fit 88 MiB; an individual cached character asset must fit 40 MiB.

The reproducible profile generator is [character-arena.py](../tools/native/character-arena.py). Separate code and data sections preserve page permissions. The native cache remains finite; the extension does not make arbitrary texture counts, dimensions or hardware formats safe.

### Model texture slots

The model-texture patch adds RX code in `.sh3tex1` and zero-initialized RW storage in `.sh3tbuf` (about 1.18 MiB). It keeps the original 176-byte model records and their 32-record pool, with separate expanded tables for each record. Slot lookup, auxiliary material tables and run tables use those expanded records. Cleanup releases the actual number of uploaded image resources, including unused image slots, once each. Global texture reset clears ownership before models can be reused.

The original texture-descriptor pool has 96 records. The extension appends 1,024 records, supporting all 32 model records with 32 images each plus the original descriptor reserve. This is a CPU metadata limit; GPU memory and image-size limits are unchanged. Serialized MDL image/material tables keep their original format.

Build mod validates matching model/batch image counts and material slot bounds. Requirement detection includes direct MDL replacements, not only imported GLB/GLTF/FBX. The extension is added only when the staged model needs it, or retained when the supplied executable already contains this recognized extension and another runtime requirement causes an EXE build. No requirements means no generated EXE.

Source: [model-textures.c](../tools/native/model-textures.c). Build/profile tools are supplied beside it; source hashes and exact patched spans are checked. Unknown or modified executable layouts are rejected.

### Fonts

The BIN keeps its native font data and appends a `SH3FNT1\0` extension, referenced by the field at header offset 12. The extension stores higher-resolution glyph coverage. Normal and Small are independent choices; the unedited size keeps its original glyph data.

The patch hooks the uploader at `0x5FA730`, adds our compiled uploader in `.sh3font` and expands the 512×512 cache to 2048×2048. The logical UV step remains 1/512 and the cache retains 384 slots. Normal glyphs still occupy the original logical 20×30 area and Small glyphs 16×24; only their coverage resolution increases. This is why 4× artwork should look sharper without making dialogue four times larger.

The uploader source is included at [`tools/native/font-upload.c`](../tools/native/font-upload.c), with its profile extraction/build tools. The patch profile contains our compiled code and expected patch bytes; it does not contain a complete game executable.

## Supported executables and authentication

The builder accepts the two audited base layouts identified by full-file SHA-256:

```text
719b61d0faeb7e23c844ac0f2c5082634ee670a103f2dec721a3504bbc3132bf
a51f956bd5be21fd704c4d19cf0674a175d002081da43b1d377be83226c36e5e
```

These hashes identify supported bytes; they are not a claim that every release from a particular region or distributor works. Unknown executables are rejected. Do not bypass the hash check by changing the allowlist.

For an executable already patched by a recognized version of this tool, validation reverses the **exact known extensions in memory**, then authenticates the recovered base and verifies the expected bytes/section structure. Recognized existing morph, primary, secondary, picture, font, character, model-texture and background extensions are retained while adding new requirements. Patch generation is designed to be idempotent.

This recognition does not cover arbitrary executable modifications. External fixes installed as DLLs or configuration files are separate; their presence is not evidence that any EXE layout is supported.

## Build, install and undo

1. Stage the model, texture or font replacement and inspect it in the editor.
2. Choose **Build mod** and provide your supported `sh3.exe` if requested.
3. Review the generated manifest and `runtime-buffers.json`. They record requirements, selected patches and hashes of the source/output.
4. Close the game. Back up the current executable and the game files you will replace **together**.
5. Install the generated `sh3.exe`, when present, together with the generated `data` contents. Preserve their directory structure.
6. Test relevant gameplay and cutscenes, not only the editor preview.
7. To roll back an installed mod, restore the paired backups. Removing a replacement from the editor project only changes future builds.

`runtimeVerified: false` in a build report is intentional: Build mod has not run your specific replacement in the game. Structural validation and selected in-game confirmations are described separately in [Validation](VALIDATION.md).

## Publishing a mod

The application release must not contain a game EXE or game archives. Build mod generates an executable locally from the user's own copy. Use the ASI overlay delivery mode to distribute authored extensions and changed assets without including a game executable or whole source archives. Changed payload files themselves are included; this is not a binary-delta or rights-clearance mechanism.

Implementation entry points: [`core/workbench.mjs`](../core/workbench.mjs) and the runtime/profile modules in [`core`](../core).

## Background/MAP arena

Growth checks include MAP, shared GB/TR textures and companion world files from the complete open stage. Stock capacity is tried first. If it fails, the same calculation is repeated against a 256 MiB primary arena; passing it requires the new extension. Indoor transitions reserve the two largest distinct room footprints. Outdoor stages reserve shared resources plus four equal tile fractions, each able to hold twice the largest tile, covering duplicate/current-neighbor ownership. Format, GPU, tile-coordinate and per-object limits still apply.

The patch redirects the initializer CALL at `0x58EB7B` to a shim that substitutes only the primary pointer/size before tail-calling the original initializer. The auxiliary 12 MiB pool and all other shared-pool users stay intact. Replacement mode uses `.sh3bg01` and `.sh3bbuf`; ASI allocates equivalent code/data separately. Original native initialization, background placements and outdoor tile-queue transitions were executed in emulation. Authored high-resolution stages still need tests in the game.

## MAP geometry queue

Opaque MAP draws already use 32-bit vertex counts and non-indexed strips; they do not share the MDL primary INDEX16 limit. The importer retains its two-million-strip-vertices per part, 256 MiB asset and full-stage memory checks.

The transparent renderer shares 4,096 descriptors with effect streams. Its original producers can choose a descriptor before a capacity flush, losing one submission or overwriting sorting data. `.sh3tr01` preflights three producer entries (`0x5F5990`, `0x5F58E0`, `0x5F5A30`) and flushes before descriptor selection. Stream capacities remain 8,192 / 4,096 / 64 vertices. Native MAP submissions request three vertices; batch sorting is retained. Sorting between separate batches can still differ. This is not unlimited GPU geometry support.

The patch is selected for any increase in transparent triangle count against the opened source, or more than 2,730 such triangles in a staged MAP. The verified native CPU cases include 25,000 MAP triangle submissions and mixed-stream descriptor exhaustion. Authored large rooms still require rendering and gameplay tests.

## Removed Action-length extension

Action ranges and ANM bank lengths remain native. Fit source motion into the existing destination range. Old `SH3ANM1` banks and `.sh3anm1` / `.sh3abuf` executable extensions are rejected: restore the original ANM and executable before rebuilding. The extension code and UI have been removed.

The ASI runtime's combined allocation ceiling is 512 MiB, allowing the background and character arenas alongside other extensions. This is a safety bound on extension allocations, not a guarantee of free address space in a 32-bit game or of GPU texture memory. All enabled patches together currently require about 391 MiB. Only required patches are allocated.
