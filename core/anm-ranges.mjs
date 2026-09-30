import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const FRAME_COUNT = 1763;
const WEAPONS = [
  ['chhaa_basic1_none.anm', 201, 217],
  ['chhaa_basic1_hand.anm', 218, 249],
  ['chhaa_basic2_shot.anm', 250, 269],
  ['chhaa_basic2_mach.anm', 270, 275],
  ['chhaa_basic1_knif.anm', 276, 290],
  ['chhaa_basic3_pipe.anm', 291, 307],
  ['chhaa_basic1_blad.anm', 308, 324],
  ['chhaa_basic3_hamm.anm', 325, 333],
  ['chhaa_basic1_stun.anm', 334, 342],
  ['chhaa_basic1_sabe.anm', 343, 356],
  ['chhaa_basic2_flam.anm', 357, 360],
];
const SIGNATURES = [
  [0x4c5fa0, 64, 'e0b4bb121e57973e7a7a9ef967e3e0bec523e866babd368648f6bbc90e57a155'],
  [0x4c55c0, 320, '0f418f4efa3ebbb21efbfd7c33354805415d3239b7a3d3f95992335003d2a189'],
  [0x4973a0, 16, 'c2f51ed9812f82e36d1db3d8a784e46a92520b8a0d215554784a3f1389897df1'],
  [0x497980, 96, 'cf4afa8d568b7ee6abf6c01bec4bf2febbc530c82607e41cc0707f57485ece20'],
  [0x60da50, 192, '786bc040856d4db2553f59ad8500fc6e060de9a6029def64edf7ae8ed0e18ff0'],
  [0x4a66f0, 176, '2dc13ea18ec83463c8cfe3ab234ec6a7d9934b450f76b861f66765eea1ff1dfd'],
];

function unsupported(message) {
  return { ranges: [], rangeSource: null, rangeNote: message };
}

function peReader(buffer) {
  const requireBytes = (offset, count) => {
    if (offset < 0 || count < 0 || offset + count > buffer.length) throw new Error('Truncated PE file.');
  };
  requireBytes(0, 64);
  if (buffer.readUInt16LE(0) !== 0x5a4d) throw new Error('Not a PE file.');
  const pe = buffer.readUInt32LE(0x3c);
  requireBytes(pe, 24);
  if (buffer.readUInt32LE(pe) !== 0x4550 || buffer.readUInt16LE(pe + 4) !== 0x14c) throw new Error('Not the supported x86 executable.');
  const count = buffer.readUInt16LE(pe + 6), optionalSize = buffer.readUInt16LE(pe + 20);
  requireBytes(pe + 24, optionalSize);
  if (optionalSize < 32 || buffer.readUInt16LE(pe + 24) !== 0x10b) throw new Error('Unsupported PE header.');
  const base = buffer.readUInt32LE(pe + 52), table = pe + 24 + optionalSize;
  if (base !== 0x400000 || count < 1 || count > 96) throw new Error('Unsupported executable layout.');
  requireBytes(table, count * 40);
  const sections = Array.from({ length: count }, (_, i) => ({
    rva: buffer.readUInt32LE(table + i * 40 + 12),
    size: buffer.readUInt32LE(table + i * 40 + 16),
    offset: buffer.readUInt32LE(table + i * 40 + 20),
  }));
  return (va, size) => {
    const rva = va - base;
    const section = sections.find(s => rva >= s.rva && rva + size <= s.rva + s.size);
    if (!section) throw new Error('Animation metadata is not present in the executable.');
    const offset = section.offset + rva - section.rva;
    requireBytes(offset, size);
    return buffer.subarray(offset, offset + size);
  };
}

function descriptor(read, address, expectedId) {
  const bytes = read(address, 12);
  const id = bytes.readUInt16LE(0), nominalFrames = bytes.readUInt16LE(2);
  const speed = bytes.readInt16LE(4), start = bytes.readUInt16LE(6), end = bytes.readUInt16LE(8);
  const loop = bytes[10];
  if (id !== expectedId || start > end || end >= FRAME_COUNT || loop > 1 || speed < 0 || speed > 16384) {
    throw new Error('Unsupported or invalid animation descriptor table.');
  }
  // Zero-length descriptors are placeholders, including action 341's one-frame range.
  if (!nominalFrames || !speed) return null;
  return { id, label: `Action ${id}`, start, end, loop: loop === 1,
    fps: speed * 60 / 4096, nativeSpeed: speed, nominalFrames,
    sourceAddress: `0x${address.toString(16).toUpperCase()}` };
}

/** Extract verified Heather action descriptors from a user-supplied PC executable. */
export function readHeatherAnimationRanges(buffer) {
  const read = peReader(buffer);
  for (const [address, size, expected] of SIGNATURES) {
    if (createHash('sha256').update(read(address, size)).digest('hex') !== expected) {
      throw new Error('This executable has an unsupported animation-code profile.');
    }
  }
  const common = [];
  for (let id = 101; id <= 148; id++) {
    const clip = descriptor(read, 0x6cfe80 + (id - 100) * 12, id);
    if (clip) common.push(clip);
  }
  for (let id = 500; id <= 537; id++) {
    const clip = descriptor(read, 0x6cfca0 + (id - 500) * 12, id);
    if (clip) common.push(clip);
  }
  const banks = new Map();
  for (const [weaponClass, [name, first, last]] of WEAPONS.entries()) {
    if (read(0x6bddb0 + weaponClass * 2, 2).readUInt16LE(0) !== 0x800 + weaponClass) {
      throw new Error('Unsupported weapon-class mapping.');
    }
    const bankIndex = read(0x6bdd24 + weaponClass * 2, 2).readUInt16LE(0);
    if (bankIndex >= 14) throw new Error('Unsupported animation-bank index.');
    const fileId = read(0x7117f8 + bankIndex * 2, 2).readUInt16LE(0);
    if (!fileId || fileId > 0xff) throw new Error('Unsupported animation file ID.');
    const nameAddress = read(0x710c90 + fileId * 4, 4).readUInt32LE(0);
    const expectedName = `data/chr/pl/${name}`;
    if (read(nameAddress, expectedName.length + 1).toString('ascii') !== `${expectedName}\0`) {
      throw new Error('Unsupported animation-bank filename mapping.');
    }
    const specific = [];
    for (let id = first; id <= last; id++) {
      const clip = descriptor(read, 0x6d00d0 + (id - 200) * 12, id);
      if (clip) specific.push(clip);
    }
    banks.set(name, [...common.filter(c => c.id < 500), ...specific, ...common.filter(c => c.id >= 500)]);
  }
  return banks;
}

/** Cache native clip metadata by executable identity; never cache missing files permanently. */
export class AnimationRangeCatalog {
  #cache = new Map();

  forBank({ dataRoot, executablePath, bankName, modelId, frameCount }) {
    const normalized = String(bankName || '').replaceAll('\\', '/').toLowerCase();
    const basename = normalized.split('/').at(-1);
    if (!WEAPONS.some(([name]) => name === basename) || normalized.includes('/test/')) return unsupported('No verified action table for this bank. Set a custom frame range.');
    if (modelId !== 0x100 || frameCount !== FRAME_COUNT) return unsupported('Native action ranges require the original 1763-frame Heather gameplay bank layout.');
    const exe = executablePath || (dataRoot ? path.resolve(dataRoot, '..', 'sh3.exe') : null);
    if (!exe) return unsupported('Open the game data folder to read action ranges from its sh3.exe.');
    let stat;
    try { stat = fs.statSync(exe); }
    catch (error) {
      if (error.code === 'ENOENT' || error.code === 'EACCES' || error.code === 'EPERM') return unsupported('Action ranges are unavailable: sh3.exe could not be read next to the data folder.');
      throw error;
    }
    if (stat.size > 128 * 1024 * 1024) return unsupported('Action ranges are unavailable: executable exceeds the supported size.');
    const stamp = `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
    let cached = this.#cache.get(exe);
    if (!cached || cached.stamp !== stamp) {
      const buffer = fs.readFileSync(exe);
      try { cached = { stamp, banks: readHeatherAnimationRanges(buffer) }; }
      catch (error) { cached = { stamp, message: error.message }; }
      this.#cache.set(exe, cached);
    }
    if (!cached.banks) return unsupported(`Action ranges are unavailable: ${cached.message}`);
    return {
      ranges: cached.banks.get(basename).map(clip => ({ ...clip })),
      rangeSource: 'Native sh3.exe action table',
      rangeNote: 'Inclusive frame ranges. Default rate uses the native 60 Hz clock; gameplay may adjust speed and blend upper/lower-body actions. Action IDs are verified; movement names are not yet mapped.',
    };
  }
}
