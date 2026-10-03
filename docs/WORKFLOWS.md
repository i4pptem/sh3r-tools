# Workflows

## Choose how to build a mod

**Build mod** offers **ASI overlay** (experimental, originals unchanged) and **Replace game files** (the existing workflow). ASI builds require an original supported `sh3.exe` and Ultimate ASI Loader 9.7.0+ Win32. They put changed archive entries and loose assets in `plugins/SH3Tools/data` and apply required runtime patches in memory. Read the generated `INSTALL.txt` or [ASI guide](ASI-OVERLAY.md).

A local Windows workbench for Silent Hill 3 PC assets. English interface. Developed by **i4pptem**. This guide describes version 1.0.0.

## Run

Extract the portable release and run **Silent Hill 3 Tools.exe** from its folder. Keep the executable with its surrounding files. The portable build includes Electron. Run Install media.cmd once for optional FFmpeg media conversion; no system codec or Node.js installation is needed. Morph workspace and FBX exchange additionally use an installed Blender 4.2+ (tested with 5.2.2). Set SH3TOOLS_BLENDER to its executable if automatic detection does not find it.

Choose **Open data folder** and select the game's data directory. Selecting the game root or opening data/arc.arc also discovers the same complete workspace. Keep the catalog beside its archives.

- **Asset library** contains the main ARC assets.
- **Movie folder** contains files under data/movie.
- **Pic** contains files under data/pic.
- **Sound** contains sound/sd.afs, nested sound/demo_afs archives and loose sound files.

Switch sections directly in the sidebar. No additional folder dialog is needed, and staged replacements remain in one project. Search and file-type filters apply to the current section. Build output preserves nested paths such as data/sound/demo_afs/amcm.afs. Missing optional media folders appear as empty sections.

A single ARC, AFS or movie can still be opened separately. Saved version 0.3 projects load into the expanded workspace with their replacements preserved.

Success notifications dismiss after five seconds; errors dismiss after eight seconds. Each new notification restarts its timer, and the close button remains available.

## Model export and workspace layout

Select a PC MDL. In **Inspector → Export model**, choose **Export GLB** or **Export FBX**. Both include meshes, original mesh names, skeleton, skin weights, texture bindings and pose morph shape keys. FBX embeds textures and uses the installed Blender; it exports the model in its bind pose. Use the animation exchange controls for a selected ANM range. Use **Export Blender (.blend)** for a native Blender authoring scene. The single Import model action accepts GLB, GLTF, FBX and .blend; FBX and .blend require Blender.

**Import model…** detects compatible attribute edits and topology/morph changes automatically. The morph workspace, native morph JSON, embedded textures, mesh visibility and native file actions are grouped in expandable Inspector sections. Asset information and integrity details are below the editing tools.

Use **Asset library** or **Inspector** above the preview to hide either panel; the preference survives restarts. **Ctrl+Shift+L** toggles the library. **Ctrl+F** reveals it and focuses search. **Focus preview** temporarily hides the library, Inspector and navigation; **Esc** restores the previous panel layout.

Animation appears as a compact overlay inside the viewport. **Clips & tools** opens three tabs: **Clips** for banks and ranges, **Export / Import** for animation exchange, and **Morphs** for manual shape preview and intensity. Playback and the timeline remain visible when folded. Advanced playback settings contain FPS, speed, the facial track and optional external motion loading. Drag the Animation header to move the window. Open **Clips & tools** and drag its lower-right corner to change width and height. Position and expanded size are saved between sessions; the window stays inside the viewport as the layout changes. **↺** resets its layout. A focused header or resize corner also supports arrow keys (Shift for larger steps). The expanded panel scrolls within the viewport on smaller windows.

The vector emblem, app/window icon and restrained charcoal/copper palette share the same visual identity. Developer credit appears in the header and status bar.

## Replace a complete model and its morphs

1. Select the original PC MDL and **Export GLB** to obtain its rig and named native morph slots.
2. In your model editor, bind the replacement mesh to that original rig. Preserve bone names and bind transforms, apply mesh object transforms, export triangles, and use at most three nonzero bone influences per vertex. New topology is supported; new skeletons are not.
3. Author the replacement model's shape keys to match the meaning of each original morph. [Blender Morph Tools](BLENDER-MORPH-TOOLS.md) can transfer them using paired points and protected surface regions, with a single-morph preview before creating the complete set. Inspect and correct the result; unrelated faces are not matched anatomically without user guidance.
4. In **Import model**, choose **Import model…** and select a GLB, GLTF, FBX or .blend. Compatible edits open a before/after review; changed topology, shape keys, skinning or materials first open the native rebuild setup. For every included part, select an original visibility/render template and, when needed, a separate native texture slot. Review the bone-visibility warnings. Map every native morph slot to a new shape key, or explicitly select Neutral. Matching names are preselected.
5. **Review replacement…**, then **Apply & stage model** rebuilds native geometry, skin palettes, morph bases, deltas and vertex references. The original target order stays intact so existing facial tracks address the replacement shapes. Supplied color images are imported atomically with geometry. Existing named slots with no color image or explicit color factor retain their texture.
6. Inspect the result with its original ANM and cutscene morph clips. Save the project, then **Build mod** to produce separate game-format files.

GLB export converts rounded native bone matrices to TRS-representable exchange matrices. Import matches bones by name and hierarchy, measures inverse-bind/rest-pose drift over the original and replacement geometry bounds, and accepts only drift below half a native position step (1/32 local unit) and half a native normal step (1/8192). The native skeleton is retained exactly. Identity armature wrapper nodes are accepted; transformed mesh coordinates and larger rig changes are rejected.

Native rebuilding remains experimental. The user confirmed the subdivided Heather face/hair replacement and morph cutscenes in the game on 2026-09-24. Currently supported templates use 48-byte skinned vertices. Limits are three influences per vertex, sixteen palette slots per part, 256 global bone pairs and 32,768 unique morph nodes per model. The morph limit counts pooled changing positions/normals, not every mesh vertex or the sum across shape keys. Models above the stock 1,536-node capacity require runtime expansion. Build mod detects this from staged MDL bytes and applies it through the ASI DLL in memory or includes a patched sh3.exe in replacement-file mode. It creates a separate 768 KiB scratch section and redirects all 64 native references; source files are preserved. The two audited PC executable revisions are supported; unknown builds are rejected. Install the generated sh3.exe together with the built data folder, retaining a backup of your original files. An executable already expanded by this version can be reused for later builds. Palette splitting is automatic; secondary mesh partitions stay within their 682-vertex staging bound. Build mod also expands the aggregate transparent-mesh arrays when required: 65,536 vertices and 131,072 triangles, with native uint16 vertex indices. This fixes a separate overflow that subdivision of the hair can trigger even with expanded morph scratch. Native emulation validates the new buffers, and the user confirmed the repaired Heather cutscenes; other authored models still require their own game tests. Native morph coordinates must fit signed 16-bit storage at 1/16 position precision. Rebuilding retains one immutable template prefix and stable part identities. Repeating the same import produces identical native bytes without cumulative growth. For assets rebuilt by versions before 0.5.0, use **Use original MDL templates…** in the replacement dialog and choose a clean MDL for that character; current textures are retained.

Primary geometry has a separate aggregate limit: the stock game converts all primary-part indices to 16 bits, so models above 65,536 primary vertices wrap into earlier meshes even if each part is small. Build mod now emits the primary INDEX32 patch when needed and preserves it in later builds. It changes GPU index allocation and upload; the MDL index format, materials, part visibility and morph slots stay intact. The user confirmed that it removes the gameplay/cutscene distortions in the 90,971-primary-vertex Heather workspace. Automatic `_part_` chunks remain necessary for palette and transparent-mesh limits; they do not rename the native material or visibility identity.

The same **Import model…** action prepares position, normal and UV edits for review when topology, skinning, morphs and material assignments are unchanged. Native morph JSON edits existing sparse deltas. Preview sliders and playback never stage changes; **Bake intensity** does.

## Model textures and new slots

Use materials named **Texture_0**, **Texture_1**, etc. to bind exact native slots. For Heather, the next new material is **Texture_4**, then **Texture_5**. Supply its base-color image and assign the material to a mesh. New slots must be consecutive. Unnamed materials are assigned available slots automatically, with identical images shared; inspect the assignments in the rebuild dialog. Visibility/render templates remain independent of texture selection.

Model import supports **32 image slots (Texture_0–Texture_31)** and up to **32 primary/secondary texture groups**. Build mod detects the native counts from staged MDL bytes. It includes the model-texture executable extension when a model exceeds six images, five primary runs or one secondary run. Five/six images fitting the original run tables need no additional patch. The extension preserves original model records, adds separate per-model tables and expands the shared texture-resource pool from 96 to 1,120 descriptors. Larger image payloads independently participate in the character-memory calculation. Install the generated executable and archives together; see [Executable patches](EXECUTABLE-PATCHES.md).

GLB may embed PNG/JPEG images. Keep a GLTF file with its referenced BIN and image companions inside the same model directory or its subfolders; remote URLs and paths outside that directory are rejected. Embed FBX textures or retain the paths stored in the FBX. FBX uses the installed Blender 4.2+ to recover the rest-pose geometry, skin and shape keys; model animation is not imported through this action. When exporting model FBX from Blender, disable **Add Leaf Bones**, enable **Custom Properties**, and keep all original bones.

Only base-color textures are transferred, including the material base-color factor. Explicit flat-color materials become 1×1 native images. They keep their supplied dimensions and alpha; the native visibility/render template determines blending behavior. Normal, metallic and roughness maps are not converted into new game shading. Apply UV transforms and use UV map 0. Keep the original rig and at most three influences per vertex. Shared-palette model variants and models without an existing image template cannot gain new slots through this writer. Separate PNG import remains available.

## Supported workflows

| Format | Preview and exchange |
| --- | --- |
| ARC / AFS | Names, search, per-archive native/converted export, native replacement and verified patched copies |
| PC MDL | Textured geometry, skeleton, morphs, GLB / FBX export, GLB / GLTF / FBX import with color textures, preserved-layout edits and experimental topology rebuild |
| ANM / PACK | Skeletal/facial playback and selected-range Blender/FBX exchange. PACK supports bone motion and facial weights; ANM preserves original native channels. Scene/bank length remains unchanged. |
| TEX / DAT / PIC / TBN2 | BGRA32, picture RGBA/PS2 alpha, RGBA5551, indexed palettes and PIC; automatic PNG fitting and palette reduction |
| Font BIN | Normal/small glyph atlases, native PNG exchange and experimental 2×/4× coverage import; original IDs and text metrics |
| MES | Text/control inspection and structured JSON exchange; verified Latin mapping; unidentified Asian glyph codes retained |
| MAP / CLD / CAM | Textured MAP with GB/TR/local materials, collision geometry and camera zones; textured GLB and structure JSON export |
| DED / SDB | Parsed lighting and sound-region/control records; structure JSON export |
| BD + HD | Sample selection/playback and WAV exchange with native PS ADPCM re-encoding |
| ADX / WAV, including unnamed AFS BIN | Content-based playback and WAV export; native filenames and entry IDs retained |
| AIX | Layer selection/playback and WAV exchange with native ADX re-encoding |
| Movie .000 | FMV playback, original MPEG export, editable WebM export and native movie re-encoding |
| Other assets | Native export/replacement and hex inspection |

Native-resolution font PNGs use transparent pixels or opaque gray levels 95, 127, 159, 191, 223 and 255. Keep native atlas dimensions and glyph cell allocation for standard import. Glyph metrics and character mappings are not edited. Font research uses belek666/fontsh234: https://github.com/belek666/fontsh234.

To create a high-resolution font, export its Normal or Small PNG, upscale/redraw it at exactly 2× or 4× without changing cell order, then use **Import high-resolution PNG…**. The importer converts grayscale/RGB luminance multiplied by alpha into 256 levels of coverage. It keeps the full original drawable rectangle per glyph: 20 × 30 logical pixels for Normal, 16 × 24 for Small. Pixels outside those rectangles are cropped, and the game’s advance widths, text sizes, line spacing and IDs remain unchanged. Only the selected font size receives new coverage; other sizes/languages keep their original glyphs.

**Build mod** includes both the changed archive and a matching sh3.exe. Install them together. The patch uses a 2048 × 2048 glyph cache with the original 384 slots and preserves compatible model/morph/picture patches. High-resolution coverage is appended to the original BIN; all original sections remain recoverable. Once a size has high-resolution coverage, **Import PNG** edits it at 2×/4× and **Export PNG** retains its resolution. Use Revert replacement to undo the staged asset. Native emulation and file round trips are verified; the user also confirmed the Normal 4× replacement appears in the game.

For MES editing, change messages[].segments[].text in the exported JSON. Keep raw controls, glyph IDs and their order. The top-level display text is informational. Unknown Japanese/Chinese codes remain explicit rather than being assigned guessed Unicode characters.

Imported PNGs are fitted to the native texture dimensions; see Archive export and image viewing below.

Audio replacements must have the same decoded sample count as the original sample/layer; the importer converts sample rate and channels to the native profile. Other bank slots/layers and loop flags are retained. Matching HD files must be available beside their BD entries in the same archive.

For FMVs, open **Movie folder**, choose a .000, then export the original MPEG or an editable WebM. **Import edited video** restores the original MPEG-1 video / MP2 audio profile and encrypted .000 wrapper. Preserve the original duration and include both video and audio. The importer checks actual video/audio frame counts and full output decoding. **Build mod** writes changed movies under data/movie in a new output folder.

The installed game contains .sdb files; no .sbd sample was available to establish that format. MAP resolves GB/TR/embedded textures, including the shared cc01TR texture. The Colors button toggles stored RGB tint. Stored type-3 object transforms are reproduced; native lighting and animated effects are not. huef.map contains an unresolved TR index; its affected group is identified explicitly. MAP supports the part editor described below; other world structures support inspection/export. KG1/KG2 are shadow geometry, not animation.

## Playback and projects

Select an MDL with **Keep model when selecting motion** enabled. Under **Clips & tools → Clips → Animation bank / cutscene**, choose a gameplay ANM or a **Cutscenes / PACK** entry. Opening the game's data folder discovers compatible cutscenes in its Sound sources automatically. **Playback settings & facial track → Open external motion…** also accepts an AFS or an extracted PACK/BIN, for example data/sound/demo_afs/amcm.afs for Heather. Native model IDs, bone counts and morph target counts filter compatibility.

A cutscene starts character motion and its matching facial track together on the same timeline. The facial track must belong to the same PACK entry; unrelated gameplay and facial clips are not paired. Use play/pause, the scrubber, inclusive start/end frames and loop controls to inspect a segment. PACK playback defaults to the game's 30 samples per second; preview FPS and speed remain adjustable. ANM has no embedded playback rate. **Fit** frames the current character pose, including a character positioned far from the scene origin.

The model viewer previews and edits the selected character. The separate [Cutscene Inspector](CUTSCENES.md) loads the scene camera, characters, environment and audio together. Playback itself does not stage changes.

### Find actions in Heather gameplay banks

Open the game's data folder with its **sh3.exe** in the parent folder. Select Heather and a **Gameplay / ANM** bank, then use **Action range**. The arrows step through the native action IDs. Selecting an action applies its inclusive first/last frame, loop flag and default playback rate. Custom frame bounds remain editable, and **Whole bank** restores the complete timeline. Export uses the currently selected bounds. **Auto-play**, beside Loop, repeats even actions whose native loop flag is off and starts each newly selected ANM action. It is a persistent preview preference; Pause and Stop still work. Turning it off restores the selected action’s loop behavior. It does not change bank data or PACK playback.

The verified set covers 11 original 1763-frame chhaa_basic banks: none, hand, shot, mach, knif, pipe, blad, hamm, stun, sabe and flam. Action numbers come from the executable; descriptive movement names have not been mapped. Identical or overlapping intervals can be distinct native actions. Test banks, other models and unsupported executable profiles do not receive guessed ranges. The app reads this metadata locally and does not patch the executable for range discovery.

The default rate uses the native 60 Hz clock. Actual gameplay may alter speed and blend different upper/lower-body actions; isolated whole-rig preview does not reproduce that controller. The final frame is included. Choosing a range changes preview/export selection, not game action/event tables or bank length.

### Reload archives after installing a mod

When returning to the app or accessing a changed source, a dialog offers **Reload sources**. You can also use the refresh button beside Sources or **Ctrl+R**. Finish copying game files before reloading.

The dialog reports staged replacements that can be kept and replacements already present on disk. Kept edits must still match their original asset hash; already installed edits leave Staged changes. Conflicting or missing assets require explicit **Reload and discard conflicts** confirmation. Unapplied map previews are also counted before discarding. Cancelling leaves the workspace intact, but reading/building changed sources remains blocked until reloaded. Archive offsets, asset selections and preview caches are refreshed together. Repeat the interrupted export/import/build after reloading; it is not automatically retried with a potentially changed selection.

### Edit a cutscene character

1. Open the game's **data** folder or an AFS in the asset library, select the character model, then choose the cutscene under **Animation bank / cutscene → Cutscenes / PACK**. An external AFS/PACK opened only through **Playback settings & facial track → Open external motion…** can be previewed/exported; open its archive in the workspace before staging replacements.
2. Set the inclusive start/end range and choose **Export / Import → Export cutscene range…**. Choose **.blend** for Blender or **.fbx** for exchange. Both include the rig, model and matching facial shape key animation. The exported range starts at frame 0. The character is centered for authoring precision; stored metadata restores its original scene coordinates on import.
3. Animate original bones in Pose Mode, directly or with IK/control bones, and edit existing facial shape key values. Save the .blend or export FBX with Bake Animation, Custom Properties enabled, default Primary Y / Secondary X, and Add Leaf Bones disabled. Keep native shape key identities. A morph shared by several meshes needs matching weights on those meshes; conflicting values are reported. Do not edit the rest skeleton. Armature object movement/scale is ignored; animate bones for motion.
4. Choose **Import animation…** and select the edited file. Review source and destination ranges, optional retiming, and **Import bone motion** / **Import facial shape keys**. Uncheck facial import if you only need body motion. A missing/conflicting facial mesh can be corrected or excluded without blocking bone import.
5. **Stage animation**, review playback, save the project, then **Build mod**. The replacement is written to the original AFS path under data/sound/demo_afs in the new output folder. Original game files remain untouched.

PACK bones have explicit position and rotation records, so ANM missing-channel rules do not apply. The importer retains the target scene's length and native track layout. Other characters, camera/light records, audio and actor track 0 remain unchanged. Moving the skeleton does not relocate actor collision/event/culling state; this is character animation editing, not scene placement editing. Gameplay ANM and cutscene PACK exchanges are distinct formats.

Morph import preserves segment boundaries and untouched curves, rebuilds changed curves as signed Q12 keys, and restores 2048-byte section alignment. Boundary anchors can introduce at most half a Q12 step (1/8192) in surrounding integer samples; the importer measures and enforces this bound. A clamped curve sample can drive several scene frames: include the whole held interval to change it, or retain its original value. Values must fit -8 through 32767/4096. Rebuilt curves must leave three streaming blocks in the stock 0x210000-byte cutscene arena; excessive key data is rejected with an explanation. No executable patch is needed for this workflow.

Facial preview/export samples steady-state native weights: ends are inclusive, selection uses ceil(scene frame), and the last payload continues beyond its descriptor end. The game's one-update reset when a payload changes depends on runtime cadence; it is not baked into a stateless DCC export. Preserve segment boundaries and check authored results in the game.

Closing with unsaved work offers **Save**, **Don’t save**, or **Cancel**. Save validates and applies pending room edits on an isolated state, writes the project, and only then closes. Cancelling the file picker or an invalid edit keeps the workspace open.

**Save project** stores staged payloads and source hashes in a new .sh3project. Original archives/movies remain referenced. **Build mod** creates a new SH3-Build timestamped folder with changed archives or movies and a verified integrity manifest. Models or pictures requiring expanded storage include sh3.exe and runtime-buffers.json at the build root. The output folder opens after a successful build. Existing compatible morph, primary-index, transparent-mesh, font, picture and character-file patches are preserved and composed on later builds. It does not install into the game. Original files and existing exports are preserved. Test built assets in a separate game copy before deployment; file integrity is not an in-game behavior guarantee.

## Validation and remaining work

The unified installed workspace contains 2,796 main archive assets, seven movies, three loose pictures and 1,185 entries in the Sound section (70 archive/folder sources). All 157 PC MDLs and 461 texture containers parse, including valid empty containers; this is acceptance coverage, not exhaustive visual inspection. All 368 MES files, six font atlases, seven FMVs, 32 audio banks and twelve AIX files pass relevant round-trip checks. See [Validation](VALIDATION.md) for evidence and limits.

Remaining work includes game validation of authored ANM replacements, automatic morph transfer between unrelated models, ANM bank length/channel changes, PACK scene length/camera editing and complete scripted rendering, and complete world visibility/event editing and broader native collision shapes. New rigs and arbitrary native engine capacity increases are outside this release.

## Development

See [Development](DEVELOPMENT.md) for source setup and [media provenance](../tools/media/README.md) for the optional runtime.

## Archive export and image viewing

**Export all archives…** exports every opened archive and loose-file source across all four sections, regardless of current filters. Choose native files or converted files. Right-click a source in the sidebar, or use its hover ellipsis. **Export native files…** exports every entry of that source with staged edits, regardless of search/type filters. **Export converted files…** exports supported models/maps to GLB, every texture/palette preview to PNG, ADX/AIX/bank audio to WAV, messages to JSON and movies to MPEG. Unsupported entries keep their native bytes. PACK exports decoded morph JSON plus its native payload, retaining other cutscene sections. Each entry has its own indexed folder; export-report.json lists outputs and conversion failures. A failed conversion retains the native asset. Filesystem errors stop the operation.

Use the arrow keys to browse the filtered asset list. Text fields, selectors, animation controls and map-edit fields retain their own keyboard behavior. Use the texture toolbar or mouse wheel to zoom around the pointer. Drag with the left or middle mouse button to pan; Fit or double-click centers the whole image. 1:1 displays native pixels.

**Import PNG** resamples to the original dimensions and automatically reduces indexed images to 16/256 colors without forced dithering. Direct-color images retain their available color range. Shared-palette variants still require consistent recoloring of shared indices. RGBA5551 uses binary alpha. Font atlases retain their separate glyph/dimension rules. This is image fitting, not increased native resolution.

The three sys_title TEX files have an original zero batch count; their valid image records are now read. Picture RGBA and 0–128 alpha are handled separately from PC model BGRA. The stock main-menu loader has a 1,361,920-byte file arena: its 512² title fits, a 1024² direct-color title does not. PC Fix render-resolution settings do not establish an expanded file arena. Native texture growth and palette promotion are available through the separate Import PNG at full size action. Version 0.5.0 includes the expanded picture arena in builds that need it.

## Experimental texture replacement

Choose a texture, then **Import PNG at full size…**. This preserves the PNG dimensions instead of resampling. Indexed textures with one palette and RGBA5551 records become direct 32-bit color; existing direct-color records retain the appropriate picture/model channel and alpha convention. Shared palette variants cannot be collapsed because their material bindings would change. Fonts retain their glyph-layout rules.

The experimental writer updates image dimensions, pixel/header offsets, payload lengths, dimension exponents and batch length, then reopens and verifies the pixels. Subsequent images remain byte-exact. MDL geometry/rig/morph bytes preceding its terminal texture batch are preserved. Original-sized Import PNG remains available separately.

Use **Build mod** to write the staged result into a new output folder for a game test. The optional mode retains the imported dimensions. For oversized data/pic TEX assets, the build adds five 16 MiB picture slots (80 MiB total), plus bounds checks before the file copy. A 1024² title was rebuilt and archived successfully at 4,194,496 bytes; that exceeds the known stock arena and can crash the game unless its loader has been extended. Install the newly generated executable together with the texture archive. The patch passed 725 native emulator checks. On 2026-09-24 the user confirmed that the replaced texture renders correctly in the game, including nonstandard dimensions. Other model/map texture loading paths are not covered by this picture-specific patch. General editor bounds remain 8192 pixels per side, 16 megapixels and 256 MiB per asset.

## MAP part editor

Select a MAP, click a mesh or choose **Map part**, and use **Frame selected part** to focus it. **Move / Rotate / Scale** choose the 3D gizmo. Drag an axis or enter numeric transforms; UV offset/scale and material assignment also preview immediately. Drafts survive mesh selection and returning to the map. **Apply & stage map edits** validates and commits all its preview edits atomically. **Discard preview edits** resets them. Apply or discard previews before import, export, saving a project or building; unapplied drafts are not saved. **Ctrl+Z / Undo map action** first undoes preview gestures (100 steps), then applied map operations (20 states within a 64 MiB history budget), including selected shared-texture replacement. Text fields retain their normal text undo. Ctrl/Shift-click parts in the list or viewport to select several; Move and its numeric coordinates translate the whole selection. Group rotation/scale of MAP parts are not supported; collision selections have their own grouped transforms in the Room editor. Expanded static parts use native unpartitioned visibility while their MAP is loaded; event/movable parts keep their ownership and bounds. Applying keeps the camera framing.

**Selected material texture** shows the actual source TEX/MAP and native image index. **Replace selected texture PNG…** supports Fit or Full size, stages the correct embedded or GB/TR companion asset, and refreshes the map. A shared TEX replacement affects every map referencing that image. Material assignment uses an existing texture from the same native family and affects all parts in its native material group. Full size validates the complete indoor/outdoor stage and transition memory budget. If stock storage is insufficient, Build mod adds the conditional 256 MiB primary background extension.

### Edit one mesh in Blender

1. Select the part and choose **Export selected part GLB…**. Only this mesh and its assigned image are exported, with world placement preserved.
2. Import that GLB in Blender. Edit its vertices, UVs or topology, or apply a Subdivision Surface modifier. Keep one mesh with one material slot, normals, UVs and its vertex color attribute. The RGB colors carry native lighting tint. Preserve its placement; do not center the object by moving its geometry.
3. Export the selected object as GLB, including vertex colors. Applied object transforms are supported; mirrored transforms need their winding corrected before export.
4. Choose the original target part in the tool and **Replace selected part GLB…**. This stages a native strip rebuild with its original material, part identity and visibility bindings. Embedded GLB material images are not imported by this geometry action; use the PNG action for image changes.
5. Inspect the result, save the project, and **Build mod**. The output folder opens automatically.

Ordinary parts support a different number of vertices and triangles. The writer updates physical hierarchy lengths and all verified geometry, texture, interest-point and light-decal pointers, retaining other parts and texture payloads. Repeated imports do not accumulate stale geometry. The deterministic strip encoder adds repeated connector vertices, so the native vertex count is higher than Blender's indexed count.

Special parts carrying auxiliary native payloads support preserved-topology attribute edits only; the inspector explains this for the selected part. Transparent replacements may change topology but must not increase their original triangle budget pending runtime validation. RGB colors are required; each original ordinary part's constant native alpha is retained. Expanded static type-1 parts switch to native unpartitioned visibility; event and movable parts retain their original object envelope. Optimized repartitioning, room streaming, event editing, and adding/removing material groups remain separate work. Selected-mesh collision binding and CAM zone editing are described in [Map collision and cameras](MAP-WORLD.md). The new MAP writer is file- and Blender-tested; changed MAP rendering still needs a game test.

**Import whole map GLB…** retains the earlier strict exchange mode: keep all parts and original triangle/vertex order. Use the selected-part workflow for new topology.

## Morph workspace and Subdivision (0.7)

1. Select the model and choose **Morph workspace → Export workspace .blend…**. Open that file in Blender. Each affected part has a BASE and its named poses arranged in a compact row in the front-view plane, with spacing based on that part’s actual bounds; the rig and other original parts are retained.
2. Select the desired BASE, for example **Mesh_0_6__BASE**, and add **Subdivision Surface**, level 1. Leave the modifier unapplied. The importer applies identical settings to its base and every pose, including UV and point-attribute interpolation.
3. Edit pose vertices in Edit Mode if needed. Keep the original object transforms, rig, groups and `sh3_correspondence` point attribute. Do not independently remesh only one pose. Every pose must retain matching topology and vertex correspondence; equal vertex counts alone are insufficient.
4. Save the `.blend`, then choose **Morph workspace → Import workspace…**. Review the preselected part/material and shape-key mappings, then **Review replacement…**, then **Apply & stage model**.
5. Preview the native morphs and **Build mod**. Install its data and required runtime patch together, as for GLB rebuilding.

Assembly uses the BASE modifier stack for all poses; it supports Armature and Subdivision Surface, not arbitrary modifiers. Skin weights are limited to the strongest three influences and normalized for the game. Unrelated replacement faces still need authored expression correspondence. Source blend files are opened with script auto-execution disabled and are never overwritten.

## ANM animation exchange (0.9.0)

1. Select a model and an ANM from Asset library. In **Clips & tools → Clips**, choose an action or a custom inclusive range; FPS is under playback settings. Then use **Export / Import → Export ANM range…**. For example, 825–834 exports ten samples, numbered 0–9 in the exported scene. Choose Blender (.blend, recommended) or FBX. ANM contains no FPS or named-action table.
2. Open the exported .blend directly in Blender. For FBX, import with animation offset 0 and automatic bone orientation disabled, then disable **Connected** on the original bones in Edit Mode before animating or baking: Blender automatically connects collinear FBX joints and suppresses their independent translations. Edit animation in Pose Mode. Retain the original bone names, rest axes and original-bone ancestry. Additional IK/control bones and helper rigs are allowed. Sparse keys are evaluated at every source frame automatically.
3. Either save a **.blend** scene and import it directly, or export FBX with **Bake Animation**, **Custom Properties**, **Key All Bones**, **Simplify 0**, and **NLA Strips / All Actions disabled**. Keep Add Leaf Bones disabled and use Blender's default **Primary Y / Secondary X**. Preserve the exported rest axes. FBX does not preserve Blender constraints; Bake Animation records their result. Direct .blend import evaluates the scene's constraints and active action/NLA without requiring manual baking. Blender file scripts are not auto-executed.
4. Select the destination ANM, which may be another bank for the same original skeleton. Choose **Import animation…**, then the FBX or .blend. The dialog shows separate source and destination ranges and counts. Both endpoints are included. Use **Fit source motion to the destination range** only when you intend to retime the clip. Trimming a duplicated final loop pose is an explicit source-range choice.
5. Choose the missing-channel policy. **Preserve unsupported channels** imports writable motion and lists every skipped bone/channel and frame range in the persistent result. **Stop if any motion cannot be written** rejects such a replacement. Neither option creates new native channels.
6. Stage, inspect playback, save the project and Build mod. Frames outside the destination interval remain byte-identical, and the target bank keeps its length and layout. Test gameplay, weapon transitions and cutscenes in the game.

The converter uses evaluated original-bone transforms, so control bones themselves are never written into ANM. Blender (.blend) model/animation exports orient each bone along its joint chain, using skinned vertices for terminal bones and a common roll reference. FBX exports retain the original SH3 bone orientation. For .blend, evaluated poses are rebaked into the authoring basis without changing skin deformation. The importer converts poses back to the original SH3 local axes using the stored bind reference. Static uniform applied skeleton scale is normalized; armature object placement and object scale do not become root motion. Animate the original root bone when root motion is intended. Bone Scale animation is ignored because ANM stores only Location/Rotation. Rest-pose changes are checked separately and identify the affected bone.

A loop range 0–9 contains ten samples and interpolates from 9 back to 0. A repeated first pose at frame 9 can create a hold; it is not silently removed. Preview loop/clamp and FPS do not edit the game's action/event tables. Compatible skeletons permit cross-bank transfer, but weapon grips, root motion, hit events and transition timing still belong to the target action.

**New channels remain a runtime feature.** The stock player uses fixed model strides, one shared stride during old/new-bank blending, sequential decoder cursors and procedural bone masks. Heather gameplay detaches bones after 42 and protects some earlier nodes. Appending channels or merely increasing a stride would not safely enable hair/fingers. No expanded-ANM runtime patch is included in this version.

The source suite includes animation range/channel tests. A self-contained Blender regression can be run with `blender --background --factory-startup --disable-autoexec --python tools/blender/test_animation_rig.py`. It checks two-bone IK, sparse controls, extra bones, object scale, inclusive frame numbering and rest-pose rejection without game files.

### Blender model scenes and bone axes

**Export Blender (.blend)** saves the assembled model with its rig, shape keys and packed textures. Open it in Blender, edit the model and save; **Import model…** accepts the saved .blend directly, alongside GLB, GLTF and FBX. This is separate from **Morph workspace**, which lays out base and expression meshes for synchronized subdivision. Blender scene scripts are not auto-executed by the converter.

.blend uses individually joint-aligned authoring bones. FBX retains the original SH3 bone orientation, without joint alignment or roll changes. Blender scenes retain independent bone translations; FBX import in Blender can automatically enable Connected on aligned joints. Disable that connection before animating Translation or baking a return FBX. The tool also disables automatic connections on original bones while reading FBX, but cannot recover a translation already omitted by another program's bake.

When exporting back through FBX, keep **Primary Y / Secondary X**, **Add Leaf Bones disabled**, and **Custom Properties enabled**. For GLB/GLTF, enable **Custom Properties** as well. The armature's `sh3_model_bind` property retains the conversion back to native rest and inverse-bind matrices. Real rest-pose edits are still rejected; calibration does not replace an edited skeleton with a stored snapshot. Direct GLB exports retain the original game basis.

The Blender scene/FBX basis and deformation regression runs with `blender --background --factory-startup --disable-autoexec --python-exit-code 1 --python tools/blender/test_fbx_axes.py`.


## Map collision, camera zones and flight navigation

See [Map collision and cameras](MAP-WORLD.md) for selected-mesh CLD binding, automatic rebuild after topology changes, CAM editing, CLD/CAM reference layers on MAP geometry, an approximate camera study, grouped undo, and WASD / X / C navigation. The draggable, resizable **Room editor** keeps collision, camera and auto-rebuild controls in the viewport. **E / R / T** switch transform tools; visible collision geometry can be selected directly.

## Extended authoring workflows

See [Mod authoring](MOD-AUTHORING.md) for Blender Morph Tools 1.3.2, Merge mods, KG1 shadow rebuilding and fixed-range animation import. See [Cutscene Inspector](CUTSCENES.md) for full-scene `.blend` export and PACK visibility.
