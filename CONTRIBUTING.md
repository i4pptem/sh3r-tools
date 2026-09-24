# Contributing

Issues and focused pull requests are welcome. Original contributions are made under **GPL-3.0-only**, the project's license. Preserve third-party notices and identify the origin/license of any code or artwork you introduce.

Start with [Development](docs/DEVELOPMENT.md), [Formats](docs/FORMATS.md) and [Executable patches](docs/EXECUTABLE-PATCHES.md). Keep changes within the relevant parser, writer or UI component. Preserve source-file immutability and deterministic rebuilding. Avoid weakening bounds or executable authentication merely to accept a sample.

Before a pull request, run `pnpm test`, `pnpm check:repo` and `pnpm build`. Include meaningful synthetic regression cases for native format changes. Describe user-visible behavior, validation and unresolved limits. Runtime address/profile changes need evidence for the supported layout and native behavior, not only a passing editor preview.

Do not commit game executables, original/extracted game assets, archives, user projects, private paths, credentials, development environments or downloaded runtimes. Use synthetic fixtures or explain how a contributor can reproduce with their own installation. Do not attach proprietary game files to a public issue.
