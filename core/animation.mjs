import {decodeNativeShort} from './anm-codec.mjs';
import {requireThat, range} from './binary.mjs';

// Fixed frame strides are format facts from Murugo's SH3 reader, checked against PC assets.
export const ANM_MODELS = new Map(Object.entries({
  256: [264, 'chhaa'], 258: [734, 'chcaa'], 259: [480, 'chvaa'], 260: [502, 'chdcc'],
  512: [190, 'en_one'], 513: [104, 'en_ckn'], 514: [144, 'en_aid'], 515: [220, 'en_nse'],
  516: [150, 'en_deb'], 517: [134, 'en_fly'], 518: [208, 'en_ap2'], 519: [116, 'en_rod'],
  520: [34, 'en_ded1'], 521: [46, 'en_mry'], 522: [138, 'en_lie'], 523: [122, 'en_lix'],
  528: [240, 'en_smb'], 529: [208, 'en_apb'], 530: [284, 'en_spi'], 531: [208, 'en_hpb'],
  532: [558, 'en_shb'], 533: [278, 'en_bhr'], 4124: [34, 'bg_fre'], 4126: [138, 'bg_huo'],
  4127: [284, 'bg_spi'], 4128: [70, 'bg_mes'], 4132: [146, 'bg_sya'], 4147: [22, 'it_dagger'],
  4152: [46, 'bg_ded1'], 4157: [128, 'en_zbb'], 4158: [70, 'bg_slv'], 4163: [52, 'bg_ddd'],
  4174: [22, 'it_radio2'], 4175: [168, 'bg_lyc'],
}).map(([id, [stride, model]]) => [Number(id), {stride, model}]));


/** Reject retired appended-Action banks before preview, import or mod build. */
export function assertFixedAnimation(buffer) {
  requireThat(!buffer.subarray(-8).equals(Buffer.from('SH3ANM1\0')), 'This ANM uses the removed Action-length extension. Restore the original ANM and reimport the edited motion into its existing range with Fit enabled.');
}

export function animationHeader(buffer) {
  range(buffer, 0, 4, 'ANM header');
  const modelId = buffer.readUInt32LE(0), info = ANM_MODELS.get(modelId);
  requireThat(info, `Unsupported ANM model ID 0x${modelId.toString(16)}.`);
  assertFixedAnimation(buffer);
  const frameCount = (buffer.length - 4) / info.stride;
  requireThat(Number.isInteger(frameCount) && frameCount > 0 && frameCount <= 200000, 'ANM size does not match its fixed frame layout.');
  return {modelId, frameCount, ...info};
}

/** Decode absolute local poses. NaN slots retain the model's bind-local component. */
export function parseAnimation(buffer, parents) {
  const header = animationHeader(buffer), boneCount = parents.length;
  requireThat(boneCount > 0 && boneCount <= 256 && header.frameCount * boneCount <= 4000000, 'Animation exceeds preview limits.');
  const rotations = new Float32Array(header.frameCount * boneCount * 4).fill(NaN);
  const translations = new Float32Array(header.frameCount * boneCount * 3).fill(NaN);
  const animated = new Set(), masks = new Uint8Array(boneCount);
  for (let frame = 0; frame < header.frameCount; frame++) {
    let offset = 4 + frame * header.stride, group = 0;
    const end = offset + header.stride;
    const need = size => requireThat(offset + size <= end, `ANM frame ${frame} exceeds its boundary.`);
    while (offset < end) {
      need(4); const flags = buffer.readUInt32LE(offset); offset += 4;
      for (let slot = 0; slot < 8; slot++) {
        const flag = flags >>> (slot * 4) & 7, bone = group * 8 + slot;
        if (!flag) {requireThat(frame === 0 || !masks[bone], 'ANM changes its animated bone layout between frames.'); continue;}
        requireThat([1, 2, 5, 6].includes(flag) && bone < boneCount, `Unsupported ANM bone ${bone} or flag ${flag}.`);
        const mask = flag & 3;
        if (frame === 0) masks[bone] = mask;
        else requireThat(masks[bone] === mask, 'ANM changes its animated bone layout between frames.');
        animated.add(bone);
        if (flag & 2) {
          const width = parents[bone] < 0 ? 4 : 2; need(width * 3);
          for (let k = 0; k < 3; k++) {
            const value = width === 4 ? buffer.readFloatLE(offset + k * width) : decodeNativeShort(buffer.readUInt16LE(offset + k * width));
            requireThat(Number.isFinite(value), 'Non-finite ANM translation.'); translations[(frame * boneCount + bone) * 3 + k] = value;
          }
          offset += width * 3;
        }
        need(6); const q = [0, 2, 4].map(k => buffer.readInt16LE(offset + k) / 32768); offset += 6;
        const xyz = q.reduce((sum, value) => sum + value * value, 0);
        // Quantization can put a unit quaternion just outside the unit sphere.
        requireThat(xyz <= 1.0001, 'Invalid ANM rotation.');
        q.push(Math.sqrt(Math.max(0, 1 - xyz)) * (flag & 4 ? -1 : 1));
        const length = Math.hypot(...q); rotations.set(q.map(v => v / length), (frame * boneCount + bone) * 4);
      }
      group++; requireThat(group <= Math.ceil(boneCount / 8), 'ANM has too many bone groups.');
    }
  }
  return {type: 'skeletal', ...header, boneCount, rotations, translations, animatedBones: [...animated], fps: 30};
}
