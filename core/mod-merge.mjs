import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {openArchive,entryBytes} from './archives.mjs';
import {folderFiles} from './loose-files.mjs';
import {requireThat,sha256,fileHash,MAX_ASSET,writeNew,safeOutput} from './binary.mjs';
import {validateBackgroundMemory} from './map-memory.mjs';

const normalize=name=>String(name).replaceAll('\\','/').toLowerCase();
const dataPath=name=>normalize(name).split('/data/').at(-1).replace(/^data\//,'');
const basename=name=>normalize(name).split('/').at(-1);
const read=file=>{requireThat(fs.statSync(file).size<=512*1024*1024,'Mod metadata exceeds 512 MiB.');return JSON.parse(fs.readFileSync(file,'utf8'));};

function archiveIndex(wb,name) {
  const relative=dataPath(name),exact=wb.archives.flatMap((a,i)=>normalize(a.relativePath||'')===relative?[i]:[]);
  const matches=exact.length?exact:wb.archives.flatMap((a,i)=>basename(a.file)===basename(name)?[i]:[]);
  requireThat(matches.length===1,`Open the matching clean data folder: source ${name} is missing or ambiguous.`);
  return matches[0];
}
function packageChanges(wb,doc,label,add) {
  requireThat(Array.isArray(doc.assets)&&doc.assets.length<=100000,'Invalid mod package.');
  for(const asset of doc.assets) {
    const a=archiveIndex(wb,asset.archive),archive=wb.archives[a];
    const index=archive.format==='FOLDER'?archive.entries.findIndex(e=>normalize(e.name)===normalize(asset.name)):asset.index;
    requireThat(Number.isInteger(index)&&index>=0,'Mod asset is missing from the source.');
    add(`${a}:${index}`,Buffer.from(asset.data,'base64'),label,asset.originalHash);
  }
}
function projectChanges(wb,doc,label,add) {
  requireThat(Array.isArray(doc.sources)&&Array.isArray(doc.changes)&&doc.changes.length<=100000,'Invalid project changes.');
  const sources=doc.sources.map(source=>archiveIndex(wb,source.file));
  for(const change of doc.changes) {
    requireThat(typeof change.key==='string'&&/^\d+:\d+$/.test(change.key),'Invalid project asset key.');
    const [a,index]=change.key.split(':').map(Number);requireThat(sources[a]!==undefined,'Project source is missing.');
    const source=doc.sources[a],archive=wb.archives[sources[a]];
    const mapped=archive.format==='FOLDER'?archive.entries.findIndex(e=>dataPath(e.name)===dataPath(source.file)+'/'+normalize(source.files?.[index]?.name)):index;
    requireThat(mapped>=0,'Project loose file is missing.');
    add(`${sources[a]}:${mapped}`,Buffer.from(change.data,'base64'),label,change.originalHash,change.rebuildReport);
  }
}
function archiveChanges(wb,file,label,add,report) {
  const a=archiveIndex(wb,report?.source||file),base=wb.archives[a],incoming=openArchive(file);
  requireThat(incoming.format===base.format&&incoming.entries.length===base.entries.length,'Mod archive layout differs. Adding or removing entries is not supported.');
  if(report?.outputHash)requireThat(fileHash(file)===report.outputHash,'Mod archive differs from its build manifest.');
  if(report?.sourceHash)requireThat(fileHash(base.file)===report.sourceHash,'Mod was built against another source archive. Open its clean base version.');
  for(const entry of incoming.entries) {
    const record=report?.changes?.find(change=>change.index===entry.index);
    if(report?.changes&&!record)continue;
    const data=entryBytes(incoming,entry.index);
    if(record)requireThat(sha256(data)===record.after,'Mod entry differs from its build manifest.');
    add(`${a}:${entry.index}`,data,label,record?.before);
  }
}
function buildContentRoot(folder,manifest) {
  if (manifest?.contentRoot !== undefined) {
    requireThat(typeof manifest.contentRoot === 'string' && manifest.contentRoot.length > 0, 'Invalid mod content root.');
    return manifest.contentRoot === '.' ? folder : safeOutput(folder,manifest.contentRoot);
  }
  // Version-1 manifests from older releases implicitly used the update directory.
  if (manifest?.mode === 'overlay' || fs.existsSync(path.join(folder,'update/data'))) return path.join(folder,'update');
  if (fs.existsSync(path.join(folder,'plugins/SH3Tools/data'))) return path.join(folder,'plugins/SH3Tools');
  return folder;
}
function folderChanges(wb,folder,label,add) {
  const manifestFile=path.join(folder,'manifest.json'),manifest=fs.existsSync(manifestFile)?read(manifestFile):null;
  if(manifest)requireThat(manifest.format==='sh3tools-build-v1'&&Array.isArray(manifest.archives),'Unsupported mod build manifest.');
  const compact = manifest?.archives.filter(report=>report.compact) || [];
  const content=buildContentRoot(folder,manifest);
  const compactFiles=new Set(compact.flatMap(report=>report.changes.map(change=>normalize(change.file))));
  for (const report of compact) {
    const a=archiveIndex(wb,report.file), base=wb.archives[a];
    requireThat(base.format===report.format && fileHash(base.file)===report.sourceHash,'Compact mod needs its matching original archive.');
    for (const change of report.changes) {
      const file=safeOutput(content,change.file);
      requireThat(fs.statSync(file).size===change.size && change.size<=MAX_ASSET,'Invalid compact replacement size.');
      const data=fs.readFileSync(file);requireThat(sha256(data)===change.after,'Compact replacement checksum differs.');
      add(`${a}:${change.index}`,data,label,change.before);
    }
  }
  const root=path.join(content,'data');requireThat(compact.length||fs.existsSync(root),'Choose a mod build containing data or plugins/SH3Tools/data (older update builds are also supported).');
  const files=fs.existsSync(root)?folderFiles(root):[],entries=wb.snapshot().entries;
  for(const file of files) {
    const relative=normalize(path.relative(root,file));if(relative==='arc.arc'||compactFiles.has('data/'+relative))continue;
    const report=manifest?.archives.find(r=>r.format!=='FOLDER'&&dataPath(r.file)===relative);
    if(/\.(arc|afs)$/.test(relative)){archiveChanges(wb,file,label,add,report);continue;}
    const target=entries.find(e=>normalize(e.name)==='data/'+relative);requireThat(target,`Mod file data/${relative} is not present in the open game.`);
    requireThat(fs.statSync(file).size<=MAX_ASSET,'Mod asset exceeds 256 MiB.');
    const loose=manifest?.archives.flatMap(r=>r.files||[]).find(r=>dataPath(r.file)===relative);
    const data=fs.readFileSync(file);if(loose)requireThat(sha256(data)===loose.outputHash,'Mod file differs from its build manifest.');
    add(target.key,data,label,loose?.sourceHash);
  }
}

/** Compare mods against the open base, without changing staged work or source files. */
export function prepareModMerge(wb,files) {
  requireThat(Array.isArray(files)&&files.length>0&&files.length<=64,'Choose between 1 and 64 mods.');wb.assertSources();
  const items=new Map();let bytes=0,duplicates=0,unchanged=0;
  const add=(key,data,label,originalHash,rebuildReport)=>{
    const {archive,entry}=wb.get(key),original=wb.originalBytes(archive,entry),hash=sha256(original);
    requireThat(!originalHash||originalHash===hash,`${entry.name}: mod uses another original asset. Open the matching clean game files.`);
    requireThat(data.length>0&&data.length<=MAX_ASSET,`${entry.name}: invalid mod asset size.`);
    if(data.equals(original)){unchanged++;return;}
    let item=items.get(key);
    if(!item){item={key,name:entry.name,originalHash:hash,variants:[]};const staged=wb.changes.get(key);if(staged)item.variants.push({data:staged.data,hash:sha256(staged.data),label:'Current project',rebuildReport:staged.rebuildReport});items.set(key,item);}
    const incomingHash=sha256(data);if(item.variants.some(v=>v.hash===incomingHash)){duplicates++;return;}
    bytes+=data.length;requireThat(bytes<=512*1024*1024,'Selected mod changes exceed the 512 MiB merge budget. Merge a smaller group first.');
    item.variants.push({data,hash:incomingHash,label,rebuildReport});
  };
  for(const input of files) {
    const file=path.resolve(input),label=path.basename(file),stat=fs.statSync(file);
    if(stat.isDirectory()){folderChanges(wb,file,label,add);continue;}
    if(/\.(arc|afs)$/i.test(file)){archiveChanges(wb,file,label,add);continue;}
    const doc=read(file);
    if(doc.format==='sh3tools-mod-v1')packageChanges(wb,doc,label,add);
    else if(['sh3tools-project-v1','sh3tools-project-v2'].includes(doc.format))projectChanges(wb,doc,label,add);
    else if(doc.format==='sh3tools-build-v1')folderChanges(wb,path.dirname(file),path.basename(path.dirname(file)),add);
    else throw new Error('Choose a .sh3mod, .sh3project, ARC/AFS or a build manifest.json.');
  }
  const plan={token:randomUUID(),archives:wb.archives,changes:new Map(wb.changes),items:[...items.values()]};wb.mergePlan=plan;
  return {token:plan.token,duplicates,unchanged,items:plan.items.map(item=>({key:item.key,name:item.name,conflict:item.variants.length>1,
    collisionBinding:[...wb.mapCollisions].some(([key,b])=>key===item.key||b.target===item.key),
    choices:item.variants.map((v,index)=>({index,label:v.label,size:v.data.length,hash:v.hash}))}))};
}

/** Commit one fully validated selection; conflicts always need an explicit choice. */
export function applyModMerge(wb,token,choices={}) {
  const plan=wb.mergePlan;wb.assertSources();
  requireThat(plan&&plan.token===token&&plan.archives===wb.archives&&plan.changes.size===wb.changes.size&&[...plan.changes].every(([key,value])=>wb.changes.get(key)===value),'Merge review is stale. Compare the mods again.');
  const updates=[],changes=new Map(wb.changes),bindings=new Map(wb.mapCollisions);
  for(const item of plan.items) {
    const choice=choices[item.key]??(item.variants.length===1?0:null);
    requireThat(Number.isInteger(choice)&&choice>=-1&&choice<item.variants.length,`Choose which mod supplies ${item.name}.`);
    const variant=choice>=0?item.variants[choice]:null;
    const {archive,entry}=wb.get(item.key),data=variant?.data||wb.originalBytes(archive,entry);
    const prepared=wb.prepareChange(item.key,data,'Merged: '+(variant?.label||'original'));
    if(prepared){if(variant.rebuildReport)prepared.rebuildReport=variant.rebuildReport;changes.set(item.key,prepared);}else changes.delete(item.key);
    updates.push({key:item.key,data});
    if(!data.equals(wb.bytes(item.key)))for(const [key,binding] of bindings)if(key===item.key||binding.target===item.key)bindings.delete(key);
  }
  const candidate=Object.assign(Object.create(Object.getPrototypeOf(wb)),wb,{changes,mapCollisions:bindings});
  validateBackgroundMemory(candidate,updates);
  const disconnectedBindings=wb.mapCollisions.size-bindings.size;
  wb.changes=changes;wb.mapCollisions=bindings;wb.mapHistory.clear();wb.textureLibrary.reset();wb.modelPlan=null;wb.animationPlan=null;wb.mergePlan=null;
  return {...wb.snapshot(),mergeReport:{assets:updates.length,disconnectedBindings}};
}

/** Export only replacement assets with their original identities and hashes. */
export function exportModPackage(wb,file) {
  wb.assertSources();requireThat(wb.changes.size,'Stage replacements before exporting a mod package.');
  const assets=[...wb.changes].map(([key,change])=>{const {archive,entry}=wb.get(key);return {archive:archive.relativePath||path.basename(archive.file),index:entry.index,name:entry.name,originalHash:change.originalHash,data:change.data.toString('base64')};});
  writeNew(file,JSON.stringify({format:'sh3tools-mod-v1',assets}));return {file,assets:assets.length};
}
