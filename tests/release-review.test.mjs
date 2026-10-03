import test from 'node:test';
import assert from 'node:assert/strict';
import {buildReview,buildFingerprint} from '../core/build-review.mjs';
import {modelDiagnostics} from '../core/model-review.mjs';
import {animationChannels} from '../core/animation-channels.mjs';
import {worldName,actionName} from '../core/world-action-names.mjs';
import {parseModel} from '../core/model.mjs';
import {texturedModelFixture} from './helpers/model-fixture.mjs';
import {Workbench} from '../core/workbench.mjs';
import {exportGlb} from '../core/gltf.mjs';

test('build review reports validator failure as blocking and fingerprints staged bytes',()=>{
 const wb={changes:new Map([['0:0',{data:Buffer.from('first'),label:'Test'}]]),get:()=>({entry:{name:'image.tex',extension:'tex',size:4},archive:{name:'test.arc'}}),prepareChange(){},buildRequirements(){throw new Error('Source changed');}};
 const a=buildReview(wb);assert.equal(a.canBuild,false);assert.equal(a.assets.length,1);assert.match(a.issues[0].message,/Source changed/);const old=a.token;wb.changes.get('0:0').data=Buffer.from('second');assert.notEqual(old,buildFingerprint(wb));
 wb.buildRequirements=()=>({requiresFontPatch:true,fontScale:4});const b=buildReview(wb);assert.equal(b.canBuild,true);assert.equal(b.patches[0].reason,'4 × atlas scale');
 wb.changes.clear();assert.equal(buildReview(wb).canBuild,false);
});
test('model review identifies invalid weighted vertices and missing texture slots',()=>{
 const model=parseModel(texturedModelFixture());assert.equal(modelDiagnostics(model).issues.length,0);model.meshes[0].weights[0]=NaN;model.meshes[0].texture=100;
 const report=modelDiagnostics(model);assert.deepEqual(report.meshes[0].invalid,[0]);assert.equal(report.issues.filter(i=>i.severity==='error').length,2);
});
test('a reviewed candidate cannot stage after either source or review identity changes',()=>{
 const wb=new Workbench(),source=texturedModelFixture();let current=source;wb.bytes=()=>current;
 wb.get=()=>({archive:{entries:[]},entry:{name:'test.mdl'}});wb.stage=()=>{throw new Error('Unexpected stage');};
 const info=wb.prepareModelBytes('model',exportGlb(parseModel(source))),selection={meshes:info.inputs.map(input=>({input:input.index,template:input.template})),morphs:info.morphs};
 const review=wb.reviewModel('model',info.token,selection);assert.equal(wb.changes.size,0);assert.throws(()=>wb.applyModelReview('model',info.token,'wrong'),/reviewed model changed/);
 current=Buffer.from(source);current[current.length-1]^=1;assert.throws(()=>wb.applyModelReview('model',info.token,review.reviewHash),/reviewed model changed/);
});
test('ANM support table distinguishes rotation-only, root translation and runtime-controlled bones',()=>{
 const data=Buffer.alloc(4+34);data.writeUInt32LE(0x101c);data.writeUInt32LE(0x112,4);
 const model={bones:[{name:'bone000',parent:-1},{name:'bone001',parent:0},{name:'bone002',parent:0},{name:'bone003',parent:0}]};
 const table=animationChannels(model,data);assert.deepEqual(table.bones.map(b=>[b.translation,b.rotation,b.scale]),[[true,true,false],[false,true,false],[false,true,false],[false,false,false]]);
});
test('verified areas and actions preserve unknown identities',()=>{
 assert.equal(worldName('data/bg/am01.map').name,'Apartments');assert.equal(worldName('data/bg/tpf1.map').name,'Amusement park');assert.equal(worldName('unknown.map'),null);assert.equal(worldName('am01.mdl'),null);
 assert.equal(actionName(101,'chhaa_basic1_none.anm'),'Idle');assert.match(actionName(201,'chhaa_basic1_none.anm'),/Unarmed/);assert.equal(actionName(201,'chhaa_basic1_hand.anm'),null);assert.equal(actionName(99999,'unknown'),null);
});
