import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const media = path.join(root, 'tools/media');
export const metadata = JSON.parse(fs.readFileSync(path.join(media, 'download.json'), 'utf8'));
export const runtime = path.join(media, 'runtime', metadata.installDirectory);
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

/** Verify all publisher files against the runtime tested for this release. */
export function verifyRuntime(directory = runtime) {
  const manifest = JSON.parse(fs.readFileSync(path.join(media, 'runtime-manifest.json'), 'utf8'));
  for (const [relative, expected] of Object.entries(manifest.files)) {
    const file = path.resolve(directory, relative);
    if (!file.startsWith(path.resolve(directory) + path.sep)) throw new Error('Invalid runtime manifest path.');
    if (!fs.existsSync(file) || sha256(fs.readFileSync(file)) !== expected) {
      throw new Error(`Media runtime verification failed: ${relative}. Move the incomplete runtime aside, then install it again.`);
    }
  }
  return Object.keys(manifest.files).length;
}
