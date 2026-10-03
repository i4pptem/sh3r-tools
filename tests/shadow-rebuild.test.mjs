import test from 'node:test';
import assert from 'node:assert/strict';
import {rebuildShadow,shadowBlocks,shadowCompanion,stageModelWithShadow} from '../core/shadow-rebuild.mjs';
import {texturedModelFixture} from './helpers/model-fixture.mjs';

function block(){const data=Buffer.alloc(160);data.writeInt16LE(1,4);data.writeInt16LE(1,22);[3,6,5,3].forEach((n,i)=>data.writeInt16LE(n,112+i*2));return data;}
test('KG1 rebuild updates every block and emits closed integer bone volumes within native budgets',()=>{
 const source=Buffer.concat([block(),block()]),model=texturedModelFixture(),result=rebuildShadow(source,model),blocks=shadowBlocks(result.data);
 assert.equal(blocks.length,2);assert.deepEqual(source,Buffer.concat([block(),block()]));
 for(const block of blocks){assert.equal(block.objects.length,1);const edges=new Map();let triangles=0;
   for(const offset of [0,6,8,10,12,14])assert.equal(block.header.readInt16LE(offset),0);
   for(const object of block.objects)for(const primitive of object.primitives){assert.equal(primitive.vertices,3);triangles++;
     const vertices=[16,24,40].map(at=>[0,2,4].map(k=>result.data.readInt16LE(primitive.offset+at+k)));
     const center=[0,2,4].map(k=>result.data.readInt16LE(primitive.offset+8+k)),radius=result.data.readInt16LE(primitive.offset+14);
     for(const vertex of vertices)assert.ok(Math.hypot(...vertex.map((v,k)=>v-center[k]))<=radius);
     for(let i=0;i<3;i++){const edge=[vertices[i].join(','),vertices[(i+1)%3].join(',')].sort().join('|');edges.set(edge,(edges.get(edge)||0)+1);}
   }
   assert.ok(triangles>0&&triangles<=24);assert.ok([...edges.values()].every(count=>count===2));
 }
});
test('KG1 companion matches the PC model path only in its owning archive',()=>{
 const wb={get:()=>({entry:{name:'data/pcchr/pl/chhaa.mdl'},archive:{entries:[{name:'data/chr/pl/pl_htr_alh.kg1',index:3}]}})};
 assert.equal(shadowCompanion(wb,'8:51'),'8:3');
});
test('invalid shadow resources cannot stage half a model replacement',()=>{
 const changes=new Map([['8:51',{data:Buffer.from('existing')}]]),wb={changes,
  get:()=>({entry:{name:'data/pcchr/pl/chhaa.mdl'},archive:{entries:[{name:'data/chr/pl/pl_htr_alh.kg1',index:3}]}}),bytes:()=>Buffer.from('bad KG1')};
 assert.throws(()=>stageModelWithShadow(wb,'8:51',texturedModelFixture(),'replacement'));
 assert.equal(changes.size,1);assert.equal(changes.get('8:51').data.toString(),'existing');
});


test('texture-only imports preserve the current custom shadow resource',()=>{
 const source=texturedModelFixture(),replacement=Buffer.from(source);replacement[replacement.length-1]^=1;
 const wb={get:()=>({entry:{name:'data/pcchr/pl/chhaa.mdl'},archive:{entries:[{name:'data/chr/pl/pl_htr_alh.kg1',index:3}]}}),
   bytes:key=>{assert.equal(key,'8:51');return source;},stage:(key,data,label)=>({key,data,label})};
 const result=stageModelWithShadow(wb,'8:51',replacement,'texture');assert.deepEqual(result.data,replacement);
});

test('native costume aliases and explicit no-shadow models override matching basenames',()=>{
 const entries=[{index:0,name:'data/chr/pl/chhaa.kg1'},{index:34,name:'data/chr/pl/pl_htr_alh.kg1'},{index:40,name:'data/chr/pl/rchhaa.kg1'}];
 for(const model of ['chhaa','chhbb'])assert.equal(shadowCompanion({get:()=>({entry:{name:`data/pcchr/pl/${model}.mdl`},archive:{entries}})},'8:51'),'8:34');
 assert.equal(shadowCompanion({get:()=>({entry:{name:'data/pcchr/pl/rchhaa.mdl'},archive:{entries}})},'8:51'),null);
});
