import fs from 'node:fs';
import path from 'node:path';
import {animationHeader, parseAnimation} from './animation.mjs';
import {parseMorphAnimations} from './morph-animation.mjs';
import {modelLayout} from './model.mjs';
import {openArchive, entryBytes} from './archives.mjs';
import {requireThat, readRange} from './binary.mjs';

export class MotionLibrary {
  constructor(workbench) {this.workbench = workbench; this.external = new Map(); this.nextId = 0;}
  model(key) {
    const data = this.workbench.bytes(key), h = modelLayout(data);
    return {modelId: data.readUInt32LE(4), morphCount: h.morphCount,
      parents: Array.from({length: h.boneCount}, (_, i) => data.readInt8(h.parentOffset + i))};
  }
  compatible(model, clip) {return clip.modelId === model.modelId && (clip.type !== 'morph' || clip.targetCount === model.morphCount);}
  metadata(clip, id) {return {id, name: clip.name, type: clip.type, modelId: clip.modelId, frameCount: clip.frameCount, fps: 30};}
  list(key) {
    const model = this.model(key), clips = [], unsupported = [];
    for (const entry of this.workbench.snapshot().entries.filter(e => /^anm_?$/.test(e.extension))) {
      try {
        const header = animationHeader(this.workbench.bytes(entry.key));
        if (this.compatible(model, header)) clips.push(this.metadata({...header, type: 'skeletal', name: entry.name}, `asset:${entry.key}`));
      } catch (error) {
        unsupported.push({name: entry.name, reason: error.message});
      }
    }
    for (const [id, clip] of this.external) if (this.compatible(model, clip)) clips.push(this.metadata(clip, id));
    return {clips, unsupported};
  }
  validateSkeleton(model, header) {
    requireThat(this.compatible(model, header), 'This ANM belongs to a different model.');
    const canonical = this.workbench.snapshot().entries.find(e => e.name.endsWith('/' + header.model + '.mdl'));
    if (canonical) {
      const expected = this.model(canonical.key).parents;
      requireThat(expected.length === model.parents.length && expected.every((parent, i) => parent === model.parents[i]), 'ANM skeleton hierarchy does not match this model.');
    }
  }
  get(key, id) {
    const model = this.model(key);
    if (typeof id === 'string' && id.startsWith('asset:')) {
      const data = this.workbench.bytes(id.slice(6)), header = animationHeader(data);
      this.validateSkeleton(model, header);
      return {...parseAnimation(data, model.parents), name: this.workbench.get(id.slice(6)).entry.name, id};
    }
    const clip = this.external.get(id); requireThat(clip && this.compatible(model, clip), 'This motion is incompatible with the selected model.');
    if (clip.data) {this.validateSkeleton(model, clip); return {...parseAnimation(clip.data, model.parents), name: clip.name, id};}
    return {...clip, id};
  }
  open(key, file) {
    const model = this.model(key), extension = path.extname(file).toLowerCase(), name = path.basename(file);
    requireThat(!['.kg1', '.kg2'].includes(extension), 'KG1 / KG2 contain shadow geometry, not animation. Choose ANM or a cutscene AFS / PACK.');
    const candidates = [];
    if (/^\.anm_?$/.test(extension)) {
      const data = readRange(file, 0, fs.statSync(file).size), header = animationHeader(data);
      candidates.push({...header, type: 'skeletal', name, data});
    } else if (extension === '.afs') {
      const archive = openArchive(file);
      for (const entry of archive.entries) {
        // PACK tables start at byte zero; audio/video entries have unrelated signatures.
        if (entry.size < 16) continue;
        const magic = readRange(file, entry.offset, 4).readUInt32LE(0);
        if (![0x12345678, 0x29843918, 0x29853918].includes(magic)) continue;
        const clips = parseMorphAnimations(entryBytes(archive, entry.index));
        for (const clip of clips) candidates.push({...clip, type: 'morph', name: `${name} · entry ${entry.index} · ${clip.name}`});
      }
    } else {
      requireThat(['.pack', '.bin'].includes(extension), 'Choose an ANM, cutscene AFS or PACK file.');
      for (const clip of parseMorphAnimations(readRange(file, 0, fs.statSync(file).size))) candidates.push({...clip, type: 'morph', name: `${name} · ${clip.name}`});
    }
    const matching = candidates.filter(clip => this.compatible(model, clip));
    requireThat(matching.length, `No compatible motion for model 0x${model.modelId.toString(16)} (${model.morphCount} morphs) in ${name}.`);
    const added = [];
    for (const clip of matching) {if (clip.data) {this.validateSkeleton(model, clip); parseAnimation(clip.data, model.parents);} const id = `external:${++this.nextId}`; this.external.set(id, clip); added.push(this.metadata(clip, id));}
    return {clips: added, skipped: candidates.length - matching.length};
  }
}
