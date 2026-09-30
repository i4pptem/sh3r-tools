/** Synthetic PACK payloads without game data. */
export function motionPack(tracks, morphWeight) {
  const size = 4 + tracks.length * 20 + tracks.reduce((n, t) => n + (t.width || 24) * t.frames.length, 0);
  const motion = Buffer.alloc(size); motion.writeUInt32LE(tracks.length);
  let cursor = 4 + tracks.length * 20;
  tracks.forEach((track, i) => {
    const offset = 4 + i * 20;
    [track.type ?? 1, ((track.modelId ?? 256) << 16) | track.index, track.width || 24, track.frames.length, 0].forEach((v, k) => motion.writeUInt32LE(v >>> 0, offset + k * 4));
  });
  for (let frame = 0; frame < Math.max(...tracks.map(t => t.frames.length)); frame++) for (const track of tracks) {
    if (frame >= track.frames.length) continue;
    track.frames[frame].forEach((v, k) => motion.writeFloatLE(v, cursor + k * 4)); cursor += track.width || 24;
  }
  const sections = [{type: 2, data: motion}];
  if (morphWeight !== undefined) {
    const morph = Buffer.alloc(54); morph.writeUInt32LE(256); morph.writeUInt32LE(1, 8);
    [0, 2, 26, 28].forEach((v, k) => morph.writeUInt32LE(v, 12 + k * 4));
    morph.writeUInt32LE(0x29843918, 28); morph.writeUInt16LE(1, 32); morph.writeUInt16LE(1, 36); morph.writeUInt16LE(2, 40);
    morph.writeUInt32LE(20, 44); morph.writeUInt16LE(1, 48); morph.writeInt16LE(morphWeight, 52);
    sections.push({type: 1, data: morph});
  }
  const header = 16 + sections.length * 16, data = Buffer.alloc(header + sections.reduce((n, s) => n + s.data.length, 0));
  data.writeUInt32LE(0x12345678); data.writeUInt32LE(1, 4); data.writeUInt32LE(sections.length, 8); cursor = header;
  sections.forEach((section, i) => {
    [cursor, section.type, section.data.length, 0].forEach((v, k) => data.writeUInt32LE(v, 16 + i * 16 + k * 4));
    section.data.copy(data, cursor); cursor += section.data.length;
  });
  return data;
}
