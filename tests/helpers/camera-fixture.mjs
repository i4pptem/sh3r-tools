export function cameraFixture() {
  const data = Buffer.alloc(256);
  for (const offset of [0, 32]) [0, 0, 1000, 0, 1000, 1000, 50, -1600].forEach((value, i) => data.writeFloatLE(value, offset + i * 4));
  data.writeFloatLE(10000, 84); data.writeFloatLE(10000, 88); data.writeUInt32LE(1, 128 + 68);
  return data;
}
