# Workflows

A local Windows workbench for Silent Hill 3 PC assets. English interface. Developed by **i4pptem**. Version 0.8.1 adds character-file memory expansion and safer model texture and visibility mapping.

## Run

Open **dist/0.8.1/Silent Hill 3 Tools-win32-x64/Silent Hill 3 Tools.exe**. Keep the executable with its surrounding files. The portable build includes Electron. Run Install media.cmd once for optional FFmpeg media conversion; no system codec or Node.js installation is needed. Morph workspace and FBX exchange additionally use an installed Blender 4.2+ (tested with 5.2.2). Set SH3TOOLS_BLENDER to its executable if automatic detection does not find it.

Choose **Open data folder** and select the game's data directory. Selecting the game root or opening data/arc.arc also discovers the same complete workspace. Keep the catalog beside its archives.

- **Asset library** contains the main ARC assets.
- **Movie folder** contains files under data/movie.
- **Pic** contains files under data/pic.
- **Sound** contains sound/sd.afs, nested sound/demo_afs archives and loose sound files.

Switch sections directly in the sidebar. No additional folder dialog is needed, and staged replacements remain in one project. Search and file-type filters apply to the current section. Build output preserves nested paths such as data/sound/demo_afs/amcm.afs. Missing optional media folders appear as empty sections.

A single ARC, AFS or movie can still be opened separately. Saved version 0.3 projects load into the expanded workspace with their replacements preserved.

Success notifications dismiss after five seconds; errors dismiss after eight seconds. Each new notification restarts its timer, and the close button remains available.

## Model export and workspace layout

Select a PC MDL. In **Inspector → Export model**, choose **Export GLB** or **Export FBX**. Both include meshes, original mesh names, skeleton, skin weights, texture bindings and pose morph shape keys. FBX embeds textures and uses the installed Blender; it exports the model in its bind pose. Use the animation exchange controls for a selected ANM range. Model replacement continues to use GLB or a morph workspace; FBX export does not add direct FBX-to-MDL import.

**Import model → What changed?** separates new topology/morph rebuilding from positions, normals and UV edits with unchanged topology. The morph workspace, native morph JSON, embedded textures, mesh visibility and native file actions are grouped in expandable Inspector sections. Asset information and integrity details are below the editing tools.

Use **Asset library** or **Inspector** above the preview to hide either panel; the preference survives restarts. **Ctrl+Shift+L** toggles the library. **Ctrl+F** reveals it and focuses search. **Focus preview** temporarily hides the library, Inspector and navigation; **Esc** restores the previous panel layout.

Animation playback and its timeline remain visible. **Clips & settings** opens skeletal/facial clip selection, range, FPS, speed, looping and animation exchange. Playback continues when this panel is collapsed. **Pose morphs** opens the manual shape preview and intensity controls.

The vector emblem, app/window icon and restrained charcoal/copper palette share the same visual identity. Developer credit appears in the header and status bar.

## Replace a complete model and its morphs

1. Select the original PC MDL and **Export GLB** to obtain its rig and named native morph slots.
2. In a GLB-capable editor, bind the replacement mesh to that original rig. Preserve bone names and bind transforms, apply mesh object transforms, export triangles, and use at most three nonzero bone influences per vertex. New topology is supported; new skeletons are not.
3. Author the replacement model's shape keys to match the meaning of each original morph. The tool does not infer facial correspondence or automatically transfer expressions between unrelated faces.
4. In **Import model**, choose **Import GLB…**. The tool applies compatible attribute edits directly; changed topology, shape keys, skinning or materials opens the native rebuild setup. For every included part, select an original visibility/render template and, when needed, a separate native texture slot. Review the bone-visibility warnings. Map every native morph slot to a new shape key, or explicitly select Neutral. Matching names are preselected.
5. **Build & stage replacement** rebuilds native geometry, skin palettes, morph bases, deltas and vertex references. The original target order stays intact so existing facial tracks address the replacement shapes. Original texture images are retained; GLB images are not imported automatically. Replace intended native texture slots separately through PNG import.
6. Inspect the result with its original ANM and cutscene morph clips. Save the project, then **Build mod** to produce separate game-format files.

GLB export converts rounded native bone matrices to TRS-representable exchange matrices. Import matches bones by name and hierarchy, measures inverse-bind/rest-pose drift over the original and replacement geometry bounds, and accepts only drift below half a native position step (1/32 local unit) and half a native normal step (1/8192). The native skeleton is retained exactly. Identity armature wrapper nodes are accepted; transformed mesh coordinates and larger rig changes are rejected.

Native rebuilding remains experimental. The user confirmed the subdivided Heather face/hair replacement and morph cutscenes in the game on 2026-09-24. Currently supported templates use 48-byte skinned vertices. Limits are three influences per vertex, sixteen palette slots per part, 256 global bone pairs and 32,768 unique morph nodes per model. The morph limit counts pooled changing positions/normals, not every mesh vertex or the sum across shape keys. Models above the stock 1,536-node capacity require the expanded executable. Build mod detects this from staged MDL bytes and includes a patched sh3.exe beside the data folder. It creates a separate 768 KiB scratch section and redirects all 64 native references; source files are preserved. The two audited PC executable revisions are supported; unknown builds are rejected. Install the generated sh3.exe together with the built data folder, retaining a backup of your original files. An executable already expanded by this version can be reused for later builds. Palette splitting is automatic; secondary mesh partitions stay within their 682-vertex staging bound. Build mod also expands the aggregate transparent-mesh arrays when required: 65,536 vertices and 131,072 triangles, with native uint16 vertex indices. This fixes a separate overflow that subdivision of the hair can trigger even with expanded morph scratch. Native emulation validates the new buffers, and the user confirmed the repaired Heather cutscenes; other authored models still require their own game tests. Native morph coordinates must fit signed 16-bit storage at 1/16 position precision. Rebuilding retains one immutable template prefix and stable part identities. Repeating the same import produces identical native bytes without cumulative growth. For assets rebuilt by versions before 0.5.0, use **Use original MDL templates…** in the replacement dialog and choose a clean MDL for that character; current textures are retained.

Primary geometry has a separate aggregate limit: the stock game converts all primary-part indices to 16 bits, so models above 65,536 primary vertices wrap into earlier meshes even if each part is small. Build mod now emits the primary INDEX32 patch when needed and preserves it in later builds. It changes GPU index allocation and upload; the MDL index format, materials, part visibility and morph slots stay intact. The user confirmed that it removes the gameplay/cutscene distortions in the 90,971-primary-vertex Heather workspace. Automatic `_part_` chunks remain necessary for palette and transparent-mesh limits; they do not rename the native material or visibility identity.

The same **Import GLB…** action applies position, normal and UV edits directly when topology, skinning, morphs and material assignments are unchanged. Native morph JSON edits existing sparse deltas. Preview sliders and playback never stage changes; **Bake intensity** does.

## Supported workflows

| Format | Preview and exchange |
| --- | --- |
| ARC / AFS | Names, search, per-archive native/converted export, native replacement and verified patched copies |
| PC MDL | Textured geometry, skeleton, morphs, GLB / FBX export, preserved-layout edits and experimental topology rebuild |
| ANM / PACK | Skeletal/facial playback; selected ANM range FBX export/replacement (original skeleton, channels and bank length) |
| TEX / DAT / PIC / TBN2 | BGRA32, picture RGBA/PS2 alpha, RGBA5551, indexed palettes and PIC; automatic PNG fitting and palette reduction |
| Font BIN | Normal/small glyph atlases, native PNG exchange and experimental 2×/4× coverage import; original IDs and text metrics |
| MES | Text/control inspection and structured JSON exchange; verified Latin mapping; unidentified Asian glyph codes retained |
| MAP / CLD / CAM | Textured MAP with GB/TR/local materials, collision geometry and camera zones; textured GLB and structure JSON export |
| DED / SDB | Parsed lighting and sound-region/control records; structure JSON export |
| BD + HD | Sample selection/playback and WAV exchange with native PS ADPCM re-encoding |
| ADX / WAV, including unnamed AFS BIN | Content-based playback and WAV export; native filenames and entry IDs retained |
| AIX | Layer selection/playback and WAV exchange with native ADX re-encoding |
| Movie .000 | FMV playback, original MPEG export, editable WebM export and native movie re-encoding |
| Other assets | Native export/replacement and hex inspection |

Native-resolution font PNGs use transparent pixels or opaque gray levels 95, 127, 159, 191, 223 and 255. Keep native atlas dimensions and glyph cell allocation for standard import. Glyph metrics and character mappings are not edited. Font research uses belek666/fontsh234: https://github.com/belek666/fontsh234.

To create a high-resolution font, export its Normal or Small PNG, upscale/redraw it at exactly 2× or 4× without changing cell order, then use **Import high-resolution PNG…**. The importer converts grayscale/RGB luminance multiplied by alpha into 256 levels of coverage. It keeps the full original drawable rectangle per glyph: 20 × 30 logical pixels for Normal, 16 × 24 for Small. Pixels outside those rectangles are cropped, and the game’s advance widths, text sizes, line spacing and IDs remain unchanged. Only the selected font size receives new coverage; other sizes/languages keep their original glyphs.

**Build mod** includes both the changed archive and a matching sh3.exe. Install them together. The patch uses a 2048 × 2048 glyph cache with the original 384 slots and preserves compatible model/morph/picture patches. High-resolution coverage is appended to the original BIN; all original sections remain recoverable. Once a size has high-resolution coverage, **Import PNG** edits it at 2×/4× and **Export PNG** retains its resolution. Use Revert replacement to undo the staged asset. Native emulation and file round trips are verified; the user also confirmed the Normal 4× replacement appears in the game.

For MES editing, change messages[].segments[].text in the exported JSON. Keep raw controls, glyph IDs and their order. The top-level display text is informational. Unknown Japanese/Chinese codes remain explicit rather than being assigned guessed Unicode characters.

Imported PNGs are fitted to the native texture dimensions; see Archive export and image viewing below.

Audio replacements must have the same decoded sample count as the original sample/layer; the importer converts sample rate and channels to the native profile. Other bank slots/layers and loop flags are retained. Matching HD files must be available beside their BD entries in the same archive.

For FMVs, open **Movie folder**, choose a .000, then export the original MPEG or an editable WebM. **Import edited video** restores the original MPEG-1 video / MP2 audio profile and encrypted .000 wrapper. Preserve the original duration and include both video and audio. The importer checks actual video/audio frame counts and full output decoding. **Build mod** writes changed movies under data/movie in a new output folder.

The installed game contains .sdb files; no .sbd sample was available to establish that format. MAP resolves GB/TR/embedded textures, including the shared cc01TR texture. The Colors button toggles stored RGB tint. Stored type-3 object transforms are reproduced; native lighting and animated effects are not. huef.map contains an unresolved TR index; its affected group is identified explicitly. MAP supports the part editor described below; other world structures support inspection/export. KG1/KG2 are shadow geometry, not animation.

## Playback and projects

Select an MDL with **Keep model open**, then choose an ANM. Compatible motion starts automatically. **Open motion file…** accepts the cutscene AFS files under data/sound/demo_afs; amcm.afs includes Heather's facial performances. Native model IDs, skeletons and target counts filter compatibility. Arbitrary gameplay and facial clips are not automatically synchronized to a matching scene. Preview FPS is adjustable because ANM does not contain the playback rate.

**Save project** stores staged payloads and source hashes in a new .sh3project. Original archives/movies remain referenced. **Build mod** creates a new SH3-Build timestamped folder with changed archives or movies and a verified integrity manifest. Models or pictures requiring expanded storage include sh3.exe and runtime-buffers.json at the build root. The output folder opens after a successful build. Existing compatible morph, primary-index, transparent-mesh, font, picture and character-file patches are preserved and composed on later builds. It does not install into the game. Original files and existing exports are preserved. Test built assets in a separate game copy before deployment; file integrity is not an in-game behavior guarantee.

## Validation and remaining work

The unified installed workspace contains 2,796 main archive assets, seven movies, three loose pictures and 1,185 entries in the Sound section (70 archive/folder sources). All 157 PC MDLs and 461 texture containers parse, including valid empty containers; this is acceptance coverage, not exhaustive visual inspection. All 368 MES files, six font atlases, seven FMVs, 32 audio banks and twelve AIX files pass relevant round-trip checks. See [Validation](VALIDATION.md) for evidence and limits.

Remaining work includes game validation of authored ANM replacements, automatic morph transfer between unrelated models, ANM bank length/channel changes, PACK skeletal/camera tracks, and complete world visibility/collision/event editing. New rigs and arbitrary native engine capacity increases are outside this release.

## Development

See [Development](DEVELOPMENT.md) for source setup and [media provenance](../tools/media/README.md) for the optional runtime.

## Archive export and image viewing

**Export all archives…** exports every opened archive and loose-file source across all four sections, regardless of current filters. Choose native files or converted files. Right-click a source in the sidebar, or use its hover ellipsis. **Export native files…** exports every entry of that source with staged edits, regardless of search/type filters. **Export converted files…** exports supported models/maps to GLB, every texture/palette preview to PNG, ADX/AIX/bank audio to WAV, messages to JSON and movies to MPEG. Unsupported entries keep their native bytes. PACK exports decoded morph JSON plus its native payload, retaining other cutscene sections. Each entry has its own indexed folder; export-report.json lists outputs and conversion failures. A failed conversion retains the native asset. Filesystem errors stop the operation.

Use the arrow keys to browse the filtered asset list. Text fields, selectors, animation controls and map-edit fields retain their own keyboard behavior. Use the texture toolbar or mouse wheel to zoom around the pointer. Drag with the left or middle mouse button to pan; Fit or double-click centers the whole image. 1:1 displays native pixels.

**Import PNG** resamples to the original dimensions and automatically reduces indexed images to 16/256 colors without forced dithering. Direct-color images retain their available color range. Shared-palette variants still require consistent recoloring of shared indices. RGBA5551 uses binary alpha. Font atlases retain their separate glyph/dimension rules. This is image fitting, not increased native resolution.

The three sys_title TEX files have an original zero batch count; their valid image records are now read. Picture RGBA and 0–128 alpha are handled separately from PC model BGRA. The stock main-menu loader has a 1,361,920-byte file arena: its 512² title fits, a 1024² direct-color title does not. PC Fix render-resolution settings do not establish an expanded file arena. Native texture growth and palette promotion are available through the separate Import PNG at full size action. Version 0.5.0 includes the expanded picture arena in builds that need it.

## Experimental texture replacement

Choose a texture, then **Import PNG at full size…**. This preserves the PNG dimensions instead of resampling. Indexed textures with one palette and RGBA5551 records become direct 32-bit color; existing direct-color records retain the appropriate picture/model channel and alpha convention. Shared palette variants cannot be collapsed because their material bindings would change. Fonts retain their glyph-layout rules.

The experimental writer updates image dimensions, pixel/header offsets, payload lengths, dimension exponents and batch length, then reopens and verifies the pixels. Subsequent images remain byte-exact. MDL geometry/rig/morph bytes preceding its terminal texture batch are preserved. Original-sized Import PNG remains available separately.

Use **Build mod** to write the staged result into a new output folder for a game test. The optional mode retains the imported dimensions. For oversized data/pic TEX assets, the build adds five 16 MiB picture slots (80 MiB total), plus bounds checks before the file copy. A 1024² title was rebuilt and archived successfully at 4,194,496 bytes; that exceeds the known stock arena and can crash the game unless its loader has been extended. Install the newly generated executable together with the texture archive. The patch passed 725 native emulator checks. On 2026-09-24 the user confirmed that the replaced texture renders correctly in the game, including nonstandard dimensions. Other model/map texture loading paths are not covered by this picture-specific patch. General editor bounds remain 8192 pixels per side, 16 megapixels and 256 MiB per asset.

## MAP part editor

Select a MAP, click a mesh or choose **Map part**, and use **Frame selected part** to focus it. **Move / Rotate / Scale** choose the 3D gizmo. Drag an axis or enter numeric transforms; UV offset/scale and material assignment also preview immediately. Drafts survive mesh selection and returning to the map. **Apply & stage map edits** validates and commits all its preview edits atomically. **Discard preview edits** resets them. Apply or discard previews before import, export, saving a project or building; unapplied drafts are not saved. **Ctrl+Z / Undo map action** first undoes preview gestures (100 steps), then applied map operations (20 states within a 64 MiB history budget), including selected shared-texture replacement. Text fields retain their normal text undo. Ctrl/Shift-click parts in the list or viewport to select several; Move and its numeric coordinates translate the whole selection. Group rotation/scale are not supported. Static parts still must remain inside their original visibility bounds. Applying keeps the camera framing.

**Selected material texture** shows the actual source TEX/MAP and native image index. **Replace selected texture PNG…** fits a PNG to its native dimensions and palette, stages the correct embedded or GB/TR companion asset, and refreshes the map. A shared TEX replacement affects every map referencing that image. Material assignment uses an existing texture from the same native family and affects all parts in its native material group. FullSize picture-loader support does not establish support for larger map-texture allocations; map PNG replacement currently uses the native allocation.

### Edit one mesh in Blender

1. Select the part and choose **Export selected part GLB…**. Only this mesh and its assigned image are exported, with world placement preserved.
2. Import that GLB in Blender. Edit its vertices, UVs or topology, or apply a Subdivision Surface modifier. Keep one mesh with one material slot, normals, UVs and its vertex color attribute. The RGB colors carry native lighting tint. Preserve its placement; do not center the object by moving its geometry.
3. Export the selected object as GLB, including vertex colors. Applied object transforms are supported; mirrored transforms need their winding corrected before export.
4. Choose the original target part in the tool and **Replace selected part GLB…**. This stages a native strip rebuild with its original material, part identity and visibility bindings. Embedded GLB material images are not imported by this geometry action; use the PNG action for image changes.
5. Inspect the result, save the project, and **Build mod**. The output folder opens automatically.

Ordinary parts support a different number of vertices and triangles. The writer updates physical hierarchy lengths and all verified geometry, texture, interest-point and light-decal pointers, retaining other parts and texture payloads. Repeated imports do not accumulate stale geometry. The deterministic strip encoder adds repeated connector vertices, so the native vertex count is higher than Blender's indexed count.

Special parts carrying auxiliary native payloads support preserved-topology attribute edits only; the inspector explains this for the selected part. Transparent replacements may change topology but must not increase their original triangle budget pending runtime validation. RGB colors are required; each original ordinary part's constant native alpha is retained. Static type-1 parts must remain inside their original geometry bounds; event and movable parts retain their original object envelope. Free relocation across visibility cells, collision, camera and event editing, and adding/removing material groups remain separate work. The new MAP writer is file- and Blender-tested; changed MAP rendering still needs a game test.

**Import whole map GLB…** retains the earlier strict exchange mode: keep all parts and original triangle/vertex order. Use the selected-part workflow for new topology.

## Morph workspace and Subdivision (0.7)

1. Select the model and choose **Morph workspace → Export workspace .blend…**. Open that file in Blender. Each affected part has a BASE and its named poses arranged in a compact row in the front-view plane, with spacing based on that part’s actual bounds; the rig and other original parts are retained.
2. Select the desired BASE, for example **Mesh_0_6__BASE**, and add **Subdivision Surface**, level 1. Leave the modifier unapplied. The importer applies identical settings to its base and every pose, including UV and point-attribute interpolation.
3. Edit pose vertices in Edit Mode if needed. Keep the original object transforms, rig, groups and `sh3_correspondence` point attribute. Do not independently remesh only one pose. Every pose must retain matching topology and vertex correspondence; equal vertex counts alone are insufficient.
4. Save the `.blend`, then choose **Morph workspace → Import workspace…**. Review the preselected part/material and shape-key mappings, then **Build & stage replacement**.
5. Preview the native morphs and **Build mod**. Install its data and required runtime patch together, as for GLB rebuilding.

Assembly uses the BASE modifier stack for all poses; it supports Armature and Subdivision Surface, not arbitrary modifiers. Skin weights are limited to the strongest three influences and normalized for the game. Unrelated replacement faces still need authored expression correspondence. Source blend files are opened with script auto-execution disabled and are never overwritten.

## ANM range exchange through FBX (experimental, 0.7)

Select a model and an ANM from the asset library. Open **Clips & settings**, set **Range** and **FPS**, then expand **Exchange animation** and choose **Export ANM range FBX…**. Exported FBX frames are numbered **0 through range length minus one**. FPS is an exchange assumption; ANM stores no FPS or action names.

In Blender, import the FBX with animation offset 0. Edit bones in Pose Mode. Export one active action with **Custom Properties enabled**, **Add Leaf Bones disabled**, **NLA Strips / All Actions disabled**, **Simplify 0**, and the same FPS and frame range. Keep the armature, bone names, parents, rest transforms and armature custom properties. Those properties retain the original native interval and the decoded exchange baseline.

Choose **Replace ANM range from FBX…** with the same model and bank selected. It stages the native ANM and reloads the edited range for playback. Save/build the mod normally. A repeated import does not accumulate conversion changes; frames outside the exported range remain byte-identical.

This mode edits only existing rotation/translation channels. It rejects authored Pose Mode scale, missing channels, a changed skeleton, object-level armature animation and changed duration. Blender may bake Scale keys near 1.0 into the FBX; those keys are allowed when the bone scale itself remains unchanged. It does not author PACK cutscenes, facial curves, action/event tables or new channels. Export ranges are limited to 500,000 bone samples. Installed Blender performs the FBX conversion. Small conversion residuals within a float32 roundoff envelope retain the exported native sample; changed poses are transferred as deltas from the measured FBX baseline. Source native quaternion/sign bytes remain intact for unchanged channels.

Blender round trips and native channel decoding have been verified. Authored ANM changes still need an in-game test, particularly transitions, root motion and procedural/IK behavior.
