# Post-1.0 roadmap

Version 1.0.0 keeps the current feature scope. These are possible future directions, not missing release prerequisites or promises of compatibility and release dates:

- Broader game validation of authored model/morph replacements, skinning and DCC exchange.
- Broader landmark-transfer validation across different faces, hair and cloth; automatic anatomical correspondence and lip/eyelid separation remain future work. User-defined landmark alignment and region masks are available.
- Broader in-game ANM import validation and verified Action names. The channel table explains current writable components; new native channels remain unsupported. Action duration extension was removed; imports preserve fixed bank ranges.
- PACK scene length changes and new actor/light channel authoring; resolve the five remaining scene-resource associations, additional stage-script visibility, scripted effects and exact lighting. Full-scene preview and Blender exchange of existing motion/camera/light/prop channels, including preview/export of PACK-to-MAP masks, are available; broader in-game validation of authored character motion remains.
- Optimized MAP cell repartitioning, room streaming/event editing, broader in-game validation of the expanded indoor/outdoor resource budgets, broader wall shapes and full gameplay-camera simulation; in-game validation of expanded static parts and authored room transitions.
- Better discovery and diagnostics for unsupported asset variants and executable layouts.
- Validate authored KG1 proxies across character variants and scenes; self-intersection detection and better automatic proxy generation remain future work. Exact low-detail per-bone GLB exchange and explicit disable/source restoration are available. Morph-following and blended shadow skinning are not implemented.
- Extend asset-level mod merging toward explicit internal-asset conflict resolution. ASI overlay builds and portable asset packages are available.

See [Formats](FORMATS.md) for what is implemented today. New findings must be backed by native layout validation and, where necessary, game tests before existing safety bounds are removed.
