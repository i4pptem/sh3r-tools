import {ModelVisibility} from '../app/ui/model-visibility.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {parseModel, modelLayout} from '../core/model.mjs';
import {modelFixture} from './helpers/model-fixture.mjs';
import {createModelObject} from '../app/ui/model-object.mjs';
import {AnimationPlayer} from '../app/ui/animation-player.mjs';

function modelFixtureWithVariants(modelId = 0x100) {
  const model = parseModel(modelFixture());
  model.modelId = modelId;
  const base = model.meshes[0];
  model.meshes = [0,1,3,4,5,12,13,38,1,5].map((visibilityId,i) => ({...base, visibilityId, name: i === 8 ? 'edited_face_part1' : i === 9 ? 'edited_hair_part1' : 'Part_' + i, group: Number(i > 7)}));
  return model;
}
const cutscene = {sourceFormat:'pack', frameCount:2, boneCount:1, eulers:new Float32Array(6), translations:new Float32Array(6)};
const gameplay = {sourceFormat:'anm', frameCount:2, rotations:new Float32Array(8).fill(NaN), translations:new Float32Array(6).fill(NaN)};
const shown = asset => asset.meshes.map(mesh => mesh.visible);

test('native visibility is an unsigned part flag in either mesh group, independent of ordinal', () => {
  for (const secondary of [false,true]) for (const visibilityId of [0,1,5,32,63,255]) {
    const bytes = modelFixture(), layout = modelLayout(bytes), part = layout.groups[0][1];
    bytes[part + 0x52] = visibilityId;
    if (secondary) {const base=bytes.readUInt32LE(20); bytes.writeUInt32LE(0,base+32);bytes.writeUInt32LE(1,base+40);bytes.writeUInt32LE(part-base,base+44);}
    const parsed = parseModel(bytes).meshes[0];
    assert.equal(parsed.visibilityId,visibilityId);assert.equal(parsed.group,Number(secondary));
  }
});

test('PACK preview hides gameplay duplicates and keeps cutscene meshes including renamed split parts', async () => {
  const model = modelFixtureWithVariants(), original = structuredClone(model), asset = await createModelObject(model,[]);
  try {
    const player = new AnimationPlayer(asset);
    player.clip('skeletal',cutscene);
    assert.deepEqual(shown(asset),[true,true,true,true,false,false,false,false,true,false]);
    player.seek(1); player.stop();
    assert.deepEqual(shown(asset),[true,true,true,true,false,false,false,false,true,false]);
    assert.deepEqual(model,original);
    player.clip('skeletal',gameplay);assert.ok(shown(asset).every(Boolean));
    player.clip('skeletal',cutscene);player.clip('skeletal',null);assert.ok(shown(asset).every(Boolean));
  } finally {asset.dispose();}
});

test('manual visibility survives clip switches and cannot expose a filtered gameplay variant', async () => {
  const asset = await createModelObject(modelFixtureWithVariants(),[]);
  try {
    const player = new AnimationPlayer(asset);
    asset.visibility.set('Part_0',false);player.clip('skeletal',cutscene);
    asset.visibility.set('Part_4',true);assert.equal(asset.meshes[4].visible,false);
    asset.visibility.set('Part_2',false);player.clip('skeletal',null);
    assert.equal(asset.meshes[0].visible,false);assert.equal(asset.meshes[2].visible,false);assert.equal(asset.meshes[4].visible,true);
    asset.visibility.set('Part_2',true);assert.equal(asset.meshes[2].visible,true);
  } finally {asset.dispose();}
});

test('other characters and parts without native metadata retain their authored visibility', async () => {
  const model=modelFixtureWithVariants(0x101), asset=await createModelObject(model,[]);
  try {const player=new AnimationPlayer(asset);asset.visibility.set('Part_5',false);player.clip('skeletal',cutscene);assert.deepEqual(shown(asset),[true,true,true,true,true,false,true,true,true,true]);} finally {asset.dispose();}
  model.modelId=0x100;model.meshes.forEach(part=>delete part.visibilityId);
  const unknown=await createModelObject(model,[]);
  try {new AnimationPlayer(unknown).clip('skeletal',cutscene);assert.ok(shown(unknown).every(Boolean));} finally {unknown.dispose();}
});

test('filtering preserves independent flashlight and unknown scripted part choices', () => {
  const meshes = [0,1,3,4,5,12,13,32,38,60].map(visibilityId=>({name:String(visibilityId),visibilityId,visible:true}));
  const visibility=new ModelVisibility({modelId:0x100,meshes},meshes);
  visibility.setCutscene(true);
  assert.deepEqual(meshes.filter(part=>part.visible).map(part=>part.visibilityId),[0,1,3,4,32,60]);
  visibility.set('32',false);visibility.setCutscene(false);visibility.setCutscene(true);
  assert.deepEqual(meshes.filter(part=>part.visible).map(part=>part.visibilityId),[0,1,3,4,60]);
});
