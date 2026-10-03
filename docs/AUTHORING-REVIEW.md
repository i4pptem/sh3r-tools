# Review before building

**Build mod** first opens a shared review of staged assets. It lists structural errors, warnings, changed sizes and conditional runtime patches with the metrics that triggered them. Unapplied room drafts link back to their owning map. Errors block Continue; warnings remain visible for review. Continue chooses the existing installation mode and destination. The assets and sources are revalidated before the build is written. Passing these checks does not emulate all game behavior.

## Model import review

Import GLB, GLTF, FBX or `.blend` using **Import model…**. Compatible edits open the review directly; new topology, skinning, materials or morphs first open template/morph mapping, followed by **Review replacement…**. Nothing is staged until **Apply & stage model**.

The two synchronized views show the current model and the exact serialized replacement. Compare counts, textures, wireframe, UV layout, individual parts and morphs. Choose an original ANM or PACK clip to compare motion. The part table lists texture slots, visibility IDs and used bones. Weight diagnostics highlight invalid weights in red and suspicious influence/visibility associations in amber. Invalid weights or missing textures block staging. Visibility associations are inferred from original templates, not a proof that a particular bone is inactive in every game state.

For Heather, Gameplay body / face shows verified IDs 0 and 5; inspect equipment hands separately by visibility group. Cutscene preview hides the known gameplay duplicates. These are review aids: complete equipment/event masks are not simulated. Test gameplay, weapon changes and cutscenes in the game.

Back discards the candidate without changing staged assets. Importing another file replaces the candidate. Applying cannot silently rebuild different bytes or accept a review for an older source.

## Animation channels and names

**Animation → Export / Import → Channel support…** reads the selected ANM's native channel flags. Filter by bone name, writable Position, writable Rotation or bones with no channels. The same table is available before staging an animation import. It includes every original bone; Scale is not stored. Blender keys cannot add missing ANM channels. Preserve reports skipped motion, while Stop rejects it. Reports are retained in the project and shown at Build review.

Forty-three verified Heather Action states have readable names; other actions keep their numeric IDs. Names come from native state/weapon selectors and only apply to the original verified bank layouts. Eleven Heather weapon banks and twenty map area prefixes have readable labels. Exact rooms, unknown Actions and weapon-hand masks are not guessed. Ranges remain inclusive and retain native length; use Fit for edited clips of another duration.

## World Inspector and Layers

**World Inspector** lists MAP files by verified area, with area filtering and name/code search. Select a map to use the existing editor in the same workspace. Geometry, materials, textures, whole-map and selected-part exchange remain in **Inspector → Assets**. **Inspector → Layers** owns CLD/CAM file choices, visibility, opacity and collision groups. The floating Room editor retains Collisions, Cameras and Auto rebuild controls. E/R/T, X/C and Ctrl+Z work in either library view. World Inspector and Asset library share the same staged assets and room drafts.

## KG1 shadow proxies

**Inspect / edit KG1 proxy…** shows each native shadow block over the model in bind pose. Choose a block and inspect individual bone objects. Export proxy GLB, edit low-detail geometry in Blender, then import the GLB. Keep the exported object names. Export static unskinned meshes, with no shape keys or animation. Apply mirrored transforms and recalculate outward normals.

Each bone object may contain several disconnected closed components or concave geometry. Join components assigned to the same exported object; do not duplicate its identity. Omitted objects are preserved. **Disable this shadow object** is explicit. **Restore opened source** uses the archive bytes as opened, not the latest staged generated hull; open a clean archive when a clean baseline is required. The dialog identifies other models sharing this KG1.

Coordinates are rounded into native signed-16 bone-local storage before validation. Changed objects must have noncollapsed triangles, paired opposite edges, connected vertex fans and positive component volume. The complete block must fit the supported scratch and 900-triangle budget. Unchanged geometry retains original strips and bytes, even where the original contains open edges. Surface self-intersections are not proven absent; inspect them in Blender and the game. Failed validation stages nothing.

KG1 follows rigid bone transforms, not blended skinning or facial morph deltas. Auto rebuild creates a simplified starting proxy; it cannot guarantee correct self-shadowing around an animated mouth or elbow. Author a conservative proxy or explicitly disable a problematic object. `.kg2` map shadows remain native exchange only.

## Blender Morph Tools 1.3.2

The download card appears only for models with native morph slots. The add-on now provides labelled point picking, face/hair/cloth templates, editable lip/eyelid region suggestions, a single-morph comparison preview and per-region coverage. Preview copies do not change the source or target. Create all morphs only after reviewing the selected expressions.

Neutral alignment is local; motion uses the fitted rotation and uniform scale. Optional landmark-motion constraints preserve the captured correspondence after smoothing. Region weights can feather the outer edge into surrounding skin while keeping opposing rims separate. Unmatched vertices remain unchanged. Per-morph facial depth controls can reduce lip retraction in a chosen region without changing other expressions.

Read [Blender Morph Tools](BLENDER-MORPH-TOOLS.md) for installation, landmark placement, region editing, previews, limits and the final model-import workflow. Transfers still require artistic and game review; they do not create missing anatomy or native morph slots.

## What mod merging currently means

Different files inside the same archive can merge. For example, one mod changes `chhaa.mdl`, another changes an unrelated texture file: both changes survive. If one mod edits a mesh inside `chhaa.mdl` and another edits an embedded texture inside that same MDL, the current merger asks which whole MDL to keep. Combining those internal edits would require matching geometry, texture slots, UVs and morphs. That internal merge is not implemented.
