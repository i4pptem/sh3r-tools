/** Read inclusive native ranges through a bounded executable-address reader. */
export function readActionTable(read, {tableAddress, firstId, lastId}, frameCount) {
  const result = [];
  for (let expectedId = firstId; expectedId <= lastId; expectedId++) {
    const address = tableAddress + (expectedId - firstId) * 12, bytes = read(address, 12);
    const id = bytes.readUInt16LE(0), nominalFrames = bytes.readUInt16LE(2);
    const speed = bytes.readInt16LE(4), start = bytes.readUInt16LE(6), end = bytes.readUInt16LE(8), loop = bytes[10];
    if (id !== expectedId || start > end || end >= frameCount || loop > 1 || speed < 0 || speed > 16384) {
      throw new Error(`Unsupported or invalid animation descriptor for Action ${expectedId}.`);
    }
    // Native zero-duration/zero-speed entries are placeholders, not playable actions.
    if (!nominalFrames || !speed) continue;
    result.push({id, label: `Action ${id}`, start, end, loop: loop === 1,
      fps: speed * 60 / 4096, nativeSpeed: speed, nominalFrames,
      sourceAddress: `0x${address.toString(16).toUpperCase()}`});
  }
  return result;
}
