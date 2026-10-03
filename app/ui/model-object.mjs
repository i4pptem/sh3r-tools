import * as THREE from 'three';
import {ModelVisibility} from './model-visibility.mjs';

/** Build one independently animated asset for model and full-scene viewers. */
export async function createModelObject(model,textureImages) {
  const asset={model,group:new THREE.Group(),meshes:[]};
  const loader = new THREE.TextureLoader();
  const loaded = await Promise.allSettled(textureImages.map(async image => {
    const texture = await loader.loadAsync(image.url); texture.colorSpace = THREE.SRGBColorSpace; texture.flipY = false;
    if (model.world) texture.wrapS = texture.wrapT = THREE.RepeatWrapping; return texture;
  }));
  const textures = loaded.filter(result => result.status === 'fulfilled').map(result => result.value);
  const failed = loaded.find(result => result.status === 'rejected');
  if (failed) {textures.forEach(texture => texture.dispose()); throw failed.reason;}
  asset.textures = textures;
  asset.parents = model.bones.map(b => b.parent);
  const matrices = model.bones.map(b => new THREE.Matrix4().fromArray(b.matrix));
  asset.rigBones = model.bones.map((source, i) => {
    const bone = new THREE.Bone(); bone.name = source.name;
    const local = source.parent < 0 ? matrices[i] : matrices[source.parent].clone().invert().multiply(matrices[i]);
    local.decompose(bone.position, bone.quaternion, bone.scale); return bone;
  });
  asset.rigBones.forEach((bone, i) => (asset.parents[i] < 0 ? asset.group : asset.rigBones[asset.parents[i]]).add(bone));
  asset.bindPose = asset.rigBones.map(b => ({position: b.position.clone(), quaternion: b.quaternion.clone(), scale: b.scale.clone()}));
  asset.group.updateMatrixWorld(true);
  asset.skin = asset.rigBones.length ? new THREE.Skeleton(asset.rigBones, matrices.map(m => m.clone().invert())) : null;
  for (const source of model.meshes) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(source.positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(source.normals, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(source.uv, 2));
    if (source.colors) geometry.setAttribute('color', new THREE.Float32BufferAttribute(source.colors, 3));
    if (asset.skin) {geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(source.joints, 4)); geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(source.weights, 4));}
    geometry.setIndex(source.indices);
    geometry.morphTargetsRelative = true;
    if (source.morphPositions.length) {
      geometry.morphAttributes.position = source.morphPositions.map(values => new THREE.Float32BufferAttribute(values, 3));
      geometry.morphAttributes.normal = source.morphNormals.map(values => new THREE.Float32BufferAttribute(values, 3));
    }
    const texture = textures[source.texture];
    const material = model.world
      ? new THREE.MeshBasicMaterial({map: texture || null, color: source.cameraZone ? (source.cameraZone==='activation'?0xe6b888:0x88bbc6) : texture ? 0xffffff : 0xa6a98f, vertexColors: !!source.colors, side: source.layout?.vertices!==undefined && source.transparency!==1 ? THREE.FrontSide : THREE.DoubleSide, transparent: !!source.cameraZone || source.transparency === 1, opacity: source.cameraZone ? .18 : 1, depthWrite: !source.cameraZone && source.transparency !== 1, alphaTest: source.transparency === 3 ? .5 : 0})
      : new THREE.MeshStandardMaterial({map: texture || null, color: texture ? 0xffffff : 0xa6a98f, roughness: .9, metalness: 0, side: THREE.DoubleSide, transparent: source.group === 1, depthWrite: source.group !== 1, alphaTest: source.group === 1 ? 0 : .1});
    const mesh = asset.skin ? new THREE.SkinnedMesh(geometry, material) : new THREE.Mesh(geometry, material);
    if (asset.skin) {mesh.bind(asset.skin, new THREE.Matrix4()); mesh.frustumCulled = false;}
    mesh.name = source.name; asset.group.add(mesh); asset.meshes.push(mesh);
  }
  asset.visibility = new ModelVisibility(model, asset.meshes);
  asset.dispose=()=>{asset.group.traverse(object=>{object.geometry?.dispose();if(Array.isArray(object.material))object.material.forEach(m=>m.dispose());else object.material?.dispose();});asset.skin?.dispose();asset.textures.forEach(t=>t.dispose());asset.group.removeFromParent();};
  return asset;
}
