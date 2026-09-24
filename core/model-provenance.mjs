import {createHash} from 'node:crypto';
import {align, range, requireThat} from './binary.mjs';

const magic = Buffer.alloc(16); magic.write('SH3MDLTEMPLATE1');
const digest = data => createHash('sha256').update(data).digest().subarray(0, 12);

/** Read editor identity stored outside all native model tables. */
export function modelProvenance(data) {
  const texture = data.readUInt32LE(12), footer = texture - 32;
  if (footer < 24 || !data.subarray(footer, footer + 16).equals(magic)) return null;
  const size = data.readUInt32LE(footer + 16);
  requireThat(size > 0 && size <= 1024 * 1024 && size <= footer, 'Invalid model template metadata.');
  const payload = data.subarray(footer - size, footer);
  requireThat(digest(payload).equals(data.subarray(footer + 20, footer + 32)), 'Model template metadata checksum failed.');
  const record = JSON.parse(payload.toString('utf8'));
  requireThat(record.version === 1 && Number.isInteger(record.prefixLength) && record.prefixLength <= footer - size && Array.isArray(record.meshes), 'Invalid model template record.');
  const base = data.readUInt32LE(20); range(data, base, 112, 'Model template header');
  requireThat(record.prefixLength >= base + 112 && Buffer.from(record.header, 'base64').length === 112, 'Invalid preserved model header.');
  requireThat(record.meshes.every(m => typeof m.name === 'string' && typeof m.template === 'string') && new Set(record.meshes.map(m => m.name)).size === record.meshes.length, 'Invalid model part identities.');
  return record;
}

/** Reuse immutable native templates while retaining the current embedded textures. */
export function modelTemplate(data) {
  const record = modelProvenance(data); if (!record) return data;
  const output = Buffer.concat([data.subarray(0, record.prefixLength), data.subarray(data.readUInt32LE(12))]);
  Buffer.from(record.header, 'base64').copy(output, output.readUInt32LE(20));
  output.writeUInt32LE(record.prefixLength, 12); output.writeUInt32LE(record.prefixLength, 16);
  return output;
}

export function encodeModelProvenance(template, meshes) {
  const base = template.readUInt32LE(20);
  const raw = Buffer.from(JSON.stringify({version: 1, prefixLength: template.readUInt32LE(12), header: template.subarray(base, base + 112).toString('base64'), meshes}));
  const payload = Buffer.alloc(align(raw.length, 16), 32); raw.copy(payload);
  const footer = Buffer.alloc(32); magic.copy(footer); footer.writeUInt32LE(payload.length, 16); digest(payload).copy(footer, 20);
  return Buffer.concat([payload, footer]);
}
