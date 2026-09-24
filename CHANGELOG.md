# Changelog

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
