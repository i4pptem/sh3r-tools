import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const excluded = new Set(['node_modules', '.git', '__pycache__', 'runtime', 'downloads']);
const rootFiles = ['README.md', 'LICENSE', 'CREDITS.md', 'THIRD_PARTY_NOTICES.md', 'CHANGELOG.md', 'CONTRIBUTING.md',
  'SECURITY.md', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', '.gitignore', '.gitattributes', '.editorconfig'];

/** Return the explicit source-distribution inventory, excluding local build inputs. */
export function sourceFiles() {
  const files = [...rootFiles];
  function visit(relative) {
    for (const entry of fs.readdirSync(path.join(root, relative), {withFileTypes: true})) {
      if (excluded.has(entry.name)) continue;
      const file = `${relative}/${entry.name}`;
      if (entry.isSymbolicLink()) throw new Error(`Source symlinks are not supported: ${file}`);
      if (entry.isDirectory()) visit(file);
      else if (file !== 'app/ui/bundle.js') files.push(file);
    }
  }
  for (const directory of ['app', 'core', 'docs', 'tests', 'tools', '.github']) visit(directory);
  return files.sort();
}

if (process.argv[2] === '--json') console.log(JSON.stringify(sourceFiles()));
