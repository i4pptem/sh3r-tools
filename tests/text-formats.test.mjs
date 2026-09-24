import test from 'node:test';
import assert from 'node:assert/strict';
import {PNG} from 'pngjs';
import {readMessages, replaceMessages} from '../core/messages.mjs';
import {readFonts, replaceFont} from '../core/fonts.mjs';
import {fontSource} from '../core/font-hires.mjs';
import {readTextures, replaceTexture} from '../core/textures.mjs';
import {indexed4Address} from '../core/ps2-texture-address.mjs';

function messageFixture() {
  const one = Buffer.from('008021ffff000090', 'hex'), two = Buffer.from('008022fffd23ffff0090', 'hex');
  const header = Buffer.from([2, 0, 3, 0, (6 + one.length) / 2, 0]);
  return Buffer.concat([header, one, two]);
}
test('MES packed Latin and line controls preserve the source exactly', () => {
  const data = messageFixture(), doc = readMessages(data);
  assert.equal(doc.messages[0].text, 'A'); assert.equal(doc.messages[1].text, 'B\nC');
  assert.deepEqual(replaceMessages(data, doc), data);
});
test('MES text expansion rebuilds word pointers and packed alignment', () => {
  const data = messageFixture(), doc = readMessages(data);
  doc.messages[0].segments[1].text = 'An edited message';
  const output = replaceMessages(data, doc), parsed = readMessages(output);
  assert.equal(parsed.messages[0].text, 'An edited message'); assert.equal(parsed.messages[1].text, 'B\nC');
  assert.ok(output.readUInt16LE(4) > data.readUInt16LE(4));
});
test('MES accented text uses the verified Latin font mapping', () => {
  const data = messageFixture(), doc = readMessages(data); doc.messages[0].segments[1].text = 'éñü€';
  assert.equal(readMessages(replaceMessages(data, doc)).messages[0].text, 'éñü€');
});
test('MES rejects altered controls, different source and invalid pointers', () => {
  const data = messageFixture(), doc = readMessages(data); doc.messages[0].segments[0].hex = '0000';
  assert.throws(() => replaceMessages(data, doc), /controls/);
  doc.sourceHash = 'wrong'; assert.throws(() => replaceMessages(data, doc), /different source/);
  const broken = Buffer.from(data); broken.writeUInt16LE(1, 2); assert.throws(() => readMessages(broken), /pointer/);
});

function fontFixture() {
  const sections = [30, 24].map(height => {
    const table = Buffer.alloc(688); table[17] = 1; table.writeUInt16LE(172, 242);
    const bits = Buffer.alloc(Math.ceil(height * 3 / 32) * 4);
    for (let i = 0; i < height; i++) {const bit = i * 3; bits[bit >> 3] |= 6 << (bit & 7); if ((bit & 7) > 5) bits[(bit >> 3) + 1] |= 6 >> (8 - (bit & 7));}
    return Buffer.concat([table, bits]);
  });
  const header = Buffer.alloc(16); header.writeUInt32LE(16); header.writeUInt32LE(16 + sections[0].length, 4); header.writeUInt32LE(16 + sections[0].length + sections[1].length, 8);
  return Buffer.concat([header, ...sections, Buffer.from('opaque font metrics')]);
}
test('Font BIN atlases retain glyph IDs, dimensions and all original bytes', () => {
  const data = fontFixture(), fonts = readFonts(data); assert.equal(fonts.length, 2);
  assert.equal(fonts[0].glyphs[0].id, 1); assert.equal(fonts[0].glyphs[0].height, 30); assert.equal(fonts[1].glyphs[0].height, 24);
  for (const font of fonts) assert.deepEqual(replaceFont(data, font.index, font.png), data);
});
test('Font PNG repacking updates section pointers and preserves trailing metadata', () => {
  const data = fontFixture(), font = readFonts(data)[0], image = PNG.sync.read(font.png);
  for (let y = 0; y < 30; y++) image.data.fill(0, y * image.width * 4, y * image.width * 4 + 4);
  const output = replaceFont(data, 0, PNG.sync.write(image)), decoded = readFonts(output);
  assert.ok(output.length < data.length); assert.deepEqual(decoded[0].rgba, image.data);
  assert.deepEqual(decoded[1].rgba, readFonts(data)[1].rgba);
  assert.ok(output.subarray(output.readUInt32LE(8)).equals(data.subarray(data.readUInt32LE(8))));
});
test('Font importer rejects unsupported grays and painting outside glyph cells', () => {
  const data = fontFixture(), font = readFonts(data)[0], image = PNG.sync.read(font.png);
  image.data.set([30, 30, 30, 255], 0); assert.throws(() => replaceFont(data, 0, PNG.sync.write(image)), /gray values/);
  image.data.set([255, 255, 255, 255], 0); image.data.set([255, 255, 255, 255], 4);
  assert.throws(() => replaceFont(data, 0, PNG.sync.write(image)), /padding transparent/);
});

function indexedFixture(bits = 4, banks = 4) {
  const width = 128, height = 128, size = width * height * bits / 8, data = Buffer.alloc(32 + size + 48 + banks * 1024);
  data.writeUInt32LE(0xffffffff); data.writeUInt16LE(width, 8); data.writeUInt16LE(height, 10); data[12] = bits;
  data.writeUInt32LE(size, 16); data.writeUInt32LE(size + 32, 20); data.writeUInt16LE(0x9999, 30);
  const end = size + 32; data.writeUInt32LE(banks * 1024, end); data[end + 12] = banks; data[end + 14] = 64;
  data.set([255, 0, 0, 128, 0, 255, 0, 128], end + 48);
  return data;
}
test('PSMT4 address conversion is a bounded bijection across multiple pages', () => {
  const width = 256, height = 256, seen = new Set();
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {const nibble = indexed4Address(x, y, width); assert.ok(nibble >= 0 && nibble < width * height); seen.add(nibble);}
  assert.equal(seen.size, width * height); assert.equal(indexed4Address(0, 0, width), 0); assert.equal(indexed4Address(0, 2, width), 33);
});
test('Four-bit PNG edit stays inside its pixel and palette allocation', () => {
  const data = indexedFixture(), image = readTextures(data)[0]; assert.match(image.format, /4-bit/);
  assert.deepEqual(replaceTexture(data, 0, image.png), data);
  const edited = PNG.sync.read(image.png); edited.data.set([0, 255, 0, 255], (100 * 128 + 80) * 4);
  const output = replaceTexture(data, 0, PNG.sync.write(edited)); assert.equal(output.length, data.length); assert.deepEqual(readTextures(output)[0].rgba, edited.data);
  assert.deepEqual(output.subarray(0, 32), data.subarray(0, 32));
});
test('Palette variants share indices and reject an inconsistent per-pixel recolor', () => {
  const data = indexedFixture(8, 8), palette = 32 + 128 * 128 + 48; data.set([0, 0, 255, 128], palette + 64);
  const textures = readTextures(data); assert.equal(textures.length, 2);
  assert.deepEqual([...textures[1].rgba.subarray(0, 4)], [0, 0, 255, 255]);
  const image = PNG.sync.read(textures[1].png); image.data.set([255, 0, 255, 255], 0);
  assert.throws(() => replaceTexture(data, 1, PNG.sync.write(image)), /shares indices/);
});
test('Empty TEX wrapper returns an empty image collection', () => {
  const data = Buffer.alloc(64); data.writeUInt32LE(0xa7a7a7a7, 12); assert.deepEqual(readTextures(data), []);
});


test('hires fonts preserve native data and metrics while retaining full drawable coverage',()=>{
  const original=fontFixture(),normal=readFonts(original)[0];
  for(const scale of [2,4]) {
    const image={width:normal.width*scale,height:normal.height*scale,data:Buffer.alloc(normal.width*normal.height*scale*scale*4)};
    const set=(x,y,color)=>image.data.set(color,(y*image.width+x)*4);
    set(15*scale,3*scale,[255,255,255,255]);
    set(2*scale,2*scale,[128,128,128,128]);
    set(21*scale,2*scale,[255,255,255,255]);
    const output=replaceFont(original,0,PNG.sync.write(image),{highResolution:true}),parts=fontSource(output),decoded=readFonts(output);
    assert.deepEqual(parts.native,original);assert.equal(parts.fonts[0].scale,scale);assert.equal(parts.fonts[1],null);
    assert.equal(decoded[0].width,normal.width*scale);assert.equal(decoded[0].height,normal.height*scale);
    assert.equal(decoded[0].rgba[(3*scale*image.width+15*scale)*4],255,'Draw area must extend beyond advance width.');
    assert.equal(decoded[0].rgba[(2*scale*image.width+2*scale)*4],64);
    assert.equal(decoded[0].rgba[(2*scale*image.width+21*scale)*4+3],0,'Cell padding is not drawable.');
    assert.deepEqual(decoded[1].rgba,readFonts(original)[1].rgba);
    assert.deepEqual(replaceFont(output,0,decoded[0].png),output,'Repeated high-resolution imports must be byte-exact.');
  }
});

test('native edits to the other font relocate the extension without changing high-resolution coverage',()=>{
  const source=fontFixture(),normal=readFonts(source)[0],scale=2;
  const image={width:normal.width*scale,height:normal.height*scale,data:Buffer.alloc(normal.width*normal.height*scale*scale*4)};
  image.data.set([255,255,255,255]);const high=replaceFont(source,0,PNG.sync.write(image),{highResolution:true});
  const small=PNG.sync.read(readFonts(source)[1].png);small.data.fill(0);
  const edited=replaceFont(high,1,PNG.sync.write(small));
  assert.notEqual(edited.readUInt32LE(12),high.readUInt32LE(12));
  assert.deepEqual(fontSource(edited).fonts[0],fontSource(high).fonts[0]);
  assert.deepEqual(readFonts(edited)[1].rgba,small.data);
});

test('hires font parsing rejects damaged pointers, truncated payloads and unsupported scales',()=>{
  const source=fontFixture(),normal=readFonts(source)[0],image={width:normal.width*2,height:normal.height*2,data:Buffer.alloc(normal.width*normal.height*16)};
  const data=replaceFont(source,0,PNG.sync.write(image),{highResolution:true}),start=data.readUInt32LE(12),at=data.readUInt32LE(start+16)+start;
  for(const [offset,value]of [[at,3],[at+8,0],[at+12,0],[start+8,data.length]]){const damaged=Buffer.from(data);damaged.writeUInt32LE(value,offset);assert.throws(()=>readFonts(damaged));}
  assert.throws(()=>readFonts(data.subarray(0,data.length-1)),/length/);
  assert.throws(()=>replaceFont(source,0,normal.png,{highResolution:true}),/2× or 4×/);
});
