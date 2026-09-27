# Changelog

## 0.8.4 (unreleased)

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
