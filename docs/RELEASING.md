# Preparing a release

The repository and artifacts are prepared locally first. No tool script pushes Git commits, creates a GitHub repository or publishes a release.

## Before publishing

1. Review README, credits, license, screenshots and the supported-feature boundaries.
2. Run `pnpm install --frozen-lockfile`, `pnpm test`, `pnpm check:repo` and `pnpm build` from the standalone repository.
3. Run `pnpm package`, then `pnpm release:zip`. Existing output archives are preserved; move old candidates aside before intentionally rebuilding the same version.
4. Verify the bundled `resources/app/tools/blender/sh3_morph_transfer.py` matches the source and reports version 1.3.2 for application 1.0.0. Run the [Blender checks](DEVELOPMENT.md#blender-checks).
5. Extract the portable ZIP into a fresh folder. Launch it, run **Install media.cmd**, verify media conversion and exercise the editing workflows relevant to the release. Optional Blender workflows need an installed Blender.
6. Inspect ZIP inventories. No game EXE, ARC/AFS, extracted game assets, user projects, research, local paths, credentials or `node_modules` development tree belong in the source archive. The portable contains Electron's executable, not the game's executable.
7. Commit the reviewed public source, create/push the tag matching `package.json` (prefix `v`), then publish a GitHub Release using the matching section of [CHANGELOG](../CHANGELOG.md) as the starting point for release notes.

Upload these files from `release-assets`:

- `Silent-Hill-3-Tools-<version>-win-x64.zip`
- `Silent-Hill-3-Tools-<version>-source.zip`
- `SHA256SUMS.txt`

The portable already includes Blender Morph Tools. The optional standalone add-on ZIP can be attached separately, but is not required to use the bundled export action. Version 1.0.0 release text is in [docs/releases/1.0.0.md](releases/1.0.0.md).

The source ZIP must match the released program. Regenerate it if reviewed source changes before publication. GitHub's automatically generated source archives are also useful once the matching tag exists.

## Optional media distribution

The public package contains a downloader, **not FFmpeg binaries**. Local `tools/media/runtime` and `tools/media/downloads` are ignored and excluded even if installed while developing. Do not attach the upstream binary ZIP to this release without separately handling the applicable redistribution/source requirements. The dated publisher asset may eventually expire; the installer fails clearly and never substitutes unverified files. Future releases can update the pin only after validating a new media build.

Keep Electron's notices and the application license with the portable output. Original native font-uploader C source and its build recipe must remain with the corresponding application source.
