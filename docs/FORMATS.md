# Format support

Support below describes the implemented PC workflows. A file extension alone is not sufficient to identify every game resource; unsupported variants can still be exported/replaced as native bytes without a specialized editor.

| Format / resource | Preview and export | Import / editing scope |
| --- | --- | --- |
| ARC catalog/subarchives | Asset tree, native export, converted archive/all-archive export | Stage native replacements; build separate archives with updated layout |
| AFS, nested demo AFS | Container browsing and embedded file detection | Native replacements and supported converted audio exchange |
| PC MDL | Textured model, skin/skeleton, morphs; GLB, FBX and Blender scenes | GLB / GLTF / FBX / .blend import with base-color images; compatible edits or native geometry/morph rebuilding against the original rig; new slots up to native limits; per-texture PNG replacement |
| ANM | Skeletal playback, verified character/enemy and Game Over action ranges from local sh3.exe, custom range selection, Blender / FBX range export | FBX / Blender evaluated motion into explicit ranges of same-skeleton banks; existing channels retained; imports keep bank length and native Action ranges; unsupported channels reported |
| Cutscene PACK tracks | Full-scene Inspector with camera, characters, facial motion, MAP objects/environment and ADX audio; selected-character Blender/FBX exchange and whole-scene Blender export | Selected-character exchange and whole-scene Blender reimport of existing bones/morphs, camera, lights and moving props; preserves scene length, masks, other tracks and actor state. New channels, geometry/audio import through the scene button and scripted effects remain unsupported; see [Cutscene Inspector](CUTSCENES.md) |
| KG1 / KG2 | Shadow-geometry inspection; KG1 bind-pose overlays and proxy GLB export | Rebuild KG1 from MDL geometry or import edited per-bone proxy geometry, with explicit disable/source restoration. KG2 remains native exchange. These are not skeletal animation clips |
| TEX, texture-bearing DAT/TBN2, PIC | Decoded texture preview, pan/zoom, PNG | Format-aware replacement; optional full-size mode for supported paths, not a guarantee for every container |
| `fontdata_*.bin` | Normal/Small glyph atlas, PNG | Native font editing and 2×/4× coverage extensions; expanded fonts need the runtime uploader |
| BMP / PNG pictures | Texture Inspector preview and PNG export | PNG replacement; uncompressed 24/32-bit BMP retains its dimensions and requires opaque artwork |
| MES | Parsed message inspection and JSON | Validated message JSON reimport |
| MAP | Textured geometry; whole-map or selected-part GLB | Multi-select transforms, gizmo/undo, texture/UV/material edits, supported visibility edits, part rebuilding with new topology; explicit Apply stages output |
| CLD | Collision geometry and spatial lists | Edit individual records inside MAP or rebuild selected mesh bindings; native wall/grid constraints apply |
| CAM | Gameplay camera zones, MAP overlays and supported camera-study modes | Edit/rebuild existing records, JSON exchange and undo; cutscene camera tracks are separate |
| DED / SDB | Lighting and sound-region/control structure inspection | Native export/replacement; no complete event scripting editor |
| SBD | No verified sample in the research installation | Native export/replacement only; do not assume SDB support applies to SBD |
| ADX / WAV and recognized audio BIN | Audio preview, WAV exchange | Supported ADX/native audio replacement; `.bin` in demo archives may be audio rather than a font |
| HD / BD sound banks | Bank/sample inspection and decoded audio | Supported sample replacement/repacking; preserve paired resources and bank constraints |
| AIX | Audio stream inspection/preview and export | Supported audio replacement and native rebuilding |
| PC movies (`data/movie`, including `.000`) | Decryption, playable preview and video export | Conversion to the native MPEG-1/MP2 program-stream workflow and re-encryption |
| Unknown BIN / other files | File information, native export | Native byte replacement only |

Media conversion uses optional FFmpeg; FBX and `.blend` workflows use optional Blender. Raw export does not require a converter. Batch converted export can only convert formats supported by the corresponding exporter; inspect its result/report for skipped or failed entries.

**AFS audio:** rebuilt archives and compact overlays preserve the native sequential sector layout. A replacement WAV in `sd.afs` must fit the original 976,896-byte sound-effect scratch buffer, including rounding the complete file up to a 2,048-byte sector boundary. This limit does not apply to every other audio format or bank. Codec, stream and paired-bank constraints still apply.

**Models:** current rebuilding templates use 48-byte skinned vertices. New skeletons, unlimited bone influences and semantic expression matching between unrelated faces are outside this release. An optional Blender add-on transfers relative shape-key displacements geometrically, with manual facial review. GLB/GLTF/FBX model import and FBX ANM exchange are separate actions. Model textures accept PNG/JPEG base-color images; 32 image slots and 32 texture groups per mesh group are supported with a conditional executable extension beyond the stock tables. PBR normal/metallic/roughness shading is not converted.

**Maps:** selected mesh bindings can rebuild CLD collision; CAM zone editing is available. Gameplay triggers, portals and scripts are not edited. See [Map collision and cameras](MAP-WORLD.md). Changed topology and visibility still need testing in the game. See [Workflows](WORKFLOWS.md) and [Executable patches](EXECUTABLE-PATCHES.md).

**Texture Inspector:** indexes recognized TEX/DAT/TBN2/PIC containers, PC MDL batches, embedded MAP batches, font atlases and supported BMP/PNG files in the opened workspace. Shared GB/TR map companions are listed under Texture files, with their referencing maps. Embedded MAP imports support Fit or Full size for terminal batches. Growth requires the complete stage catalog and indoor/outdoor memory validation. Build mod conditionally expands the primary MAP arena to 256 MiB when stock storage is insufficient. Unsupported variants are reported in the catalog rather than silently omitted. This is staged file editing, not live injection into a running game.

## Folder-based replacement

[Batch replacement](BATCH-REPLACE.md) supports PNG slots (including MDL/MAP), native TEX/PIC/DAT/TBN2/BMP, PCM WAV, native ADX/AIX and converted AIX/HD+BD WAV tracks. It retains the individual import limits; it does not introduce WAV-to-ADX conversion or new game codecs.
