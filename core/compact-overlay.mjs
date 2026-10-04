import fs from 'node:fs';
import path from 'node:path';
import {requireThat,sha256,fileHash,safeOutput,writeNew,MAX_ASSET} from './binary.mjs';
import {planAfsLayout} from './afs-layout.mjs';
import {entryBytes} from './archives.mjs';

const normalized=value=>String(value).replaceAll('\\','/').toLowerCase();
const word=n=>{requireThat(Number.isInteger(n)&&n>=0&&n<=0xffffffff,'Compact overlay value exceeds 32 bits.');const b=Buffer.alloc(4);b.writeUInt32LE(n);return b;};
const string=s=>{const b=Buffer.from(s,'utf8');requireThat(b.length>0&&b.length<1024&&!b.includes(0),'Invalid compact overlay path.');return Buffer.concat([word(b.length),b]);};

/** Write changed payloads and metadata for a sector-ordered virtual AFS. */
export function writeCompactArchive(archive,replacements,folder,progress=()=>{}) {
  const layout=archive.format==='AFS'?planAfsLayout(archive,replacements):null;
  const changes=[],relative=normalized('data/'+archive.relativePath);
  safeOutput(folder,relative);
  for(const [index,data] of replacements){
    const entry=archive.entries[index];requireThat(entry&&data.length>0&&data.length<=MAX_ASSET,'Invalid compact replacement.');
    requireThat(archive.format!=='ARC'||entry.name.toLowerCase().startsWith('data/'),'Open the game data folder to resolve native ARC asset names before building a compact overlay.');
    const file=archive.format==='ARC'?normalized(entry.name):`${relative}.entries/entry_${String(index).padStart(5,'0')}.${entry.detectedFormat||'bin'}`;
    const offset=layout?.entries[index].offset??0;
    writeNew(safeOutput(folder,file),data);
    requireThat(fileHash(safeOutput(folder,file))===sha256(data),'Compact asset verification failed.');
    changes.push({index,name:entry.name,file,size:data.length,offset,before:sha256(entryBytes(archive,index)),after:sha256(data)});
    progress({message:`Writing changed assets from ${archive.name}`,done:changes.length,total:replacements.size});
  }
  return {format:archive.format,compact:true,file:relative,source:archive.file,sourceHash:fileHash(archive.file),sourceSize:archive.size,
    virtualSize:layout?.size??archive.size,entries:archive.entries.length,changes,
    ...(layout?{layout:{header:layout.header.toString('base64'),extents:layout.extents}}:{})};
}

/** Authenticate original archive identities and changed payloads, without embedding either archive. */
export function writeCompactManifest(folder,reports,catalogFile=null) {
  const sources=reports.filter(r=>r.compact),count=sources.reduce((n,r)=>n+r.changes.length,0);
  if(catalogFile&&sources.some(source=>source.format==='ARC')){const size=fs.statSync(catalogFile).size;sources.push({format:'ARC',file:'data/arc.arc',sourceHash:fileHash(catalogFile),sourceSize:size,virtualSize:size,changes:[]});}
  requireThat(sources.length<=512&&count<=32768,'Too many compact overlay assets.');
  const chunks=[Buffer.from('SH3DATA2'),word(2),word(sources.length),word(count)],names=new Set();
  for(const source of sources){
    const header=source.layout?Buffer.from(source.layout.header,'base64'):Buffer.alloc(0),extents=source.layout?.extents||[];
    chunks.push(word(source.format==='ARC'?1:2),word(source.sourceSize),word(source.virtualSize),string(source.file),Buffer.from(source.sourceHash,'hex'),word(header.length),header,word(extents.length));
    for(const extent of extents)chunks.push(word(extent.offset),word(extent.sourceOffset),word(extent.size));
  }
  for(const [i,source] of sources.entries())for(const change of source.changes){
    const name=source.format==='ARC'?normalized(change.name):`${source.file}:${change.index}`;
    requireThat(!names.has(name),'Duplicate native asset path in compact overlay.');names.add(name);
    chunks.push(word(i),word(change.index),string(name),string(change.file),word(change.size),word(change.offset),Buffer.from(change.after,'hex'));
  }
  const body=Buffer.concat(chunks);requireThat(body.length<=4*1024*1024,'Compact overlay metadata exceeds 4 MiB.');
  writeNew(path.join(folder,'SH3Tools.assets'),Buffer.concat([body,Buffer.from(sha256(body),'hex')]));
}

/** Read a virtual AFS interval for layout tests and tooling; the native ASI uses the same extents. */
export function readVirtualAfs(source,report,payloads,offset,length) {
  requireThat(Number.isSafeInteger(offset)&&offset>=0&&Number.isSafeInteger(length)&&length>=0,'Invalid virtual read.');
  const end=Math.min(report.virtualSize,offset+length),out=Buffer.alloc(Math.max(0,end-offset));
  for(const extent of report.layout.extents){
    const begin=Math.max(offset,extent.offset),stop=Math.min(end,extent.offset+extent.size);
    if(begin<stop)source.copy(out,begin-offset,extent.sourceOffset+begin-extent.offset,extent.sourceOffset+stop-extent.offset);
  }
  const header=Buffer.from(report.layout.header,'base64');
  if(offset<header.length)header.copy(out,0,offset,Math.min(end,header.length));
  for(const change of report.changes){
    for(const [at,bytes] of [[change.offset,payloads.get(change.index)]]){
      const begin=Math.max(offset,at),stop=Math.min(end,at+bytes.length);
      if(begin<stop)bytes.copy(out,begin-offset,begin-at,stop-at);
    }
  }
  return out;
}
