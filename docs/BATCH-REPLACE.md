# Replace textures and audio from a folder

Open the game data folder or the target archive first. Choose **Replace from folder…** in Asset Library or Texture Inspector. An archive's context menu offers **Replace textures from folder…** and **Replace audio from folder…**, already scoped to that archive.

1. Choose **Textures** or **Audio** and the archive scope. Use a specific archive when filenames repeat.
2. For PNG images, choose **Fit to original** (resizing/palette conversion) or **Full size**. Full size retains the individual texture import restrictions and normal Build Mod resource checks. Font atlases use their original size; high-resolution font import remains an individual operation.
3. Click **Choose folder & scan…**. Subfolders are included; links are skipped. File dialogs remember the folder using the existing texture/audio location history.
4. Review the target and result for each file. Only validated, changed files are selected. Uncheck anything you want to keep. The results filter and pagination help with large folders.
5. Click **Stage selected**. Review **Staged changes**, save your project or use **Build mod**.

Scanning never changes the project. Applying prepares the whole selected batch before committing any of it. If a file changed since scanning, the project changed, conversion fails, or a combined resource budget is exceeded, the batch is not staged. Existing staged edits remain intact. Several PNGs targeting different slots of one MDL/MAP are composed into one replacement.

## Texture filenames

PNG names from Texture Inspector can be reused directly:

```text
chhaa_0.png
chhaa_1.png
```

The suffix is the **zero-based texture slot**. Supported standalone textures, embedded MDL/MAP textures and font atlases are included. A shared map texture replaces its actual TEX owner.

For explicit container names or duplicate names, use subfolders:

```text
chrpl.arc/chhaa.mdl/texture_000.png
chrpl.arc/chhaa.mdl/texture_001.png
```

Keep full native paths when needed, for example `chrpl.arc/data/pcchr/pl/chhaa.mdl/texture_000.png`. A folder named after the container (`chhaa.mdl/texture_000.png`) also works. Native TEX/PIC/DAT/TBN2/BMP replacements retain their original filenames. For a container with just one image, `container.png` is accepted. Multiple-image containers require a slot suffix or folder.

The indexed folders produced by **Export converted files** are accepted unchanged, such as `archive.arc/00012_data/path/image.tex/texture_000.png`. Model and map exports normally contain GLB; export their PNGs through Texture Inspector for batch image replacement. Batch replacement does not import model or map geometry.

## Sound filenames

Original WAV/ADX/AIX files keep their original names. For unnamed or duplicate AFS entries, use the **zero-based entry index**:

```text
sd.afs.entries/entry_00000.wav
sd.afs.entries/entry_00001.wav
```

`sd.afs/entry_00000.wav` and the indexed filenames from native archive export are also accepted. Flat `entry_00000.wav` is accepted only when it identifies one entry in the selected scope.

Converted export folders with `track_000.wav`, `track_001.wav`, etc. identify **AIX layers** or **HD/BD samples**. These imports require the optional FFmpeg runtime and keep the original duration/sample count. Both HD and BD companions must be open. Two exported HD/BD views of the same sample are a conflict: keep one input copy.

Standalone WAV replacements must be valid **PCM 8-bit or 16-bit, mono or stereo**. Convert float/compressed WAV first. The native `sd.afs` scratch-buffer limit still applies. Standalone ADX replacement currently requires an encoded native ADX; WAV-to-ADX import is not supported. Native whole HD/BD replacement is outside this batch workflow; use sample WAVs.

## Review results

| Result | Meaning |
| --- | --- |
| Ready | Matched, validated and different from the current project. Can be selected. |
| Unchanged | Already identical; no replacement is needed. |
| Ambiguous | More than one target. Narrow the archive scope or retain archive/container subfolders. |
| Conflict | More than one input targets a slot, or a whole native container overlaps PNG/sample edits. Keep one input version and scan again. |
| Unmatched | No supported target; check the name, extension and selected scope. Notes/JSON reports can remain in the folder. |
| Error | The row explains the format, conversion or resource problem. Other validated rows can still be selected. |
| Skipped | A link or non-regular file, which is not followed. |

Limits: 10,000 input files, 32 nested folders, 256 MiB per file and 512 MiB per input/prepared replacement batch. Use smaller groups for large texture packs. A successful import validates the file and known limits; test the resulting mod in the intended game scenes.
