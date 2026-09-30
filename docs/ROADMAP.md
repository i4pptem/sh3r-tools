# Roadmap

Priorities for future work, rather than promises of compatibility or release dates:

- Broader game validation of authored model/morph replacements, skinning and DCC exchange.
- Better assisted expression correspondence for unrelated replacement faces.
- In-game ANM import validation and an opt-in extended-bank runtime: separate old/new bank addressing, sequential cursors, procedural bone ownership and transition tests before new channels can be supported. Game action/event table editing remains separate.
- PACK scene length/actor/camera editing, camera/audio playback and full-scene timelines; broader in-game validation of authored character motion.
- Deeper MAP visibility, collision, camera and event editing; further validation of transparent and special parts.
- Better discovery and diagnostics for unsupported asset variants and executable layouts.
- A more convenient separately distributable runtime-patch workflow for mod authors.

See [Formats](FORMATS.md) for what is implemented today. New findings must be backed by native layout validation and, where necessary, game tests before existing safety bounds are removed.
