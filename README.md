<p align="center">
  <img src=".github/images/sh3-tools-banner.svg" alt="Silent Hill 3 Tools — by i4pptem" width="960">
</p>

<p align="center">A modern asset workspace for Silent Hill 3 PC.</p>
<p align="center">
  <a href="https://github.com/i4pptem/sh3r-tools/releases">Download</a> ·
  <a href="docs/INSTALL.md">Getting started</a> ·
  <a href="docs/WORKFLOWS.md">Workflows</a> ·
  <a href="docs/EXECUTABLE-PATCHES.md">Runtime patches</a> ·
  <a href="CREDITS.md">Credits</a>
</p>

**Silent Hill 3 Tools** brings archive browsing, asset previews, editing and mod building into one Windows application. Open the game's `data` folder, explore its assets, stage your replacements and build a separate mod folder. Developed by **i4pptem**.

This is an independent modding project for the **PC version** of Silent Hill 3. It is separate from [Silent Hill 3 Remix](https://github.com/i4pptem/sh3r-rtx); RTX Remix is not required.

<p align="center"><img src=".github/images/workspace.png" alt="Model workspace with Heather, asset library and Inspector" width="1120"></p>

## What you can do

- **Explore the whole game.** ARC and AFS archives, nested sound archives, pictures and movies appear in a single library. Search, filter, navigate with the keyboard and export one archive or all archives, as native files or supported interchange formats.
- **Work with characters.** Preview PC MDL models, skeletons, textures and pose morphs. Play skeletal ANM and supported facial clips. Export models as **GLB or FBX**, including skin weights and shape keys.
- **Replace geometry and morphs.** Import new topology against the original rig; map replacement shape keys to native morph slots. Export a Blender workspace with separate base/pose meshes, subdivide them consistently and rebuild their native morph data.
- **Exchange skeletal animation.** Export a selected ANM range to FBX and import edited motion into the supported original animation layout.
- **Edit maps.** Preview textured MAP geometry, select and move several meshes with a gizmo, undo with Ctrl+Z, replace textures, edit UV/material settings and exchange an individual part as GLB, including new topology. Apply the edits to stage a new MAP.
- **Update textures and fonts.** Pan and zoom texture previews, export PNG and import replacements. Optional full-size texture replacement and 2×/4× font coverage support higher-resolution artwork.
- **Inspect text, sound and movies.** MES/JSON exchange, native sound-bank decoding, WAV exchange, AIX handling and encrypted PC FMV preview/export/reimport. See the [format matrix](docs/FORMATS.md) for each format's actual editing scope.
- **Keep changes organized.** Save a project, review staged replacements and build game-format output into a separate folder. The output folder opens after a successful build.

The preview workspace has collapsible Asset library and Inspector panels, a focus mode and compact animation settings. The interface is in English.

## Get started

1. Download the latest `Silent-Hill-3-Tools-*-win-x64.zip` from [Releases](https://github.com/i4pptem/sh3r-tools/releases) and extract the **entire folder**.
2. Run **Silent Hill 3 Tools.exe**. No Node.js installation is needed.
3. For movie/media conversion, run **Install media.cmd** once. It downloads the pinned FFmpeg build directly from its publisher and verifies its checksum. An internet connection is required for this step; normal asset processing is local.
4. For FBX exchange and Blender morph workspaces, install **Blender 4.2 or newer**; version 5.2.2 was tested. Set `SH3TOOLS_BLENDER` to `blender.exe` if automatic detection does not find it.
5. Choose **Open data folder**, select the game's `data` directory, then browse, export or stage replacements. Use **Build mod** when ready to create installable output.

Keep a clean copy of your game files. Install the generated files only after closing the game. [Installation and rollback instructions →](docs/INSTALL.md)

## How executable patches work

**Ordinary replacements do not automatically produce a patched executable.** Build mod inspects the staged assets and requests a supported local `sh3.exe` only when a replacement needs expanded runtime storage or the high-resolution font uploader.

| Feature | Trigger in staged output |
| --- | --- |
| Morph scratch buffer | More than 1,536 pooled morph nodes in a rebuilt model |
| Primary mesh GPU indices | More than 65,536 primary-group vertices |
| Secondary mesh buffers | More than 1,024 vertices or 2,048 triangles in the secondary group |
| Picture streaming buffer | A recognized TEX under `data/pic` exceeds `0x14C800` bytes |
| Character file arena | Staged model/animation sizes exhaust the 40 MiB character arena or its cache |
| High-resolution fonts | A font BIN contains a supported 2×/4× coverage extension |

The source executable is authenticated and left untouched. A new executable is written into the mod output, and already recognized tool patches are preserved when composing it. The tool release contains **no game executable or game archives**.

[Read the full patch guide](docs/EXECUTABLE-PATCHES.md) for supported hashes, exact changes, combined-patch behavior, reports and rollback. Asset previews cannot prove that a replacement works in every game scene.

## Current boundaries

Version **0.8.3** adds automatic GLB import routing, keeps the last export/import folder, and makes each mesh's native texture slot easier to inspect. The 0.8.1 character-file memory fix remains included. Native geometry/morph rebuilding, animation import, map rebuilding and expanded runtime buffers need testing with your own assets and scenes. Model replacement retains the original skeleton; unrelated facial expressions are not transferred automatically. The map tools edit supported geometry and texture structures, not the entire level scripting system. FBX model export does not imply direct FBX-to-MDL model replacement.

[Supported formats](docs/FORMATS.md) · [Validation](docs/VALIDATION.md) · [Troubleshooting](docs/TROUBLESHOOTING.md) · [Roadmap](docs/ROADMAP.md)

## Build from source

Use Windows x64, Node.js 24+ and pnpm 11.25.0:

```powershell
pnpm install --frozen-lockfile
pnpm setup:electron
pnpm test
pnpm build
pnpm start
```

`pnpm setup:media` installs the optional local media runtime. `pnpm package` creates the portable application; `pnpm release:zip` creates the distribution archives and checksums. See [Development](docs/DEVELOPMENT.md) and [Releasing](docs/RELEASING.md).

## Credits and license

Built with Electron, Three.js and pngjs, with optional Blender and FFmpeg workflows. The research community made understanding these formats possible: SH3_chr, sh3redux, memory-of-alessa, fontsh234, ShiningHill, Misc-Game-Research and many others are credited with their specific contributions in [CREDITS.md](CREDITS.md).

Original project source and artwork: **Copyright © 2026 i4pptem**, licensed under [GNU GPL v3.0 only](LICENSE). Third-party components retain their own licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Silent Hill 3 and the game imagery shown in screenshots belong to their respective rights holders. This project is not affiliated with or endorsed by Konami.
