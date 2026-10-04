import fs from 'node:fs';
import {AnimationRangeCatalog} from './anm-ranges.mjs';
import path from 'node:path';
import {animationHeader, parseAnimation} from './animation.mjs';
import {parseMorphAnimations,matchingCutsceneMorph} from './morph-animation.mjs';
import {cutsceneAnimations, parseCutsceneAnimation} from './cutscene-animation.mjs';
import {modelLayout} from './model.mjs';
import {openArchive, entryBytes} from './archives.mjs';
import {requireThat, readRange} from './binary.mjs';

export class MotionLibrary {
  constructor(workbench) {
    this.workbench = workbench; this.ranges = new AnimationRangeCatalog(); this.external = new Map(); this.nextId = 0;
    this.packSources = new Map(); this.packClips = new Map();
  }
  model(key) {
    const data = this.workbench.bytes(key), h = modelLayout(data);
    const result = {modelId: data.readUInt32LE(4), morphCount: h.morphCount,
      parents: Array.from({length: h.boneCount}, (_, i) => data.readInt8(h.parentOffset + i))};
    if (result.modelId === 0x180 && result.parents.length === 73) {
      const canonical = this.workbench.snapshot().entries.find(entry => /(?:^|\/)chhaa\.mdl$/i.test(entry.name));
      if (canonical) {
        const reference = this.workbench.bytes(canonical.key), layout = modelLayout(reference);
        if (reference.readUInt32LE(4) === 0x100 && layout.boneCount === result.parents.length &&
            result.parents.every((parent, i) => parent === reference.readInt8(layout.parentOffset + i))) result.anmModelId = 0x100;
      }
    }
    return result;
  }
  compatible(model, clip) {
    const modelId = clip.sourceFormat !== 'pack' && clip.type !== 'morph' ? model.anmModelId ?? model.modelId : model.modelId;
    return clip.modelId === modelId && (clip.type !== 'morph' || clip.targetCount === model.morphCount) &&
      (clip.boneCount === undefined || clip.boneCount === model.parents.length);
  }
  metadata(clip, id = clip.id) {
    const actionCount = clip.type === 'skeletal' && clip.sourceFormat !== 'pack' ? this.actionRanges(clip, clip.name).ranges.length : 0;
    return {id, name: clip.name, type: clip.type, modelId: clip.modelId, frameCount: clip.frameCount, actionCount,
      sourceFormat: clip.sourceFormat || 'anm', sceneId: clip.sceneId, assetKey: clip.assetKey, sectionIndex: clip.sectionIndex, fps: 30};
  }
  source(key, label, read, version, assetKey) {
    if (!this.packSources.has(key)) this.packSources.set(key, {key, label, read, version, assetKey});
    return this.packSources.get(key);
  }
  assetSource(entry) {
    return this.source('asset:' + entry.key, `${entry.archiveName} · entry ${entry.index}`,
      () => this.workbench.bytes(entry.key), () => this.workbench.changes.get(entry.key)?.data || null, entry.key);
  }
  sourceClips(source) {
    const version = source.version();
    if (source.cache && source.cache.version === version) return source.cache.clips;
    const data = source.read();
    const candidates = [...cutsceneAnimations(data), ...parseMorphAnimations(data)];
    if (source.cache) for (const clip of source.cache.clips) this.packClips.delete(clip.id);
    const clips = candidates.map(clip => ({...clip, id: `cutscene:${++this.nextId}`, sourceFormat: 'pack',
      sceneId: source.key, assetKey: source.assetKey, name: `${source.label} · ${clip.name}`}));
    source.cache = {version, clips};
    for (const clip of clips) this.packClips.set(clip.id, {source, clip});
    return clips;
  }
  list(key) {
    const model = this.model(key), clips = [], unsupported = [];
    for (const entry of this.workbench.snapshot().entries) {
      if (/^anm_?$/.test(entry.extension)) {
        try {
          const header = animationHeader(this.workbench.bytes(entry.key));
          if (this.compatible(model, header)) clips.push(this.metadata({...header, type: 'skeletal', name: entry.name}, `asset:${entry.key}`));
        } catch (error) {unsupported.push({name: entry.name, reason: error.message});}
      } else if (entry.detectedFormat === 'pack') this.assetSource(entry);
    }
    for (const source of this.packSources.values()) {
      try {for (const clip of this.sourceClips(source)) if (this.compatible(model, clip)) clips.push(this.metadata(clip));}
      catch (error) {unsupported.push({name: source.label, reason: error.message});}
    }
    for (const [id, clip] of this.external) if (this.compatible(model, clip)) clips.push(this.metadata(clip, id));
    return {clips, unsupported};
  }
  validateSkeleton(model, header) {
    requireThat(this.compatible(model, header), 'This motion belongs to a different model or skeleton.');
    const canonical = header.model && this.workbench.snapshot().entries.find(e => e.name.endsWith('/' + header.model + '.mdl'));
    if (canonical) {
      const expected = this.model(canonical.key).parents;
      requireThat(expected.length === model.parents.length && expected.every((parent, i) => parent === model.parents[i]), 'ANM skeleton hierarchy does not match this model.');
    }
  }
  actionRanges(header, bankName) {
    const dataRoot = this.workbench.dataRoot || (this.workbench.catalogPath ? path.dirname(this.workbench.catalogPath) : null);
    return this.ranges.forBank({...header, bankName, dataRoot});
  }
  get(key, id) {
    const model = this.model(key);
    if (typeof id === 'string' && id.startsWith('asset:')) {
      const data = this.workbench.bytes(id.slice(6)), header = animationHeader(data);
      this.validateSkeleton(model, header);
      const name = this.workbench.get(id.slice(6)).entry.name;
      return {...parseAnimation(data, model.parents), ...this.actionRanges(header, name), sourceFormat: 'anm', name, id};
    }
    const packed = this.packClips.get(id);
    if (packed) {
      const {source, clip} = packed, available = this.sourceClips(source);
      requireThat(available.includes(clip), 'Cutscene source changed. Refresh the motion list before playing it.');
      this.validateSkeleton(model, clip);
      if (clip.type === 'morph') return clip;
      const motion = parseCutsceneAnimation(source.read(), clip.sectionIndex, model.modelId, model.parents);
      return {...motion, ...this.metadata(clip), morphClip: matchingCutsceneMorph(available,model.modelId,model.morphCount)};
    }
    const clip = this.external.get(id); requireThat(clip && this.compatible(model, clip), 'This motion is incompatible with the selected model.');
    this.validateSkeleton(model, clip);
    return {...parseAnimation(clip.data, model.parents), ...this.actionRanges(clip, clip.name), sourceFormat: 'anm', name: clip.name, id};
  }
  exchangeSource(key,id) {
    const clip=this.get(key,id);
    requireThat(clip.type==='skeletal','Select a skeletal animation. Matching facial motion is included with PACK exports.');
    if(clip.sourceFormat==='pack') {
      const record=this.packClips.get(id);
      return {clip,data:record.source.read(),target:record.source.assetKey};
    }
    requireThat(id.startsWith('asset:'),'Select an ANM from the asset library for exchange.');
    return {clip,data:this.workbench.bytes(id.slice(6)),target:id.slice(6)};
  }
  fileSource(file, index) {
    const archiveIndex = this.workbench.archives.findIndex(archive => path.resolve(archive.file) === file);
    if (index !== undefined && archiveIndex >= 0) {
      const entry = this.workbench.snapshot().entries.find(entry => entry.key === `${archiveIndex}:${index}`);
      return this.assetSource(entry);
    }
    const label = path.basename(file) + (index === undefined ? '' : ` · entry ${index}`);
    const read = () => index === undefined ? readRange(file, 0, fs.statSync(file).size) : entryBytes(openArchive(file), index);
    return this.source(`file:${file}:${index ?? 'pack'}`, label, read, () => {const stat = fs.statSync(file); return `${stat.size}:${stat.mtimeMs}`;});
  }
  open(key, file) {
    file = path.resolve(file);
    const model = this.model(key), extension = path.extname(file).toLowerCase(), name = path.basename(file);
    requireThat(!['.kg1', '.kg2'].includes(extension), 'KG1 / KG2 contain shadow geometry, not animation. Choose ANM or a cutscene AFS / PACK.');
    const candidates = [];
    if (/^\.anm_?$/.test(extension)) {
      const data = readRange(file, 0, fs.statSync(file).size), header = animationHeader(data);
      this.validateSkeleton(model, header); parseAnimation(data, model.parents);
      const clip = {...header, type: 'skeletal', sourceFormat: 'anm', name, data, id: `external:${++this.nextId}`};
      this.external.set(clip.id, clip); candidates.push(clip);
    } else if (extension === '.afs') {
      const archive = openArchive(file);
      for (const entry of archive.entries) {
        if (entry.size < 16) continue;
        const magic = readRange(file, entry.offset, 4).readUInt32LE(0);
        if (magic !== 0x12345678) continue;
        candidates.push(...this.sourceClips(this.fileSource(file, entry.index)));
      }
    } else {
      requireThat(['.pack', '.bin'].includes(extension), 'Choose an ANM, cutscene AFS or PACK file.');
      candidates.push(...this.sourceClips(this.fileSource(file)));
    }
    const matching = candidates.filter(clip => this.compatible(model, clip));
    requireThat(matching.length, `No compatible motion for model 0x${model.modelId.toString(16)} (${model.morphCount} morphs) in ${name}.`);
    return {clips: matching.map(clip => this.metadata(clip)), skipped: candidates.length - matching.length};
  }
}
