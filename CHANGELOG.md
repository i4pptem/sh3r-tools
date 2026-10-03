# Changelog

## 1.0.0 — Asset authoring and compact mods

Changes since **0.9.0**, including the intermediate development previews. See the [illustrated release notes](docs/releases/1.0.0.md) for screenshots, installation and the full feature tour.

### Models and Blender Morph Tools

- Bundle Blender Morph Tools **1.3.2**: explicit source/replacement selection, labelled neutral-surface picking, face/hair/cloth landmarks, protected lip/eyelid regions, smoothing and local landmark-motion constraints.
- Add single-morph comparison previews, region coverage, unmatched-vertex selection and per-expression facial depth controls. Preserve Basis, topology, UVs, skin weights and unchanged input objects.
- Review the serialized model replacement beside the original before staging, including geometry, textures, UVs, weights, visibility groups, morphs and original motion.
- Resolve character shadows from native actor/costume resource tables, including shared KG1 files. Rebuild proxies or edit individual bone objects through GLB, with quantized geometry validation and explicit disable/source restoration.

### Maps and world editing

- Add World Inspector with verified area names and code/name filtering; move layer controls into the right Inspector.
- Edit MAP, CLD and CAM together with reference overlays, shared room undo, multi-selection transforms, direct picking, simplified collision bindings and camera study with a movable reference character.
- Add WASD/X/C flight navigation, E/R/T transform shortcuts, a draggable/resizable Room editor and full-height map previews.
- Support larger static parts, full-size embedded/shared map textures, stage-wide memory checks and conditional background/transparent-queue extensions.

### Cutscenes and animation

- Add full Cutscene Inspector playback with environment, character/morph tracks, cameras, sound and moving objects.
- Export complete scenes to Blender and reimport existing motion, morph, camera, light and prop channels. Preserve native scene length, channel identities and unedited data.
- Apply PACK visibility to matching MAP event groups, correct opaque wall facing, filter duplicate character parts and account for supported stage-script rules, carousel motion and audio lead-in.
- Add per-bone ANM channel tables, saved skipped-channel reports, 43 verified Heather Action-state names and Auto-play for one-shot actions.
- Remove the experimental Action-length extension. ANM imports preserve native lengths/ranges; Fit resamples edited motion into an existing range. Retired experimental banks/executables require restoration before rebuilding.

### Building and daily use

- Add compact ASI overlay builds: `plugins/SH3Tools.dll`, a small ASI initializer and changed ARC/AFS entries or loose files under `plugins/SH3Tools/data`. Apply required patches in memory while retaining original files on disk.
- Add portable asset packages and Merge mods with explicit per-asset conflicts; support original and current overlay layouts.
- Add shared Build review with changed sizes, errors, warnings, pending room links and conditional patch reasons.
- Add verified model names/aliases, themed build/exit/reload prompts, Save / Don't save / Cancel on exit, and detailed progress inside long-export dialogs.
- Update installation, Blender workflows, format boundaries, runtime patch documentation and release instructions for 1.0.0.

The main application remains Windows x64. The bundled add-on can be used independently in Blender, including macOS. Native skeletons and ANM layouts remain fixed; KG1 does not follow facial morphs; map/cutscene scripting and internal MDL/MAP conflict merging are outside this release. See [release notes](docs/releases/1.0.0.md) and [validation](docs/VALIDATION.md).

## 0.9.0 — Animation & Cutscene Workflows

### Cutscene animation

- Play character animations from PACK files inside cutscene AFS archives, with synchronized facial morphs.
- Automatically discover compatible cutscenes from the game's data folder.
- Export selected cutscene ranges to **Blender (.blend)** or **FBX**, then reimport bone motion, facial shape keys, or both.
- Preserve other characters and scene tracks, restore the original scene coordinates, and validate rebuilt facial curves against the native memory budget.
- Improve facial-track boundaries, continuation of the last facial pose, and exact-frame rotation sampling.

### Blender and animation exchange

- Export ready-to-edit **.blend** models and animation ranges with packed textures, shape keys and independent bone translations.
- Blender exports use joint-aligned bones; **FBX retains the original SH3 bone orientations**. GLB model export remains available.
- Sample evaluated IK/FK motion on the original game bones. Extra control bones are ignored and sparse keyframes are interpolated.
- Normalize uniform skeleton scale and ignore armature object placement/scale while checking rest-pose changes separately.
- Transfer compatible animation between banks using the same original rig, with explicit source/destination ranges and optional retiming.
- Preserve unsupported native channels with a detailed bone/channel/frame report, or choose strict rejection.
- Fix selected-range looping that could sample the next action, and fractional-FPS FBX imports that could introduce an extra end frame.

### Gameplay action ranges

- Read verified action ranges for **11 main Heather gameplay banks** from the local sh3.exe.
- Select native action IDs with inclusive frame bounds, loop flags and default playback rates; step through actions and export the selected range.
- Keep custom ranges available for unsupported banks and executable profiles. Movement names are not yet mapped; entries use **Action 101**, **Action 201**, etc.

### Animation panel

- Replace the large animation section with a compact window inside the viewport.
- Separate **Clips**, **Export / Import** and **Morphs**, with advanced playback settings kept out of the main controls.
- Drag the header to move the panel and resize its expanded view from the lower-right corner.
- Remember position and size between sessions, keep the panel inside the viewport and restore defaults with **↺**.
- Keep playback controls accessible when folded; move external motion loading into advanced settings.

### Archive reload

- Offer to reload game archives changed outside the app, including after installing a built mod.
- Preserve compatible staged replacements, recognize already installed changes and request confirmation before discarding conflicts or unapplied map previews.
- Refresh archive offsets, selections and model/texture/animation caches together.
- Add **Reload sources** and **Ctrl+R**.

### Notes

- Blender workflows require an installed Blender 4.2+; tested with Blender 5.2.2.
- New native ANM channels, animation bank/cutscene length changes and camera/event editing are not included.
- Action discovery reads the local executable without modifying it. In-game speed and body-part blending can differ from isolated preview.
- 242 automated tests pass, with additional Blender round-trip and packaged UI checks. Test authored replacements in the game before distributing a mod.

## 0.8.5

### Model and texture import

- Import GLB, GLTF or FBX through one **Import model** dialog. GLTF supports local BIN/image companions; FBX conversion uses installed Blender 4.2+.
- Import base-color PNG/JPEG textures with the model at their supplied dimensions, including material base-color factors. Missing companion images produce an explicit error.
- Add consecutive **Texture_N** slots beyond the original model count, up to **32 images (Texture_0–Texture_31)**. Repeated replacements preserve expanded slots and template identities.
- Build mod automatically adds the model-texture executable patch when native image-slot or texture-group limits are exceeded. The extension supports 32 primary and 32 secondary texture groups, expands the shared resource pool to 1,120 entries and handles model cleanup and reset. Recognized existing executable patches are preserved.
- Texture Inspector immediately indexes images added by a model replacement.

### Texture Inspector

- Choose **10, 20, 50 or 100 textures per page**. The selection is saved between sessions; thumbnails load in bounded batches.

### Animation exchange

- FBX animation exchange transfers **Location and Rotation only**. Scale animation is omitted on export and ignored on import, including deliberately animated Scale; original rest/bind transforms remain validated.
- Fixed false missing-channel errors caused by FBX rotation roundoff when the resulting native packed rotation is unchanged. Unsupported motion is still rejected with the source frame and an explanation that FBX keys cannot create native ANM channels.

### Validation

- 206 regression tests passed, covering resource resolution, texture/material assignment, new-slot limits, repeat imports, animation channels and runtime patch authentication.
- A 32-slot Heather model passed live resource-lookup checks; correct gameplay, weapon changes and a cutscene were confirmed in game. The packaged import dialog and all 32 Texture Inspector images were also checked.
- Native-code emulation covered expanded resource allocation, material binding, cleanup and reset. Reapplying all seven composed runtime extensions produced an identical executable.

## 0.8.4

- Added Texture Inspector beside Asset library: one searchable catalog for texture files, embedded MDL/MAP textures, font atlases and supported BMP pictures.
- Added paged thumbnails, source filters, a modified-source filter, zoom/pan, PNG export and direct PNG replacement without opening the owning model or map first.
- Shared map TEX files appear once per source, with links to referencing maps. Replacements update the original container and all previews, and remain staged until Build mod.
- Texture selections are verified against the current source hash; rebuilding or reverting a model/map invalidates its cached slots and thumbnails.
- Embedded MAP textures use Fit to original to preserve native offsets. Optional full-size import remains available for supported model/standalone textures, with the existing conditional runtime patches.
- Added PNG exchange for uncompressed 24/32-bit BMP pictures while retaining dimensions, row layout and opaque file data.

## 0.8.3

- Fixed false ANM scale-channel errors after editing and re-exporting FBX animation in Blender. The importer now checks the authored Pose Mode scale instead of scale noise from reconstructed bone matrices.
- Unified GLB model import: compatible attribute edits stage directly; topology, morph, skinning and material changes open the native rebuild setup. Blender material names retain their native texture-slot identity when image indices are reordered or names gain a .001 suffix.
- Preserved the last file-dialog folder and selected texture slot across import/preview refresh. Meshes show their native texture slot in the Inspector.
- Removed the redundant Compact workspace action; exported morph workspaces already use the compact layout.

## 0.8.1 — 2026-09-26

- Fixed startup crashes from oversized character MDLs by calculating the complete character-file memory budget and conditionally expanding its arena from 40 MiB to 128 MiB.
- Added visibility/bone compatibility warnings and separate texture-slot selection for model parts so replacement materials can follow the GLB while preserving native gameplay/cutscene templates.
- Grouped rebuilt primary parts by texture to fit the native render-info table and preserve draw bindings.


## 0.8.0 — 2026-09-24

First public preview, bringing the existing asset workflows into a standalone repository.

- Added model FBX export alongside GLB, preserving the rig, weights, shape keys and embedded textures through the Blender bridge.
- Redesigned the preview workspace, Inspector and animation controls; added collapsible panels, focus mode and persistent panel preferences.
- Added the original Silent Hill 3 Tools emblem, Windows icon and i4pptem developer credit.
- Includes the ARC/AFS library, archive batch export, model/morph rebuilding, subdivision workspace, ANM exchange, map part editor, texture/font/message/media workflows and conditional executable extensions developed during the private preview.
- Prepared GPL-3.0-only licensing, feature/workflow/patch documentation, reference credits, standalone tests, CI and release packaging.
- Removed a machine-specific bootstrap probe and the tests' dependency on a private research folder.
- Added a checksum-verified optional FFmpeg installer. Public release archives exclude local media binaries and downloads.

See [Validation](docs/VALIDATION.md) for test scope and [Roadmap](docs/ROADMAP.md) for remaining work.
