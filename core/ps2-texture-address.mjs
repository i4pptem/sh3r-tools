/** Map a PSMT4 pixel to a nibble in the game's PSMCT32 upload stream. */
export function indexed4Address(x, y, width) {
  const page = Math.floor(x / 128) + Math.floor(y / 128) * (width / 128);
  const blockX = (x & 127) >> 5, blockY = (y & 127) >> 4;
  const block = ((blockX & 1) << 1) | ((blockX & 2) << 2) | (blockY & 1) | ((blockY & 2) << 1) | ((blockY & 4) << 2);
  const word = ((x & 1) | ((x & 6) << 1) | ((y & 1) << 1)) ^ ((((y >> 1) ^ (y >> 2)) & 1) << 3);
  const address = page * 8192 + block * 256 + ((y & 15) >> 2) * 64 + word * 4 + ((x & 31) >> 3);
  const uploadWidth = width / 2, uploadPages = uploadWidth / 64;
  const uploadPage = Math.floor(address / 8192), uploadBlock = (address >> 8) & 31, uploadWord = (address >> 2) & 15;
  const uploadX = (uploadPage % uploadPages) * 64 + ((uploadBlock & 1) | ((uploadBlock & 4) >> 1) | ((uploadBlock & 16) >> 2)) * 8
    + (uploadWord & 1) + ((uploadWord & 12) >> 1);
  const uploadY = Math.floor(uploadPage / uploadPages) * 32 + (((uploadBlock & 2) >> 1) | ((uploadBlock & 8) >> 2)) * 8
    + ((address >> 6) & 3) * 2 + ((uploadWord & 2) >> 1);
  return ((uploadY * uploadWidth + uploadX) * 4 + (address & 3)) * 2 + ((y >> 1) & 1);
}
