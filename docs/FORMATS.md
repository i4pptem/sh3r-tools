# Format support

Support below describes the implemented PC workflows. A file extension alone is not sufficient to identify every game resource; unsupported variants can still be exported/replaced as native bytes without a specialized editor.

| Format / resource | Preview and export | Import / editing scope |
| --- | --- | --- |
| ARC catalog/subarchives | Asset tree, native export, converted archive/all-archive export | Stage native replacements; build separate archives with updated layout |
| AFS, nested demo AFS | Container browsing and embedded file detection | Native replacements and supported converted audio exchange |
| PC MDL | Textured model, skin/skeleton, morphs; GLB, FBX and Blender scenes | GLB / GLTF / FBX / .blend import with base-color images; compatible edits or native geometry/morph rebuilding against the original rig; new slots up to native limits; per-texture PNG replacement |
| ANM | Skeletal playback, verified Heather gameplay action ranges from local sh3.exe, custom range selection, Blender / FBX range export | FBX / Blender evaluated motion into explicit ranges of same-skeleton banks; existing channels and bank length retained; unsupported channels reported |
| Cutscene PACK tracks | Character skeletal and facial playback from PACK/AFS, filtered by selected model; matching face and body share a timeline | Selected-character range export/import through Blender or FBX, including existing facial controls; preserves scene length, other tracks and actor state. Camera playback and full scene authoring are not supported |
| KG1 / KG2 | Shadow-geometry inspection where recognized | Native exchange; these are not ordinary skeletal animation clips |
| TEX, texture-bearing DAT/TBN2, PIC | Decoded texture preview, pan/zoom, PNG | Format-aware replacement; optional full-size mode for supported paths, not a guarantee for every container |
| `fontdata_*.bin` | Normal/Small glyph atlas, PNG | Native font editing and 2×/4× coverage extensions; expanded fonts need the runtime uploader |
| BMP / PNG pictures | Texture Inspector preview and PNG export | PNG replacement; uncompressed 24/32-bit BMP retains its dimensions and requires opaque artwork |
| MES | Parsed message inspection and JSON | Validated message JSON reimport |
| MAP | Textured geometry; whole-map or selected-part GLB | Multi-select transforms, gizmo/undo, texture/UV/material edits, supported visibility edits, part rebuilding with new topology; explicit Apply stages output |
| CLD / CAM | Recognized collision/camera structure inspection | Native export/replacement; not a complete collision or camera-sequence authoring tool |
| DED / SDB | Lighting and sound-region/control structure inspection | Native export/replacement; no complete event scripting editor |
| SBD | No verified sample in the research installation | Native export/replacement only; do not assume SDB support applies to SBD |
| ADX / WAV and recognized audio BIN | Audio preview, WAV exchange | Supported ADX/native audio replacement; `.bin` in demo archives may be audio rather than a font |
| HD / BD sound banks | Bank/sample inspection and decoded audio | Supported sample replacement/repacking; preserve paired resources and bank constraints |
| AIX | Audio stream inspection/preview and export | Supported audio replacement and native rebuilding |
| PC movies (`data/movie`, including `.000`) | Decryption, playable preview and video export | Conversion to the native MPEG-1/MP2 program-stream workflow and re-encryption |
| Unknown BIN / other files | File information, native export | Native byte replacement only |

Media conversion uses optional FFmpeg; FBX and `.blend` workflows use optional Blender. Raw export does not require a converter. Batch converted export can only convert formats supported by the corresponding exporter; inspect its result/report for skipped or failed entries.

**Models:** current rebuilding templates use 48-byte skinned vertices. New skeletons, unlimited bone influences and automatic expression matching between unrelated faces are outside this release. GLB/GLTF/FBX model import and FBX ANM exchange are separate actions. Model textures accept PNG/JPEG base-color images; 32 image slots and 32 texture groups per mesh group are supported with a conditional executable extension beyond the stock tables. PBR normal/metallic/roughness shading is not converted.

**Maps:** movement edits supported mesh data, not arbitrary gameplay triggers, portals, scripts or collision. Changed topology and visibility still need testing in the game. See [Workflows](WORKFLOWS.md) and [Executable patches](EXECUTABLE-PATCHES.md).

**Texture Inspector:** indexes recognized TEX/DAT/TBN2/PIC containers, PC MDL batches, embedded MAP batches, font atlases and supported BMP/PNG files in the opened workspace. Shared GB/TR map companions are listed under Texture files, with their referencing maps. Embedded MAP imports fit the original dimensions and preserve offsets; they do not resize the map texture batch. Unsupported variants are reported in the catalog rather than silently omitted. This is staged file editing, not live injection into a running game.
