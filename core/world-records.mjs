import {range,requireThat} from './binary.mjs';

function floats(data,offset,count) {
  range(data,offset,count*4);
  const values=Array.from({length:count},(_,i)=>data.readFloatLE(offset+i*4));
  requireThat(values.every(Number.isFinite),'World record contains a non-finite coordinate.');return values;
}

/** Decode fixed camera zone records; camera behavior parameters remain unmodified. */
export function cameraRecords(data) {
  requireThat(data.length>=128&&data.length%128===0,'CAM must contain complete 128-byte camera records.');
  const records=[];let terminator=-1;
  for(let offset=0;offset<data.length;offset+=128) {
    const flags=data.readUInt32LE(offset+68);
    if(flags===1){terminator=offset;break;}
    const active=floats(data,offset,8),constraint=floats(data,offset+32,8);
    records.push({index:records.length,kindId:data.readInt32LE(offset+64),flags,
      activeGroundPoints:[[active[0],active[1]],[active[2],active[3]],[active[4],active[5]]],activeHeights:active.slice(6),
      constraintGroundPoints:[[constraint[0],constraint[1]],[constraint[2],constraint[3]],[constraint[4],constraint[5]]],constraintHeights:constraint.slice(6),
      areaSizeType:data.readInt32LE(offset+72),roadType:data.readInt32LE(offset+76),verticalMovementType:data.readInt32LE(offset+80),
      watchHeightOffset:data.readFloatLE(offset+84),traceBottomHeight:data.readFloatLE(offset+88),roadDirectionType:data.readInt32LE(offset+92),
      projection:floats(data,offset+96,3),cameraMovementType:data.readInt32LE(offset+108),movementParameters:floats(data,offset+112,4),
      parameterWords:Array.from({length:16},(_,i)=>data.readUInt32LE(offset+64+i*4))});
  }
  requireThat(terminator>=0,'CAM end marker is missing.');
  const nameEnd=data.indexOf(0,terminator),sourceName=data.subarray(terminator,Math.min(nameEnd<0?terminator+64:nameEnd,terminator+64)).toString('ascii');
  return {format:'SH3 camera zones',recordSize:128,count:records.length,records,
    sourceName:/^[\w .-]+\.cam$/i.test(sourceName)?sourceName:null,
    note:'Activation and camera constraint volumes are displayed as prisms. Camera movement settings are inspected only; no cutscene playback is implied.'};
}

/** Decode the ten bounded light tables present in PC room DED files. */
export function drawEnvironmentRecords(data) {
  range(data,0,112,'DED header');
  const environmentOffset=data.readUInt32LE(84);
  requireThat(environmentOffset>=112&&environmentOffset<=data.length,'DED environment offset is outside the payload.');
  const kinds=[1,2,3,4,10,11,12,13,14,15],strides=[32,32,48,64,48,48,48,64,64,64],tables=[],spans=[];
  for(let table=0;table<10;table++) {
    const count=data.readUInt32LE(4+table*8),offset=data.readUInt32LE(8+table*8),stride=strides[table];
    requireThat(count<=10000,'DED light count exceeds the preview limit.');
    if(!count)continue;
    requireThat(offset>=112&&offset+count*stride<=environmentOffset,'DED light table exceeds its section.');
    range(data,offset,count*stride,'DED light table');spans.push([offset,offset+count*stride]);
    const records=Array.from({length:count},(_,index)=>{
      const p=offset+index*stride,record={index,offset:p,color:floats(data,p,4),packedIdentifier:data.readUInt32LE(p+stride-4)};
      if(stride===32)record.direction=floats(data,p+16,3);
      else {
        record.parameters=floats(data,p+16,4);record.position=floats(data,p+32,3);
        if(stride===64)record.direction=floats(data,p+48,3);
      }
      return record;
    });
    tables.push({table,kind:kinds[table],recordSize:stride,count,offset,
      category:[10,11].includes(kinds[table])?'Point lights':[13,14].includes(kinds[table])?'Spot lights':`Light type ${kinds[table]}`,records});
  }
  spans.sort((a,b)=>a[0]-b[0]);for(let i=1;i<spans.length;i++)requireThat(spans[i][0]>=spans[i-1][1],'DED light tables overlap.');
  return {format:'SH3 room lighting and effects',roomId:data.readUInt16LE(0),flags:data.readUInt16LE(2),tables,
    lightCount:tables.reduce((sum,table)=>sum+table.count,0),environmentOffset,environmentBytes:data.length-environmentOffset,
    environmentWords:Array.from({length:Math.floor((data.length-environmentOffset)/4)},(_,i)=>data.readUInt32LE(environmentOffset+i*4)),
    note:'Light table colors, vectors and parameters are decoded. The environment block and some light types remain unidentified. This file is not a skeletal animation clip.'};
}

/** Inspect PC sound regions and controls without claiming that their words are audio samples. */
export function soundDatabaseRecords(data) {
  requireThat(data.length>=192&&data.length%96===0,'SDB must contain complete 96-byte sound-region records.');
  const records=[];let sourceName,terminated=false;
  for(let offset=0;offset<data.length;offset+=96) {
    const flags=data.readUInt32LE(offset+28);
    if(flags===0x80000000) {
      requireThat(offset+96===data.length,'Unexpected records after the SDB end marker.');
      const name=data.subarray(offset,offset+24),end=name.indexOf(0);sourceName=name.subarray(0,end<0?name.length:end).toString('ascii');terminated=true;break;
    }
    const coordinates=floats(data,offset,6),globalDefault=records.length===0&&coordinates.every(value=>Math.abs(value)===9900000256);
    records.push({index:records.length,kind:globalDefault?'Global default':'Region',coordinates,
      controlId:data.readUInt32LE(offset+24),flags,controlWords:Array.from({length:16},(_,i)=>data.readUInt32LE(offset+32+i*4))});
  }
  requireThat(terminated,'SDB end marker is missing.');
  return {format:'SH3 sound-region database',sourceName,recordSize:96,count:records.length,records,
    note:'Spatial sound-region coordinates and control words are inspected. Channel assignments and playback rules are not fully decoded; this is not a playable audio stream.'};
}
