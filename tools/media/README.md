# Optional media runtime

Silent Hill 3 Tools runs FFmpeg/ffprobe as separate local processes without a shell, system codec installation or PATH changes. The public tool ZIP does not bundle their binaries. Run **Install media.cmd** in the portable folder or `pnpm setup:media` from source to download the tested runtime directly from its publisher.

## Verified input

- Publisher: [BtbN/FFmpeg-Builds](https://github.com/BtbN/FFmpeg-Builds).
- Build: **n8.1.3-20260922**, Windows x64, shared LGPL, version 3 enabled, GPL/nonfree build options disabled.
- Archive: [ffmpeg-n8.1.3-win64-lgpl-shared-8.1.zip](https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-09-22-13-18/ffmpeg-n8.1.3-win64-lgpl-shared-8.1.zip).
- SHA-256: `d1be0e64c0fae2e6c2061bd24c6f61e4b4ad9f962d8fd9240731a77a48b06f71`.
- FFmpeg source: [n8.1.3](https://github.com/FFmpeg/FFmpeg/tree/n8.1.3).
- Publisher build recipes: [3e6685eda92f9288c15ac320139622dcedca09a4](https://github.com/BtbN/FFmpeg-Builds/tree/3e6685eda92f9288c15ac320139622dcedca09a4).

`download.json` is the machine-readable pin. `runtime-manifest.json` authenticates all 223 extracted files. The dated archive was compared with the previously tested runtime: every extracted file matched. Only the top-level archive directory name differs. The installer maps it to the stable internal `runtime/ffmpeg-n8.1-latest-win64-lgpl-shared-8.1` directory expected by the media bridge.

## Offline / unavailable upstream download

Dated publisher assets can expire. The installer fails rather than accepting an unverified replacement. Keep the verified archive for your own future installations, or use an updated tool release with a newly tested pin.

From source:

```powershell
pnpm setup:media --archive "D:\Downloads\ffmpeg-n8.1.3-win64-lgpl-shared-8.1.zip"
```

From the portable folder (PowerShell):

```powershell
$env:ELECTRON_RUN_AS_NODE = '1'
& '.\Silent Hill 3 Tools.exe' '.\resources\app\tools\setup-media.mjs' --archive 'D:\Downloads\ffmpeg-n8.1.3-win64-lgpl-shared-8.1.zip'
Remove-Item Env:ELECTRON_RUN_AS_NODE
```

An existing runtime is verified and left in place; an incomplete or altered installation produces an error. Move it aside before reinstalling. Downloaded ZIPs and extracted runtimes are ignored by Git and excluded from release packaging.

## Notices

The downloaded runtime includes LGPLv3 in `LICENSE.txt`, documentation, public headers and import libraries. Keep these files together. The incorporated GPLv3 text is in `LICENSE-GPLv3.txt`. External enabled libraries retain their own licenses. The application uses the command-line boundary and does not restrict replacing this optional runtime.

If you choose to redistribute FFmpeg yourself, follow the applicable component licenses and provide corresponding source where required; our source archive and recipe links are not a complete source bundle for every external library in BtbN's binary. See [FFmpeg's guidance](https://ffmpeg.org/legal.html) and [the project notices](../../THIRD_PARTY_NOTICES.md).
