import profile from './map-geometry-runtime-profile.json' with {type:'json'};
import {peLayout} from './morph-runtime.mjs';
import {align,range,requireThat} from './binary.mjs';
const NAME='.sh3tr01',HEADER=72,MAGIC=Buffer.from('SH3TR01\0');
function codeAt(address){const code=Buffer.from(profile.code,'hex');for(const at of profile.externalRelativeBranches)code.writeInt32LE(code.readInt32LE(at)+profile.base-address,at);return code;}
function jump(address,to){const code=Buffer.alloc(5);code[0]=0xe9;code.writeInt32LE(to-address-5,1);return code;}
function replace(data,layout,patch,expected,value){const at=layout.offset(patch.address);range(data,at,5);requireThat(data.subarray(at,at+5).equals(expected),'Transparent queue instruction differs at 0x'+patch.address.toString(16));value.copy(data,at);}

/** Restore exact authored code and section headers before authenticating the complete EXE. */
export function restoreMapGeometryRuntime(source){
  const layout=peLayout(source),index=layout.sections.findIndex((_,i)=>source.toString('ascii',layout.table+i*40,layout.table+i*40+8)===NAME);
  if(index<0)return {data:source,hasMapGeometry:false};
  requireThat(index===layout.count-1,'Transparent queue section order differs.');
  const section=layout.sections[index],at=layout.table+index*40,address=layout.imageBase+section.rva+HEADER,code=codeAt(address);
  const rawSize=align(HEADER+code.length,source.readUInt32LE(layout.optional+36));
  requireThat(section.size===HEADER+code.length&&section.rawSize===rawSize&&section.raw+rawSize===source.length,'Transparent queue section size differs.');
  requireThat(source.readUInt32LE(at+36)===0x60000020&&source.subarray(at+24,at+36).every(b=>!b),'Transparent queue section flags differ.');
  range(source,section.raw,rawSize);const h=source.subarray(section.raw,section.raw+HEADER),length=h.readUInt32LE(8);
  requireThat(h.subarray(0,8).equals(MAGIC)&&h.subarray(20,32).every(b=>!b),'Unknown transparent queue metadata.');
  const rawEnd=Math.max(...layout.sections.slice(0,index).map(s=>s.raw+s.rawSize));
  requireThat(length>=rawEnd&&length<=section.raw&&align(length,source.readUInt32LE(layout.optional+36))===section.raw,'Invalid transparent queue original length.');
  requireThat(source.subarray(length,section.raw).every(b=>!b)&&source.subarray(section.raw+HEADER+code.length).every(b=>!b),'Unexpected transparent queue padding.');
  requireThat(source.subarray(section.raw+HEADER,section.raw+HEADER+code.length).equals(code),'Transparent queue code differs.');
  const data=Buffer.from(source.subarray(0,length));
  for(const patch of profile.patches)replace(data,layout,patch,jump(patch.address,address+patch.entry),Buffer.from(patch.expected,'hex'));
  h.subarray(32,72).copy(data,at);data.writeUInt16LE(index,layout.pe+6);data.writeUInt32LE(h.readUInt32LE(12),layout.optional+4);data.writeUInt32LE(h.readUInt32LE(16),layout.optional+56);
  return {data,hasMapGeometry:true};
}

/** Flush the shared native queue before selecting a descriptor; preserve original batch capacities. */
export function expandMapGeometryRuntime(source){
  const layout=peLayout(source),at=layout.table+layout.count*40,firstRaw=Math.min(...layout.sections.filter(s=>s.rawSize).map(s=>s.raw));
  requireThat(at+40<=firstRaw&&at+40<=source.readUInt32LE(layout.optional+60),'No room for transparent queue section header.');
  requireThat((source.readUInt16LE(layout.pe+22)&1)&&!(source.readUInt16LE(layout.optional+70)&0x40),'Relocatable EXE needs another transparent queue profile.');
  const alignment=source.readUInt32LE(layout.optional+32),fileAlignment=source.readUInt32LE(layout.optional+36);
  const rva=align(Math.max(...layout.sections.map(s=>s.rva+Math.max(s.size,s.rawSize))),alignment),address=layout.imageBase+rva+HEADER,code=codeAt(address);
  const raw=align(source.length,fileAlignment),rawSize=align(HEADER+code.length,fileAlignment),data=Buffer.alloc(raw+rawSize);source.copy(data);MAGIC.copy(data,raw);
  data.writeUInt32LE(source.length,raw+8);data.writeUInt32LE(source.readUInt32LE(layout.optional+4),raw+12);data.writeUInt32LE(source.readUInt32LE(layout.optional+56),raw+16);
  source.subarray(at,at+40).copy(data,raw+32);code.copy(data,raw+HEADER);
  for(const patch of profile.patches)replace(data,layout,patch,Buffer.from(patch.expected,'hex'),jump(patch.address,address+patch.entry));
  data.fill(0,at,at+40);data.write(NAME,at,8,'ascii');data.writeUInt32LE(HEADER+code.length,at+8);data.writeUInt32LE(rva,at+12);data.writeUInt32LE(rawSize,at+16);data.writeUInt32LE(raw,at+20);data.writeUInt32LE(0x60000020,at+36);
  data.writeUInt16LE(layout.count+1,layout.pe+6);data.writeUInt32LE(source.readUInt32LE(layout.optional+4)+rawSize,layout.optional+4);data.writeUInt32LE(align(rva+HEADER+code.length,alignment),layout.optional+56);
  return {data,report:{patch:profile.id,instructionCount:profile.patches.length,...profile.limits,runtimeVerified:false}};
}
