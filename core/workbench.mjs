import {inspectShadowProxy,exportShadowProxy,importShadowProxy} from './shadow-proxy.mjs';
import {animationChannels} from './animation-channels.mjs';
import {modelDiagnostics} from './model-review.mjs';
import {buildReview,buildFingerprint} from './build-review.mjs';
import {validateAfsReplacement} from './afs-layout.mjs';
import {writeCompactArchive,writeCompactManifest} from './compact-overlay.mjs';
import {prepareCutsceneImport,applyCutsceneImport} from './cutscene-import.mjs';
import {shadowCompanion,shadowBinding,stageModelWithShadow} from './shadow-rebuild.mjs';
import {worldName,bankName} from './world-action-names.mjs';
import {modelName} from './model-names.mjs';
import {assertFixedAnimation} from './animation.mjs';
import {animationHeader} from './animation.mjs';
import {prepareBatchReplace, applyBatchReplace} from './batch-replace.mjs';
import {prepareModMerge,applyModMerge,exportModPackage} from './mod-merge.mjs';
import {exportCutscene} from './cutscene-export.mjs';
import {CutsceneLibrary} from './cutscene-library.mjs';
import {saveProject} from './save-project.mjs';
import {validateBackgroundMemory} from './map-memory.mjs';
import {rebuildMapTexture} from './map-texture.mjs';
import {editRoom} from './room-edit.mjs';
import {worldReferences, worldReference} from './world-references.mjs';
import {collisionOptions, collisionPlan, updateBoundCollision, stageWorld, undoWorld, loadCollisionBindings} from './map-collision.mjs';
import {editCameras, importCameras} from './camera-edit.mjs';
import {prepareOverlay, writeOverlay} from './asi-overlay.mjs';
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
import {parseMap} from './world-formats.mjs';
import {inspectWorld} from './world-formats.mjs';
import {parseAdx, decodeAdx, parseAix, decodeAix, parseSoundBank, decodeSoundBank, waveFile, importAixWave, importSoundBankWave} from './audio.mjs';
import {readMessages, replaceMessages} from './messages.mjs';
import {fontSource} from './font-hires.mjs';
import {readFonts, replaceFont} from './fonts.mjs';
import {modelTemplate} from './model-provenance.mjs';
import {replacementInfo, rebuildModel} from './model-rebuild.mjs';
import {looseBytes, verifySource, buildLoose} from './loose-files.mjs';
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
  constructor(progress = () => {}, cacheFolder = path.join(os.tmpdir(), 'sh3tools-media-cache')) { this.sources = []; this.reloadPlan = null; this.mergePlan = null; this.archives = []; this.changes = new Map(); this.input = null; this.catalogPath = null; this.dataRoot = null; this.progress = progress; this.motion = new MotionLibrary(this); this.cutscenes = new CutsceneLibrary(this); this.cacheFolder = cacheFolder; this.modelPlan = null; this.animationPlan = null; this.scenePlan = null; this.mapHistory = new Map(); this.mapCollisions = new Map(); this.textureLibrary = new TextureLibrary(this); }
  open(input) {
    const workspace = openWorkspace(input), sources = workspaceSources(workspace);
    assertSources(sources);
    Object.assign(this, workspace); this.sources = sources; this.reloadPlan = null; this.mergePlan = null; this.textureLibrary.reset(); this.mapHistory.clear(); this.mapCollisions.clear(); this.changes.clear(); this.modelPlan = null; this.animationPlan = null; this.scenePlan = null; this.motion = new MotionLibrary(this); this.cutscenes = new CutsceneLibrary(this);
    return this.snapshot();
  }
  prepareBatchReplace(folder, options) {return prepareBatchReplace(this, folder, options);}
  applyBatchReplace(token, ids) {return applyBatchReplace(this, token, ids);}
  cancelBatchReplace(token) {if (this.batchPlan?.token === token) this.batchPlan = null;}
  prepareModMerge(files) {return prepareModMerge(this,files);}
  applyModMerge(token,choices) {return applyModMerge(this,token,choices);}
  cancelModMerge(token) {if(this.mergePlan?.token===token)this.mergePlan=null;}
  exportModPackage(file) {return exportModPackage(this,file);}
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
    this.textureLibrary.reset(); this.mapHistory.clear(); this.mapCollisions.clear(); this.modelPlan = null; this.animationPlan = null; this.scenePlan = null;
    this.motion = new MotionLibrary(this); this.cutscenes = new CutsceneLibrary(this); this.reloadPlan = null; this.mergePlan = null; this.mapCollisions=plan.collisionBindings;
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
  exportCutscene(id,options,file) {return exportCutscene(this,id,options,file);}
  prepareCutsceneImport(id,file) {return prepareCutsceneImport(this,id,file);}
  cancelCutsceneImport(token) {if(this.scenePlan?.token===token)this.scenePlan=null;return null;}
  applyCutsceneImport(id,token,options) {return applyCutsceneImport(this,id,token,options);}
  cutsceneCatalog(force) {return this.cutscenes.catalog(force);}
  cutscenePreview(id,options) {return this.cutscenes.load(id,options);}
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
    for (const mesh of world.model.meshes) mesh.replacementIssue = mapPartReplacementIssue(data,mesh);
    world.collision = collisionOptions(this,key); world.references = worldReferences(this,key); return world;
  }
  exportArchive(id, folder, mode) {return exportArchive(this, id, folder, mode);}
  exportAllArchives(folder, mode) {return exportAllArchives(this, folder, mode);}
  snapshot() {
    return {textureRevision: this.textureLibrary.revision, input: this.input, dataRoot: this.dataRoot, archiveCount: this.archives.length,
      archives: this.archives.map((a, i) => ({id: i, section: a.section, name: a.name, format: a.format, size: a.size, count: a.entries.length})),
      entries: this.archives.flatMap((a, i) => a.entries.map(e => ({key: `${i}:${e.index}`, archive: i, section: a.section, archiveName: a.name, index: e.index, name: e.name, friendlyName:modelName(e.name)?.name||worldName(e.name)?.name||bankName(e.name)||'', searchAliases:modelName(e.name)?.aliases||worldName(e.name)?.aliases||'',
        extension: e.extension, detectedFormat: this.format(`${i}:${e.index}`), kind: assetKind(this.format(`${i}:${e.index}`)), size: e.size, offset: e.offset, chunkTableOffset: e.chunkTableOffset,
        changed: this.changes.has(`${i}:${e.index}`), newSize: this.changes.get(`${i}:${e.index}`)?.data.length}))),
      changes: [...this.changes].map(([key, c]) => ({key, name: this.get(key).entry.name, label: c.label, originalSize: this.get(key).entry.size, size: c.data.length}))};
  }
  mapReference(key) {const {archive,entry}=this.get(key); return this.originalBytes(archive,entry);}
  stageMap(key, data, label, targetKey=key) {
    const updates=[{key:targetKey,data}];
    const collision=targetKey===key && this.format(key)==='map' ? updateBoundCollision(this,key,data) : null;
    if(collision)updates.push(collision.update);
    return stageWorld(this,key,updates,label,collision?.plan);
  }
  worldReference(key, target) {return worldReference(this,key,target);}
  previewMapCollision(key,hash,options) {
    requireThat(this.format(key)==='map'&&sha256(this.bytes(key))===hash,'Map changed. Select it again before rebuilding collision.');
    const {plan,update}=collisionPlan(this,key,options),before=inspectWorld(plan.base,'cld'),after=inspectWorld(update.data,'cld');
    return {groups:after.groups.map((g,i)=>({name:g.name,count:g.count,original:before.groups[i].count})),bytes:update.data.length};
  }
  collisionInfo(key, target) {
    requireThat(this.format(key)==='map','Select a MAP asset.');
    const options=collisionOptions(this,key);
    requireThat(options.candidates.some(candidate=>candidate.key===target),'Select a companion CLD from the same archive.');
    const collision=inspectWorld(this.mapCollisions.get(key)?.base || this.bytes(target),'cld');
    return {mode:collision.groups.some(g=>g.spatialCells.slice(1).some(list=>list.length))?'grid':'room',groups:collision.groups.slice(0,4).map(g=>({name:g.name,count:g.count,materials:[...new Set(g.records.map(r=>r.material))]}))};
  }
  bindMapCollision(key, hash, options) {
    requireThat(this.format(key)==='map' && sha256(this.bytes(key))===hash,'Map changed. Select it again before configuring collision.');
    const {plan,update}=collisionPlan(this,key,options);
    return stageWorld(this,key,update?[update]:[],'Rebuilt map collision',plan);
  }
  editMap(key, hash, edits) {
    requireThat(this.format(key)==='map' && sha256(this.bytes(key))===hash,'Map changed. Select it again before editing.');
    requireThat(Array.isArray(edits) && edits.length <= 50000, 'Invalid map edit list.');
    let data = this.bytes(key); const reference = this.mapReference(key);
    for (const edit of edits) data = editMap(data, edit, reference);
    return this.stageMap(key, data, 'MAP part / material edits');
  }
  editRoom(key,hash,edits,references) {return editRoom(this,key,hash,edits,references);}
  editCameras(key, hash, edits) {
    requireThat(this.format(key)==='cam' && sha256(this.bytes(key))===hash,'Camera file changed. Select it again before editing.');
    return this.stageMap(key,editCameras(this.bytes(key),edits),'Camera zone edits');
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
  replaceMapTexture(key, hash, index, file, mode='fit') {
    requireThat(['fit','fullSize'].includes(mode),'Choose Fit or Full size texture import.');
    requireThat(this.format(key)==='map' && sha256(this.bytes(key))===hash, 'Map changed. Select it again before editing.');
    const texture = this.worldAsset(key).textures[index]; requireThat(texture, 'Select a resolved map texture.');
    const sourceKey = texture.sourceKey ?? key, data = this.bytes(sourceKey), offset = texture.sourceOffset;
    const png = readRange(file, 0, fs.statSync(file).size);
    let output;
    if(mode==='fullSize')output=sourceKey===key?rebuildMapTexture(data,texture.sourceIndex,png):rebuildTexture(data,texture.sourceIndex,png);
    else {const fragment=replaceTexture(data.subarray(offset),texture.sourceIndex,png,false,{adapt:true});output=Buffer.from(data);fragment.copy(output,offset);}
    return this.stageMap(key,output,sourceKey===key?'MAP embedded texture':'Shared MAP texture: '+path.basename(file),sourceKey);
  }
  undoMap(key) {return undoWorld(this,key);}
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
    const token=sha256(Buffer.concat([Buffer.from(key+Date.now()),glb]));
    this.modelPlan={key,token,sourceHash:sha256(data),output,label:'Model and textures: '+path.basename(file)};
    return {...this.reviewModel(key,token),modelImport:'review'};
  }
  prepareModelBytes(key,glb,textures) {
    const data=this.bytes(key); textures ||= modelTexturePlan(data,glb); glb = textures.glb;
    const info=replacementInfo(data,glb,textures.count);
    const token = sha256(Buffer.concat([Buffer.from(key + Date.now()), glb]));
    this.modelPlan = {key, glb, textures, sourceHash: sha256(data), token}; return {token, ...info, shadowAvailable:!!shadowCompanion(this,key),shadowResource:shadowBinding(this,key), importedTextures: textures.summary, newTextureSlots: textures.added};
  }
  modelTemplates(key, token, file) {
    const plan=this.modelPlan, current=this.bytes(key);
    requireThat(plan && plan.key===key && plan.token===token && plan.sourceHash===sha256(current),'Prepare the replacement model again.');
    const original=modelTemplate(readRange(file,0,fs.statSync(file).size)), model=parseModel(original), existing=parseModel(current);
    requireThat(model.modelId===existing.modelId && model.morphNames.length===existing.morphNames.length && model.textureCount<=existing.textureCount,'Choose the original MDL for this same character.');
    requireThat(JSON.stringify(model.bones)===JSON.stringify(existing.bones),'Original template skeleton differs from this model.');
    let template=Buffer.concat([original.subarray(0,original.readUInt32LE(12)),current.subarray(current.readUInt32LE(12))]);
    template.writeUInt32LE(current.readUInt32LE(8),8); template=syncModelImageTable(template);
    const info=replacementInfo(template,plan.glb,plan.textures.count); plan.template=template; return {...info,token,shadowAvailable:!!shadowCompanion(this,key),shadowResource:shadowBinding(this,key),importedTextures:plan.textures.summary,newTextureSlots:plan.textures.added};
  }

  reviewModel(key,token,selection) {
    const plan=this.modelPlan,data=this.bytes(key);
    requireThat(plan&&plan.key===key&&plan.token===token&&plan.sourceHash===sha256(data),'The model changed. Prepare the replacement again.');
    const rebuilt=plan.output?{data:plan.output,report:null}:rebuildModel(plan.template||data,plan.glb,selection,plan.textures);
    const reference=parseModel(modelTemplate(data));
    const serialize=bytes=>{const model=parseModel(bytes);return {model,diagnostics:modelDiagnostics(model,reference),textures:readTextures(bytes,true).map(({png,width,height,index})=>({width,height,index,url:'data:image/png;base64,'+png.toString('base64')}))};};
    plan.candidate={...rebuilt,selection,hash:sha256(rebuilt.data)};
    return {key,token,reviewHash:plan.candidate.hash,before:serialize(data),after:serialize(rebuilt.data),report:rebuilt.report};
  }
  applyModelReview(key,token,reviewHash) {
    const plan=this.modelPlan;
    requireThat(plan&&plan.key===key&&plan.token===token&&plan.sourceHash===sha256(this.bytes(key))&&plan.candidate?.hash===reviewHash,'The reviewed model changed. Preview it again before applying.');
    const candidate=plan.candidate,diagnostics=modelDiagnostics(parseModel(candidate.data));
    requireThat(!diagnostics.issues.some(issue=>issue.severity==='error'),'Resolve invalid model weights or texture slots before staging.');
    const snapshot=stageModelWithShadow(this,key,candidate.data,plan.label||'Reviewed model topology and morph replacement',candidate.selection?.rebuildShadow!==false);
    if(this.changes.has(key))this.changes.get(key).rebuildReport=candidate.report;
    this.modelPlan=null;this.animationPlan=null;this.scenePlan=null;
    return {...snapshot,rebuildReport:candidate.report};
  }
  rebuildModel(key,token,selection){const review=this.reviewModel(key,token,selection);return this.applyModelReview(key,token,review.reviewHash);}

  shadowPreview(key){const binding=shadowBinding(this,key);requireThat(binding,'No matching KG1 is open.');const data=this.bytes(binding.key);return {key,binding,hash:sha256(data),...inspectShadowProxy(parseModel(this.bytes(key)),data)};}
  exportShadowProxy(key,file){const binding=shadowBinding(this,key);requireThat(binding,'No matching KG1 is open.');writeNew(file,exportShadowProxy(parseModel(this.bytes(key)),this.bytes(binding.key)));return {file};}
  importShadowProxy(key,hash,file,decisions=[]){const binding=shadowBinding(this,key);requireThat(binding&&sha256(this.bytes(binding.key))===hash,'KG1 changed. Reopen the shadow tools.');const {archive,entry}=this.get(binding.key),result=importShadowProxy(parseModel(this.bytes(key)),this.bytes(binding.key),this.originalBytes(archive,entry),file?readRange(file,0,fs.statSync(file).size):null,decisions);return {...this.stage(binding.key,result.data,'Edited rigid KG1 shadow proxy'),shadowReport:{...result.report,resource:binding.name,sharedModels:binding.sharedModels}};}
  rebuildModelShadow(key) {requireThat(shadowCompanion(this,key),'No named KG1 companion is available. Open the game data folder, or the original archive beside its arc.arc catalog; then select the MDL.');return stageModelWithShadow(this,key,this.bytes(key),'Model with rebuilt shadow',true,true);}
  animationChannels(key,id) {const source=this.animationSource(key,id);requireThat(source.clip.sourceFormat==='anm','Choose a gameplay ANM bank for this table.');return animationChannels(source.model,source.data);}
  animationSource(key,id) {
    return {model:parseModel(this.bytes(key)),...this.motion.exchangeSource(key,id)};
  }
  animationExchange(source,start,end,fps) {
    const {model,data,clip}=source;
    return clip.sourceFormat==='pack'?cutsceneExchange(model,data,clip.sectionIndex,clip.modelId,start,end,fps):animationExchange(model,data,start,end,fps);
  }
  async exportAnimation(key,id,start,end,fps,file) {
    const source=this.animationSource(key,id),exchange=this.animationExchange(source,start,end,fps);
    exchange.metadata.actionId=source.clip.ranges?.find(action=>action.start===start&&action.end===end)?.id;
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
      channels:clip.sourceFormat==='anm'?animationChannels(source.model,data):null,sourceStart:exchange.sampleStart,sourceEnd:exchange.sampleEnd,exportStart:exchange.metadata.start,targetFrames:identity.metadata.frameCount,fps:exchange.metadata.fps,...result.report};
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
    if(this.changes.has(target))this.changes.get(target).animationReport=report;
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
    const base = {key, kind, shadowResource:kind==='model'?shadowBinding(this,key):null, mapUndo: this.mapHistory.get(key)?.length || 0, rebuildReport: this.changes.get(key)?.rebuildReport, size: data.length, hash: sha256(data), hex: data.subarray(0, 1024).toString('hex'), textures: []};
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
  prepareChange(key, data, label) {
    const {archive,entry}=this.get(key); requireThat(data.length>0 && data.length<=MAX_ASSET,'Replacement must be between 1 byte and 256 MiB.');
    requireThat(archive.format!=='ARC' || entry.size===entry.size2,'This compressed ARC variant is read-only.');
    validateAfsReplacement(archive,entry.index,data);
    if(['map','cld','cam'].includes(entry.extension))inspectWorld(data,entry.extension);
    if(entry.extension==='mdl')parseModel(data);
    if(entry.extension==='000')decodeMovie(data);
    if(entry.extension==='wav')requireThat(data.toString('ascii',0,4)==='RIFF' && data.toString('ascii',8,12)==='WAVE','Expected a WAV file. Convert audio to the original game format first.');
    const original=this.originalBytes(archive,entry);
    return data.equals(original)?null:{data,label,originalHash:sha256(original)};
  }
  stage(key, data, label) {
    validateBackgroundMemory(this,[{key,data}]);
    const change=this.prepareChange(key,data,label);
    if(change)this.changes.set(key,change);else this.changes.delete(key);
    if(['map','cam'].includes(this.get(key).entry.extension))this.mapHistory.delete(key);
    this.textureLibrary.invalidate(key); return this.snapshot();
  }
  replace(key, file, mode = 'native', textureIndex = 0) {
    if (mode === 'cameraJson') {requireThat(this.format(key)==='cam','Select a CAM asset.'); return this.stageMap(key,importCameras(this.bytes(key),JSON.parse(readRange(file,0,fs.statSync(file).size).toString('utf8'))),'Camera structure from JSON');}
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
    if(mode==='native' && ['map','cam'].includes(this.format(key)))return this.stageMap(key,result,'Native world replacement');
    return this.stage(key, result, `${mode === 'textureExperimental' ? 'Experimental texture ' + data.readUInt32BE(16) + ' × ' + data.readUInt32BE(20) + ' (game test required)' : mode}: ${path.basename(file)}`);
  }
  bakeMorph(key, target, factor) {
    requireThat(Number.isInteger(target) && Number.isFinite(factor) && factor >= 0 && factor <= 2, 'Invalid morph intensity.');
    const data = this.bytes(key), doc = morphDocument(data); requireThat(doc.targets[target], 'Unknown morph target.');
    for (const delta of doc.targets[target].deltas) for (const attr of ['position', 'normal']) delta[attr] = delta[attr].map(v => Math.round(v * factor));
    return this.stage(key, replaceMorphs(data, doc), `Morph ${target}: intensity ×${factor}`);
  }
  undo(key) {
    this.get(key); const binding=this.mapCollisions.get(key);
    requireThat(![...this.mapCollisions].some(([owner,p])=>owner!==key&&p.target===key),'This CLD is linked to a map. Restore and disconnect its collision binding in the map editor.');
    if(binding)stageWorld(this,key,[{key,data:this.mapReference(key)},{key:binding.target,data:binding.base}],'Reverted map and collision',null);
    this.changes.delete(key); this.mapHistory.delete(key); this.textureLibrary.invalidate(key); return this.snapshot();
  }
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
  saveProject(file,drafts=[]) {return saveProject(this,file,drafts);}
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
      const prepared=candidate.prepareChange(key,Buffer.from(change.data,'base64'),String(change.label)); if(prepared)candidate.changes.set(key,prepared);else candidate.changes.delete(key);
      if(change.animationReport&&candidate.changes.has(key))candidate.changes.get(key).animationReport=change.animationReport;
      if (change.rebuildReport && candidate.changes.has(key)) candidate.changes.get(key).rebuildReport = change.rebuildReport;
    }
    const remap=key=>{requireThat(typeof key==='string' && /^\d+:\d+$/.test(key),'Invalid collision asset key.');const [a,i]=key.split(':').map(Number);requireThat(sourceIndices[a]!==undefined,'Collision source is missing.');return sourceIndices[a]+':'+i;};
    validateBackgroundMemory(candidate,[...candidate.changes].map(([key,change])=>({key,data:change.data})));
    loadCollisionBindings(candidate,doc.collisionBindings || [],remap);
    this.textureLibrary.reset(); this.mapHistory.clear(); this.mapCollisions.clear(); this.sources = candidate.sources; this.reloadPlan = null; this.mergePlan = null; this.archives = candidate.archives; this.changes = candidate.changes; this.input = candidate.input; this.catalogPath = candidate.catalogPath; this.dataRoot = candidate.dataRoot; this.modelPlan = null; this.animationPlan = null; this.scenePlan = null; this.motion = new MotionLibrary(this); this.cutscenes = new CutsceneLibrary(this); this.mapCollisions=candidate.mapCollisions;
    return this.snapshot();
  }
  buildReview() {return buildReview(this);}
  validateBuildReview(token) {requireThat(token===buildFingerprint(this),'Staged changes changed. Review the build again.');return this.buildRequirements();}
  buildRequirements() {
    const background=validateBackgroundMemory(this,[...this.changes].map(([key,change])=>({key,data:change.data})));
    const requiresBackgroundPatch=background.some(stage=>stage.requiresBackgroundPatch);
    const transparentTriangles=data=>parseMap(data).model.meshes.filter(m=>m.textureSource===2||m.transparency===1).reduce((n,m)=>n+m.indices.length/3,0);
    const mapGeometry=[...this.changes].filter(([key])=>this.get(key).entry.extension==='map').map(([key,change])=>({name:this.get(key).entry.name,original:transparentTriangles(this.mapReference(key)),triangles:transparentTriangles(change.data)}));
    const requiresMapGeometryPatch=mapGeometry.some(map=>map.triangles>map.original||map.triangles>2730);
    this.assertSources();
    for(const [key,plan] of this.mapCollisions)requireThat(updateBoundCollision(this,key,this.bytes(key)).plan.outputHash===plan.outputHash,'Map collision is out of sync. Rebuild its binding before building the mod.');
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
    for(const entry of this.snapshot().entries.filter(e=>/^anm_?$/.test(e.extension))) assertFixedAnimation(this.bytes(entry.key));
    const executable = this.dataRoot ? path.join(path.dirname(this.dataRoot), 'sh3.exe') : null;
    return {...character, mapGeometry, requiresMapGeometryPatch, background, requiresBackgroundPatch, textureSlots, primaryTextureRuns, secondaryTextureRuns, requiresModelTexturePatch, fontScale, requiresFontPatch, morphNodes, primaryVertices, requiresPrimaryIndexPatch, secondaryVertices, secondaryTriangles, pictureBytes, requiresMorphPatch, requiresSecondaryPatch, requiresPicturePatch,
      requiresRuntimePatch: requiresMapGeometryPatch || requiresBackgroundPatch || requiresModelTexturePatch || character.requiresCharacterPatch || requiresFontPatch || requiresPrimaryIndexPatch || requiresMorphPatch || requiresSecondaryPatch || requiresPicturePatch, executable: executable && fs.existsSync(executable) ? executable : null};
  }
  build(folder, gameExecutable, options = {}) {
    requireThat(this.changes.size, 'No replacements are staged.');
    requireThat(!fs.existsSync(folder), 'Build into a new, empty destination.');
    const root = path.resolve(folder);
    for (const archive of this.archives) requireThat(!archive.file.toLowerCase().startsWith(root.toLowerCase() + path.sep), 'Build output cannot contain source archives.');
    const mode = options.mode || 'replace';
    requireThat(['replace', 'overlay'].includes(mode), 'Unknown mod build mode.');
    const contentRoot = mode === 'overlay' ? path.join(folder, 'plugins', 'SH3Tools') : folder;
    const requirements = this.buildRequirements(); let runtime, overlay;
    if (mode === 'overlay') {
      const executable = gameExecutable || requirements.executable;
      requireThat(executable, 'Choose the original sh3.exe for this ASI mod.');
      overlay = prepareOverlay(fs.readFileSync(executable), requirements, options.loader ? Buffer.from(options.loader) : null);
    }
    if (mode === 'replace' && requirements.requiresRuntimePatch) {
      const executable = gameExecutable || requirements.executable;
      requireThat(executable, 'Select a supported sh3.exe to build the required runtime buffer patch.');
      runtime = expandRuntimeBuffers(readRange(executable, 0, fs.statSync(executable).size), requirements);
      runtime.report.source = path.resolve(executable); runtime.report.requirements = requirements;
    }
    fs.mkdirSync(folder, {recursive: true}); const reports = [];
    for (const [i, archive] of this.archives.entries()) {
      const replacements = new Map([...this.changes].filter(([key]) => key.startsWith(`${i}:`)).map(([key, c]) => [Number(key.split(':')[1]), c.data]));
      if (!replacements.size) continue;
      if (archive.format === 'FOLDER') {reports.push(buildLoose(archive, replacements, contentRoot)); continue;}
      if (overlay) {reports.push(writeCompactArchive(archive, replacements, contentRoot, this.progress)); continue;}
      const relative = archive.relativePath;
      const output = safeOutput(path.join(contentRoot, 'data'), relative); fs.mkdirSync(path.dirname(output), {recursive: true});
      reports.push({...buildArchive(archive, replacements, output, this.progress), source: archive.file, sourceHash: fileHash(archive.file), outputHash: fileHash(output)});
    }
    if (this.catalogPath && !overlay) {fs.mkdirSync(path.join(contentRoot, 'data'), {recursive: true}); fs.copyFileSync(this.catalogPath, path.join(contentRoot, 'data/arc.arc'), fs.constants.COPYFILE_EXCL);}
    if (overlay) {writeCompactManifest(contentRoot, reports, this.catalogPath); writeOverlay(folder, overlay);}
    if (runtime) {writeNew(path.join(folder, 'sh3.exe'), runtime.data); writeNew(path.join(folder, 'runtime-buffers.json'), JSON.stringify(runtime.report, null, 2));}
    writeNew(path.join(folder, 'manifest.json'), JSON.stringify({format: 'sh3tools-build-v1', mode, contentRoot: mode === 'overlay' ? 'plugins/SH3Tools' : '.', created: new Date().toISOString(), verified: true, archives: reports, runtime: overlay?.report || runtime?.report}, null, 2));
    return {folder, mode, archives: reports.length, changes: this.changes.size, runtimePatch: overlay?.report || runtime?.report};
  }
}
