# Validation

Validation combines synthetic regression tests, local real-asset checks, exchange comparisons and selected user-confirmed game tests. Private game assets and development trace dumps are not redistributed. The source test suite is self-contained.

## 1.0.1

The following checks cover the consolidated release. Intermediate suite counts record the checks performed when each feature was implemented; the final complete suite contains 394 tests.

### Action catalogs and implicit skin weights

The self-contained Node suite passed **394/394 tests**. New coverage checks native residual weights and distinct fourth palette indices, unchanged MDL/GLB round trips, invalid bone references, per-bank descriptor bounds and identity, placeholders, model/frame-layout restrictions, and reflection hierarchy compatibility. Repository source checks and the production UI build passed.

The original executable yielded **510 additional bank/Action pairs** across 30 bank profiles, alongside the 11 existing Heather gameplay profiles. Descriptor IDs, sample bounds, native filename mappings, loader selectors and relevant function fingerprints were verified. Two original enemy Action setters passed **818 isolated x86 emulation checks** over all 409 enemy IDs. No live game process was attached or patched for this work.

All 41 recognized real bank layouts produced bounded Action catalogs. Forty banks decoded with their matching installed models. The legacy en_ded1.mdl_ has a different/incomplete hierarchy and still cannot decode en_ded1.anm; its Action table alone does not resolve that model mismatch. All 28 installed Heather/player reflection variants accepted the unarmed bank and its 101 Actions.

All **157 original PC MDLs** passed parsing after the skin correction. The supplied third-party archive's **28 MDLs** and standalone model also opened. The standalone 12,035-vertex, 57-part model exported to textured GLB and reimported without edits **byte-for-byte**. Synthetic checks also cover a fourth influence distinct from the first three. Original supplied files were not modified. New-topology writing remains limited to three authored influences.

An isolated Electron UI check selected and played enemy, Heather costume/reflection and Game Over Actions through the actual controls, and previewed the supplied MDL through native replacement staging. It used a separate app profile and supplied file-dialog selections through the test harness. These are app/file-level and isolated native-code checks, not a new in-game acceptance test of every animation or replacement model.

### Folder-based replacement

The complete Node suite passed **380/380 tests**, with no skipped tests. Batch regression coverage includes unchanged inputs, AFS duplicate names and explicit entry indices, archive scoping, two texture slots in one MDL (fit and full size), MAP geometry preservation, overlapping inputs, malformed WAV/PNG, the native SD buffer cap, stale reviews and a file changing midway through an atomic batch. Repository source/profile checks and the production UI build passed.

An isolated Electron instance exercised the actual folder-dialog handlers and review UI: ready/error/unmatched audio rows, selective WAV staging, then PNG staging from Texture Inspector. The preview image was read back and compared; no renderer exceptions occurred. Native dialog results were provided by the test harness. The review was visually inspected through an Electron capture.

On the original PC Heather model, a batch of two texture slots produced exactly the same MDL bytes as sequential individual imports, while the other slots stayed unchanged. A two-sample HD/BD fixture was converted through the installed FFmpeg runtime; both replacements composed into the same BD without modifying its original files. These are file-level checks, not a new in-game acceptance test of arbitrary replacement packs.

Antivirus reports on the development snapshots and the investigation limits are documented in [Antivirus verification](ANTIVIRUS.md).

### Persistent file dialogs

The complete Node suite passed **370/370 tests**, with no skipped tests. Six new tests exercise restart persistence, separate data/build locations, shared model export/import folders, cancellation, multi-selection, removed folders and malformed preferences. Syntax and repository checks passed.

An isolated Electron integration check opened the original data folder through the real IPC handler, exported Heather to GLB, exported the add-on to another directory, exited the process and started a new one with the same test profile. Captured native-dialog options retained the independent data/model/add-on locations, and cancellation left preferences unchanged. Dialog results were supplied by the test harness; this verifies actual application routing and persistence, not a visual interaction with Windows Explorer.

The separate antivirus investigation is recorded in [Antivirus verification](ANTIVIRUS.md). It does not certify the software malware-free or establish that every scanner will accept the new release.

### AFS audio replacement

The complete self-contained Node suite passed **364/364 tests**, with no skipped tests. New regression coverage includes replacements that grow/shrink across sector boundaries, first/middle/last entries, repeated builds, untouched entry preservation, native directory limits, and the `sd.afs` WAV buffer limit. Physical and compact output are compared byte-for-byte. Repository source/profile checks and the production UI build passed.

The original game's x86 AFS parser was executed under emulation against the original and rebuilt 378-entry `sd.afs`. All rebuilt entry addresses agree with the native cumulative sector calculation. A separate 32-bit runtime harness passed **300 virtual I/O checks**, including cursor/completion handling, EOF and source/payload verification.

The WAV attached to issue #2 was installed through the compact overlay in the user's actual game. Runtime capture confirmed that all **5,656 PCM bytes** matched the supplied 16,600 Hz mono sample, the native DirectSound buffer was created successfully, and an untouched sample remained byte-identical to the original. The user confirmed audible menu sounds. The existing three asset replacements were retained, and the original game executable and archives were not modified. The rebuilt physical AFS was checked against the compact virtual output; the audible game check used the DLL overlay.

## 1.0.0 release preparation

On 2026-10-03, the complete self-contained Node suite passed **348/348 tests** with no skipped tests. All four Morph Tools regression scripts passed in Blender 5.2.2. Dependencies installed successfully from the frozen lockfile. The application bundles Morph Tools **1.3.2**; release preparation changes packaging/version and documentation without changing the transfer algorithm or native asset workflows.

The user confirmed that the supplied Heather face now works correctly in their Blender 5.2.2 macOS workflow. This closes that reported authoring issue; it is not a blanket acceptance of other faces, hair/cloth transfers or in-game deformation. Existing KG1, ANM, cutscene and map limitations are retained and documented.

The packaged Windows application was launched with an isolated user-data profile against read-only original assets. Version 1.0.0, model/World Inspector previews, the 77-entry cutscene catalog and scene 38 at frame 600 loaded without renderer exceptions. The actual Inspector add-on export matched the source 1.3.2 file byte-for-byte. Current model/world/cutscene documentation screenshots come from this packaged build. Source checks and the production UI build passed. These checks do not install a mod or replay edited assets in the game.

## Blender Morph Tools 1.3.2 — mesh selection panel

The user reported missing mesh selectors in Blender 5.2.2 on macOS. Registration inspection on Windows 5.2.2 did not reproduce a missing class or invalid mesh icon; the platform-specific visual cause remains unconfirmed. Source/replacement selection now has an explicit **1. Meshes** child panel, open by default and ordered before landmarks. Every concrete panel uses an unregistered layout mixin instead of inheriting a registered panel.

All seven panels register independently and their draw methods pass property, icon, operator and list checks with empty settings and the populated private 1.3.1 review scene. The mesh panel contains both selectors, all four mesh buttons and matching mode. Re-registration preserves saved source/target, landmarks, regions and depth correction settings. The existing Blender workflow test and repository check pass. AST comparison confirms that transfer functions and property groups are unchanged from 1.3.1. These are background Python checks. The subsequent user check confirmed the Heather face workflow in Blender 5.2.2 on macOS.

## Blender Morph Tools 1.3.1 — expression depth

The 1.3.0 face transfer received positive user feedback with residual lower-lip retraction in Morph 11. New explicit facial-depth controls were checked for signed inward/outward behavior, fractional region weights, target masks, unmatched vertices, unchanged unrelated keys and rotated object placement. The correction preserves displacement perpendicular to the face-depth axis. A private review copy uses 0.55 inward strength on the Lower lip region of Morph 11; the other 24 keys are byte-identical in coordinate values to 1.3.0. Front/profile CPU renders show less retraction. This authored setting is not a global default or an automatic anatomical fix; the user subsequently accepted the revised Heather face workflow.

## Blender Morph Tools 1.3.0 — standalone authoring update

All four self-contained Blender regression scripts passed in Blender 5.2.2: transfer/smoothing, landmarks, protected regions, and the new preview/authoring workflow. Coverage includes selected-key versus full transfer, preservation of original mesh/key state, preview replacement and cleanup, hair/cloth key names, captured-topology changes, exact landmark motion after smoothing, isolated layers, weighted outer-region transitions, feature-group creation/update and rejection of points on the same rim edge. Neutral residuals have compact support; a distant surface receives only the fitted similarity transform.

A private replacement face reproduced the reported mouth and eyelid artifacts. All 25 transferred keys regenerate identically from saved settings (maximum coordinate difference 0). Single-key previews for Morph 00/02/06/09/10/11/24 match their full-transfer keys exactly. Basis, topology, UVs and skin weights are retained. The 171 unmatched vertices outside the six protected lip/eyelid regions retain their original coordinates in every key. No protected-region vertices are unmatched. CPU renders of Morph 06/09/10/11 were visually compared before and after; eyelid closure and outer lip transitions improved.

These original checks were offline authoring checks, not in-game verification. The later 1.3.2 user confirmation is recorded above. Windows native-window point-picking and overlay verification was not part of the background test pass. Application 1.0.0 includes the updated add-on rather than the older preview.14 copy.

## 0.9.1-preview.14 mouth correspondence

Blender 5.2.2 passed existing transfer and landmark tests plus new protected-region regressions: two nearby surfaces with opposite movement, smoothing across connected edges, both matching modes, invalid/overlapping groups, stale unmatched diagnostics and unchanged source/Basis. A private replacement face reproduced both lip rims moving in the same direction. Corrected opposite-rim landmarks and separate source/target lip groups restored opposite movement, with no unmatched vertices inside those groups. All 25 keys were transferred; the complete set still needs artistic and game review. Geometry, Basis, UVs and skin weights are preserved; this does not add a mouth cavity or separate welded lips.

## 0.9.1-preview.13 authoring review

The complete self-contained Node suite passed **348/348 tests** for this build.

- Source regressions cover non-staging import preparation, stale candidate rejection, invalid weight/material diagnostics, Build review error aggregation/fingerprints, exact ANM channel masks and verified-name fallbacks.
- KG1 regressions cover displayed-to-bone-local transforms, exact no-op preservation, explicit disable/source restoration, stale identity rejection, changed geometry writing, strip winding and quantized closed-manifold validation. An independent synthetic concave L-prism plus disconnected cube passed original native sizing, six directional and three spotlight emission checks offline. This does not validate GPU self-shadow appearance.
- A real Heather shadow export passed Blender 5.2.2 import/export and preserved all 32,272 original KG1 bytes across 35 objects. No game or source archive was modified by these tests.
- Blender tests cover existing barycentric transfer/smoothing and landmark-guided uniform-scale/rotation displacement, non-affine anchor interpolation, non-facial key names, unchanged Basis and rejection of incomplete/degenerate pairs.
- An isolated Electron instance exercised World Inspector, Inspector Layers, morph-only add-on visibility, channel tables, KG1 overlay, model review/apply and Build review. Edited game behavior still requires user testing, particularly authored KG1 self-shadowing and new morph transfers.

Private input assets, Blender round-trip outputs and UI screenshots are kept outside the public source inventory.

## Automated source checks

The 0.9.0 Node suite contained **233 tests** covering archive writes, native layouts, texture and font exchange, messages, model/morph rebuilding, map operations, animation channels, project behavior and runtime patch composition/authentication. The extracted native-layout validator lives under `tests/helpers`, so tests no longer depend on a private research directory. The production UI bundle is built with esbuild.

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

## ASI overlay preview

All 128 combinations of seven runtime extensions match the existing disk patcher and relocate at alternate addresses. A separate native x86 host validates executable/writable regions, duplicate initialization, hash verification, conflicts, bounds and corrupted plans. The Node suite includes overlay layout, relocation and checksum checks. A separate vanilla-EXE game copy with PC Fix activates font 4× and 32 model texture slots successfully. This is activation evidence; authored gameplay/cutscene replacements still need in-game checks. See [ASI overlay](ASI-OVERLAY.md).


## Map-world editing preview

All 285 original CAM files round-trip through the structured writer byte-for-byte, including JSON exchange, and all 288 original CLD files parse. Regressions cover native winding, group preservation, room/grid indices, polygon/cell overlap, wall merging/splitting, absolute cylinder top Y, new-topology collision rebuilding, conflicts and atomic undo. A real MAP/CLD binding survives project save/load, automatic rebuild, archive build, installation into a disposable source copy and source reload.

Electron checks cover Ctrl+Z from transform fields, Cyrillic KeyZ, WASD movement, collision binding, paired undo, CAM edits and camera undo with no renderer errors. Native PC functions executed in an isolated suspended process confirm a generated floor hit in both indoor mode and outdoor cell 10, its upward plane, and character-column contact against a generated rectangle versus a distant miss. These are targeted native-function checks, not a completed gameplay walkthrough of an authored map. CAM controller behavior and complete scene memory usage still need in-game validation.


## Map reference and camera study preview

The current source suite passes 265 tests. Added checks cover unambiguous companion selection, bound-CLD precedence, staged reference bytes, source-record immutability, native camera sentinels, rotated activation membership, sight axes and unsupported modes.

The local installation has 287 MAP files: 282 have an exact CLD companion and 284 have an exact CAM companion. Across 934 CAM records, 883 use supported study modes 0/2/6/7 and produce finite camera positions/directions; 51 use other modes and are reported as unavailable for camera-view preview. This is data coverage, not proof of pixel-identical gameplay composition.

Twelve CAM normalization fixtures and four direction-vector fixtures match the original PC functions executed in an isolated suspended process. No original game file was modified. The full stateful controller, collision response and stage overrides were not simulated.

Electron checks cover simultaneous layer loading, visibility/X-ray controls, reference placement, live camera updates, anchored mode 7, unsupported-mode handling, map staging/undo, and read-only study controls. The main map remains selectable and editable; camera and collision references remain outside model exports. Final scene composition still needs comparison in the running game.

## Integrated room preview

Preview.4 checks cover shared MAP/CLD/CAM draft undo, atomic multi-file apply, generated-group ownership, manual unbound collision edits across regeneration/project reload, native cylinder/wall preservation, exact PNG pixels and untouched MAP prefixes, two-room memory accounting, incomplete-catalog/outdoor growth rejection, and repeat GLB import after static visibility expansion.

An automated Electron test checks viewport height at two window sizes, numeric room edits, actual mouse drags of the reference and CAM gizmos, Ctrl+Z, and combined staged undo. A real indoor MAP with moved static geometry, edited CLD/CAM and an enlarged 512×512 local texture passed project save/load and separate mod build without changing source archives.

Isolated calls into the original PC executable verified six visibility IDs (hidden type 1, visible type 0), unchanged event-mask behavior, native type-0 classification, and exact texture row copying for 2048×2048/257×129 32-bit and 513×63 16-bit inputs with padded destination pitch. GPU calls were mocked: this checks native byte semantics, not device allocation or gameplay. Source-resource accounting matched the native list builder for all 287 original maps. Authored transitions, outdoor growth, and third-party renderer compatibility remain game-test work.


Preview.5 adds tests for full-edge collision components and native-group isolation, Shift/Ctrl selection forwarding, atomic multi-record movement/undo, persistent Apply failure ownership, and fixed-camera editor/native direction agreement. Pitch/yaw serialization preserves other CAM fields; switching back to MAP editing restores world XYZ gizmo axes. On `tpf1.map`, an event-controlled part outside its native bounds reproduced a failed Apply and a blocked Build with the retained reason. A subsequent Electron run staged two moved/rotated meshes, two translated collision records and a mode-7 camera rotated by an actual mouse drag, then built a separate verified archive containing all three assets with no renderer errors. This is file/UI validation; the authored room has not been tested in gameplay.


## Room workspace validation for 0.9.1-preview.6

All 287 source tests pass. New cases cover shared-pivot collision rotation/scaling, upright wall constraints, cylinder radius/height and grouped orbit, E/R/T focus rules, X/C flight controls, prompt ownership/cancellation, whole-map import with automatic collision regeneration and project reload, and disconnecting a collision binding while retaining its current bytes.

An automated Electron run on am11.map selected collision directly in the viewport without first activating the record editor, dragged rotation and scale gizmos on a selection spanning Floor and Walls, undid the complete gesture and staged both records. It moved/resized the floating Room editor, configured and disconnected automatic rebuilding, edited a fixed camera, retained the active tab after Apply and built a separate archive containing CLD/CAM changes. Build, reload and exit questions used app dialogs; cancellation retained staged work. The shared Animation window still expanded, moved and resized. No renderer errors were recorded. These are file/UI checks; the newly authored room was not run in the game.

## 0.9.1-preview.7

- 301 automated tests: existing format/patch/room coverage plus collision reduction with a preserved hole and footprint, transactional project save failures, camera projection/coordinates/cuts, discrete masks, MAP prop matrices, model aliases and ANM Auto-play.
- All 77 real PACK scenes decoded with all expected character models. Native metadata resolves maps and primary ADX associations for 72; five remain manual. Default variant selection also considers the facial track. One final-stage MAP-object channel has no matching loaded object and is reported.
- Desktop checks: camera/characters/environment/audio playback and seeking, pause on leaving the scene tab, model preview after switching tabs, resource controls, pending room save/reopen, cancelled close/file picker, validation failure without losing drafts, and collision complexity preview.
- Collision generation counts measured on am11/tpf1 as documented in MAP-WORLD. No game FPS measurement or new authored-collision gameplay validation is claimed.
- The camera and resource contracts were derived from the local PC code and corpus; exact lighting, stage callbacks and scripted visibility remain outside this viewer.

## 0.9.1-preview.8

The suite contains 306 passing tests. Added coverage reads native visibility bytes in both MDL mesh groups, filters Heather gameplay duplicates during PACK preview, preserves renamed/split part identities and manual visibility across PACK/ANM/bind-pose switches, and leaves other characters and independent props alone. The native detailed Heather selectors were checked against the PC executable; inventory and scene-specific script overrides are not inferred from PACK. The desktop preview was checked on the apartment cutscene with Heather and Harry, including playback, seeking and returning to the model viewer. Game and exported model data are unchanged.

## 0.9.1-preview.9 authoring checks

- KG1 output: both generated Heather blocks pass original native size/cache routines; closed integer hulls and budgets are tested. A generated type-6 primitive passes native emission checks. New silhouette quality is not yet confirmed in gameplay/cutscenes.
- Background extension: original initializer and placement routines, 6,712 placements across 287 MAPs, and outdoor tile/fraction transitions were checked in emulation. No blanket game compatibility claim is made for authored enlarged stages.
- Action overrides: original animation setup, frame queries, wrap/transition behavior, repeated resizing and untouched original bank samples are tested. Gameplay attacks/root motion/events still require game checks.
- ASI: the native x86 host executes relocated code with combined 400 MiB test storage; conflicting bytes, wrong executable hash, malformed plans and bad relocations are rejected. Production ASI is rebuilt after these tests.
- Blender: geometric morph transfer checks input preservation, displacement, transforms, masks and unmatched points. Scene 38's sampled camera, Heather/Douglas skin and morph positions agree with viewer samples within float32/bind rounding; audio is packed.
- Merging: source hashes, per-file conflict choice, duplicate changes, stale reviews, raw archives, manifests, replacement/overlay layouts and loose files are covered. No game binaries or assets are included in these unit fixtures.

The completed preview has 327 passing regression tests. A real Action 101 Blender clip was retimed from 10 to 20 samples, imported without skipped channels, saved/reloaded as a project and built as a separate ASI mod. Its entire original bank prefix remained byte-exact. Full scene 38 (4,112 frames, two characters, one map) was exported and reopened, including packed sound and sampled visibility at the first, middle and final frames. Desktop checks cover scene visibility, export range validation, merge conflicts, shadow rebuilding, the add-on entry point and Action resizing.


## 0.9.1-preview.10 scene exchange and shadow binding

- 334 Node regression tests pass. Added coverage includes byte-exact unchanged PACK channels, selective writes, unequal native track lengths, invalid or duplicate identities, stale source reviews, transparent material slot identity, anonymous archive rejection and atomic shared-KG1 ownership conflicts.
- A real scene 38 range (frames 0–9) exports to Blender and reimports with a byte-identical PACK. An edited fixture stages 730 bone components, one morph channel, one camera, one light and one moving-object track. Other actor data and visibility bytes remain unchanged; the result survives project save/load. This validates file exchange, not playback of the edited PACK in game.
- Sun, Point and Spot exchange checks cover coordinates, color/power, native direction magnitude, attenuation properties, cones, camera roll/lens and read-only held tracks. 543 original light samples and 15 interpolation cases agree with native PC functions. Blender power conventions and rendering remain an approximation.
- Vincent's secondary transparent material survives GLB round-trip without changing MDL bytes. A Blender render shows the eyes through the glasses. Primary cutout materials retain their original behavior.
- Add-on checks cover transfer displacement, transforms, masks, unmapped points and smoothing without changes to Basis or topology. In the supplied face fixture, three passes at strength 0.35 reduce the measured edge-difference energy by approximately 56%; 1,431 unmatched vertices still require better correspondence/alignment. This metric is not an anatomical quality guarantee.
- Native actor/costume tables resolve the actual KG1, including Heather's shared `pl_htr_alh.kg1`. The user confirmed that replacing this resource removes the old silhouette. Original/generated KG1 spotlight emission passes 32 bounded native emulation cases; all tested outputs are finite and within budgets.
- Remaining KG1 limitation: coarse convex rigid bone volumes can intersect facial concavities and diverge from blended elbow skin. Facial morphs are not applied to KG1. The generated head has 24 triangles versus 205 in the original authored proxy; in the supplied neutral face, 55.7% of sampled surface points are inside the generated volume. No automatic inset is applied as a purported fix. A separate diagnostic archive retains the original head/jaw proxies; it is not a new default or an in-game validated solution.
- Desktop checks cover whole-scene import review, atomic staging and reload, the correct shared shadow resource, and renderer errors. Public packages exclude game files, research fixtures and optional downloaded media tools.

The complete scene 38 export/import (4,112 frames, two characters, camera, lights, moving object and packed audio) also preserves the original PACK byte-for-byte when unchanged. The native game has not yet been used to validate the newly authored scene edits.

## Preview.11 compact assets, scene rules and progress

337 automated Node tests pass. The native x86 ASI host also passes code relocation, large arena allocation, duplicate initialization and corrupted/conflicting input rejection. A separate native asset host verifies ARC substitution plus 300 virtual AFS intervals, independent cursors, immediate overlapped completion, virtual sizes, EOF, seeking and source/payload checksum rejection.

All enabled runtime patches compose and restore identically on the supported original EXE; the combined ASI plan has 10 regions and 114 instruction writes. The transparent producer shims were executed against original x86 code for 25,000 MAP triangles, repeated flushes, effects and descriptor exhaustion; this does not emulate GPU behavior.

The seven reported scenes (70, 43, 4, 41, 65, 80, 48) prepare using real local assets. An Electron test exports a 300-frame carousel scene to a compressed Blender file, records measured frame progress inside the modal, verifies disabled controls while exporting, and reports no renderer exceptions. Heather/Claudia/Harry searches return results, and Import model/Rebuild KG1 shadows have equal measured dimensions.

A separate compact test build includes a 32-slot Heather, 4x font and one edited PACK. Its three replacement payloads occupy 65,117,424 bytes versus 218,766,116 bytes in the corresponding full original archives. Re-merging that build reproduces the staged assets. Early ASI activation succeeds in an isolated game copy; native single-instance protection then exits because the user's existing game is running. This is not an in-game playback validation of compact ARC/AFS loading. Authored large MAPs, precise scene48 audio synchronization and carousel initial phase still require visual game comparison.

The 300-frame carousel Blender export reimports without changing PACK bytes, including the read-only scripted prop controllers. The export modal also shows an intentional file error inline, restores its controls, and successfully retries a real export.

## 0.9.1-preview.12 — DLL layout and MAP facing

The user confirmed that preview.11 compact replacements work in the game. Preview.12 changes their installation layout to `plugins/SH3Tools.dll`, a small ASI initializer, and `plugins/SH3Tools/data`. A real pinned Ultimate ASI Loader host confirms initialization before main, DLL patch execution, file redirection, vanilla fallback, file metadata and mmio reads in this layout. Native ARC substitution and 300 virtual AFS reads pass, including independent cursors, completion, EOF, bounds and checksum rejection. Both old and new real mod builds merge back to the same staged payload bytes. The new layout has not yet been rechecked in game.

338 Node tests pass. A front/back ray test checks MAP face selection; exported scene indices preserve the same winding with single-sided opaque materials. The previous back-side selection was incorrect and is removed. Public packages contain no game assets.
