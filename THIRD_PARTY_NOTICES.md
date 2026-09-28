# Third-party notices

Original Silent Hill 3 Tools code and artwork are Copyright © 2026 i4pptem, under **GPL-3.0-only**; the complete text is in [LICENSE](LICENSE). This notice does not relicense third-party components or game content.

## In the portable release

| Component | Version | License / source |
| --- | --- | --- |
| Electron | 44.4.3 | MIT plus Chromium and other third-party terms; [Electron source](https://github.com/electron/electron/tree/v44.4.3) |
| Three.js | 0.186.0 | MIT; [source](https://github.com/mrdoob/three.js/tree/r186) |
| pngjs | 7.0.0 | MIT; [source](https://github.com/pngjs/pngjs) |
| jpeg-js | 0.4.4 | BSD-3-Clause encoder and Apache-2.0 decoder; [source and notices](https://github.com/jpeg-js/jpeg-js) |

Electron's `LICENSE` and `LICENSES.chromium.html` remain at the portable application's root. Their notices must be retained. The application license is separately named **LICENSE-SH3-TOOLS.txt** there, and is also present in `resources/app/LICENSE`. Production npm dependencies retain their license files in `resources/app/node_modules`.

The UI bundle incorporates Three.js and pngjs-related application imports as configured by esbuild; dependency licenses remain included even where code is bundled. The source archive, exact dependency versions and lockfile are provided for the application. No complete game executable, archive, extracted model, font or texture is shipped. The README screenshot depicts the game and is not covered by the application's artwork license.

## Optional tools installed separately

**Blender** is GPL software distributed by the [Blender project](https://www.blender.org/about/license/). It is not included. The application invokes the user's installation as a separate background process with our Python bridge scripts. Those scripts are part of this repository under GPL-3.0-only.

**FFmpeg** is not included in the public portable/source ZIPs. `Install media.cmd` or `pnpm setup:media` downloads a pinned shared LGPL build directly from [BtbN/FFmpeg-Builds](https://github.com/BtbN/FFmpeg-Builds), verifies SHA-256 and preserves the publisher's files. It runs as a separate command-line process. The downloaded runtime's `LICENSE.txt` contains LGPLv3; `tools/media/LICENSE-GPLv3.txt` contains the incorporated GPLv3 terms. Its exact URL, hash, source tag and build recipes are recorded in [tools/media/README.md](tools/media/README.md). FFmpeg and its enabled dependencies retain their individual licenses.

If you redistribute that optional binary runtime yourself, you take on its redistribution requirements, including corresponding source where applicable. A source link or this application source archive is not a claim to supply all corresponding source for BtbN's external dependencies. The public packaging script deliberately excludes the runtime even when it is installed locally. See [FFmpeg's legal guidance](https://ffmpeg.org/legal.html).

## Development dependencies and research

esbuild (MIT), Electron Packager (BSD-2-Clause), pnpm (MIT), Python/pefile and optional development/analysis tools retain their own terms. The lockfile records the JavaScript dependency graph. Development `node_modules`, tool caches and reverse-engineering environments are excluded from the source and portable releases.

The format research repositories are listed in [CREDITS.md](CREDITS.md) with their specific roles. Those references are not bundled plugins. Silent Hill 3 is a Konami title; this project is not affiliated with or endorsed by Konami.
