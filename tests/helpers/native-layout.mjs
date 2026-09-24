/** Independent native layout checks, including fields not used by the app preview. */
export function validateNativeLayout(data) {
  function assert(condition, message) { if (!condition) throw new Error(message); }
  function range(offset, length, label, limit = data.length) {
    assert(Number.isSafeInteger(offset) && Number.isSafeInteger(length) && offset >= 0 && length >= 0 && offset + length <= limit, `${label}: outside payload`);
  }
  range(0, 32, 'Outer header');
  const base = data.readUInt32LE(20), texture = data.readUInt32LE(12);
  assert(texture === data.readUInt32LE(16), 'Texture pointer copies disagree');
  range(base, 128, 'Model header', texture);
  assert(data.readUInt32LE(base) === 0xffff0003, 'Not a PC MDL');
  const u = offset => data.readUInt32LE(base + offset);
  const bones = u(12), pairs = u(20), nodes = u(68), targets = u(76);
  assert(pairs <= 256, 'Exceeds conservative pair matrix capacity');
  assert(nodes <= 32768, 'Exceeds signed PC cluster-node index range');
  for (const [pointer, bytes, label] of [[8,bones*64,'Bones'],[16,bones,'Parents'],[24,pairs*2,'Pairs'],[28,pairs*64,'Pair matrices'],[52,u(48)*4,'Texture table'],[60,u(56)*8,'Materials'],[72,nodes*12,'Morph bases'],[80,targets*8,'Morph descriptors'],[92,16,'Hit data'],[96,128,'Box data']]) range(base+u(pointer), bytes,label,texture);
  for (let t=0;t<targets;t++) {
    const p=base+u(80)+t*8,n=data.readUInt32LE(p),start=base+data.readUInt32LE(p+4),seen=new Set();
    range(start,n*14,`Target ${t}`,texture);
    for(let i=0;i<n;i++) {const vertex=data.readUInt16LE(start+i*14+12); assert(vertex<nodes && !seen.has(vertex),`Target ${t}: invalid/duplicate node`);seen.add(vertex);}
  }
  let meshCount=0,vertexCount=0,morphReferences=0,maxPalette=0,nonUnitWeights=0;
  const spans=[];
  for(const [countField,startField] of [[32,36],[40,44]]) {
    let offset=base+u(startField);
    for(let i=0;i<u(countField);i++) {
      range(offset,160,'Mesh prefix',texture);
      const m=k=>data.readUInt32LE(offset+k),size=m(0),header=m(8),n=m(68),indices=m(76),primary=m(28),secondary=m(36);
      range(offset,size,'Mesh block',texture);assert(size%16===0,'Unaligned mesh size');
      assert(header===m(64),'Mesh vertex-start copies disagree');
      assert(indices===m(16),'Mesh strip-count copies disagree');
      assert(primary+secondary<=16,'Exceeds PC shader palette capacity');
      maxPalette=Math.max(maxPalette,primary+secondary);
      const stride=(m(72)-header)/n;assert(stride===32||stride===48,'Invalid stride');
      for(const [start,length,label] of [[m(24),m(20)*6,'Morph refs'],[m(32),primary*2,'Bone palette'],[m(40),secondary*2,'Pair palette'],[m(56),m(52)*2,'Material indices'],[m(60),16,'Final header block'],[header,n*stride,'Vertices'],[m(72),indices*4,'Indices']]) range(start,length,label,size);
      for(let j=0;j<indices;j++) assert(data.readUInt32LE(offset+m(72)+j*4)<n,'Invalid strip index');
      const destinations=new Set();
      for(let r=0;r<m(20);r++) {
        const p=offset+m(24)+r*6,src=data.readUInt16LE(p),dst=data.readUInt16LE(p+2),count=data.readUInt16LE(p+4);
        assert(count>0 && src+count<=nodes && dst+count<=n,'Invalid morph reference range');
        for(let j=0;j<count;j++){assert(!destinations.has(dst+j),'Overlapping destination morph ranges');destinations.add(dst+j);}
      }
      for(let v=0;v<n && stride===48;v++) {
        const p=offset+header+v*stride,first=data[p+24];
        assert(first<primary,'First influence must name a primary palette slot');
        const basis=data.readUInt16LE(offset+m(32)+first*2);assert(basis<bones,'Invalid primary bone');
        let sum=0;
        for(let j=0;j<3;j++) {
          const weight=data.readFloatLE(p+12+j*4),slot=data[p+24+j];sum+=weight;
          assert(Number.isFinite(weight)&&weight>=0&&weight<=1.001,'Invalid native skin weight');
          if(!weight)continue;
          if(slot<primary) assert(data.readUInt16LE(offset+m(32)+slot*2)===basis,'Secondary direct slot changes native position space');
          else {
            assert(slot<primary+secondary,'Invalid pair palette slot');
            const pair=data.readUInt16LE(offset+m(40)+(slot-primary)*2);assert(pair<pairs,'Invalid global pair index');
            const pairOffset=base+u(24)+pair*2;
            assert(data[pairOffset]===basis && data[pairOffset+1]<bones,'Pair matrix belongs to a different primary basis');
          }
        }
        assert(sum>0,'Native weights are all zero'); if(Math.abs(sum-1)>0.001)nonUnitWeights++;
      }
      spans.push([offset,offset+size]);meshCount++;vertexCount+=n;morphReferences+=m(20);offset+=size;
    }
  }
  spans.sort((a,b)=>a[0]-b[0]);for(let i=1;i<spans.length;i++)assert(spans[i][0]>=spans[i-1][1],'Mesh groups overlap');
  return {bytes:data.length,textureOffset:texture,bones,pairs,nodes,targets,meshCount,vertexCount,morphReferences,maxPalette,nonUnitWeights};
}
