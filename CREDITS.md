# Credits

- [Ultimate ASI Loader — ThirteenAG](https://github.com/ThirteenAG/Ultimate-ASI-Loader): starts the ASI initializer and provides configurable file redirection for `plugins/SH3Tools` (optional pinned 9.7.0 Win32 download, MIT license).
- [Silent Hill 2 Enhancements — Elisha Riedlinger and contributors](https://github.com/elishacloud/Silent-Hill-2-Enhancements): reference for separate mod-folder workflows. SH3-specific runtime implementation is independent.


**Silent Hill 3 Tools** — application, Blender Morph Tools, user experience and original project artwork by **[i4pptem](https://github.com/i4pptem)**.

Silent Hill 3 was created by Team Silent / Konami. Game content, names and screenshots remain the property of their respective rights holders. This is an independent community tool.

## Community testing and feedback

- **[a.fiend](https://linktr.ee/afiend)** - modder who tested the tool's capabilities, provided feedback and suggested new features.

## Format research and reference projects

These projects informed investigation, implementation and cross-checking. A research credit does not mean that an upstream application or plugin is bundled, or that its license covers our independently written implementation.

| Project | Contribution to this work |
| --- | --- |
| [alanm20/SH3_chr](https://github.com/alanm20/SH3_chr) | PC character MDL structures, textures, skinning and morph reference; Noesis workflows |
| [Palm-Studios/sh3redux](https://github.com/Palm-Studios/sh3redux) | ARC catalog/subarchive structure and texture research |
| [kidneyclark/sh3-modlib](https://github.com/kidneyclark/sh3-modlib) | Independent archive-format reference |
| [dreamingmoths/memory-of-alessa](https://github.com/dreamingmoths/memory-of-alessa) | PS2 decompilation context for morph interpolation, characters, fonts and world structures; PC behavior was investigated separately |
| [Murugo/Misc-Game-Research](https://github.com/Murugo/Misc-Game-Research) | Silent Hill animation/PACK research and Blender exchange reference |
| [belek666/fontsh234](https://github.com/belek666/fontsh234) | Font glyph layout and native packing |
| [JokieW/ShiningHill](https://github.com/JokieW/ShiningHill) | MAP/GB/TR structures, local texture blocks, world records and AFS research |
| [alanm20/SH3_map](https://github.com/alanm20/SH3_map) | Map-format reference |
| [316austin316/Silent-Hill-3-Modding](https://github.com/316austin316/Silent-Hill-3-Modding) | SH3X texture palette/swizzle reference |
| [leeao/PS2Textures](https://github.com/leeao/PS2Textures) | GS texture block/column organization |
| [vgmstream](https://github.com/vgmstream/vgmstream) | ADX, AIX, HD/BD banks and PlayStation ADPCM format reference |
| [stb](https://github.com/nothings/stb) | Softimage PIC decoding reference |
| [pmttavara/ph2](https://github.com/pmttavara/ph2) | Inspiration for a practical Silent Hill map-editing workflow; ph2 targets Silent Hill 2 |
| [Palm Studios FMV notes](https://github.com/ThirteenAG/WidescreenFixesPack/issues/386#issuecomment-348859766) | PC movie encryption and format research |
| [SH3_PC_Fix / Steam006](https://www.pcgamingwiki.com/wiki/Silent_Hill_3) | Compatibility and texture-fix context; not bundled with this application |

The original research collection is [i4pptem's Silent Hill 3 tools list](https://github.com/stars/i4pptem/lists/silent-hill-3-tools). Our native model/morph rebuilding, expanded runtime patches and application UI are separate implementations, not a redistribution of the reference tools.

## Application and exchange tools

- [Electron](https://www.electronjs.org/) — desktop application runtime.
- [Three.js](https://threejs.org/) — 3D preview rendering.
- [meshoptimizer](https://github.com/zeux/meshoptimizer) — topology-preserving collision simplification.
- [pngjs](https://github.com/pngjs/pngjs) — PNG exchange.
- [Blender](https://www.blender.org/) — optional FBX and morph-workspace bridge, installed separately.
- [FFmpeg](https://ffmpeg.org/) and [BtbN/FFmpeg-Builds](https://github.com/BtbN/FFmpeg-Builds) — optional media conversion runtime, downloaded directly by the user through the included installer.
- [esbuild](https://esbuild.github.io/), [Electron Packager](https://github.com/electron/packager), [pnpm](https://pnpm.io/) — development and packaging.
- [Playwright](https://playwright.dev/) — development-time UI verification.

## Reverse engineering and validation

[Vibe-Reverse-Engineering](https://github.com/Ekozmaster/Vibe-Reverse-Engineering), [Ghidra](https://github.com/NationalSecurityAgency/ghidra), [Frida](https://frida.re/), [Capstone](https://www.capstone-engine.org/), [Unicorn](https://www.unicorn-engine.org/) and [pefile](https://github.com/erocarrera/pefile) supported investigation and validation. They are not required to run the application.

See [Third-party notices](THIRD_PARTY_NOTICES.md) for licensing and the distinction between bundled dependencies, optional tools and research references.
