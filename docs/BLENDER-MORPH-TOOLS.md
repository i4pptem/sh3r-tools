# Blender Morph Tools 1.3.2

Create pose-morph shape keys for a replacement mesh using the original SH3 morph mesh as a reference. The same workflow supports faces, hair strands and clothing. It creates a new object; it does not replace the original mesh or invent new game morph slots.

## Install and prepare

Silent Hill 3 Tools 1.0.0 bundles this add-on. Save it using **Get Blender morph add-on…** on a model with morphs, or use `resources/app/tools/blender/sh3_morph_transfer.py` from the portable folder.

Install `sh3_morph_transfer.py` with Blender's **Preferences → Add-ons → Install from Disk**. Replace the older add-on with the same filename, restart Blender, and open **3D View → Sidebar → SH3 Tools**. Blender 4.2+ is required; this revision was tested through Blender 5.2.2's Python API and CPU renderer, with user-confirmed Heather face results in Blender 5.2.2 on macOS.

Export the original model with its shape keys from Silent Hill 3 Tools. Bind your replacement to the original rig and place both neutral meshes in corresponding positions. Expand **Pose Morph Transfer → 1. Meshes** and choose **Original morph mesh** and **Replacement mesh**, or select an object and use **Use active**. **Select / frame** reveals the chosen mesh.

Matching reads undeformed **Basis** coordinates in world space. Armature poses, subdivision and other modifiers are not baked. Finish topology changes before capturing landmarks. Mesh topology, Basis, UVs, materials, rig and skin weights are retained on the result.

## Mark corresponding points

Use **Aligned surfaces** for similar, already aligned shapes. Use **Paired landmarks** when their proportions differ.

1. Add a **Face**, **Hair / strand** or **Cloth / cloak** template. Adding a template keeps existing points. Custom points can be added or removed individually.
2. Select a landmark row. **Pick source** or **Pick target** temporarily displays that mesh's neutral surface. Click its corresponding point; **Esc** cancels. The previous shape display and modifier visibility are restored afterward.
3. For exact vertex selection, enter Edit Mode, select one vertex and use **Capture source** or **Capture target**. Return to Object Mode before transfer.
4. Complete every listed pair. Cyan markers identify source points, orange markers identify target points; labels show their list numbers and the active point's name. Markers always refer to Basis positions.

The Face template has 14 points: four eye corners, four upper/lower eyelid centers, nose tip, two mouth corners, upper/lower lip centers and chin. Use the **inner rims** of the mouth opening and eye opening. Upper and lower points must lie on opposite rims. Eye corners are not the middle of an eyelid. Left/right labels must refer to the same anatomical side on both meshes.

For hair, mark matching roots, intermediate strand points and tips. For clothing, mark shoulders, seams and hem points. The algorithm does not depend on facial names except for the optional face-region helper.

At least three non-collinear pairs are required. New captures store a topology signature; changed vertex/edge indexing requires recapture. Older files have no signature, so inspect their saved point positions manually.

## Separate lips, eyelids and overlapping layers

Open **Protect overlapping surfaces**. A region pairs one source vertex group with one target group. Source groups must contain complete triangles. Positive target memberships must not overlap between region pairs.

For a face, capture both corners and both rim centers, choose **Upper / lower lips**, **Left upper / lower eyelid** or **Right upper / lower eyelid**, then click **Suggest regions from landmarks**. The helper follows mesh edges to propose editable groups. **Region reach** controls their extent. Inspect the colored points using **Show selected region**. Suggestions are not an anatomical recognition system.

The suggested groups blend their outer edge into the surrounding skin. A target weight of 1 restricts correspondence to its source group. Fractional weights blend toward whole-surface correspondence; leave the actual opposing rims at full weight. A weight of 0 uses ordinary correspondence. Smoothing never directly averages two different protected regions; it can transition into surrounding unprotected skin.

For hair layers, cloth pieces or manual corrections, select vertices in Edit Mode and use **Set source selection** / **Set target selection**, or choose existing vertex groups. These buttons create or update add-on-owned groups; they do not overwrite bone-weight groups. Selection assignment creates full weights; use Weight Paint for a soft outer edge. **Transfer settings → Target region** separately controls overall morph influence.

## Preview one morph

Choose a source **Morph**, then **Preview / update**. Two temporary copies appear side by side: original on the left, replacement on the right. The arrow buttons preview the previous/next morph, and **Preview amount** controls both copies together. The original objects and their key values remain unchanged.

The coverage table reports matched vertices per region. Unmatched points appear in pink; **Select unmatched vertices** selects them in Edit Mode. They retain their existing coordinates, including during smoothing. Correct the alignment, masks or matching distance where necessary. Zero maximum distance uses 5% of the aligned source bounds.

Settings changes mark the preview stale. After editing geometry or vertex-group weights, click **Preview / update** yourself. A preview is a snapshot, not a live deformation modifier. **Remove previews** removes only the temporary objects owned by this scene's preview session.

**Preserve landmark motion** keeps captured target points moving with their source points after smoothing. Corrections spread locally along mesh edges; **Landmark influence distance** controls their reach. Zero uses 10% of the target bounds. Neutral alignment uses a local residual field, while motion uses the fitted rotation and uniform scale, avoiding nonlinear amplification of large expressions. Wrong landmarks still produce wrong motion.

## Adjust one expression's lip depth

If a different lip profile retracts too far into the mouth, open **Preview, then create → Facial depth corrections**. Preview the affected morph, click **Add current morph**, and choose its protected **Lower lip** or **Upper lip** region.

**Inward motion** scales backward movement; **Outward motion** scales forward movement. A value of 1 preserves the transferred motion, 0 removes that depth component, and values above 1 amplify it. The plane defined by the replacement mouth corners and chin supplies the depth axis; the nose tip determines its forward side. The perpendicular opening and sideways components are retained. Recapture those target landmarks if they are missing or incorrect.

Click **Preview / update** after changing the controls. Corrections apply after transfer, smoothing and landmark-motion constraints, and are included in **Create all morphs on a new copy**. Only the listed morph and selected region are adjusted. Soft region weights blend the correction into surrounding skin. Other morphs, unmatched vertices and Basis are preserved. Remove a row to restore the normal transfer for that region/morph.

This is an artist-controlled adjustment for different proportions, not automatic volume reconstruction or collision detection. Start at 1 and reduce only as needed while comparing front and side views. No facial depth correction is added by default; hair/cloth workflows retain their existing behavior.

## Create and import the result

Click **Create all morphs on a new copy**, inspect all resulting keys, and remove temporary preview objects before exporting. **Smooth existing keys on a copy** respects protected-region labels stored on a transferred result.

Export only the intended replacement meshes and original rig. In Silent Hill 3 Tools use **Import model…**, map the preserved key names to native slots, review the replacement, then stage it. Test gameplay and cutscenes before distributing a mod.

A transfer remains an authoring starting point. It does not separate welded lips, create a mouth cavity, fit eyeballs/teeth, rig hair physics, simulate cloth, or guarantee absence of self-intersections. Different proportions and extreme expressions can need extra landmarks, region edits or sculpt correction. The processing budget is 20 million key-vertices and 20 million target-vertex/anchor pairs per operation.
