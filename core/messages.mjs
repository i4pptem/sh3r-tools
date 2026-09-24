import {requireThat, range, sha256} from './binary.mjs';

const decoder = new TextDecoder('windows-1252');
const characters = Array.from({length: 224}, (_, code) => decoder.decode(Uint8Array.of(code + 32)));
const latinCharacter = code => code < characters.length && !/[\u007f-\u009f]/.test(characters[code]) ? characters[code] : null;
const characterCodes = new Map(characters.flatMap((character, code) => latinCharacter(code) === null ? [] : [[character, code]]));
const word = code => {const data = Buffer.alloc(2); data.writeUInt16LE(code); return data;};

function parseMessage(data) {
  const segments = []; let cursor = 0, packed = false;
  const raw = hex => {
    if (segments.at(-1)?.kind === 'raw') segments.at(-1).hex += hex;
    else segments.push({kind: 'raw', hex});
  };
  const text = (value, encoding) => {
    if (segments.at(-1)?.kind === 'text' && segments.at(-1).encoding === encoding) segments.at(-1).text += value;
    else segments.push({kind: 'text', encoding, text: value});
  };
  while (cursor < data.length) {
    if (packed) {
      const code = data[cursor++];
      if (code === 255) {
        range(data, cursor, 1, 'Packed message command');
        const command = data[cursor++]; raw(Buffer.from([255, command]).toString('hex'));
        if (command === 255 || command === 0) {
          packed = false;
          const padding = cursor % 2 ? data.subarray(cursor, ++cursor).toString('hex') : '';
          segments.push({kind: 'align', hex: padding});
        }
      } else {
        const character = latinCharacter(code);
        if (character !== null) text(character, 'latin8'); else raw(Buffer.from([code]).toString('hex'));
      }
    } else {
      range(data, cursor, 2, 'Message glyph or command');
      const code = data.readUInt16LE(cursor); cursor += 2;
      if (code === 0x8000) {packed = true; raw('0080');}
      else {
        const character = latinCharacter(code);
        if (character !== null) text(character, 'glyph16'); else raw(word(code).toString('hex'));
      }
    }
  }
  return segments;
}

function preview(segments) {
  return segments.map(segment => {
    if (segment.kind === 'text') return segment.text;
    if (segment.kind === 'align') return '';
    const hex = segment.hex;
    if (hex === '0080' || hex === '0090') return '';
    if (hex === 'fffd' || hex === 'fdff') return '\n';
    if (hex === 'ffff') return '\n';
    return `<${hex.toUpperCase()}>`;
  }).join('').trim();
}

/** Decode the pointer table and editable Latin text while preserving every control and unmapped glyph. */
export function readMessages(data) {
  range(data, 0, 2, 'Message count');
  requireThat(data.length % 2 === 0, 'Message file has an incomplete word.');
  const count = data.readUInt16LE(0); range(data, 2, count * 2, 'Message pointers');
  requireThat(count <= 16384, 'Too many messages.');
  const offsets = Array.from({length: count}, (_, index) => data.readUInt16LE(2 + index * 2) * 2);
  for (const [index, offset] of offsets.entries()) requireThat(offset >= (count + 1) * 2 && offset <= data.length && (!index || offset >= offsets[index - 1]), 'Invalid message pointer order.');
  const prefix = data.subarray((count + 1) * 2, offsets[0] ?? data.length).toString('hex');
  const messages = offsets.map((offset, index) => {
    const segments = parseMessage(data.subarray(offset, offsets[index + 1] ?? data.length));
    return {index, text: preview(segments), segments};
  });
  return {format: 'sh3-messages-v1', sourceHash: sha256(data), count, prefix, messages};
}

/** Rebuild word offsets after text edits; control bytes and glyph encoding remain source-owned. */
export function replaceMessages(data, document) {
  const original = readMessages(data);
  requireThat(document?.format === original.format && document.sourceHash === original.sourceHash, 'Message document belongs to a different source asset.');
  requireThat(Array.isArray(document.messages) && document.messages.length === original.count, 'Keep the original message count and order.');
  requireThat(document.prefix === original.prefix, 'Keep the message table prefix unchanged.');
  const encoded = document.messages.map((message, index) => {
    const source = original.messages[index];
    requireThat(message.index === index && Array.isArray(message.segments) && message.segments.length === source.segments.length, 'Keep message segment order and control segments.');
    const chunks = []; let size = 0;
    for (const [i, segment] of message.segments.entries()) {
      const before = source.segments[i]; requireThat(segment.kind === before.kind, 'Keep message control segments unchanged.');
      let bytes;
      if (segment.kind === 'text') {
        requireThat(segment.encoding === before.encoding && typeof segment.text === 'string', 'Keep each text segment encoding.');
        const codes = [...segment.text].map(character => {
          const code = characterCodes.get(character);
          requireThat(code !== undefined, 'This character is outside the original Latin font mapping (Windows-1252). Preserve unmapped game glyphs as control segments.'); return code;
        });
        bytes = segment.encoding === 'latin8' ? Buffer.from(codes) : Buffer.concat(codes.map(word));
      } else if (segment.kind === 'align') {
        requireThat(segment.hex === before.hex, 'Keep message alignment metadata unchanged.');
        bytes = size % 2 ? Buffer.from(before.hex || '00', 'hex') : Buffer.alloc(0);
      } else {
        requireThat(segment.hex === before.hex, 'Keep raw message controls and unmapped glyphs unchanged.'); bytes = Buffer.from(segment.hex, 'hex');
      }
      size += bytes.length; chunks.push(bytes);
    }
    requireThat(size % 2 === 0, 'Edited message ends on an incomplete word.');
    return Buffer.concat(chunks);
  });
  const header = Buffer.alloc((original.count + 1) * 2), prefix = Buffer.from(original.prefix, 'hex');
  header.writeUInt16LE(original.count); let cursor = header.length + prefix.length;
  encoded.forEach((bytes, index) => {requireThat(cursor / 2 <= 65535, 'Message file exceeds its 16-bit pointer range.'); header.writeUInt16LE(cursor / 2, 2 + index * 2); cursor += bytes.length;});
  requireThat(cursor <= 131072, 'Message file exceeds its 16-bit address range.');
  const output = Buffer.concat([header, prefix, ...encoded]); readMessages(output); return output;
}
