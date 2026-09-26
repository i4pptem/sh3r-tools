# Troubleshooting

## Media preview or conversion cannot start

Run **Install media.cmd** from the extracted application folder and restart the app. It needs write access to that folder and an internet connection for the one-time verified download. A checksum mismatch is an error: do not replace the expected checksum with the hash of an unknown download. Developer setup uses `pnpm setup:media`.

## FBX export or a morph workspace cannot find Blender

Install Blender 4.2+ or set `SH3TOOLS_BLENDER` to the full executable path, then restart the tool. Exporting a model to GLB works without Blender. Blender 5.2.2 was tested; other releases can differ in FBX import/export behavior.

## “Skeleton edits are not supported by this import mode”

The model must retain the original rig, hierarchy and bind transforms. Export from this tool, edit geometry/shape keys and use **New topology & morphs** when vertex counts changed. Check that the DCC did not alter the armature, apply a nonidentity wrapper transform or drop skin data. The tool compares meaningful bind-pose drift; it does not simply ignore skeleton differences.

## Subdivision and pose morphs

Use the morph workspace workflow to apply the same subdivision operation to the base and every corresponding pose mesh. Keep their identities and correspondence intact. The importer rebuilds native references; it cannot infer what an unrelated face should look like for each expression. Automatic `_part_` chunks are required for native skin/secondary staging limits and do not themselves change the material or visibility identity.

## The preview is correct but the game is distorted or crashes

Confirm that you installed the **matching generated executable and data** when Build mod emitted both. Morph scratch, secondary storage and primary GPU indices are different runtime limits; an older morph-only executable may be insufficient. Check gameplay and a morph cutscene. Keep the build report and describe exactly where the result differs. For assets created before stable rebuilding templates were introduced, use a clean original MDL template as described in the workflow guide.

## The high-resolution font looks unchanged

Normal and Small atlases are separate. Check which one was replaced, and install both the generated font archive and the generated executable. A higher-resolution atlas should preserve logical text size/spacing. A similar-looking upscale may be subtle; inspect glyph edges on the actual text screen.

## Full-size texture import works in preview but not in the game

Try the normal format-aware import first. Full-size mode is optional; the picture extension covers a specific `data/pic` loader and is not a universal texture patch. Record the native asset path, original/imported dimensions and whether the build emitted an executable. Do not assume unrelated texture-fix packages remove every native limit.

## Map edits are not in the output

Map preview edits must be applied using the editor's Apply action before Build mod. Ctrl+Z undoes supported map operations; it does not uninstall a mod already copied into the game. Export a selected mesh for part exchange or export the full map for a complete reference scene.

## Asset library or Inspector disappeared

Use the panel buttons above the preview. **Ctrl+Shift+L** toggles the library; **Ctrl+F** reveals search. **Esc** exits Focus preview and restores the previous panel layout.

## The executable is rejected

Compare its hash with [the supported layouts](EXECUTABLE-PATCHES.md). Unknown byte changes cannot safely be treated as a recognized tool patch. Keep a clean supported executable and use it as the build input; do not edit the profile allowlist to force acceptance.

## Reporting an issue

Include the tool version, action, virtual asset path, dimensions/counts where relevant, exact error and whether it fails in preview or in the game. Mention external fixes and the build-report hashes. Remove personal filesystem paths from reports. Do not upload game executables, full archives or proprietary extracted assets to a public issue; a small synthetic reproduction is preferable.


## Replaced character stretches in the game but previews correctly

Original part templates carry visibility and rendering settings as well as texture assignments. Heather has separate gameplay, cutscene and equipment hand/head/hair variants. Some detailed bones are not updated in gameplay. Transferring weights from those bones to an always-visible part exposes stale transforms; a bind-pose fallback in the preview can hide the problem.

The replacement dialog flags weights that cross the original model's visibility variants. Keep detailed weights on their detailed variants, and author compatible gameplay variants using active ancestors. Re-encode positions from model space when changing weights; changing native index bytes alone is incorrect. Keep the required hair and weapon-hand variants. Copying one hand shape across equipment variants does not create the correct grip for every weapon.

Texture images embedded in GLB are not imported automatically. Choose the intended native texture slot independently of the visibility template, then import each PNG into that slot. Primary parts are grouped by texture to fit the native run table. Original morph meshes still need matching UVs and images when retained alongside replacement geometry.

## The game exits before its window appears after high-resolution model textures

Embedded textures enlarge the entire MDL. This can exceed the character file arena even when each image is a valid GPU texture. Use the complete data folder and rebuild with a version supporting the character arena patch; install the generated executable and archives together. See [Executable patches](EXECUTABLE-PATCHES.md). The picture/menu patch alone does not cover this allocator.
