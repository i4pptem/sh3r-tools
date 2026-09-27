import * as THREE from 'three';
import {selectionBounds} from './map-selection.mjs';
import {AnimationPlayer} from './animation-player.mjs';
import {TransformControls} from 'three/addons/controls/TransformControls.js';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';

export class ModelViewport {
  constructor(host, onSelect, onTransform, onGesture) {
    this.host = host; this.dead = false; this.meshes = []; this.player = new AnimationPlayer(this);
    this.renderer = new THREE.WebGLRenderer({antialias: true, alpha: true});
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); this.renderer.setClearColor(0, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.replaceChildren(this.renderer.domElement);
    this.onSelect = onSelect; this.onTransform = onTransform; this.onGesture = onGesture; this.selectedParts = [];
    this.pointerDown = event => {this.pickStart = [event.clientX, event.clientY]; this.gizmoPointer = !!this.gizmo?.axis;};
    this.pointerUp = event => {
      if (this.editingEnabled === false || this.gizmoPointer || this.gizmo?.dragging || event.button !== 0 || !this.pickStart || Math.hypot(event.clientX-this.pickStart[0],event.clientY-this.pickStart[1]) > 4) return;
      const rect = this.renderer.domElement.getBoundingClientRect(), ray = new THREE.Raycaster();
      ray.setFromCamera(new THREE.Vector2((event.clientX-rect.left)/rect.width*2-1,1-(event.clientY-rect.top)/rect.height*2),this.camera);
      const hit = ray.intersectObjects(this.meshes.filter(m => m.visible),false)[0]; if (hit) this.onSelect?.(hit.object.name, event.ctrlKey || event.shiftKey || event.metaKey);
    };
    this.renderer.domElement.addEventListener('pointerdown',this.pointerDown);
    this.renderer.domElement.addEventListener('pointerup',this.pointerUp);
    this.scene = new THREE.Scene(); this.camera = new THREE.PerspectiveCamera(35, 1, 0.1, 10000);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement); this.controls.enableDamping = true;
    this.scene.add(new THREE.HemisphereLight(0xe8ede0, 0x414b3e, 2.2));
    const key = new THREE.DirectionalLight(0xffdfbe, 2.8); key.position.set(150, 250, 200); this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xb4d1eb, 1.4); fill.position.set(-200, 100, -200); this.scene.add(fill);
    this.group = new THREE.Group(); this.scene.add(this.group);
    this.observer = new ResizeObserver(() => this.resize()); this.observer.observe(host);
    let previous;
    const animate = now => {if (this.dead) return; this.frameId = requestAnimationFrame(animate); const dt = previous === undefined ? 0 : Math.min((now - previous) / 1000, .1); previous = now; this.player.update(dt); this.controls.update(); this.renderer.render(this.scene, this.camera);};
    this.frameId = requestAnimationFrame(animate); this.resize();
  }
  resize() {
    const {clientWidth: w, clientHeight: h} = this.host; if (!w || !h) return;
    this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }
  async load(model, textureImages) {
    const loader = new THREE.TextureLoader();
    const textures = await Promise.all(textureImages.map(async image => {
      const texture = await loader.loadAsync(image.url); texture.colorSpace = THREE.SRGBColorSpace; texture.flipY = false; if (model.world) texture.wrapS = texture.wrapT = THREE.RepeatWrapping; return texture;
    }));
    if (this.dead) {textures.forEach(t => t.dispose()); return;}
    this.textures = textures; this.editable = !!model.editable; this.model = model;
    this.parents = model.bones.map(b => b.parent);
    const matrices = model.bones.map(b => new THREE.Matrix4().fromArray(b.matrix));
    this.rigBones = model.bones.map((source, i) => {
      const bone = new THREE.Bone(); bone.name = source.name;
      const local = source.parent < 0 ? matrices[i] : matrices[source.parent].clone().invert().multiply(matrices[i]);
      local.decompose(bone.position, bone.quaternion, bone.scale); return bone;
    });
    this.rigBones.forEach((bone, i) => (this.parents[i] < 0 ? this.group : this.rigBones[this.parents[i]]).add(bone));
    this.bindPose = this.rigBones.map(b => ({position: b.position.clone(), quaternion: b.quaternion.clone()}));
    this.group.updateMatrixWorld(true);
    this.skin = this.rigBones.length ? new THREE.Skeleton(this.rigBones, matrices.map(m => m.clone().invert())) : null;
    for (const source of model.meshes) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(source.positions, 3));
      geometry.setAttribute('normal', new THREE.Float32BufferAttribute(source.normals, 3));
      geometry.setAttribute('uv', new THREE.Float32BufferAttribute(source.uv, 2));
      if (source.colors) geometry.setAttribute('color', new THREE.Float32BufferAttribute(source.colors, 3));
      if (this.skin) {geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(source.joints, 4)); geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(source.weights, 4));}
      geometry.setIndex(source.indices);
      geometry.morphTargetsRelative = true;
      if (source.morphPositions.length) {
        geometry.morphAttributes.position = source.morphPositions.map(values => new THREE.Float32BufferAttribute(values, 3));
        geometry.morphAttributes.normal = source.morphNormals.map(values => new THREE.Float32BufferAttribute(values, 3));
      }
      const texture = textures[source.texture];
      const material = model.world
        ? new THREE.MeshBasicMaterial({map: texture || null, color: texture ? 0xffffff : 0xa6a98f, vertexColors: !!source.colors, side: THREE.DoubleSide, transparent: source.transparency === 1, depthWrite: source.transparency !== 1, alphaTest: source.transparency === 3 ? .5 : 0})
        : new THREE.MeshStandardMaterial({map: texture || null, color: texture ? 0xffffff : 0xa6a98f, roughness: .9, metalness: 0, side: THREE.DoubleSide, alphaTest: .1});
      const mesh = this.skin ? new THREE.SkinnedMesh(geometry, material) : new THREE.Mesh(geometry, material);
      if (this.skin) {mesh.bind(this.skin, new THREE.Matrix4()); mesh.frustumCulled = false;}
      mesh.name = source.name; this.group.add(mesh); this.meshes.push(mesh);
    }
    this.skeleton = new THREE.SkeletonHelper(this.group);
    this.skeleton.material.color.set(0xfbc17c); this.skeleton.material.depthTest = false;
    this.skeleton.visible = false; this.skeleton.renderOrder = 10; this.scene.add(this.skeleton);
    const box = new THREE.Box3().setFromObject(this.group), size = box.getSize(new THREE.Vector3()).length();
    const grid = new THREE.GridHelper(Math.max(10, size * 2), 30, 0x4f5e4b, 0x303d33); grid.position.y = box.min.y; this.scene.add(grid);
    if (this.editable) this.createGizmo();
    this.frame();
  }
  createGizmo() {
    this.pivot = new THREE.Object3D(); this.scene.add(this.pivot);
    this.gizmo = new TransformControls(this.camera, this.renderer.domElement);
    this.gizmo.setSize(.8); this.gizmo.setSpace('world'); this.scene.add(this.gizmo.getHelper());
    this.gizmo.addEventListener('dragging-changed', event => {
      this.controls.enabled = !event.value;
      if(event.value) {this.gizmoPointer = true; this.dragOrigin = this.pivot.position.clone(); this.dragEdits = new Map(this.partEdits);}
      this.onGesture?.(event.value); if(!event.value) this.syncGizmo();
    });
    this.gizmo.addEventListener('objectChange', () => {
      if (this.syncingGizmo || !this.selectedPart) return;
      if(this.selectedParts.length>1) {
        const delta=this.pivot.position.clone().sub(this.dragOrigin || this.pivot.position);
        this.onTransform?.({edits:this.selectedParts.map(part=>({part,translation:(this.dragEdits.get(part)?.translation || [0,0,0]).map((v,k)=>v+delta.getComponent(k))}))});return;
      }
      const source = this.model.meshes.find(m => m.name === this.selectedPart);
      const center = new THREE.Box3().setFromArray(source.positions).getCenter(new THREE.Vector3());
      const edit = {...this.partEdits?.get(source.name), part: source.name,
        translation: this.pivot.position.clone().sub(center).toArray(),
        rotation: new THREE.Euler().setFromQuaternion(this.pivot.quaternion).toArray().slice(0,3).map(v=>v*180/Math.PI),
        scale: this.pivot.scale.toArray().map(v=>Math.max(.001,v))};
      this.onTransform?.({edits:[edit]});
    });
  }
  viewState() {return {position:this.camera.position.toArray(),target:this.controls.target.toArray(),near:this.camera.near,far:this.camera.far};}
  restoreView(view) {this.camera.position.fromArray(view.position); this.controls.target.fromArray(view.target); this.camera.near=view.near; this.camera.far=view.far; this.camera.updateProjectionMatrix(); this.controls.update();}
  setEditingEnabled(enabled) {this.editingEnabled = enabled; if(this.gizmo) this.gizmo.enabled = enabled;}
  gizmoMode(mode) {this.gizmo?.setMode(this.selectedParts.length>1 ? 'translate' : mode);}
  previewMapEdits(edits) {
    if (!this.editable) return;
    this.partEdits = new Map(edits.map(edit => [edit.part, edit]));
    const assignments = new Map();
    for (const edit of edits) if(edit.materialGroup !== null) {
      const source = this.model.meshes.find(m=>m.name===edit.part), target = this.model.meshes.find(m=>m.group===edit.materialGroup);
      if(source && target) assignments.set(source.group, target.texture);
    }
    this.meshes.forEach((mesh,i) => {
      const source = this.model.meshes[i], edit = this.partEdits.get(mesh.name);
      mesh.matrixAutoUpdate = false; mesh.matrix.identity();
      if (edit) {
        const center = new THREE.Box3().setFromArray(source.positions).getCenter(new THREE.Vector3());
        const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(...edit.rotation.map(v=>v*Math.PI/180)));
        mesh.matrix.makeTranslation(...edit.translation).multiply(new THREE.Matrix4().makeTranslation(center))
          .multiply(new THREE.Matrix4().compose(new THREE.Vector3(),rotation,new THREE.Vector3(...edit.scale)))
          .multiply(new THREE.Matrix4().makeTranslation(center.negate()));
      }
      const uv = mesh.geometry.attributes.uv;
      source.uv.forEach((v,k)=>uv.array[k]=edit ? v*edit.uvScale[k%2]+edit.uvOffset[k%2] : v); uv.needsUpdate = true;
      mesh.material.map = this.textures[assignments.get(source.group) ?? source.texture] || null;
      mesh.material.color.set(mesh.material.map ? 0xffffff : 0xa6a98f); mesh.material.needsUpdate = true;
      mesh.updateMatrixWorld(true);
    });
    this.updateSelectionBox(); this.syncGizmo();
  }
  syncGizmo() {
    if (!this.gizmo || !this.selectedPart || this.gizmo.dragging) return;
    const source = this.model.meshes.find(m=>m.name===this.selectedPart), edit = this.partEdits?.get(source.name);
    this.syncingGizmo = true;
    this.pivot.position.copy(new THREE.Box3().setFromArray(source.positions).getCenter(new THREE.Vector3()));
    this.pivot.quaternion.identity(); this.pivot.scale.set(1,1,1);
    if (edit) {this.pivot.position.add(new THREE.Vector3(...edit.translation)); this.pivot.rotation.set(...edit.rotation.map(v=>v*Math.PI/180)); this.pivot.scale.fromArray(edit.scale);}
    if(this.selectedParts.length>1) {this.pivot.position.copy(selectionBounds(this.model,[...(this.partEdits?.values()||[])],this.selectedParts).getCenter(new THREE.Vector3())); this.pivot.quaternion.identity();this.pivot.scale.set(1,1,1);this.gizmo.setMode('translate');}
    this.pivot.updateMatrixWorld(true); this.gizmo.attach(this.pivot); this.syncingGizmo = false;
  }
  frame() {
    const box = new THREE.Box3().setFromObject(this.group); if (box.isEmpty()) return;
    this.frameBox(box);
  }
  frameMorph() {
    const box = new THREE.Box3(), point = new THREE.Vector3(); this.group.updateMatrixWorld(true);
    for (const mesh of this.meshes) {
      const target = mesh.geometry.morphAttributes.position?.[this.player.target]; if (!target) continue;
      for (let i = 0; i < target.count; i++) if (target.getX(i) || target.getY(i) || target.getZ(i)) {
        mesh.getVertexPosition(i, point); box.expandByPoint(point.applyMatrix4(mesh.matrixWorld));
      }
    }
    if (!box.isEmpty()) this.frameBox(box);
  }
  frameBox(box) {
    const center = box.getCenter(new THREE.Vector3()), extent = box.getSize(new THREE.Vector3());
    const size = Math.max(extent.y, extent.x / this.camera.aspect, 1), distance = size / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2))) * 1.35;
    this.camera.near = distance / 1000; this.camera.far = distance * 30; this.camera.updateProjectionMatrix();
    this.controls.target.copy(center); this.camera.position.copy(center).add(new THREE.Vector3(distance * .32, distance * .08, distance)); this.controls.update();
  }
  selectParts(names) {
    this.selectedParts=names.filter(name=>this.meshes.some(mesh=>mesh.name===name));this.selectedPart=this.selectedParts[0];
    if(!this.selectedPart) {this.gizmo?.detach();if(this.selectionBox)this.selectionBox.visible=false;return;}
    if(!this.selectionBox) {this.selectionBox=new THREE.Box3Helper(new THREE.Box3(),0xfbc17c);this.selectionBox.material.depthTest=false;this.selectionBox.renderOrder=20;this.scene.add(this.selectionBox);}
    this.selectionBox.visible=true;this.updateSelectionBox();this.syncGizmo();
  }
  updateSelectionBox() {
    if(this.selectionBox && this.selectedParts.length) this.selectionBox.box.copy(selectionBounds(this.model,[...(this.partEdits?.values()||[])],this.selectedParts));
  }
  frameParts(names) {const box=selectionBounds(this.model,[...(this.partEdits?.values()||[])],names);if(!box.isEmpty())this.frameBox(box);}
  morph(index, weight) {this.player.manual(index, weight);}
  wire(value) {this.meshes.forEach(mesh => {mesh.material.wireframe = value;});}
  vertexColors(value) {this.meshes.forEach(mesh => {mesh.material.vertexColors = value && !!mesh.geometry.attributes.color; mesh.material.needsUpdate = true;});}
  bones(value) {if (this.skeleton) this.skeleton.visible = value;}
  visible(name, value) {const mesh = this.meshes.find(m => m.name === name); if (mesh) mesh.visible = value;}
  dispose() {
    this.renderer.domElement.removeEventListener('pointerdown',this.pointerDown); this.renderer.domElement.removeEventListener('pointerup',this.pointerUp);
    if (this.gizmo) {this.gizmo.detach(); this.scene.remove(this.gizmo.getHelper()); this.gizmo.dispose();}
    this.dead = true; cancelAnimationFrame(this.frameId); this.observer.disconnect(); this.controls.dispose();
    this.scene.traverse(object => {object.geometry?.dispose(); if (Array.isArray(object.material)) object.material.forEach(m => m.dispose()); else object.material?.dispose();});
    this.skin?.dispose(); this.textures?.forEach(t => t.dispose()); this.renderer.dispose(); this.renderer.domElement.remove();
  }
}
