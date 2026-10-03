import test from 'node:test';
import assert from 'node:assert/strict';
import {stageModelWithShadow} from '../core/shadow-rebuild.mjs';
import {parseModel} from '../core/model.mjs';
import {texturedModelFixture} from './helpers/model-fixture.mjs';

test('incompatible edited costumes cannot silently overwrite a shared shadow; explicit owner selection can',()=>{
 const original=texturedModelFixture(),other=Buffer.from(original),current=Buffer.from(original),layout=parseModel(original).meshes[0].layout;
 other.writeFloatLE(30,layout.offset+layout.header);current.writeFloatLE(-40,layout.offset+layout.header);
 const shadow=Buffer.alloc(160);shadow.writeInt16LE(1,4);shadow.writeInt16LE(1,22);[3,6,5,3].forEach((n,i)=>shadow.writeInt16LE(n,112+i*2));
 const entries=[{index:0,name:'data/chr/pl/pl_htr_alh.kg1'},{index:1,name:'data/pcchr/pl/chhaa.mdl'},{index:2,name:'data/pcchr/pl/chhbb.mdl'}];
 const changes=new Map([['0:2',{data:other}]]),wb={changes,
  get:key=>({archive:{entries},entry:entries[Number(key.split(':')[1])]}),
  bytes:key=>key==='0:0'?shadow:changes.get(key)?.data||original,originalBytes:()=>original,
  prepareChange:(_key,data,label)=>({data,label}),textureLibrary:{reset(){}},snapshot:()=>({changes:[...changes]})};
 assert.throws(()=>stageModelWithShadow(wb,'0:1',current,'model'),/share.*different shadow shapes/);
 assert.equal(changes.size,1);assert.equal(changes.get('0:2').data,other);
 const result=stageModelWithShadow(wb,'0:1',current,'model',true,true);
 assert.equal(changes.size,3);assert.equal(result.shadowReport.resource,'data/chr/pl/pl_htr_alh.kg1');
 assert.deepEqual(result.shadowReport.sharedModels,['data/pcchr/pl/chhbb.mdl']);
});
