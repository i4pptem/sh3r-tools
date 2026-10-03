import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {collisionPolygons} from '../core/collision-polygons.mjs';
import {Workbench} from '../core/workbench.mjs';
import {sha256} from '../core/binary.mjs';
import {mapFixture} from './helpers/map-fixture.mjs';
import {mapEditDefaults} from '../app/ui/map-drafts.mjs';

function floorGrid(size,hole=false) {
 const positions=[],normals=[],indices=[];
 for(let z=0;z<=size;z++)for(let x=0;x<=size;x++){positions.push(x*10,0,z*10);normals.push(0,1,0);}
 for(let z=0;z<size;z++)for(let x=0;x<size;x++){if(hole&&x>=10&&x<20&&z>=10&&z<20)continue;const a=z*(size+1)+x,b=a+size+1;indices.push(a,b,a+1,a+1,b,b+1);}
 return {meshes:[{name:'floor',positions,normals,indices}]};
}
function area(polygons){return polygons.reduce((sum,{vertices:[a,b,c]})=>sum+Math.abs((b[0]-a[0])*(c[2]-a[2])-(b[2]-a[2])*(c[0]-a[0]))/2,0);}
function contains(polygons,p){return polygons.some(({vertices})=>{const sides=vertices.map((a,i)=>{const b=vertices[(i+1)%3];return (b[0]-a[0])*(p[1]-a[2])-(b[2]-a[2])*(p[0]-a[0]);});return sides.every(v=>v>=0)||sides.every(v=>v<=0);});}
test('simplified floor removes subdivisions without filling a hole or changing its planar footprint',()=>{
 const model=floorGrid(40,true),raw=collisionPolygons(model,{group:0,parts:['floor']}),simple=collisionPolygons(model,{group:0,parts:['floor'],surfaceFilter:'walkable',simplification:{target:16,error:20}});
 assert.ok(simple.length<raw.length/50);assert.equal(area(simple),area(raw));assert.equal(contains(simple,[-150,150]),false);assert.equal(contains(simple,[-50,50]),true);
 assert.deepEqual(collisionPolygons(model,{group:0,parts:['floor'],surfaceFilter:'walkable',simplification:{target:16,error:20}}),simple);
});
test('walkable collision excludes ceilings and vertical decoration only when explicitly selected',()=>{
 const model=floorGrid(1);model.meshes.push({name:'ceiling',positions:[0,20,0,10,20,0,0,20,10],normals:[0,-1,0,0,-1,0,0,-1,0],indices:[0,1,2]});
 const parts=['floor','ceiling'];assert.equal(collisionPolygons(model,{group:0,parts}).length,3);assert.equal(collisionPolygons(model,{group:0,parts,surfaceFilter:'walkable'}).length,2);
});

function project(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sh3-save-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const map=mapFixture(),archive=Buffer.alloc(2048+map.length);archive.write('AFS\0');archive.writeUInt32LE(1,4);archive.writeUInt32LE(2048,8);archive.writeUInt32LE(map.length,12);archive.writeUInt32LE(128,16);archive.writeUInt32LE(48,20);archive.write('room.map',128);map.copy(archive,2048);const file=path.join(dir,'room.afs');fs.writeFileSync(file,archive);const wb=new Workbench();wb.open(file);
 return {dir,map,wb,room:{key:'0:0',hash:sha256(map),edits:[{...mapEditDefaults('Map_0_0'),translation:[1,0,0]}],references:[]}};
}
test('saving a project validates and includes pending room edits before publishing them',t=>{
 const {dir,map,wb,room}=project(t),file=path.join(dir,'saved.sh3project'),result=wb.saveProject(file,[room]);assert.deepEqual(result.appliedDrafts,['0:0']);assert.notDeepEqual(wb.bytes('0:0'),map);
 const restored=new Workbench();restored.loadProject(file);assert.deepEqual(restored.bytes('0:0'),wb.bytes('0:0'));wb.undoMap('0:0');assert.deepEqual(wb.bytes('0:0'),map);
});
test('failed project validation or file write leaves staged bytes and history untouched',t=>{
 const {dir,map,wb,room}=project(t),file=path.join(dir,'failed.sh3project');const invalid=structuredClone(room);invalid.edits[0].scale=[0,1,1];
 assert.throws(()=>wb.saveProject(file,[invalid]),/not saved/);assert.equal(fs.existsSync(file),false);assert.deepEqual(wb.bytes('0:0'),map);assert.equal(wb.mapHistory.size,0);
 fs.writeFileSync(file,'previous');assert.throws(()=>wb.saveProject(file,[room]),/exist/i);assert.equal(fs.readFileSync(file,'utf8'),'previous');assert.deepEqual(wb.bytes('0:0'),map);assert.equal(wb.changes.size,0);assert.equal(wb.mapHistory.size,0);
});
