import test from 'node:test';
import assert from 'node:assert/strict';
import {PNG} from 'pngjs';
import {stageBackgroundBudget} from '../core/background-budget.mjs';
import {validateBackgroundMemory} from '../core/map-memory.mjs';
import {rebuildMapTexture} from '../core/map-texture.mjs';
import {readTextures} from '../core/textures.mjs';
import {parseMap} from '../core/world-formats.mjs';
import {mapFixture} from './helpers/map-fixture.mjs';
import {editMap} from '../core/map-edit.mjs';
import {exportMapPart,importMapPart} from '../core/map-part.mjs';
import {mapEditDefaults} from '../app/ui/map-drafts.mjs';

test('MAP full size preserves geometry prefix and material identity while retaining exact PNG pixels',()=>{
 const original=mapFixture(),offset=original.readUInt32LE(16),data=Buffer.alloc(257*129*4);for(let i=0;i<data.length;i++)data[i]=i*31&255;
 const output=rebuildMapTexture(original,0,PNG.sync.write({width:257,height:129,data}));
 assert.deepEqual(output.subarray(0,offset),original.subarray(0,offset));assert.deepEqual(parseMap(output).groups,parseMap(original).groups);
 const image=readTextures(output.subarray(offset))[0];assert.equal(image.width,257);assert.equal(image.height,129);assert.deepEqual(image.rgba,data);
 assert.throws(()=>rebuildMapTexture(Buffer.concat([original,Buffer.alloc(16)]),0,PNG.sync.write({width:257,height:129,data})),/terminal/);
});
test('room memory includes shared textures and two resident rooms, aligned at native boundaries',()=>{
 const maps=['data/tmp/am11.map','data/tmp/am12.map'],sizes=new Map([[maps[0],12*1048576],[maps[1],12*1048576],['data/tmp/amGB.tex',1048576+1],['data/bg/am/am11.cld',65535]]);
 const first=stageBackgroundBudget(maps,name=>sizes.get(name));assert.equal(first.commonBytes,3276800);assert.equal(first.rooms[0].roomBytes,12*1048576+65536);assert.equal(first.conservativeTransitionFits,true);
 sizes.set('data/tmp/amGB.tex',12*1048576);assert.equal(stageBackgroundBudget(maps,name=>sizes.get(name)).conservativeTransitionFits,false);
});
test('growth checks require a complete catalog and account for outdoor tile transitions',()=>{
 const entries=[{key:'0:0',name:'data/tmp/cc11.map',size:1024}],wb={dataRoot:null,catalogPath:null,changes:new Map(),get:()=>({entry:entries[0]}),snapshot:()=>({entries})};
 assert.throws(()=>validateBackgroundMemory(wb,[{key:'0:0',data:Buffer.alloc(2048)}]),/complete game data/);
 wb.dataRoot='data';wb.catalogPath='arc.arc';assert.equal(validateBackgroundMemory(wb,[{key:'0:0',data:Buffer.alloc(2048)}])[0].requiresBackgroundPatch,false);
 assert.deepEqual(validateBackgroundMemory(wb,[{key:'0:0',data:Buffer.alloc(1024)}]),[]);
});
test('a part exported before static expansion remains importable without changing sibling visibility',()=>{
 const original=mapFixture(),world=parseMap(original),glb=exportMapPart(world,'Map_0_0');
 const expanded=editMap(original,{...mapEditDefaults('Map_0_0'),translation:[100,0,0]});
 assert.equal(parseMap(expanded).model.meshes[0].objectType,0);assert.equal(parseMap(expanded).model.meshes[1].objectType,1);
 const returned=importMapPart(expanded,'Map_0_0',glb,original);assert.equal(parseMap(returned).model.meshes[0].objectType,0);assert.deepEqual(parseMap(returned).model.meshes[0].positions,world.model.meshes[0].positions);
});

test('indoor and outdoor growth conditionally selects the expanded arena and retains its upper bound',()=>{
 for(const [stage,large,tooLarge]of [['am',40,255],['cc',5,33]]){
   const entries=[{key:'0:0',name:`data/tmp/${stage}11.map`,size:1024}],wb={dataRoot:'data',catalogPath:'arc.arc',changes:new Map(),get:()=>({entry:entries[0]}),snapshot:()=>({entries})};
   const report=validateBackgroundMemory(wb,[{key:'0:0',data:{length:large*1048576}}])[0];
   assert.equal(report.requiresBackgroundPatch,true);assert.equal(report.conservativeTransitionFits,true);
   assert.throws(()=>validateBackgroundMemory(wb,[{key:'0:0',data:{length:tooLarge*1048576}}]),/expanded 256 MiB/);
 }
});
