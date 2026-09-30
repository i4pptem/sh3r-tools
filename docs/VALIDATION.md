# Validation for 0.9.0

Validation combines synthetic regression tests, local real-asset checks, exchange comparisons and selected user-confirmed game tests. Private game assets and development trace dumps are not redistributed. The source test suite is self-contained.

## Automated source checks

The Node suite contains **233 tests** covering archive writes, native layouts, texture and font exchange, messages, model/morph rebuilding, map operations, animation channels, project behavior and runtime patch composition/authentication. The extracted native-layout validator lives under `tests/helpers`, so tests no longer depend on a private research directory. The production UI bundle is built with esbuild.

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

## Animation workflow validation for 0.9.0

A real ten-frame Heather export/import remained byte-identical. The Blender scene exporter aligns bones individually with the joint hierarchy and converts back to the native basis; FBX retains native axes. All 73 Heather bones passed strict native rest and inverse-bind validation after model FBX export/import and after Blender resaving to both FBX and GLB. Moving and uniformly scaling the armature object by 7 preserved the imported ANM bytes. Sparse control keys, an extra control bone, Copy Rotation and a real two-bone IK constraint were sampled in Blender 5.2.2; direct .blend and baked FBX inputs were checked. The IK case changed 18 native rotation samples without unsupported channels. Transferring the same motion from a knife bank to a pipe bank preserved target length and every byte outside the destination interval. These are file/conversion checks; this newly authored motion has not been tested in the game.

The standalone Blender test contains no game files. Source tests cover missing-channel reports/strict mode, same-skeleton cross-bank transfer, endpoint mapping, explicit retiming and loop sampling bounded to the selected action. Isolated original-code research confirmed ten inclusive loop samples for 0–9 and ran 632 expanded-frame decoder cases, but also proved additional stride/blending/procedural blockers. Expanded native ANM channels are deliberately not shipped as a supported feature.

The packaged 0.9.0 UI passed the FBX preparation → strict rejection → channel-preserving staging flow at 1120 × 720, with a persistent bone018 report and ten inclusive frames shown. No renderer errors were recorded. The earlier 111-frame Animation_825-935 FBX also reimported without any native byte changes. Both object scale and applied uniform rest scale passed the standalone Blender regression.

The FBX animation also remained byte-identical after Blender re-export with default Y / X axes. A two-bone IK edit on that authoring skeleton changed 18 native rotation samples while preserving bytes outside the destination interval. A self-contained Blender test verifies the exported basis, sampled native poses and evaluated skinned vertex positions. Model calibration regression tests preserve real rest and inverse-bind edits so strict validation still rejects them; applying calibration twice is prevented by consuming its metadata.

The resaved model FBX also completed native MDL rebuilding with 57 meshes, 25 morph slots and an unchanged native skeleton; its rebuilt native layout passed validation.

Native-axis FBX and joint-oriented .blend exports were checked against the original Heather motion: maximum measured native translation difference was 0.00156 game units and rotation difference 0.00122 degrees before no-op calibration; unchanged imports preserved every ANM byte. All 73 bones in both model and animation FBX exports matched the original SH3 axes within 0.00173 degrees. Both model formats completed a 57-mesh / 25-morph rebuild with unchanged native bones. A self-contained regression exercises both actual exporters and checks format-specific rest axes, mesh counts, evaluated animation and skin deformation. Twenty main joint directions, matching forward-facing feet, independent .blend bone translations and packed textures were checked, with a CPU-rendered layout review. Blender FBX auto-connection can suppress local translations in the DCC; the .blend path avoids this, and the converter disconnects original bones while reading FBX.

## Cutscene playback validation for 0.9.0

All 77 PACK entries in the development installation parsed successfully. Of their character tracks, 176 clips matched available MDLs; one character ID (0x1023 in hp3f.afs) had no matching model in that installation. First, middle and last samples of each matched clip were reconstructed through the viewer skeleton and compared with independently constructed absolute native transforms: 528 sampled poses, maximum position error 2.92e-11 game units and maximum matrix-component error 1.75e-7. These comparisons verify coordinate conversion, not rendered equivalence to the game.

Synthetic regressions cover interleaved character/camera tracks, shorter streams, actor-origin separation, malformed records, absolute-to-local conversion, wrapped Euler interpolation, normalized quaternion interpolation, large position jumps and camera cuts. Motion-library/player tests cover source invalidation, pairing facial motion only from the same PACK, clearing stale expressions, facial track endings and restoring bind scale. The source suite totals 233 passing tests.

PC instruction analysis confirms scene-absolute skeletal poses, the 30-sample clock and interpolation rules. The preview's camera-cut detector uses the native one-tick baseline; the game's elapsed-tick factor varies at runtime and is not stored in PACK. This timing assumption can change interpolation around some camera transitions. Camera tracks inform cuts but are not rendered. Full live, frame-by-frame comparison remains outstanding.

Electron UI checks cover automatic discovery, combined skeletal/facial playback, timeline seeking, fitting the current pose, switching back to ANM, and selecting the appropriate exchange controls. Playback is read-only; no source game archives are modified by these checks.

## Cutscene exchange validation for 0.9.0

Three-frame exchange ranges from all 176 matched character clips in 77 PACK files reimported byte-identically. Native arena bounds passed for the whole corpus. A regression retains exact half-turn Euler representatives, avoiding float32 wrapping drift at integer samples. Synthetic checks cover parent/child motion, other characters and tracks, range limits, invalid rigs, repeat imports, morph keys, held-frame aliases, source identity, sector relocation and the three-block streaming reserve.

A real ten-frame Heather cutscene range passed .blend and direct FBX export/import with every PACK byte unchanged. Edited bone motion and facial weights imported through both formats; unaffected skeletal frames, actor/camera/other-character records remained byte-identical. The tested facial edit had zero surrounding-frame error. A project save/load and repeated import preserved the rebuilt bytes, and Build mod produced a separate AFS with 2048-byte-aligned PACK sections. Blender scene-to-FBX conversion can introduce small floating-point rotation differences; .blend avoids that additional conversion.

The self-contained Blender test `tools/blender/test_animation_morphs.py` covers signed weights, persistent mesh identities, shared-target conflicts, missing meshes and facial keys extending the sample range. Electron UI checks exercise cutscene .blend export, the PACK range dialog, separate bone/facial toggles, staging and refreshed clip IDs with no renderer errors.

The PC write contract was checked against executable instructions: morph sections load in 2048-byte sectors, the stock demo arena has 0x210000 bytes, and streaming needs at least three 0x19000-byte blocks. The importer conservatively accounts for resident headers, lookups, scratch buffers and alignment before allowing morph growth. Existing segment boundaries and unknown fields are preserved. Stateless sampling follows steady-state selection and does not simulate the runtime's one-update reset on payload changes. The newly authored cutscene has not yet been tested in a running game.

## Action ranges, viewport controls and source reload

The local executable extractor verifies six code signatures, the weapon-class → bank-index → file-ID → filename mapping and descriptor bounds. Eleven original Heather gameplay banks expose 1,083 bank/action entries, including shared ranges repeated across banks. Placeholder records are omitted. Original code run in isolation confirmed all 11 weapon selectors and native fixed-point timing at four speeds; this does not claim live gameplay labels or reproduce procedural upper/lower-body blending.

Source tests cover safe replacement remapping by ARC file ID, already installed edits, conflicting and missing/ambiguous identities, changes during a pending reload, project save/load after refresh and loose-file index changes. Electron tests exercise the native dialog on a synthetic archive, cancellation, preserving compatible edits and explicit conflict discard. Source game files are not modified by these tests.

The viewport panel was checked at normal size and 1120 × 720: collapsed height below 100 px, expanded content constrained to the viewport, verified action selection/default rate/loop, stepping actions, exchange access and manual morph preview. Manual frame input and unsupported-bank discovery remain available. No renderer errors were recorded.

Fractional-FPS regression: Blender's FBX reader receives the effective scene rate (fps / fps_base) when converting animation times. Self-contained checks at 3.75, 7.5, 11.25, 15, 29.97, 30 and 60 FPS preserve ten frame positions and evaluated motion. A real native Action 101 range at 3.75 FPS was exported/reimported through .blend and FBX; both retained the entire ANM byte-for-byte. This corrects the time conversion rather than widening endpoint tolerances.

Animation panel geometry was checked with real pointer gestures: header dragging, corner resizing, collapse/reopen with restored size, keyboard movement, Escape cancellation and unchanged canvas pointer input. An app restart restored the saved rectangle; dragging beyond viewport edges, resizing the main window to 1120 × 720 and entering Focus preview kept the panel visible. Reset restored its default bottom-left layout. No renderer errors were recorded.
