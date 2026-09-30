import {workspaceSources, changedSources, assertSources} from './source-state.mjs';
import {prepareSourceReload, validateSourceReload} from './source-reload.mjs';
import {loadModelFile} from './model-import.mjs';
import {modelTexturePlan} from './model-textures.mjs';
import {TextureLibrary} from './texture-library.mjs';
import {characterRequirements, isCharacterAsset} from './character-requirements.mjs';
import {animationExchange,replaceAnimation} from './animation-exchange.mjs';
import {cutsceneExchange,replaceCutsceneAnimation} from './cutscene-exchange.mjs';
import {blenderExchange} from './blender-bridge.mjs';
import {exportMapPart, importMapPart} from './map-part.mjs';
import {mapPartReplacementIssue} from './map-repack.mjs';
import {editMap, importMapGlb} from './map-edit.mjs';
import {rebuildTexture, rebuildModelTextures, syncModelImageTable} from './texture-rebuild.mjs';
import {mapAsset} from './map-materials.mjs';
import {assetFormat} from './asset-format.mjs';
import {exportArchive, exportAllArchives} from './archive-export.mjs';
import {parseMorphAnimations} from './morph-animation.mjs';
import {cutsceneAnimations} from './cutscene-animation.mjs';
import {openWorkspace} from './workspace.mjs';
import fs from 'node:fs';
import os from 'node:os';
import {inspectWorld} from './world-formats.mjs';
import {parseAdx, decodeAdx, parseAix, decodeAix, parseSoundBank, decodeSoundBank, waveFile, importAixWave, importSoundBankWave} from './audio.mjs';
import {readMessages, replaceMessages} from './messages.mjs';
import {fontSource} from './font-hires.mjs';
import {readFonts, replaceFont} from './fonts.mjs';
import {modelTemplate} from './model-provenance.mjs';
import {replacementInfo, rebuildModel} from './model-rebuild.mjs';
import {looseBytes, sourceRecord, verifySource, buildLoose} from './loose-files.mjs';
import {decodeMovie, createMoviePreview, exportMovie, importMovie} from './media.mjs';
import {MotionLibrary} from './motion-library.mjs';
import path from 'node:path';
import {entryBytes, buildArchive} from './archives.mjs';
import {parseModel, modelLayout, morphDocument, replaceMorphs} from './model.mjs';
import {STOCK_MORPH_NODES, MODEL_LIMITS} from './model-limits.mjs';
import {modelTextureRequirements} from './model-texture-requirements.mjs';
import {MODEL_TEXTURE_LIMITS} from './model-limits.mjs';
import {expandRuntimeBuffers, PRIMARY_LIMITS, SECONDARY_LIMITS, PICTURE_LIMITS} from './runtime-buffers.mjs';
import {readTextures, replaceTexture} from './textures.mjs';
import {exportGlb, importGlb} from './gltf.mjs';
import {requireThat, sha256, fileHash, readRange, writeNew, safeOutput, MAX_ASSET} from './binary.mjs';

export function assetKind(extension) {
  if (extension === '000') return 'video';
  if (['map', 'cld', 'cam', 'ded', 'sdb', 'sbd'].includes(extension)) return 'world';
  if (['mdl', 'mdl_'].includes(extension)) return 'model';
  if (['tex', 'pic', 'dat', 'tbn2', 'png', 'dds', 'bmp', 'jpg', 'jpeg'].includes(extension)) return 'texture';
  if (['wav', 'ogg', 'adx', 'mp3', 'flac', 'bd', 'hd', 'aix'].includes(extension)) return 'audio';
  if (['anm', 'an2', 'anm_', 'pack', 'cluster'].includes(extension)) return 'animation';
  if (['mes', 'txt', 'fnt', 'font'].includes(extension)) return 'text';
  return 'binary';
}

export class Workbench {
  constructor(progress = () => {}, cacheFolder = path.join(os.tmpdir(), 'sh3tools-media-cache')) { this.sources = []; this.reloadPlan = null; this.archives = []; this.changes = new Map(); this.input = null; this.catalogPath = null; this.dataRoot = null; this.progress = progress; this.motion = new MotionLibrary(this); this.cacheFolder = cacheFolder; this.modelPlan = null; this.animationPlan = null; this.mapHistory = new Map(); this.textureLibrary = new TextureLibrary(this); }
  open(input) {
    const workspace = openWorkspace(input), sources = workspaceSources(workspace);
    assertSources(sources);
    Object.assign(this, workspace); this.sources = sources; this.reloadPlan = null; this.textureLibrary.reset(); this.mapHistory.clear(); this.changes.clear(); this.modelPlan = null; this.animationPlan = null; this.motion = new MotionLibrary(this);
    return this.snapshot();
  }
  sourceChanges() {return changedSources(this.sources);}
  assertSources() {assertSources(this.sources);}
  prepareSourceReload() {
    this.reloadPlan = prepareSourceReload(this);
    const {token, changes, conflicts, installed} = this.reloadPlan;
    return {token, kept: changes.size, conflicts, installed};
  }
  reloadSources(token, discardConflicts = false) {
    const plan = this.reloadPlan;
    validateSourceReload(this, plan, token, discardConflicts);
    Object.assign(this, plan.workspace); this.sources = plan.sources; this.changes = plan.changes;
    this.textureLibrary.reset(); this.mapHistory.clear(); this.modelPlan = null; this.animationPlan = null;
    this.motion = new MotionLibrary(this); this.reloadPlan = null;
    return {...this.snapshot(), keyMap: plan.keyMap, reloadSummary: {kept: plan.changes.size, installed: plan.installed.length, discarded: plan.conflicts.length}};
  }
  get(key) {
    requireThat(typeof key === 'string' && /^\d+:\d+$/.test(key), 'Invalid asset selection.');
    const [a, index] = key.split(':').map(Number), archive = this.archives[a];
    requireThat(archive?.entries[index], 'Asset is no longer open.'); return {archive, entry: archive.entries[index]};
  }
  originalBytes(archive, entry) {return archive.format === 'FOLDER' ? looseBytes(entry) : entryBytes(archive, entry.index);}
  bytes(key) {const {archive, entry} = this.get(key); return this.changes.get(key)?.data || this.originalBytes(archive, entry);}
  format(key) {const {entry} = this.get(key), changed = this.changes.get(key); return changed ? assetFormat(changed.data, entry.extension) : entry.detectedFormat || entry.extension;}
  textureOptions(key) {return {picture: /(?:^|\/)data\/pic\//i.test(this.get(key).entry.name.replaceAll('\\', '/'))};}
  textureCatalog(force) {return this.textureLibrary.catalog(force);}
  textureThumbnails(ids) {return this.textureLibrary.thumbnailBatch(ids);}
  texturePreview(id) {return this.textureLibrary.preview(id);}
  replaceLibraryTexture(id, hash, file, mode) {return this.textureLibrary.replace(id, hash, file, mode);}
  exportLibraryTexture(id, hash, file) {return this.textureLibrary.export(id, hash, file);}
  textureAsset(key) {return readTextures(this.bytes(key), ['mdl', 'mdl_'].includes(this.get(key).entry.extension), this.textureOptions(key));}
  worldAsset(key) {
    const {entry} = this.get(key), data = this.bytes(key);
    if (entry.extension !== 'map') return inspectWorld(data, entry.extension);
    const entries = this.snapshot().entries;
    const world = mapAsset(data, entry.name, name => {
      const companion = entries.find(e => e.name.toLowerCase() === 'data/tmp/' + name.toLowerCase());
      return companion ? {key: companion.key, name: companion.name, data: this.bytes(companion.key)} : null;
    });
    for (const mesh of world.model.meshes) mesh.replacementIssue = mapPartReplacementIssue(data,mesh) || ((mesh.textureSource===2 || mesh.transparency===1) ? 'Transparent part: new topology must stay within the original triangle budget.' : null);
    return world;
  }
  exportArchive(id, folder, mode) {return exportArchive(this, id, folder, mode);}
  exportAllArchives(folder, mode) {return exportAllArchives(this, folder, mode);}
  snapshot() {
    return {textureRevision: this.textureLibrary.revision, input: this.input, dataRoot: this.dataRoot, archiveCount: this.archives.length,
      archives: this.archives.map((a, i) => ({id: i, section: a.section, name: a.name, format: a.format, size: a.size, count: a.entries.length})),
      entries: this.archives.flatMap((a, i) => a.entries.map(e => ({key: `${i}:${e.index}`, archive: i, section: a.section, archiveName: a.name, index: e.index, name: e.name,
        extension: e.extension, detectedFormat: this.format(`${i}:${e.index}`), kind: assetKind(this.format(`${i}:${e.index}`)), size: e.size, offset: e.offset, fileId: e.fileId,
        changed: this.changes.has(`${i}:${e.index}`), newSize: this.changes.get(`${i}:${e.index}`)?.data.length}))),
      changes: [...this.changes].map(([key, c]) => ({key, name: this.get(key).entry.name, label: c.label, originalSize: this.get(key).entry.size, size: c.data.length}))};
  }
  mapReference(key) {const {archive,entry}=this.get(key); return this.originalBytes(archive,entry);}
  stageMap(key, data, label, targetKey=key) {
    const before=this.bytes(targetKey);if(data.equals(before))return this.snapshot();
    const history=[...(this.mapHistory.get(key)||[]),{key:targetKey,data:Buffer.from(before),afterHash:sha256(data)}];
    while(history.length>20 || (history.length>1 && history.reduce((n,edit)=>n+edit.data.length,0)>64*1024*1024))history.shift();
    const result=this.stage(targetKey,data,label);this.mapHistory.set(key,history);return result;
  }
  editMap(key, hash, edits) {
    requireThat(this.format(key)==='map' && sha256(this.bytes(key))===hash,'Map changed. Select it again before editing.');
    requireThat(Array.isArray(edits) && edits.length <= 50000, 'Invalid map edit list.');
    let data = this.bytes(key); const reference = this.mapReference(key);
    for (const edit of edits) data = editMap(data, edit, reference);
    return this.stageMap(key, data, 'MAP part / material edits');
  }
  exportMapPart(key, part, file) {
    requireThat(this.format(key)==='map','Select a MAP asset.');
    writeNew(file,exportMapPart(this.worldAsset(key),part)); return {file};
  }
  importMapPart(key, hash, part, file) {
    requireThat(this.format(key)==='map' && sha256(this.bytes(key))===hash,'Map changed. Select it again before editing.');
    const data=importMapPart(this.bytes(key),part,readRange(file,0,fs.statSync(file).size),this.mapReference(key));
    return this.stageMap(key,data,'MAP part from GLB: '+part);
  }
  replaceMapTexture(key, hash, index, file) {
    requireThat(this.format(key)==='map' && sha256(this.bytes(key))===hash, 'Map changed. Select it again before editing.');
    const texture = this.worldAsset(key).textures[index]; requireThat(texture, 'Select a resolved map texture.');
    const sourceKey = texture.sourceKey ?? key, data = this.bytes(sourceKey), offset = texture.sourceOffset;
    const png = readRange(file, 0, fs.statSync(file).size);
    const fragment = replaceTexture(data.subarray(offset), texture.sourceIndex, png, false, {adapt:true});
    const output = Buffer.from(data); fragment.copy(output, offset);
    return this.stageMap(key,output,sourceKey===key?'MAP embedded texture':'Shared MAP texture: '+path.basename(file),sourceKey);
  }
  undoMap(key) {
    const history=[...(this.mapHistory.get(key)||[])]; requireThat(history.length,'No map edits to undo in this session.');
    const previous=history.pop(); requireThat(sha256(this.bytes(previous.key))===previous.afterHash,'This asset changed outside the map editor. Undo its later edits first.');
    const result=this.stage(previous.key,previous.data,'MAP edit'); this.mapHistory.set(key,history); return result;
  }
  morphWorkspaceMetadata(key) {
    const data=modelTemplate(this.bytes(key));return {templateHash:sha256(data.subarray(0,data.readUInt32LE(12))),meshNames:parseModel(this.bytes(key)).meshes.map(mesh=>mesh.name)};
  }
  async exportMorphWorkspace(key,file) {
    const data=this.bytes(key),model=parseModel(data);requireThat(model.morphNames.length,'This model has no native morph targets.');
    const result=await blenderExchange({script:'morph_workspace',mode:'export',outputType:'blend',metadata:this.morphWorkspaceMetadata(key)},exportGlb(model,readTextures(data,true)),this.cacheFolder,this.progress);
    writeNew(file,result.data);return {file,...result.report};
  }
  async prepareMorphWorkspace(key,file) {
    const result=await blenderExchange({script:'morph_workspace',mode:'import',input:path.resolve(file),outputType:'glb',metadata:this.morphWorkspaceMetadata(key)},null,this.cacheFolder,this.progress);
    return this.prepareModelBytes(key,result.data);
  }
  async importModel(key, file) {
    const input = await loadModelFile(file, this.cacheFolder, this.progress), data = this.bytes(key);
    const textures = modelTexturePlan(data, input), glb = textures.glb;
    if (textures.added) return {...this.prepareModelBytes(key, glb, textures), modelImport: 'rebuild'};
    let edited;
    try {edited = importGlb(data, glb);}
    catch {return {...this.prepareModelBytes(key, glb, textures), modelImport: 'rebuild'};}
    const output = rebuildModelTextures(edited, textures.replacements);
    return {...this.stage(key, output, 'Model and textures: ' + path.basename(file)), modelImport: 'attributes', importedTextures: textures.summary};
  }
  prepareModelBytes(key,glb,textures) {
    const data=this.bytes(key); textures ||= modelTexturePlan(data,glb); glb = textures.glb;
    const info=replacementInfo(data,glb,textures.count);
    const token = sha256(Buffer.concat([Buffer.from(key + Date.now()), glb]));
    this.modelPlan = {key, glb, textures, sourceHash: sha256(data), token}; return {token, ...info, importedTextures: textures.summary, newTextureSlots: textures.added};
  }
  modelTemplates(key, token, file) {
    const plan=this.modelPlan, current=this.bytes(key);
    requireThat(plan && plan.key===key && plan.token===token && plan.sourceHash===sha256(current),'Prepare the replacement model again.');
    const original=modelTemplate(readRange(file,0,fs.statSync(file).size)), model=parseModel(original), existing=parseModel(current);
    requireThat(model.modelId===existing.modelId && model.morphNames.length===existing.morphNames.length && model.textureCount<=existing.textureCount,'Choose the original MDL for this same character.');
    requireThat(JSON.stringify(model.bones)===JSON.stringify(existing.bones),'Original template skeleton differs from this model.');
    let template=Buffer.concat([original.subarray(0,original.readUInt32LE(12)),current.subarray(current.readUInt32LE(12))]);
    template.writeUInt32LE(current.readUInt32LE(8),8); template=syncModelImageTable(template);
    const info=replacementInfo(template,plan.glb,plan.textures.count); plan.template=template; return {...info,token,importedTextures:plan.textures.summary,newTextureSlots:plan.textures.added};
  }
  rebuildModel(key, token, selection) {
    const plan = this.modelPlan, data = this.bytes(key);
    requireThat(plan && plan.key === key && plan.token === token && plan.sourceHash === sha256(data), 'The model changed. Prepare the replacement again.');
    const rebuilt = rebuildModel(plan.template || data, plan.glb, selection, plan.textures); this.modelPlan = null; this.animationPlan = null;
    const snapshot = this.stage(key, rebuilt.data, 'Rebuilt topology and native morphs (runtime test required)');
    const change = this.changes.get(key); if (change) change.rebuildReport = rebuilt.report;
    return {...snapshot, rebuildReport: rebuilt.report};
  }
  animationSource(key,id) {
    return {model:parseModel(this.bytes(key)),...this.motion.exchangeSource(key,id)};
  }
  animationExchange(source,start,end,fps) {
    const {model,data,clip}=source;
    return clip.sourceFormat==='pack'?cutsceneExchange(model,data,clip.sectionIndex,clip.modelId,start,end,fps):animationExchange(model,data,start,end,fps);
  }
  async exportAnimation(key,id,start,end,fps,file) {
    const source=this.animationSource(key,id),exchange=this.animationExchange(source,start,end,fps);
    exchange.metadata.bankName=source.clip.sourceFormat==='pack'?source.clip.name:this.get(source.target).entry.name;
    const outputType=path.extname(file).slice(1).toLowerCase();
    requireThat(['fbx','blend'].includes(outputType), 'Choose FBX or Blender animation output.');
    const result=await blenderExchange({script:'animation_exchange',mode:'export',outputType,metadata:exchange.metadata},exportGlb(source.model,readTextures(this.bytes(key),true),exchange),this.cacheFolder,this.progress);
    writeNew(file,result.data);return {file,...result.report};
  }
  async prepareAnimationImport(key,id,file) {
    const source=this.animationSource(key,id),{data,target,clip}=source;
    requireThat(target,'Open this cutscene AFS through the data folder or asset library before replacing animation. External motion files are preview/export sources.');
    const identity=this.animationExchange(source,0,0,30);
    const result=await blenderExchange({script:'animation_exchange',mode:'import',input:path.resolve(file),outputType:'json',skeletonHash:identity.metadata.skeletonHash},null,this.cacheFolder,this.progress);
    const exchange=JSON.parse(result.data.toString('utf8')),token=sha256(result.data),bankName=clip.sourceFormat==='pack'?clip.name:this.get(target).entry.name;
    requireThat((exchange.metadata.format||'anm')===clip.sourceFormat,'Import an animation exported from the same format: ANM for gameplay, PACK for cutscenes.');
    this.animationPlan={key,id,target,exchange,token,modelHash:sha256(this.bytes(key)),bankHash:sha256(data)};
    return {token,format:clip.sourceFormat,sourceFile:path.basename(file),sourceBank:exchange.metadata.bankName,targetBank:bankName,
      sameBank:bankName===exchange.metadata.bankName&&(clip.sourceFormat!=='pack'||exchange.metadata.sectionIndex===clip.sectionIndex),
      sourceStart:exchange.sampleStart,sourceEnd:exchange.sampleEnd,exportStart:exchange.metadata.start,targetFrames:identity.metadata.frameCount,fps:exchange.metadata.fps,...result.report};
  }
  applyAnimationImport(key,id,token,options={}) {
    const plan=this.animationPlan;
    requireThat(plan&&plan.key===key&&plan.id===id&&plan.token===token,'Animation import expired. Select the input animation again.');
    requireThat(sha256(this.bytes(key))===plan.modelHash&&sha256(this.bytes(plan.target))===plan.bankHash,'Model or target animation changed after preparation. Reopen the import to review the current bank.');
    const {model,data,target,clip}=this.animationSource(key,id);
    const rebuilt=clip.sourceFormat==='pack'?replaceCutsceneAnimation(model,data,clip.sectionIndex,clip.modelId,plan.exchange,options):replaceAnimation(model,data,plan.exchange,options);
    const report={...rebuilt.report,...plan.exchange.importReport,sourceBank:plan.exchange.metadata.bankName,targetBank:clip.sourceFormat==='pack'?clip.name:this.get(target).entry.name};
    report.sourceStart=rebuilt.report.sourceStart;report.sourceEnd=rebuilt.report.sourceEnd;
    this.animationPlan=null;
    const snapshot=this.stage(target,rebuilt.data,clip.sourceFormat==='pack'?'Cutscene animation range import':'Animation range import');
    const animationId=clip.sourceFormat==='pack'?this.motion.list(key).clips.find(item=>item.assetKey===target&&item.type==='skeletal'&&item.sectionIndex===clip.sectionIndex)?.id:id;
    return {...snapshot,animationId,animationReport:report};
  }
  async importAnimation(key,id,file,options={}) {
    const prepared=await this.prepareAnimationImport(key,id,file);
    return this.applyAnimationImport(key,id,prepared.token,options);
  }
  motionList(key) {return this.motion.list(key);}
  motionClip(key, id) {return this.motion.get(key, id);}
  openMotion(key, file) {return this.motion.open(key, file);}
  audioAsset(key, index = 0) {
    const {archive, entry} = this.get(key), data = this.bytes(key);
    if (this.format(key) === 'adx') {const info = parseAdx(data); return {key, items: [{name: 'ADX stream', ...info}], decoded: decodeAdx(data), data, type: 'adx'};}
    if (this.format(key) === 'aix') {const info = parseAix(data); return {key, items: info.layers, decoded: decodeAix(data, index), data, type: 'aix'};}
    requireThat(['hd', 'bd'].includes(entry.extension), 'Select an AIX stream or HD/BD bank.');
    const stem = entry.name.slice(0, -3).toLowerCase(), archiveIndex = key.split(':')[0];
    const hdEntry = archive.entries.find(e => e.name.toLowerCase() === stem + '.hd'), bdEntry = archive.entries.find(e => e.name.toLowerCase() === stem + '.bd');
    requireThat(hdEntry && bdEntry, 'Open the archive containing both matching HD and BD files.');
    const hd = this.bytes(archiveIndex + ':' + hdEntry.index), bdKey = archiveIndex + ':' + bdEntry.index, bd = this.bytes(bdKey), info = parseSoundBank(hd, bd);
    return {key: bdKey, items: info.samples, decoded: decodeSoundBank(hd, bd, index), hd, data: bd, type: 'bank'};
  }
  preview(key, audioIndex = 0) {
    const {entry} = this.get(key), data = this.bytes(key), format = this.format(key), kind = assetKind(format);
    const base = {key, kind, mapUndo: this.mapHistory.get(key)?.length || 0, rebuildReport: this.changes.get(key)?.rebuildReport, size: data.length, hash: sha256(data), hex: data.subarray(0, 1024).toString('hex'), textures: []};
    try {
      if (kind === 'video') return createMoviePreview(data, this.cacheFolder).then(({file, info}) => ({...base, videoFile: file, mediaInfo: info})).catch(error => ({...base, previewError: error.message}));
      if (['adx', 'aix', 'bd', 'hd'].includes(format)) {
        const audio = this.audioAsset(key, audioIndex), decoded = audio.decoded;
        base.audio = 'data:audio/wav;base64,' + waveFile(decoded.pcm, decoded.sampleRate, decoded.channels).toString('base64');
        base.audioItems = audio.items; base.audioIndex = audioIndex; base.audioKey = audio.key; base.audioEditable = audio.type !== 'adx';
      } else if (['map', 'cld', 'cam', 'ded', 'sdb', 'sbd'].includes(entry.extension)) {
        const world = this.worldAsset(key), {model, textures = [], ...details} = world;
        base.textures = textures.map(({png, ...t}) => ({...t, url: 'data:image/png;base64,' + png.toString('base64')}));
        base.world = details; base.text = JSON.stringify(details, null, 2); if (model?.meshes.length) base.model = model;
      } else if (['pack', 'cluster'].includes(format)) {
        const clips = [...cutsceneAnimations(data), ...parseMorphAnimations(data)]; base.motion = {format, clips: clips.map(({name, type, modelId, frameCount, targetCount, boneCount}) => ({name, type, modelId, frameCount, targetCount, boneCount}))};
        base.text = JSON.stringify({...base.motion, note: clips.length ? 'Select a matching model, then choose this cutscene under Clips & settings. Skeletal motion loads its matching facial track automatically. Use Export cutscene range and Import animation to edit the selected character.' : 'No supported character motion in this PACK. Camera and other scene tracks are not played.'}, null, 2);
      } else if (entry.extension === 'mes') {
        const messages = readMessages(data); base.messages = {count: messages.count}; base.text = messages.messages.map(m => '[' + m.index + '] ' + m.text).join('\n\n');
      } else if (format === 'bin' && /font/i.test(entry.name)) {
        base.font = true; base.textures = readFonts(data).map(({png, width, height, format, index, editable, glyphCount, scale}) => ({width, height, format, index, editable, glyphCount, scale, url: 'data:image/png;base64,' + png.toString('base64')}));
      } else if (kind === 'model') {
        base.model = parseModel(data);
        base.textures = readTextures(data, true).map(({png, width, height, format, index, editable}) => ({width, height, format, index, editable, url: `data:image/png;base64,${png.toString('base64')}`}));
      } else if (kind === 'texture') {
        if (['png', 'jpg', 'jpeg', 'bmp'].includes(entry.extension)) base.image = `data:image/${entry.extension === 'jpg' ? 'jpeg' : entry.extension};base64,${data.toString('base64')}`;
        else base.textures = this.textureAsset(key).map(({png, width, height, format, index, editable}) => ({width, height, format, index, editable, url: `data:image/png;base64,${png.toString('base64')}`}));
      } else if (kind === 'audio' && ['wav', 'mp3', 'ogg', 'flac'].includes(format)) {
        base.audio = `data:audio/${format};base64,${data.toString('base64')}`;
      } else if (['kg1', 'kg2'].includes(entry.extension)) base.text = 'Shadow geometry (.KG1 / .KG2)\n\nThis asset describes shadows. It is not a skeletal or morph animation. Native export and replacement are available.';
      else if (entry.extension === 'txt') base.text = data.subarray(0, 100000).toString('utf8');
      if (kind === 'texture' && !base.image && !base.textures.length) base.text = 'This texture container has no image records.';
    } catch (error) { base.previewError = error.message; }
    return base;
  }
  stage(key, data, label) {
    const {archive, entry} = this.get(key); requireThat(data.length > 0 && data.length <= MAX_ASSET, 'Replacement must be between 1 byte and 256 MiB.');
    requireThat(archive.format !== 'ARC' || entry.size === entry.size2, 'This compressed ARC variant is read-only.');
    if (entry.extension === 'map') {inspectWorld(data, 'map'); this.mapHistory.delete(key);}
    if (entry.extension === 'mdl') parseModel(data);
    if (entry.extension === '000') decodeMovie(data);
    if (entry.extension === 'wav') requireThat(data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WAVE', 'Expected a WAV file. Convert audio to the original game format first.');
    const original = this.originalBytes(archive, entry);
    if (data.equals(original)) this.changes.delete(key);
    else this.changes.set(key, {data, label, originalHash: sha256(original)});
    this.textureLibrary.invalidate(key);
    return this.snapshot();
  }
  replace(key, file, mode = 'native', textureIndex = 0) {
    if (mode === 'mapGlb') {requireThat(this.format(key)==='map', 'Select a MAP asset.'); return this.stageMap(key,importMapGlb(this.bytes(key),readRange(file,0,fs.statSync(file).size),this.mapReference(key)),'MAP geometry from GLB');}
    if (mode === 'audio') {
      const source = this.audioAsset(key, textureIndex);
      const operation = source.type === 'aix' ? importAixWave(source.data, file, textureIndex) : importSoundBankWave(source.hd, source.data, file, textureIndex);
      return operation.then(data => this.stage(source.key, data, 'Re-encoded audio sample ' + textureIndex));
    }
    if (mode === 'movie') return importMovie(this.bytes(key), file).then(result => this.stage(key, result, 'Movie converted to original game profile'));
    const data = readRange(file, 0, fs.statSync(file).size);
    let result;
    if (mode === 'native') {
      const ext = path.extname(file).slice(1).toLowerCase();
      requireThat(ext === this.get(key).entry.extension, `Choose a native .${this.get(key).entry.extension} file. Use the import action for converted assets.`);
      result = data;
    } else if (mode === 'messages') result = replaceMessages(this.bytes(key), JSON.parse(data.toString('utf8')));
    else if (mode === 'font' || mode === 'fontHires') result = replaceFont(this.bytes(key), textureIndex, data, {highResolution:mode === 'fontHires'});
    else if (mode === 'morph') result = replaceMorphs(this.bytes(key), JSON.parse(data.toString('utf8')));
    else if (mode === 'textureExperimental') result = rebuildTexture(this.bytes(key), textureIndex, data, ['mdl', 'mdl_'].includes(this.get(key).entry.extension), this.textureOptions(key));
    else if (mode === 'texture') result = replaceTexture(this.bytes(key), textureIndex, data, this.get(key).entry.extension === 'mdl', {...this.textureOptions(key), adapt: true});
    else throw new Error('Unknown import mode.');
    return this.stage(key, result, `${mode === 'textureExperimental' ? 'Experimental texture ' + data.readUInt32BE(16) + ' × ' + data.readUInt32BE(20) + ' (game test required)' : mode}: ${path.basename(file)}`);
  }
  bakeMorph(key, target, factor) {
    requireThat(Number.isInteger(target) && Number.isFinite(factor) && factor >= 0 && factor <= 2, 'Invalid morph intensity.');
    const data = this.bytes(key), doc = morphDocument(data); requireThat(doc.targets[target], 'Unknown morph target.');
    for (const delta of doc.targets[target].deltas) for (const attr of ['position', 'normal']) delta[attr] = delta[attr].map(v => Math.round(v * factor));
    return this.stage(key, replaceMorphs(data, doc), `Morph ${target}: intensity ×${factor}`);
  }
  undo(key) {this.get(key); this.changes.delete(key); this.mapHistory.delete(key); this.textureLibrary.invalidate(key); return this.snapshot();}
  async exportModelScene(key, file) {
    requireThat(!fs.existsSync(file), 'Output already exists. Choose a new filename.');
    requireThat(['mdl', 'mdl_'].includes(this.get(key).entry.extension), 'Blender/FBX model export requires a PC MDL.');
    const data = this.bytes(key), model = parseModel(data);
    const outputType=path.extname(file).slice(1).toLowerCase();
    requireThat(['fbx','blend'].includes(outputType), 'Choose FBX or Blender model output.');
    const result = await blenderExchange({script:'model_export', mode:'export', outputType, bones:model.bones.map(bone=>({name:bone.name, world:bone.matrix}))}, exportGlb(model, readTextures(data, true)), this.cacheFolder, this.progress);
    writeNew(file, result.data); return {file, size:result.data.length, report:result.report};
  }
  exportAsset(key, file, mode = 'native', textureIndex = 0) {
    if (mode === 'fbx' || mode === 'blend') return this.exportModelScene(key, file);
    const data = this.bytes(key); let output;
    if (mode === 'movie') return exportMovie(data, file, 'mpeg');
    if (mode === 'webm') return exportMovie(data, file, 'webm');
    if (mode === 'audio' && this.format(key) === 'wav') {writeNew(file, data); return {file};}
    if (mode === 'audio') {const audio = this.audioAsset(key, textureIndex).decoded; writeNew(file, waveFile(audio.pcm, audio.sampleRate, audio.channels)); return {file};}
    if (mode === 'native') output = data;
    else if (mode === 'world') {const {model, textures, ...details} = this.worldAsset(key); output = Buffer.from(JSON.stringify(details, null, 2));}
    else if (mode === 'messages') output = Buffer.from(JSON.stringify(readMessages(data), null, 2));
    else if (mode === 'font') {const texture = readFonts(data)[textureIndex]; requireThat(texture, 'Unknown font atlas.'); output = texture.png;}
    else if (mode === 'glb') {const ext = this.get(key).entry.extension; if (['map', 'cld', 'cam'].includes(ext)) {const world = this.worldAsset(key); output = exportGlb(world.model, world.textures);} else output = exportGlb(parseModel(data), readTextures(data, true));}
    else if (mode === 'morph') output = Buffer.from(JSON.stringify(morphDocument(data), null, 2));
    else if (mode === 'worldTexture') {const texture = this.worldAsset(key).textures?.[textureIndex]; requireThat(texture, 'Unknown world texture.'); output = texture.png;}
    else if (mode === 'texture') { const texture = this.textureAsset(key)[textureIndex]; requireThat(texture, 'Unknown texture.'); output = texture.png; }
    else throw new Error('Unknown export mode.');
    writeNew(file, output); return {file, size: output.length};
  }
  extract(keys, folder) {
    requireThat(Array.isArray(keys) && keys.length > 0, 'Choose assets to export.');
    requireThat(!fs.existsSync(folder), 'Choose a new export folder.');
    const outputs = keys.map(key => {
      const {archive, entry} = this.get(key), prefix = archive.format === 'AFS' ? `${String(entry.index).padStart(5, '0')}_` : '';
      return {key, file: safeOutput(folder, `${archive.name}/${prefix}${entry.name}`)};
    });
    requireThat(new Set(outputs.map(o => o.file.toLowerCase())).size === outputs.length, 'Export has duplicate filenames.');
    fs.mkdirSync(folder, {recursive: true});
    for (const [i, item] of outputs.entries()) {writeNew(item.file, this.bytes(item.key)); this.progress({message: 'Exporting assets', done: i + 1, total: outputs.length});}
    return {folder, count: outputs.length};
  }
  saveProject(file) {
    this.assertSources();
    const doc = {format: 'sh3tools-project-v2', source: this.input,
      sources: this.archives.map(sourceRecord),
      changes: [...this.changes].map(([key, c]) => ({key, label: c.label, originalHash: c.originalHash, rebuildReport: c.rebuildReport, data: c.data.toString('base64')}))};
    writeNew(file, JSON.stringify(doc)); return {file};
  }
  loadProject(file) {
    requireThat(fs.statSync(file).size <= 512 * 1024 * 1024, 'Project is too large.');
    const doc = JSON.parse(fs.readFileSync(file, 'utf8')); requireThat(['sh3tools-project-v1', 'sh3tools-project-v2'].includes(doc.format), 'Unknown project version.');
    const candidate = new Workbench(this.progress, this.cacheFolder); candidate.open(doc.source);
    requireThat(Array.isArray(doc.sources) && (doc.format === 'sh3tools-project-v1' || doc.sources.length === candidate.archives.length), 'Project source set changed.');
    const sourceIndices = doc.sources.map(source => {
      const index = candidate.archives.findIndex(archive => archive.file === path.resolve(source.file));
      requireThat(index >= 0, 'A project source is missing.'); verifySource(candidate.archives[index], source); return index;
    });
    requireThat(new Set(sourceIndices).size === sourceIndices.length, 'Duplicate project sources.');
    requireThat(Array.isArray(doc.changes) && doc.changes.length <= 100000, 'Invalid project changes.');
    for (const change of doc.changes) {
      requireThat(typeof change.key === 'string' && /^\d+:\d+$/.test(change.key), 'Invalid project replacement key.');
      const [sourceIndex, entryIndex] = change.key.split(':').map(Number);
      requireThat(sourceIndices[sourceIndex] !== undefined, 'Replacement has no source.');
      const key = sourceIndices[sourceIndex] + ':' + entryIndex;
      requireThat(sha256(candidate.bytes(key)) === change.originalHash, 'Replacement source hash mismatch.');
      candidate.stage(key, Buffer.from(change.data, 'base64'), String(change.label));
      if (change.rebuildReport && candidate.changes.has(key)) candidate.changes.get(key).rebuildReport = change.rebuildReport;
    }
    this.textureLibrary.reset(); this.mapHistory.clear(); this.sources = candidate.sources; this.reloadPlan = null; this.archives = candidate.archives; this.changes = candidate.changes; this.input = candidate.input; this.catalogPath = candidate.catalogPath; this.dataRoot = candidate.dataRoot; this.modelPlan = null; this.animationPlan = null; this.motion = new MotionLibrary(this);
    return this.snapshot();
  }
  buildRequirements() {
    this.assertSources();
    const morphNodes = Math.max(0, ...[...this.changes].filter(([key]) => ['mdl', 'mdl_'].includes(this.get(key).entry.extension)).map(([, change]) => modelLayout(change.data).morphBaseCount));
    requireThat(morphNodes <= MODEL_LIMITS.morphNodes, 'A staged model exceeds the native signed morph-index range.');
    let textureSlots = 0, primaryTextureRuns = 0, secondaryTextureRuns = 0, requiresModelTexturePatch = false;
    let primaryVertices = 0, secondaryVertices = 0, secondaryTriangles = 0, pictureBytes = 0, fontScale = 0;
    for (const [key, change] of this.changes) {
      if (['mdl','mdl_'].includes(this.get(key).entry.extension)) {
        const model = parseModel(change.data), meshes = model.meshes.filter(m => m.group === 1), textures = modelTextureRequirements(model);
        const batch = change.data.readUInt32LE(12);
        requireThat(change.data[0] === 0 && batch === change.data.readUInt32LE(16) && batch <= change.data.length - 24 && change.data.readUInt32LE(batch + 20) === model.textureCount, "Model texture header and batch counts must agree in the supported PC layout.");
        requireThat(model.meshes.every(mesh => mesh.texture >= 0 && mesh.texture < model.textureCount), "A model material references a missing texture slot.");
        requireThat(textures.textureSlots <= MODEL_TEXTURE_LIMITS.slots && textures.primaryRuns <= MODEL_TEXTURE_LIMITS.primaryRuns && textures.secondaryRuns <= MODEL_TEXTURE_LIMITS.secondaryRuns, "A staged model exceeds the expanded texture tables.");
        textureSlots = Math.max(textureSlots, textures.textureSlots); primaryTextureRuns = Math.max(primaryTextureRuns, textures.primaryRuns); secondaryTextureRuns = Math.max(secondaryTextureRuns, textures.secondaryRuns);
        requiresModelTexturePatch ||= textures.requiresModelTexturePatch;
        primaryVertices = Math.max(primaryVertices, model.meshes.filter(m => m.group === 0).reduce((n, m) => n + m.vertexCount, 0));
        requireThat(meshes.every(m => m.vertexCount <= SECONDARY_LIMITS.perMeshVertices), 'A secondary mesh exceeds the native staging buffer. Use Replace model & rebuild morphs to partition it.');
        secondaryVertices = Math.max(secondaryVertices, meshes.reduce((n,m) => n+m.vertexCount,0));
        secondaryTriangles = Math.max(secondaryTriangles, meshes.reduce((n,m) => n+m.triangleCount,0));
      }
      if (this.get(key).entry.extension === 'bin' && /fontdata_/i.test(this.get(key).entry.name)) fontScale = Math.max(fontScale, ...fontSource(change.data).fonts.map(font => font?.scale || 1));
      if (this.textureOptions(key).picture && this.format(key) === 'tex') pictureBytes = Math.max(pictureBytes, change.data.length);
    }
    requireThat(secondaryVertices <= SECONDARY_LIMITS.vertices && secondaryTriangles <= SECONDARY_LIMITS.triangles, 'Secondary geometry exceeds the expanded native index or sorting capacity.');
    requireThat(pictureBytes <= PICTURE_LIMITS.arenaBytes, 'A picture exceeds the expanded 80 MiB loader arena.');
    const requiresFontPatch = fontScale > 1;
    const requiresPrimaryIndexPatch = primaryVertices > PRIMARY_LIMITS.stockVertices;
    const requiresMorphPatch = morphNodes > STOCK_MORPH_NODES, requiresSecondaryPatch = secondaryVertices > 1024 || secondaryTriangles > 2048, requiresPicturePatch = pictureBytes > PICTURE_LIMITS.stockBytes;
    let character = {requiresCharacterPatch: false};
    if ([...this.changes.keys()].some(key => isCharacterAsset(this.get(key).entry.name))) {
      const workspace = this.dataRoot || !this.catalogPath ? this : openWorkspace(this.catalogPath);
      const staged = new Map([...this.changes].map(([key, change]) => [this.get(key).entry.name.toLowerCase(), change.data.length]));
      const entries = workspace.archives.flatMap(archive => archive.entries.map(entry => ({name: entry.name, size: staged.get(entry.name.toLowerCase()) ?? entry.size})));
      character = characterRequirements(entries);
    }
    const executable = this.dataRoot ? path.join(path.dirname(this.dataRoot), 'sh3.exe') : null;
    return {...character, textureSlots, primaryTextureRuns, secondaryTextureRuns, requiresModelTexturePatch, fontScale, requiresFontPatch, morphNodes, primaryVertices, requiresPrimaryIndexPatch, secondaryVertices, secondaryTriangles, pictureBytes, requiresMorphPatch, requiresSecondaryPatch, requiresPicturePatch,
      requiresRuntimePatch: requiresModelTexturePatch || character.requiresCharacterPatch || requiresFontPatch || requiresPrimaryIndexPatch || requiresMorphPatch || requiresSecondaryPatch || requiresPicturePatch, executable: executable && fs.existsSync(executable) ? executable : null};
  }
  build(folder, gameExecutable) {
    requireThat(this.changes.size, 'No replacements are staged.');
    requireThat(!fs.existsSync(folder), 'Build into a new, empty destination.');
    const root = path.resolve(folder);
    for (const archive of this.archives) requireThat(!archive.file.toLowerCase().startsWith(root.toLowerCase() + path.sep), 'Build output cannot contain source archives.');
    const requirements = this.buildRequirements(); let runtime;
    if (requirements.requiresRuntimePatch) {
      const executable = gameExecutable || requirements.executable;
      requireThat(executable, 'Select a supported sh3.exe to build the required runtime buffer patch.');
      runtime = expandRuntimeBuffers(readRange(executable, 0, fs.statSync(executable).size), requirements);
      runtime.report.source = path.resolve(executable); runtime.report.requirements = requirements;
    }
    fs.mkdirSync(folder, {recursive: true}); const reports = [];
    for (const [i, archive] of this.archives.entries()) {
      const replacements = new Map([...this.changes].filter(([key]) => key.startsWith(`${i}:`)).map(([key, c]) => [Number(key.split(':')[1]), c.data]));
      if (!replacements.size) continue;
      if (archive.format === 'FOLDER') {reports.push(buildLoose(archive, replacements, folder)); continue;}
      const relative = archive.relativePath;
      const output = safeOutput(path.join(folder, 'data'), relative); fs.mkdirSync(path.dirname(output), {recursive: true});
      reports.push({...buildArchive(archive, replacements, output, this.progress), source: archive.file, sourceHash: fileHash(archive.file), outputHash: fileHash(output)});
    }
    if (this.catalogPath) {fs.mkdirSync(path.join(folder, 'data'), {recursive: true}); fs.copyFileSync(this.catalogPath, path.join(folder, 'data/arc.arc'), fs.constants.COPYFILE_EXCL);}
    if (runtime) {writeNew(path.join(folder, 'sh3.exe'), runtime.data); writeNew(path.join(folder, 'runtime-buffers.json'), JSON.stringify(runtime.report, null, 2));}
    writeNew(path.join(folder, 'manifest.json'), JSON.stringify({format: 'sh3tools-build-v1', created: new Date().toISOString(), verified: true, archives: reports, runtime: runtime?.report}, null, 2));
    return {folder, archives: reports.length, changes: this.changes.size, runtimePatch: runtime?.report};
  }
}
