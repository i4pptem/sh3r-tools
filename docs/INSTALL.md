# Installation and first mod

## Portable application

Download the Windows x64 ZIP from [Releases](https://github.com/i4pptem/sh3r-tools/releases), check it against `SHA256SUMS.txt` if desired and extract the entire directory to a location you can write to. Run **Silent Hill 3 Tools.exe**. Keep its DLLs and `resources` directory beside it. The public build is unsigned and has no installer or automatic updater.

For movie preview and media conversion, close the application and run **Install media.cmd** once. This uses the bundled Electron runtime, so Node.js is not required. It downloads the exact FFmpeg build recorded in `resources/app/tools/media/download.json`, checks SHA-256 and extracts it locally. It installs no system codecs and does not modify PATH. Restart the app after installation.

If that dated upstream download is no longer available, the installer reports an error and never silently substitutes a newer build. Use an updated tool release, or supply the same verified archive to `tools/setup-media.mjs --archive <path>` as described in the media README. The runtime from another installation of this exact release can also be copied into `resources/app/tools/media/runtime`; its complete manifest must verify.

**Blender 4.2+** is needed for FBX model/animation exchange and `.blend` morph workspaces. Blender 5.2.2 was used for validation. Install it separately, or set the `SH3TOOLS_BLENDER` environment variable to the full path to `blender.exe`. GLB model export does not need Blender.

## Open the game

Choose **Open data folder** and select the game's `data` directory. Its ARC catalog, archive library, `movie`, `pic` and `sound` sections are discovered together. Keep `arc.arc` beside the archives it describes. A single ARC or AFS can also be opened separately.

Select an asset to preview it. The Inspector groups export, editing/import and native-file actions. Changes are staged in a project; playing an animation or moving a preview morph slider does not itself replace an asset. Save the project so you can continue later.

## Build and install

Use **Build mod** to write the staged changes to a separate output directory. When assets require an executable extension, the builder asks for a supported local `sh3.exe`; see [Executable patches](EXECUTABLE-PATCHES.md). The source archives and executable are not overwritten by the build. The output directory opens when building completes.

Close the game, back up the files being replaced, then copy the output into the game directory while preserving paths. When an executable is generated, install it with the matching data. To undo an installed mod, restore those backups. Reverting a staged edit is not an uninstall action.

## Updating the tool

Extract a new release into a new folder. Keep projects and exports outside the application directory, and retain the old release until you have checked your active project. Install or copy the verified media component for the new release as needed. Existing user-interface preferences are stored in the Electron user-data location.

See [Workflows](WORKFLOWS.md) for editing details and [Troubleshooting](TROUBLESHOOTING.md) for common problems.
