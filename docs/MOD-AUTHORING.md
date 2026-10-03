# Mod authoring

These workflows are included in 1.0.0. Save your project before game tests. Build output is separate from the source files.

## Transfer pose morphs in Blender

1. Select an original model with morphs and choose **Get Blender morph add-on…** in its Inspector card. Install the saved `sh3_morph_transfer.py` in Blender and enable **Silent Hill 3 Morph Transfer**. The bundled version is **1.3.2**.
2. Export the original model with shape keys. Place the replacement in the same Blender scene, bind it to the original rig and prepare skin weights separately. Finish topology changes before capturing landmarks.
3. Open **SH3 Tools → Pose Morph Transfer → 1. Meshes**. Choose **Original morph mesh** and **Replacement mesh**. Aligned surfaces suits similar neutral surfaces; Paired landmarks provides face, hair and cloth templates for differing proportions.
4. Capture corresponding neutral points and protect opposing lips, eyelids or overlapping layers with source/target region pairs. Preview one morph and inspect correspondence coverage before creating the complete set. Adjust smoothing, landmark influence or an individual facial depth correction where necessary.
5. Choose **Create all morphs on a new copy**, inspect each key, then export only the intended replacement and original rig. Use **Import model…** in the utility, map native morph slots, review the serialized result and stage it.

Read the [Blender Morph Tools guide](BLENDER-MORPH-TOOLS.md) for point placement, region suggestions, depth controls and limits. The add-on transfers displacements; it does not create missing anatomy, new native slots or skin weights. Source and target objects remain unchanged. Hair and cloth need their own visual checks; positive feedback on the supplied Heather face does not establish every model's result.

Source: [sh3_morph_transfer.py](../tools/blender/sh3_morph_transfer.py). [Development](DEVELOPMENT.md#blender-checks) lists the self-contained Blender checks.

## Merge mods without losing changes in the same archive

1. Open the clean game **data** folder.
2. Choose **Merge mods**. Select one or more `.sh3mod` packages, `.sh3project` files, raw ARC/AFS archives, or a build's `manifest.json`; **Mod folder…** accepts a replacement build or an ASI build containing compact `plugins/SH3Tools/data` and/or loose `plugins/SH3Tools/data`. Repeat the command to add further folders to the staged project.
3. Review changed assets. Identical changes combine automatically. If two mods change the same file, explicitly choose a version or **Restore original asset**. Current staged changes are included in conflict choices.
4. Choose **Merge & stage**, save a project and **Build mod**. The combined archives and required runtime patches are regenerated together. Incoming EXEs, DLLs and loader configurations are not copied.

Different entries of one archive can merge. Two edits inside the same MDL, MAP or other entry remain a file conflict; this is not an internal mesh/texture merger. Mods must use the same original game assets. Packages and build manifests verify source hashes; raw archives have no embedded base identity and are compared to the currently open files. Archive entry counts/order must match.

**Export mod package…** in Staged changes saves replacement assets and their base hashes, without absolute source paths or game executables. It includes the modified assets themselves; it is not a binary-delta format. Automatic collision bindings disconnected by replacing their MAP/CLD must be set up again if further automatic editing is desired.

## Rebuild model shadows

On geometry/skin/visibility replacement, **Import model…** can rebuild the `.kg1` selected by the native actor/costume resource tables in the same character archive. The rebuild dialog has **Rebuild matching KG1 shadow volumes**; **Rebuild KG1 shadows** in the model Inspector also runs it explicitly. A texture-only import preserves the current shadow. Save/stage the MDL and KG1 together. Heather chhaa/chhbb use **pl_htr_alh.kg1**, rather than chhaa.kg1. The Inspector and rebuild review identify the actual resource and other models sharing it. If two staged models need incompatible shapes for one shared KG1, automatic rebuilding reports a conflict. Disable automatic rebuilding for the later import, then explicitly run Rebuild KG1 shadows on the model that should own that shared silhouette.

The generator preserves original shadow bone IDs and object ordering, rebuilds all existing blocks, and makes closed low-detail convex volumes in bone-local coordinates. Heather's gameplay and alternate blocks are both included. Quantized coordinates, native scratch counts and geometry budgets are checked before either file is staged.

Use **Inspect / edit KG1 proxy…** for a bind-pose overlay and GLB exchange of individual bone objects, including closed concave and disconnected components. See [shadow proxy authoring](AUTHORING-REVIEW.md#kg1-shadow-proxies). Automatically generated hulls are rigid per-bone approximations, not render-mesh copies. Concave details, smoothly blended skin and animated facial morphs are not reproduced exactly. Unsupported shadow variants are rejected; `.kg2` map shadows are not regenerated. Inspect RealTime Shadows in gameplay, weapon changes and cutscenes. The generated format and original native decode/sizing functions have been tested; visual results still require an in-game check.

## Animation duration

ANM imports preserve native bank lengths and Action ranges. Enable **Fit source motion to the destination range** to resample an edited clip into the original range.

The experimental Action-length runtime extension has been removed. For mods made with that extension, restore the original ANM and original executable, then import the animation again into an existing range. Old appended banks are detected and rejected with an actionable message; their timing overrides are not silently discarded.
