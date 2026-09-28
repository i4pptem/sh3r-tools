import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {root, sourceFiles} from './source-files.mjs';

const files = sourceFiles();
const allowed = new Set(['.md', '.mjs', '.cjs', '.js', '.json', '.yaml', '.yml', '.css', '.html', '.svg', '.png', '.ico', '.txt', '.py', '.c', '.ps1', '.cmd']);
const errors = [];
for (const relative of files) {
  const file = path.join(root, relative);
  if (!fs.existsSync(file)) { errors.push(`Missing file: ${relative}`); continue; }
  if (relative.includes('/') && !allowed.has(path.extname(relative))) errors.push(`Unexpected source file type: ${relative}`);
  if (!['.md', '.mjs', '.cjs', '.py', '.ps1', '.json', '.yml', '.yaml'].includes(path.extname(relative))) continue;
  const text = fs.readFileSync(file, 'utf8');
  if (/C:[\\/]Silent Hill 3 Remix|Users[\\/]barykin\.a|SH3[_]ASSETS/.test(text)) errors.push(`Machine-specific path: ${relative}`);
  if (path.extname(relative) === '.md') {
    for (const match of text.matchAll(/\[[^\]]*\]\(([^\s)]+)\)/g)) {
      const link = match[1].split('#')[0];
      if (!link || /^[a-z][a-z\d+.-]*:/i.test(link)) continue;
      if (!fs.existsSync(path.resolve(path.dirname(file), decodeURIComponent(link)))) errors.push(`Broken local link in ${relative}: ${link}`);
    }
  }
}
const profile = JSON.parse(fs.readFileSync(path.join(root, 'core/font-runtime-profile.json'), 'utf8'));
const hash = createHash('sha256').update(fs.readFileSync(path.join(root, 'tools/native/font-upload.c'))).digest('hex');
if (hash !== profile.sourceSha256) errors.push('Font uploader source does not match its committed profile source hash.');
const characterProfile = JSON.parse(fs.readFileSync(path.join(root, 'core/character-runtime-profile.json'), 'utf8'));
const characterSource = fs.readFileSync(path.join(root, 'tools/native/character-arena.py'), 'utf8').replace(/\r\n?/g, '\n');
const characterHash = createHash('sha256').update(characterSource, 'utf8').digest('hex');
if (characterHash !== characterProfile.sourceSha256) errors.push('Character arena source does not match its patch profile.');
const textureProfile = JSON.parse(fs.readFileSync(path.join(root, 'core/model-texture-runtime-profile.json'), 'utf8'));
const textureSource = fs.readFileSync(path.join(root, 'tools/native/model-textures.c'), 'utf8').replace(/\r\n?/g, '\n');
if (createHash('sha256').update(textureSource, 'utf8').digest('hex') !== textureProfile.sourceSha256) errors.push('Model texture source does not match its patch profile.');
if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
else console.log(`Repository check passed: ${files.length} public files; links, source types and native source hashes verified.`);
