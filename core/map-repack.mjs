import {range, requireThat, MAX_ASSET} from './binary.mjs';

/** Relocate the absolute references in a MAP while preserving physical record strides. */
function references(data) {
  const pointers = [], records = [];
  for(const at of [4,8,20,40,44,60,72,76]) requireThat(data.readUInt32LE(at)===0,'Unsupported MAP root extension.');
  requireThat(data.readUInt32LE(16)===data.readUInt32LE(48),'MAP texture pointers disagree.');
  const pointer = at => {const value=data.readUInt32LE(at); if(value) {range(data,value,1,'MAP pointer'); pointers.push({at,value});} return value;};
  for(const at of [16,24,28,32,36,48,52,56]) pointer(at);
  const walk = (start, depth, parent) => {
    const seen = new Set();
    for(let at=start;at;) {
      requireThat(!seen.has(at),'Cyclic MAP hierarchy.'); seen.add(at); range(data,at,depth===3?64:48);
      const header=data.readUInt32LE(at+4), length=data.readUInt32LE(at+8), next=pointer(at);
      range(data,at,length); requireThat(header===(depth===3?64:48) && length>=header,'Unsupported MAP record layout.');
      requireThat(!next || next===at+length,'MAP link differs from its physical stride.');
      if(parent) requireThat(at>=parent.at+parent.header && at+length<=parent.at+parent.length,'MAP child leaves its parent.');
      const record={at,header,length,parent}; records.push(record);
      if(depth<3) walk(at+header,depth+1,record);
      at=next;
    }
  };
  const geometryStart=Math.min(...[28,32,36].map(at=>data.readUInt32LE(at)).filter(Boolean));
  let transform=data.readUInt32LE(24),visited=0;
  while(transform) {requireThat(++visited<4096 && transform+224<=geometryStart && data.readUInt32LE(transform+4)===32 && data.readUInt32LE(transform+8)===224,'Unsupported MAP transform layout.');const next=data.readUInt32LE(transform);transform=next?transform+next:0;}
  walk(Math.min(...[28,32,36].map(at=>data.readUInt32LE(at)).filter(Boolean)),0,null);
  const light=data.readUInt32LE(56);
  if(light) {
    range(data,light,32); const seen=new Set();
    for(let at=pointer(light);at;) {
      requireThat(!seen.has(at),'Cyclic MAP light records.'); seen.add(at); range(data,at,112);
      const positions=pointer(at+80), values=pointer(at+84);
      if(positions) range(data,positions,data.readUInt16LE(at+64)*16);
      if(values) range(data,values,data.readUInt16LE(at+66)*48);
      at=pointer(at+88);
    }
  }
  return {pointers,records};
}

export function mapPartReplacementIssue(data, mesh) {
  const {offset,header,length}=mesh.layout, end=header+mesh.vertexCount*36;
  if(header!==64 || length!==end || !data.subarray(offset+32,offset+64).every(v=>v===0))
    return 'This part has a special native payload. Shape/UV edits with the original topology are supported; new topology requires its payload decoder.';
  return null;
}

/** Replace one plain vertex strip, retaining every other part, suffix and identity. */
export function repackMapPart(data, mesh, vertices) {
  requireThat(!mapPartReplacementIssue(data,mesh),mapPartReplacementIssue(data,mesh));
  requireThat(vertices.length%36===0 && vertices.length/36<=2000000,'Replacement exceeds the MAP vertex limit.');
  const {pointers,records}=references(data), record=records.find(r=>r.at===mesh.layout.offset);
  const start=record.at+record.header, end=record.at+record.length;
  const roots=records.filter(r=>!r.parent), geometryEnd=roots.at(-1).at+roots.at(-1).length;
  const suffix=Math.min(...[16,48,52,56].map(at=>data.readUInt32LE(at)).filter(Boolean));
  requireThat(Number.isFinite(suffix) && suffix>=geometryEnd && data.subarray(geometryEnd,suffix).every(v=>v===0),'Unsupported MAP geometry/suffix gap.');
  const delta=record.header+vertices.length-record.length, gap=suffix-geometryEnd;
  const suffixDelta=delta===0?0:128*Math.ceil((delta-gap)/128), newGap=gap+suffixDelta-delta;
  requireThat(data.length+suffixDelta<=MAX_ASSET,'Rebuilt MAP exceeds 256 MiB.');
  const output=Buffer.concat([data.subarray(0,start),vertices,data.subarray(end,geometryEnd),Buffer.alloc(newGap),data.subarray(suffix)]);
  const relocate=at=>at>=suffix?at+suffixDelta:at>=end?at+delta:at;
  for(const ref of pointers) {
    requireThat((ref.value<start || ref.value>=end) && (ref.value<geometryEnd || ref.value>=suffix),'MAP pointer references replaced vertices or padding.');
    output.writeUInt32LE(relocate(ref.value),relocate(ref.at));
  }
  for(let ancestor=record;ancestor;ancestor=ancestor.parent) output.writeUInt32LE(ancestor.length+delta,ancestor.at+8);
  output.writeUInt32LE(vertices.length/36,record.at+16);
  references(output);
  return output;
}
