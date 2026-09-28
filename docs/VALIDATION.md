# Validation for 0.8.5

Validation combines synthetic regression tests, local real-asset checks, exchange comparisons and selected user-confirmed game tests. Private game assets and development trace dumps are not redistributed. The source test suite is self-contained.

## Automated source checks

The Node suite contains **206 tests** covering archive writes, native layouts, texture and font exchange, messages, model/morph rebuilding, map operations, animation channels, project behavior and runtime patch composition/authentication. The extracted native-layout validator lives under `tests/helpers`, so tests no longer depend on a private research directory. The production UI bundle is built with esbuild.

The 0.8.3 regression checks cover one-click GLB import of unchanged geometry and automatic rebuild setup when a mesh changes material slots. A real Heather archive was also previewed before and after an in-memory PNG replacement: only the selected slot's decoded image changed, while all other slots stayed byte-identical. This does not substitute for testing the installed mod in the game.

The 0.8.4 regressions additionally cover catalog ownership and shared-map references, MDL and MAP texture replacement, unchanged container geometry/suffix bytes, stale source rejection, incremental cache invalidation, metadata-only parsing and BMP row/padding preservation.

The 0.8.5 suite covers external/multiple GLTF buffers, data URIs, PNG/JPEG companions, missing/escaping resource paths, linear base-color factors, material-slot conflicts and gaps, native image-table growth, template metadata, repeat-import identity and extra skin-weight channels.

A further ANM regression reproduces an absent-bone FBX rotation residual beyond the float32 comparison bound but with identical native quaternion codes. Real changes crossing the native code boundary and meaningful missing-channel motion are still rejected. A supplied 111-frame animation (825–935) imported directly from the original edited FBX with incoming Scale ignored; bytes outside the range and repeated-import output remained identical. Exporting and importing an unchanged range retained the entire native ANM byte-for-byte. Regression tests verify translation/rotation-only exports, preserved static bind scale, and ignored legacy scale fields. Blender checks verify that exported FBX contains no Scale animation connections and that removing those tracks preserves all other objects and connections. Original FBX and game archives were not modified.

## Asset and exchange coverage

The development installation exposed 2,796 main archive assets, seven movies, three loose pictures and 1,185 Sound-section entries. Parsing checks covered 157 PC MDLs and 461 texture containers, including valid empty containers. Relevant round-trip checks covered 368 MES files, six font atlases, seven FMVs, 32 audio banks and twelve AIX files. These counts describe that installation, not every regional game release or exhaustive visual inspection.

FBX export was independently reimported and compared with the source GLB:

| Case | Coverage / result |
| --- | --- |
| Dense edited Heather | 69 meshes, 94,836 vertices, 73 bones, 100 per-mesh shape keys, four textures |
| Heather geometry | Maximum measured world-position/shape error 0.0001421; combined skeletal+morph deformation error 0.0004883 |
| Heather attributes | Topology, UVs, skin weights, materials and image pixels matched the exchange baseline |
| Additional model | Seven meshes, 2,267 vertices, two bones, one texture; position error 0.0001316 |

The measured position/deformation errors are below half the native 1/16 position step. This supports the tested Blender bridge path, not every DCC/FBX configuration.

The 0.8.4 catalog scan found **2,820 images** in the development installation: 328 MDL images, 1,862 embedded MAP images, 624 standalone images (including archived and loose BMP copies), and six font atlases. All images in 896 nonempty sources decoded successfully; 19 additional supported sources were empty. PNG replacements in a real MDL, MAP, shared TEX and BMP survived project save/load and a verified three-archive build; original source hashes remained unchanged. These are installation-specific counts, not coverage claims for every regional variant.

A clean Heather was imported with six images through GLB, external-resource GLTF and FBX (Blender 5.2). GLB → GLTF repeat import produced byte-identical rebuilt MDLs. All paths retained 57 meshes, 25 morph slots and 16,768 triangles; FBX split additional vertices at exchange boundaries. New slots appeared in Texture Inspector, and the result built into a verified separate chrpl.arc without changing the original archive. Native-code emulation registered all six images and checked 57 bindings across three material consumers in four run-table configurations. These are file/emulation checks; the new six-slot model has not been tested in a running game.

## UI and game checks

The 0.8.5 UI checks cover all four page sizes with loaded thumbnails, arrow navigation across a page boundary, preference persistence after reload, the 1120 × 720 footer layout, one three-format import dialog, rebuilding through each format and six updated catalog images. No renderer errors were recorded.

The 0.8.4 Texture Inspector UI check covered catalog search/filtering, real MDL PNG import/export, embedded MAP replacement, live preview refresh, shared-map references, source navigation and the 1120 × 720 layout, with no renderer errors. These tests stage files locally; the newly authored test mod has not been scene-tested in game.

Packaged UI checks covered model GLB/FBX export, GLB edit/revert, topology import controls (0.8.1), animation/morph playback, compact/focus layouts, panel persistence, map group movement/undo and high-resolution font build output. Picture patch validation included 725 native emulator checks. Model buffer and font uploader paths were also exercised with native emulation and patch-composition checks. The 0.8.1 character arena patch was checked across 32 combinations with previous extensions; a generated Windows PE launched against the oversized test model. The packaged replacement dialog was exercised with the affected GLB, including independent texture selection and bone warnings.

The user also confirmed that corrected gameplay/cutscene model variants removed stretched geometry and preserved the original pose morphs with an enlarged character model. The updated atlas for retained original hair still needs an in-game check. The user confirmed in-game behavior for the tested subdivided Heather geometry, facial cutscenes after secondary/morph expansion, removal of large-model index distortions with INDEX32, nonstandard-size menu pictures and the new 4× Normal font uploader. This is selected game validation, not a guarantee for arbitrary replacement assets.

The publication build additionally runs tests and UI compilation from the standalone source folder, verifies the portable ZIP contents, and checks launch/export behavior from the extracted archive. Release build records are kept outside the public source tree.

## Still requiring broader validation

- Authored ANM replacements in the game, especially transitions, root motion and IK/procedural behavior.
- Changed MAP rendering/visibility across scenes and special part types.
- Different rigs/templates, more authored morph workspaces and other DCC versions.
- Full-size textures outside the specifically extended picture loader.
- Executable revisions beyond the two audited base hashes.

Build reports retain `runtimeVerified: false` because the builder itself has not executed the user's newly authored replacement in the game. See [Executable patches](EXECUTABLE-PATCHES.md).

The conditional model-texture extension was tested with real eight- and 32-image Heather imports, repeated-import byte equality, catalog indexing and separate archive builds. Reapplying the composed executable patch is byte-identical. Native instruction emulation runs the compiled extension with original registration, lookup and cleanup code: 32 simultaneous models with 1,024 resources, all three material binders, auxiliary slots, single/bulk cleanup and global reset. All 1,199 stubbed GPU creates have matching releases; adjacent model memory and stack/callee-saved registers remain intact. GPU calls are stubbed in these tests. The stock-layout scan checked 158 MDLs for consistent header/batch counts. A live 32-slot Heather test recorded 80 resource lookups across primary and secondary material rendering, including Texture_31; every sampled GPU pointer was nonzero. The user confirmed correct textures during gameplay, weapon changes and a cutscene. Composing all seven runtime extensions and reapplying them was byte-identical. These checks cover the supplied test model, not every authored replacement.
