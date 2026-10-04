# DLL overlay mods

Choose **Build mod → ASI overlay** to create a mod without replacing the original executable or archives. Ultimate ASI Loader 9.7.0+ Win32 starts a small ASI bridge; all SH3 Tools patches and asset loading live in `SH3Tools.dll`.

```text
Game/
  sh3.exe
  data/                         original game archives
  dinput8.dll                   Ultimate ASI Loader, if needed
  plugins/
    global.ini                  FileLoader configuration
    SH3ToolsLoader.asi           initializes the DLL
    SH3Tools.dll                 runtime patches and asset loading
    SH3Tools/
      SH3Tools.patch            required patch plan
      SH3Tools.assets           verified source and payload identities
      SH3Tools.log               written when the mod starts
      runtime-buffers.json
      data/
        pcchr/...               changed ARC assets at native paths
        sound/demo_afs/name.afs.entries/entry_00000.pack
        movie/...               loose replacements
        pic/...
        sound/...
```

## Installation

1. Build against the matching original `data` and supported original `sh3.exe`.
2. Close the game and copy the generated `plugins` folder next to `sh3.exe`. Keep original game data.
3. Install the included Win32 `dinput8.dll` only if there is no compatible Ultimate ASI Loader already installed.
4. The included `plugins/global.ini` contains `[FileLoader] OverloadFromFolder=plugins\SH3Tools`. If another global or loader-specific INI exists, merge this setting into the active configuration and preserve unrelated settings. Keep plugin loading enabled.
5. When migrating an older build, remove its SH3Tools files from `update`; preserve other mods. Keep one active SH3Tools runtime and combine changes using **Merge mods**.
6. Check `plugins/SH3Tools/SH3Tools.log` for activation. Restart the game after changing files.

## Compact assets and compatibility

Only changed ARC/AFS entries are distributed. ARC replacements follow their native paths; AFS payloads use a separate `.afs.entries` directory so the archive itself remains available. The native reader combines original archive bytes, changed directory entries, padding and replacement payloads as needed. No complete original archive or catalog is copied or materialized.

AFS entries follow their original index order on 2,048-byte boundaries. The game derives their addresses from the first sector and the rounded entry lengths, so changing only a later directory offset is insufficient. Both build modes use this layout; compact overlays read untouched entries from their original source offsets even when a changed payload shifts the virtual positions.

**Upgrading from 1.0.0:** 1.0.1 uses compact asset index version 2. Rebuild the mod from its saved project, or import a complete older build through **Merge mods** against matching original sources, then build again. Install the generated DLL, asset index and payloads together. Replacing only the DLL in a version 1 package is not supported.

Source archive/catalog checksums and replacement hashes are verified on startup. A mod requires the same original archives used to build it. Compact mods cannot coexist with whole-archive overlays for the same archive. Merge changes in the tool first. Merge mods accepts the current layout and manifests from older `update` builds.

Loose `movie`, `pic` and `sound` replacements use Ultimate ASI Loader file redirection. Shared runtime limits and supported executable versions are described in [Executable patches](EXECUTABLE-PATCHES.md). Unknown executable versions or conflicting code patches are rejected before activation. Original executable bytes on disk remain unchanged.

The DLL's `InitializeASI` entry point must be called after loading it. Renaming the DLL to `.asi` or relying only on `LoadExtraPlugins` is not the installation method. The included bridge handles initialization outside DllMain; the DLL owns validation and all game-specific code.

## Uninstall

Remove the files from this build and its loader configuration entry, then restart. Keep shared loader files and unrelated mods.

References: [Ultimate ASI Loader 9.7.0](https://github.com/ThirteenAG/Ultimate-ASI-Loader/releases/tag/v9.7.0), [overlay documentation](https://github.com/ThirteenAG/Ultimate-ASI-Loader/blob/v9.7.0/readme.md#update-folder-overload-from-folder), [SH2 Enhanced Edition file hooks](https://github.com/elishacloud/Silent-Hill-2-Enhancements/blob/master/Common/FileSystemHooks.cpp).
