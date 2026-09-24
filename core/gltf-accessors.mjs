import {range, requireThat} from './binary.mjs';

/** Read packed, interleaved or sparse glTF accessors from an embedded GLB buffer. */
export function gltfAccessor(doc, binary, index) {
  const a = doc.accessors?.[index], widths = {5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4};
  requireThat(a, 'Missing glTF accessor.');
  const width = widths[a.componentType], size = {SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16}[a.type];
  requireThat(width && size && Number.isInteger(a.count) && a.count >= 0 && a.count * size <= 10000000, 'Invalid glTF accessor.');
  const read = (offset, type = a.componentType) => {
    if (type === 5126) return binary.readFloatLE(offset);
    const bytes = widths[type]; return type === 5120 || type === 5122 ? binary.readIntLE(offset, bytes) : binary.readUIntLE(offset, bytes);
  };
  const viewAt = (index, offset, count, elementSize, interleaved) => {
    const view = doc.bufferViews?.[index]; requireThat(view && view.buffer === 0, 'Expected an embedded glTF buffer.');
    const stride = interleaved ? view.byteStride || elementSize : elementSize;
    requireThat(Number.isInteger(stride) && stride >= elementSize && Number.isInteger(offset) && offset >= 0 && offset + (count ? (count - 1) * stride + elementSize : 0) <= view.byteLength, 'glTF accessor exceeds its view.');
    range(binary, view.byteOffset || 0, view.byteLength, 'GLB view'); return {offset: (view.byteOffset || 0) + offset, stride};
  };
  const values = new Array(a.count * size).fill(0);
  if (a.bufferView !== undefined) {
    const view = viewAt(a.bufferView, a.byteOffset || 0, a.count, size * width, true);
    for (let i = 0; i < values.length; i++) values[i] = read(view.offset + Math.floor(i / size) * view.stride + i % size * width);
  } else requireThat(a.sparse, 'Accessor has neither data nor sparse values.');
  if (a.sparse) {
    const sparse = a.sparse, type = sparse.indices?.componentType;
    requireThat([5121, 5123, 5125].includes(type) && Number.isInteger(sparse.count) && sparse.count > 0 && sparse.count <= a.count, 'Invalid sparse accessor.');
    const indices = viewAt(sparse.indices.bufferView, sparse.indices.byteOffset || 0, sparse.count, widths[type], false);
    const data = viewAt(sparse.values.bufferView, sparse.values.byteOffset || 0, sparse.count, size * width, false);
    let previous = -1;
    for (let i = 0; i < sparse.count; i++) {
      const vertex = read(indices.offset + i * widths[type], type);
      requireThat(vertex > previous && vertex < a.count, 'Sparse indices must increase within the accessor.'); previous = vertex;
      for (let k = 0; k < size; k++) values[vertex * size + k] = read(data.offset + (i * size + k) * width);
    }
  }
  if (a.normalized) {
    requireThat([5120, 5121, 5122, 5123].includes(a.componentType), 'Unsupported normalized glTF component.');
    const signed = a.componentType === 5120 || a.componentType === 5122, maximum = 2 ** (width * 8 - (signed ? 1 : 0)) - 1;
    return values.map(value => Math.max(signed ? -1 : 0, value / maximum));
  }
  return values;
}
