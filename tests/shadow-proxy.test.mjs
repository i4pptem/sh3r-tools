import test from 'node:test';
import assert from 'node:assert/strict';
import {Vector3,Matrix4} from 'three';
import {shadowBlocks,shadowPrimitive} from '../core/shadow-rebuild.mjs';
import {shadowFaces,exportShadowProxy,importShadowProxy,validateShadowFaces} from '../core/shadow-proxy.mjs';
import {writeGlb} from '../core/model-import.mjs';
import {readGlb} from '../core/gltf.mjs';
const model={bones:[{name:'bone000',parent:-1,matrix:new Matrix4().makeTranslation(50,60,70).toArray()}]};
const tetra=()=>{const p=[[0,0,0],[10,0,0],[0,10,0],[0,0,10]].map(v=>new Vector3(...v));return [[0,2,1],[0,1,3],[0,3,2],[1,2,3]].map(face=>face.map(i=>p[i]));};
function native(faces){const h=Buffer.alloc(112);h.writeInt16LE(1,4);h.writeInt16LE(faces.length,22);return Buffer.concat([h,...faces.map(shadowPrimitive)]);}
test('shadow proxy GLB no-op is byte-exact, includes displayed bone transform and ignores removed objects',()=>{
 const data=native(tetra()),glb=exportShadowProxy(model,data),{doc,accessor}=readGlb(glb);assert.deepEqual(accessor(doc.meshes[0].primitives[0].attributes.POSITION).slice(0,3),[50,60,70]);
 assert.deepEqual(importShadowProxy(model,data,data,glb).data,data);assert.deepEqual(importShadowProxy(model,data,data,null).data,data);
 const disabled=importShadowProxy(model,data,data,null,[{block:0,bone:0,mode:'disable'}]);assert.equal(shadowBlocks(disabled.data)[0].objects[0].primitives.length,0);
 assert.deepEqual(importShadowProxy(model,disabled.data,data,null,[{block:0,bone:0,mode:'original'}]).data,data);
});
test('edited shadow geometry rejects collapse, inward winding, open surfaces and vertex-only touching solids',()=>{
 const faces=tetra();assert.equal(validateShadowFaces(faces).components,1);
 assert.throws(()=>validateShadowFaces(faces.slice(1)),/closed/);assert.throws(()=>validateShadowFaces(faces.map(f=>[...f].reverse())),/inward/);
 assert.throws(()=>validateShadowFaces([[faces[0][0],faces[0][0],faces[0][2]],...faces.slice(1)]),/collapsed/);
 const touching=faces.map(f=>f.map(p=>p.clone().multiplyScalar(-1))).map(f=>[...f].reverse());assert.throws(()=>validateShadowFaces([...faces,...touching]),/vertex fan/);
 const detached=faces.map(f=>f.map(p=>p.clone().add(new Vector3(100,0,0))));assert.equal(validateShadowFaces([...faces,...detached]).components,2);
});
test('an untouched original open strip is preserved while stale proxy sources are rejected',()=>{
 const data=native([tetra()[0]]),glb=exportShadowProxy(model,data);assert.deepEqual(importShadowProxy(model,data,data,glb).data,data);
 const changed=Buffer.from(data);changed[24]^=1;assert.throws(()=>importShadowProxy(model,changed,data,glb),/another model|stale/);
});
test('type5 and type6 strips decode alternating triangle winding',()=>{
 const h=Buffer.alloc(112);h.writeInt16LE(1,4);h.writeInt16LE(1,22);const strip=Buffer.alloc(64);[4,6,7,4].forEach((v,i)=>strip.writeInt16LE(v,i*2));for(const [i,at]of [16,24,40,56].entries())strip.writeInt16LE(i,at);
 const data=Buffer.concat([h,strip]),object=shadowBlocks(data)[0].objects[0];assert.deepEqual(shadowFaces(data,object).map(f=>f.map(p=>p.x)),[[0,1,2],[2,1,3]]);
 data.writeInt16LE(5,114);assert.deepEqual(shadowFaces(data,shadowBlocks(data)[0].objects[0]).map(f=>f.map(p=>p.x)),[[1,0,2],[1,2,3]]);
});

test('edited GLB transforms are serialized in bone-local coordinates without replacing identity',()=>{
 const source=native(tetra()),{doc,binary}=readGlb(exportShadowProxy(model,source));doc.nodes[0].translation=[5,0,0];
 const result=importShadowProxy(model,source,source,writeGlb(doc,binary)),object=shadowBlocks(result.data)[0].objects[0];
 assert.equal(object.bone,0);assert.equal(object.primitives.length,4);assert.deepEqual(shadowFaces(result.data,object)[0].map(v=>v.x),[5,5,15]);assert.equal(validateShadowFaces(shadowFaces(result.data,object)).components,1);
});
