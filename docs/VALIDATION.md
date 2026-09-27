# Validation for 0.8.3

Validation combines synthetic regression tests, local real-asset checks, exchange comparisons and selected user-confirmed game tests. Private game assets and development trace dumps are not redistributed. The source test suite is self-contained.

## Automated source checks

The Node suite contains **171 tests** covering archive writes, native layouts, texture and font exchange, messages, model/morph rebuilding, map operations, animation channels, project behavior and runtime patch composition/authentication. The extracted native-layout validator lives under `tests/helpers`, so tests no longer depend on a private research directory. The production UI bundle is built with esbuild.

The 0.8.3 regression checks cover one-click GLB import of unchanged geometry and automatic rebuild setup when a mesh changes material slots. A real Heather archive was also previewed before and after an in-memory PNG replacement: only the selected slot's decoded image changed, while all other slots stayed byte-identical. This does not substitute for testing the installed mod in the game.

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

## UI and game checks

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
