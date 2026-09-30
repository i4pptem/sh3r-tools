# Troubleshooting

## Media preview or conversion cannot start

Run **Install media.cmd** from the extracted application folder and restart the app. It needs write access to that folder and an internet connection for the one-time verified download. A checksum mismatch is an error: do not replace the expected checksum with the hash of an unknown download. Developer setup uses `pnpm setup:media`.

## FBX exchange or a morph workspace cannot find Blender

Install Blender 4.2+ or set `SH3TOOLS_BLENDER` to the full executable path, then restart the tool. Exporting a model to GLB works without Blender. Blender 5.2.2 was tested; other releases can differ in FBX import/export behavior.

## “Skeleton edits are not supported by this import mode”

The model must retain the original rig, hierarchy and bind transforms. Export from this tool, edit geometry/shape keys and use **Import model…**. The tool opens the rebuild setup when needed. Check that the DCC did not alter the armature, apply a nonidentity wrapper transform or drop skin data. The tool compares meaningful bind-pose drift; it does not simply ignore skeleton differences.

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

Base-color images in GLB/GLTF/FBX are imported automatically. Match Texture_N material names to native slots, and supply consecutive names for added slots. Choose the native texture independently of the visibility template in the rebuild dialog. Missing external images must be restored beside the GLTF or at the saved FBX path; GLTF companion files must remain inside its model directory. Primary parts are grouped by texture to fit the native run table. Original morph meshes still need matching UVs and images when retained alongside replacement geometry.

## The game exits before its window appears after high-resolution model textures

Embedded textures enlarge the entire MDL. This can exceed the character file arena even when each image is a valid GPU texture. Use the complete data folder and rebuild with a version supporting the character arena patch; install the generated executable and archives together. See [Executable patches](EXECUTABLE-PATCHES.md). The picture/menu patch alone does not cover this allocator.

## Animation import reports a missing channel

Blender keys cannot allocate native ANM channels. Choose **Preserve unsupported channels** to keep those native components and import compatible motion; the result lists every skipped bone/channel and frame range. Strict mode is available when any omitted motion should stop the import. More baked keys do not fix this native limitation.

## IK, extra bones and scale

Import a saved Blender scene directly to evaluate constraints, or bake animation when exporting FBX. Preserve Custom Properties and original game bone names/rest axes. Helper bones are ignored; missing original bones are not. Armature object placement/scale are ignored, positive uniform applied skeleton scale is normalized, and bone Scale animation is omitted. Edit the original root in Pose Mode for root motion. Rest-pose errors name the affected bone and require restoring its Edit Mode transform.

## One extra frame or a hold at the loop boundary

Ranges are inclusive: 0–9 means ten samples. The last pose transitions to the first when preview looping is enabled. If the final authored pose duplicates the first, trim it explicitly in the source range and choose the intended destination duration. The importer never shifts later bank frames. Game loop/end/action/event tables are external to ANM and are not edited here.

## Bones point sideways or lose local Translation in Blender

Export a fresh Blender (.blend) model or ANM range. It has individually joint-aligned bones, a consistent roll reference and independent bone translations. FBX model and animation exports retain the original SH3 axes; they can look sideways in Blender because game joints do not necessarily point along the visible limb. Blender's FBX importer automatically marks aligned child bones Connected, which suppresses local Translation even when curves exist. For FBX authoring, disable Connected on the original bones in Edit Mode before baking; exporting a .blend scene avoids this importer behavior. Keep the delivered rest axes and custom properties. The app converts the authoring basis back to the original SH3 skeleton when importing.

## The archive changed after installing a build

Use **Reload sources** in the offered dialog, the refresh button beside Sources, or **Ctrl+R**. Compatible staged edits are retained; replacements already installed are cleared. If an asset changed both on disk and in the project, review the named conflicts before choosing to discard them. Cancelling retains the current workspace. Repeat the previous operation after the reload. If files are missing or still being copied, the reload keeps the old workspace and explains why the new sources could not be opened.

## No action ranges appear for an animation bank

Automatic discovery currently covers the 11 main 1763-frame Heather gameplay banks and a verified PC executable profile. Open the data folder with sh3.exe beside it; test banks and other animation layouts still use custom ranges. The app displays the reason when discovery is unavailable. Action IDs are native identifiers, not movement names. Rates are defaults from the game tables; gameplay state can adjust them.
