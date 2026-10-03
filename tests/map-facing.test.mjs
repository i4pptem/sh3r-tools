import test from 'node:test';
import assert from 'node:assert/strict';
import {Raycaster,Vector3} from 'three';
import {createModelObject} from '../app/ui/model-object.mjs';
import {exportGlb,readGlb} from '../core/gltf.mjs';
import {gltfAccessor} from '../core/gltf-accessors.mjs';

test('opaque MAP walls show the same authored face in the viewport and scene GLB',async()=>{
  const wall={name:'Wall',positions:[-1,-1,0,1,-1,0,0,1,0],normals:[0,0,1,0,0,1,0,0,1],uv:[0,0,1,0,.5,1],indices:[0,1,2],morphPositions:[],morphNormals:[],texture:-1,transparency:0,layout:{vertices:3}};
  const model={world:true,bones:[],meshes:[wall],morphNames:[]};
  const asset=await createModelObject(model,[]);asset.group.updateMatrixWorld(true);
  try {
    const front=new Raycaster(new Vector3(0,0,2),new Vector3(0,0,-1));
    const back=new Raycaster(new Vector3(0,0,-2),new Vector3(0,0,1));
    assert.equal(front.intersectObjects(asset.meshes).length,1);
    assert.equal(back.intersectObjects(asset.meshes).length,0);
    const {doc,binary}=readGlb(exportGlb(model,[],null,{nativeMapSides:true}));
    const primitive=doc.meshes[0].primitives[0];
    assert.deepEqual(gltfAccessor(doc,binary,primitive.indices),wall.indices);
    assert.equal(doc.materials[primitive.material].doubleSided,false);
    const transparent=readGlb(exportGlb({...model,meshes:[{...wall,transparency:1}]},[],null,{nativeMapSides:true}));
    assert.equal(transparent.doc.materials[0].doubleSided,true);
  } finally {asset.dispose();}
});
