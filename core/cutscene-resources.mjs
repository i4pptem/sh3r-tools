import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import profile from './cutscene-profile.json' with {type:'json'};
import {requireThat,range} from './binary.mjs';

/** Read scene resource references from the user's executable; no game tables are bundled. */
export function readSceneResources(buffer) {
  range(buffer,0,64,'PE header'); const pe=buffer.readUInt32LE(60);range(buffer,pe,84,'PE header');
  requireThat(buffer.readUInt16LE(0)===0x5a4d && buffer.readUInt32LE(pe)===0x4550 && buffer.readUInt16LE(pe+4)===0x14c && buffer.readUInt16LE(pe+24)===0x10b && buffer.readUInt32LE(pe+52)===0x400000,'Unsupported scene metadata executable.');
  const count=buffer.readUInt16LE(pe+6),table=pe+24+buffer.readUInt16LE(pe+20);
  requireThat(count>0&&count<=96,'Invalid PE section table.');range(buffer,table,count*40,'PE sections');
  const read=(va,size)=>{
    for(let i=0;i<count;i++) {const p=table+i*40,rva=buffer.readUInt32LE(p+12),length=buffer.readUInt32LE(p+16);
      if(va-0x400000>=rva && va-0x400000+size<=rva+length) {const offset=buffer.readUInt32LE(p+20)+va-0x400000-rva;range(buffer,offset,size,'Scene metadata');return buffer.subarray(offset,offset+size);}}
    throw new Error('Scene metadata is outside the executable sections.');
  };
  for(const signature of profile.signatures) requireThat(createHash('sha256').update(read(signature.address,signature.length)).digest('hex')===signature.sha256,'This executable uses an unsupported scene-code profile.');
  const scenes=profile.descriptors.map(({stage,address})=>{
    const data=read(address,76),afsId=read(0x6D6890+stage*4,4).readUInt32LE(0);
    requireThat(afsId<35,'Invalid scene archive index.');
    const archive=read(0x6D6200+afsId*16,16).toString('ascii').split('\0')[0];
    requireThat(/^[a-z0-9_]+\.afs$/i.test(archive),'Invalid scene archive name.');
    const backgroundStage=read(0x6B7100+stage,1)[0];requireThat(backgroundStage<=20,'Unsupported background stage.');
    const pointer=backgroundStage?read(0x6B7128+backgroundStage*4,4).readUInt32LE(0):0;
    const mapPrefix=pointer?read(pointer,3).toString('ascii').split('\0')[0]:null;
    requireThat(!mapPrefix||/^[a-z]{2}$/.test(mapPrefix),'Invalid background prefix.');
    return {stage,address,archive,backgroundStage,mapPrefix,sceneId:data[20],packEntry:data.readUInt32LE(0),audioEntry:data.readInt32LE(4),skipAudioEntry:data.readInt32LE(8),
      actors:Array.from({length:8},(_,i)=>({modelId:data.readUInt16LE(24+i*4),instanceId:data.readUInt16LE(26+i*4)})).filter(a=>a.modelId)};
  });
  const modelNames={};
  const resourceName=id=>{
    requireThat(id>0&&id<318,'Invalid native model resource ID.');const pointer=read(0x710C90+id*4,4).readUInt32LE(0);
    const bytes=[];for(let i=0;i<128;i++){const value=read(pointer+i,1)[0];if(!value)break;bytes.push(value);}
    const name=Buffer.from(bytes).toString('ascii');requireThat(/^data\/[a-z0-9_/.-]+$/i.test(name),'Invalid native model resource name: '+name);return name;
  };
  for(let i=0;i<177;i++){const row=read(0x711188+i*8,8),modelId=row.readUInt16LE(0);if(!modelId)break;if(modelNames[modelId]===undefined&&row.readUInt16LE(2)){const name=resourceName(row.readUInt16LE(2));if(/\.mdl_?$/i.test(name))modelNames[modelId]=name;}}
  // Player costume is selected by game/save state; preview defaults to the ordinary costume.
  const player=read(0x711710,8);requireThat(player.readUInt16LE(0)===1,'Unsupported player costume table.');modelNames[0x100]=resourceName(player.readUInt16LE(2));
  return {scenes,modelNames};
}

export function localSceneResources(dataRoot) {
  if(!dataRoot)return {scenes:[],modelNames:{},note:'Open the complete game data folder to resolve native scene resources.'};
  const file=path.join(path.dirname(dataRoot),'sh3.exe');
  if(!fs.existsSync(file))return {scenes:[],modelNames:{},note:'sh3.exe was not found beside data. Camera and character tracks are available; choose the soundtrack and environment manually.'};
  try{return {...readSceneResources(fs.readFileSync(file)),note:null};}
  catch(error){return {scenes:[],modelNames:{},note:error.message+' Choose the soundtrack and environment manually.'};}
}

/** Native indoor grid lookup. City streets use a separate room remapping table. */
export function sceneMapName(native,x,z) {
  if(!native?.mapPrefix||native.backgroundStage===12)return null;
  const multiplier=Math.fround(.000025);
  const code=Math.trunc(x*multiplier)*16+(x<0?0xF0:0x10)+Math.trunc(z*multiplier)+(z<0?0x0F:1);
  if(code<0||code>255)return null;
  return native.mapPrefix+code.toString(16).padStart(2,'0')+'.map';
}

export function sceneEnvironment(native,camera,maps) {
  const names=new Set();
  for(let frame=0;frame<camera.frameCount;frame++)for(const offset of [0,3]) {
    const index=frame*8+offset;const name=sceneMapName(native,camera.values[index]*50,-camera.values[index+2]*50);
    if(name)names.add(name);
  }
  return maps.filter(map=>names.has(map.name.replaceAll('\\','/').split('/').pop().toLowerCase())).map(map=>map.key);
}
