import {range, requireThat} from './binary.mjs';
import {convertAudioPcm, encodeAdxPcm} from './media.mjs';

const clamp = value => Math.max(-32768, Math.min(32767, value));
const psCoefficients = [[0, 0], [60, 0], [115, -52], [98, -55], [122, -60]];

export function waveFile(pcm, sampleRate, channels) {
  requireThat(pcm.length % (channels * 2) === 0 && pcm.length <= 256 * 1024 * 1024, 'Invalid PCM audio size.');
  const output = Buffer.alloc(44 + pcm.length);
  output.write('RIFF'); output.writeUInt32LE(output.length - 8, 4); output.write('WAVEfmt ', 8);
  output.writeUInt32LE(16, 16); output.writeUInt16LE(1, 20); output.writeUInt16LE(channels, 22);
  output.writeUInt32LE(sampleRate, 24); output.writeUInt32LE(sampleRate * channels * 2, 28);
  output.writeUInt16LE(channels * 2, 32); output.writeUInt16LE(16, 34); output.write('data', 36);
  output.writeUInt32LE(pcm.length, 40); pcm.copy(output, 44); return output;
}

export function parseAdx(data) {
  range(data, 0, 20, 'ADX header');
  const offset = data.readUInt16BE(2) + 4, channels = data[7], sampleRate = data.readUInt32BE(8), samples = data.readUInt32BE(12);
  const version = data.readUInt16BE(18), cutoff = data.readUInt16BE(16);
  requireThat(data.readUInt16BE(0) === 0x8000 && data[4] === 3 && data[5] === 18 && data[6] === 4, 'Unsupported ADX encoding.');
  requireThat([0x0300, 0x0400].includes(version) && channels >= 1 && channels <= 8 && sampleRate >= 8000 && sampleRate <= 96000 && samples > 0, 'Invalid or encrypted ADX header.');
  range(data, offset - 6, 6, 'ADX copyright marker');
  requireThat(data.toString('ascii', offset - 6, offset) === '(c)CRI', 'Invalid ADX copyright marker.');
  const byteLength = Math.ceil(samples / 32) * 18 * channels;
  range(data, offset, byteLength, 'ADX audio');
  return {offset, channels, sampleRate, samples, version, cutoff, byteLength, duration: samples / sampleRate};
}

export function decodeAdx(data) {
  const info = parseAdx(data); requireThat(info.samples * info.channels * 2 <= 256 * 1024 * 1024, 'Decoded ADX audio is too large.');
  const output = Buffer.alloc(info.samples * info.channels * 2);
  const a = Math.SQRT2 - Math.cos(2 * Math.PI * info.cutoff / info.sampleRate), b = Math.SQRT2 - 1;
  const c = (a - Math.sqrt((a + b) * (a - b))) / b, coefficient1 = Math.trunc(c * 8192), coefficient2 = Math.trunc(c * c * -4096);
  for (let channel = 0; channel < info.channels; channel++) {
    let previous = info.version === 0x0400 ? data.readInt16BE(24 + channel * 4) : 0;
    let older = info.version === 0x0400 ? data.readInt16BE(26 + channel * 4) : 0;
    for (let start = 0; start < info.samples; start += 32) {
      const offset = info.offset + ((start / 32) * info.channels + channel) * 18, scale = data.readUInt16BE(offset) + 1;
      requireThat(scale <= 0x8000, 'Unexpected ADX end marker inside audio frames.');
      for (let i = 0; i < 32 && start + i < info.samples; i++) {
        let nibble = i & 1 ? data[offset + 2 + (i >> 1)] & 15 : data[offset + 2 + (i >> 1)] >> 4;
        if (nibble >= 8) nibble -= 16;
        const prediction = info.version === 0x0300 ? Math.floor(coefficient1 * previous / 4096) + Math.floor(coefficient2 * older / 4096) : Math.floor((coefficient1 * previous + coefficient2 * older) / 4096);
        const sample = clamp(nibble * scale + prediction); output.writeInt16LE(sample, ((start + i) * info.channels + channel) * 2);
        older = previous; previous = sample;
      }
    }
  }
  return {pcm: output, ...info};
}

export function parseAix(data) {
  range(data, 0, 0x30, 'AIX header');
  requireThat(data.toString('ascii', 0, 4) === 'AIXF' && data.readUInt32BE(8) === 0x01000014 && data.readUInt32BE(12) === 0x800, 'Unsupported AIX header.');
  const count = data.readUInt16BE(24), dataOffset = data.readUInt32BE(4) + 8;
  requireThat(count >= 1 && count <= 120, 'Invalid AIX segment count.');
  range(data, 32, count * 16 + 24, 'AIX tables');
  const segments = Array.from({length: count}, (_, index) => {
    const p = 32 + index * 16, offset = data.readUInt32BE(p), size = data.readUInt32BE(p + 4), samples = data.readUInt32BE(p + 8), sampleRate = data.readUInt32BE(p + 12) || data.readUInt32BE(44);
    range(data, offset, size, 'AIX segment'); requireThat(samples > 0, 'Empty AIX segment.'); return {index, offset, size, samples, sampleRate};
  });
  requireThat(segments[0].offset === dataOffset && data[32 + count * 16] === 1, 'Invalid AIX segment table.');
  const layerOffset = 48 + count * 16, layerCount = data[layerOffset];
  requireThat(layerCount >= 1 && layerCount <= 32, 'Invalid AIX layer count.'); range(data, layerOffset + 8, layerCount * 8, 'AIX layer table');
  const layers = Array.from({length: layerCount}, (_, index) => {
    const p = layerOffset + 8 + index * 8, sampleRate = data.readUInt32BE(p), channels = data[p + 4];
    requireThat(sampleRate === segments[0].sampleRate && segments.every(s => s.sampleRate === sampleRate) && channels >= 1 && channels <= 8, 'Inconsistent AIX audio layers.');
    return {index, name: `Layer ${index + 1}`, sampleRate, channels, samples: segments.reduce((sum, s) => sum + s.samples, 0)};
  });
  requireThat(layers.every(layer => layer.samples * layer.channels * 2 <= 256 * 1024 * 1024), 'Decoded AIX layer exceeds the 256 MiB editing limit.');
  return {format: 'CRI AIX / ADX', segments, layers, duration: layers[0].samples / layers[0].sampleRate};
}

function aixPackets(data, segment, layer) {
  const packets = []; let p = segment.offset;
  while (p < segment.offset + segment.size) {
    range(data, p, 8, 'AIX packet'); const size = data.readUInt32BE(p + 4) + 8;
    requireThat(size >= 8 && p + size <= segment.offset + segment.size, 'Invalid AIX packet size.');
    const tag = data.toString('ascii', p, p + 4);
    if (tag === 'AIXP') {
      range(data, p, 16, 'AIX audio packet'); const length = data.readUInt16BE(p + 10);
      requireThat(length <= size - 16, 'Invalid AIX payload length.');
      if (data[p + 8] === layer) packets.push({offset: p + 16, size: length});
    } else requireThat(['AIXE', 'AIXF'].includes(tag), `Unexpected AIX packet ${tag}.`);
    p += size;
  }
  requireThat(packets.length > 0, 'AIX layer has no audio packets.'); return packets;
}

export function extractAixAdx(data, layer = 0, segment = 0) {
  const info = parseAix(data); requireThat(info.layers[layer] && info.segments[segment], 'Unknown AIX layer or segment.');
  return Buffer.concat(aixPackets(data, info.segments[segment], layer).map(p => data.subarray(p.offset, p.offset + p.size)));
}

export function decodeAix(data, layer = 0) {
  const info = parseAix(data); requireThat(info.layers[layer], 'Unknown AIX layer.');
  const pcm = info.segments.map((segment, i) => {
    const decoded = decodeAdx(extractAixAdx(data, layer, i));
    requireThat(decoded.samples === segment.samples && decoded.channels === info.layers[layer].channels, 'AIX segment and ADX header disagree.'); return decoded.pcm;
  });
  return {pcm: Buffer.concat(pcm), ...info.layers[layer]};
}

/** Replace one AIX layer while preserving all multiplex packets, timing, and other layers. */
export async function importAixWave(data, file, layer = 0) {
  const info = parseAix(data), audio = info.layers[layer]; requireThat(audio, 'Unknown AIX layer.');
  const pcm = await convertAudioPcm(file, audio.sampleRate, audio.channels);
  requireThat(pcm.length === audio.samples * audio.channels * 2, `Keep exactly ${audio.samples} samples (${(audio.samples / audio.sampleRate).toFixed(6)} seconds) for this AIX layer.`);
  if (pcm.equals(decodeAix(data, layer).pcm)) return Buffer.from(data);
  const output = Buffer.from(data); let sampleStart = 0;
  for (const [index, segment] of info.segments.entries()) {
    const original = extractAixAdx(data, layer, index), originalInfo = parseAdx(original);
    const segmentPcm = pcm.subarray(sampleStart * audio.channels * 2, (sampleStart + segment.samples) * audio.channels * 2); sampleStart += segment.samples;
    const encoded = await encodeAdxPcm(segmentPcm, audio.sampleRate, audio.channels), encodedInfo = parseAdx(encoded);
    requireThat(encodedInfo.samples === Math.ceil(originalInfo.samples / 32) * 32, 'ADX encoder produced an unexpected number of padded samples.');
    for (const field of ['channels', 'sampleRate', 'cutoff', 'byteLength']) requireThat(originalInfo[field] === encodedInfo[field], `ADX encoder changed ${field}.`);
    const updated = Buffer.from(original); encoded.copy(updated, originalInfo.offset, encodedInfo.offset, encodedInfo.offset + encodedInfo.byteLength);
    let cursor = 0;
    for (const packet of aixPackets(data, segment, layer)) {updated.copy(output, packet.offset, cursor, cursor + packet.size); cursor += packet.size;}
    requireThat(extractAixAdx(output, layer, index).equals(updated), 'AIX packet replacement verification failed.');
  }
  decodeAix(output, layer); return output;
}

export function parseSoundBank(header, body) {
  range(header, 0, 0x50, 'HD header');
  requireThat(header.toString('ascii', 0, 8) === 'IECSsreV' && header.toString('ascii', 16, 24) === 'IECSdaeH', 'Unsupported HD sound bank.');
  requireThat(header.readUInt32LE(28) === header.length && header.readUInt32LE(32) === body.length, 'The HD and BD bank sizes do not match.');
  const offset = header.readUInt32LE(48); range(header, offset, 20, 'HD VAG index');
  requireThat(header.toString('ascii', offset, offset + 8) === 'IECSigaV', 'Missing HD VAG index.');
  let count = header.readUInt32LE(offset + 12); requireThat(count <= 65535, 'Invalid sound count.'); range(header, offset + 16, (count + 1) * 4, 'HD sample offsets');
  if (header.readUInt32LE(offset + 16 + count * 4)) count++;
  const entries = Array.from({length: count}, (_, index) => {
    const p = offset + header.readUInt32LE(offset + 16 + index * 4); range(header, p, 8, 'HD sample');
    return {index, name: `Sample ${index + 1}`, offset: header.readUInt32LE(p), sampleRate: header.readUInt16LE(p + 4), loop: (header[p + 6] & 1) !== 0, channels: 1};
  }).filter(e => e.offset !== body.length);
  for (const e of entries) {
    const next = entries.find(other => other.offset > e.offset)?.offset ?? body.length; e.size = next - e.offset;
    requireThat(e.offset % 16 === 0 && e.size > 0 && e.size % 16 === 0 && e.sampleRate >= 4000 && e.sampleRate <= 96000, 'Invalid HD sample layout.'); range(body, e.offset, e.size, 'BD sample');
    e.samples = e.size / 16 * 28; e.duration = e.samples / e.sampleRate;
  }
  return {format: 'Sony HD/BD sound bank', samples: entries};
}

export function decodeSoundBank(header, body, index = 0) {
  const info = parseSoundBank(header, body).samples[index]; requireThat(info, 'Unknown sound-bank sample.');
  const pcm = Buffer.alloc(info.samples * 2); let previous = 0, older = 0, sampleIndex = 0;
  for (let p = info.offset; p < info.offset + info.size; p += 16) {
    const filter = body[p] >> 4, shift = body[p] & 15, flag = body[p + 1]; requireThat(filter <= 4 && shift <= 12 && flag <= 7, 'Unsupported PS ADPCM frame.');
    const [a, b] = psCoefficients[filter];
    for (let i = 0; i < 28; i++) {
      let nibble = i & 1 ? body[p + 2 + (i >> 1)] >> 4 : body[p + 2 + (i >> 1)] & 15; if (nibble >= 8) nibble -= 16;
      const sample = flag === 7 ? 0 : (nibble << 12 >> shift) + Math.floor((previous * a + older * b) / 64);
      pcm.writeInt16LE(clamp(sample), sampleIndex++ * 2); older = previous; previous = sample;
    }
  }
  return {pcm, ...info};
}

function encodePsFrame(pcm, sampleStart, previous, older) {
  let best;
  for (let filter = 0; filter < psCoefficients.length; filter++) for (let shift = 0; shift <= 12; shift++) {
    const [a, b] = psCoefficients[filter], nibbles = []; let p = previous, o = older, error = 0;
    for (let i = 0; i < 28; i++) {
      const sample = pcm.readInt16LE((sampleStart + i) * 2), prediction = Math.floor((p * a + o * b) / 64);
      const nibble = Math.max(-8, Math.min(7, Math.round((sample - prediction) / (1 << (12 - shift)))));
      const decoded = nibble * (1 << (12 - shift)) + prediction; error += (sample - clamp(decoded)) ** 2; nibbles.push(nibble & 15); o = p; p = decoded;
    }
    if (!best || error < best.error) best = {filter, shift, nibbles, previous: p, older: o, error};
  }
  return best;
}

/** Replace one bank sample, retaining its frame count and original loop/end flags. */
export async function importSoundBankWave(header, body, file, index = 0) {
  const info = parseSoundBank(header, body).samples[index]; requireThat(info, 'Unknown sound-bank sample.');
  const pcm = await convertAudioPcm(file, info.sampleRate, 1);
  requireThat(pcm.length === info.samples * 2, `Keep exactly ${info.samples} samples (${info.duration.toFixed(6)} seconds) for this bank slot.`);
  if (pcm.equals(decodeSoundBank(header, body, index).pcm)) return Buffer.from(body);
  const output = Buffer.from(body); let previous = 0, older = 0;
  for (let p = info.offset, sample = 0; p < info.offset + info.size; p += 16, sample += 28) {
    if (body[p + 1] === 7) {
      requireThat(pcm.subarray(sample * 2, (sample + 28) * 2).every(value => value === 0), 'Keep silence in the reserved ADPCM end frames.');
      previous = 0; older = 0; continue;
    }
    const frame = encodePsFrame(pcm, sample, previous, older); previous = frame.previous; older = frame.older;
    output[p] = (frame.filter << 4) | frame.shift;
    for (let i = 0; i < 14; i++) output[p + 2 + i] = frame.nibbles[i * 2] | (frame.nibbles[i * 2 + 1] << 4);
  }
  decodeSoundBank(header, output, index); return output;
}
