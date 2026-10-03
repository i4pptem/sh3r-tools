import {referenceMeshes,recordCenter} from '../../core/world-shapes.mjs';
import * as THREE from 'three';
import {CameraStudyView} from './camera-study-view.mjs';

const collisionColors = [0x8fce9b, 0xe4a889, 0xb9a0d3, 0xe58686, 0x81cdd1];

function disposeGroup(group) {
  group.removeFromParent();
  group.traverse(object => {object.geometry?.dispose(); object.material?.dispose();});
}

/** Reference geometry has its own selection and stays outside MAP exports. */
export class WorldReferenceView {
  constructor(viewport) {
    this.viewport = viewport; this.layers = new Map(); this.pickers = new Map(); this.settings = {};
    viewport.camera.layers.enable(1);
    this.study = new CameraStudyView(viewport);
  }
  load(kind, world) {
    if (this.layers.has(kind)) disposeGroup(this.layers.get(kind));
    this.layers.delete(kind);
    if (!world) return;
    const group = new THREE.Group(); group.name = `Reference_${kind}`;
    for (const [index, source] of referenceMeshes(world,kind).entries()) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(source.positions, 3)); geometry.setIndex(source.indices);
      const color = kind === 'cam' ? (source.region === 'active' ? 0xe6b888 : 0x88bbc6) : collisionColors[source.group] || collisionColors[index % 5];
      const material = new THREE.MeshBasicMaterial({color, transparent: true, opacity: .2, side: THREE.DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1});
      const mesh = new THREE.Mesh(geometry, material); mesh.name = source.name; mesh.userData = {...source,baseColor:color}; mesh.layers.set(1); mesh.renderOrder = 5;
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geometry), new THREE.LineBasicMaterial({color, transparent: true, opacity: .8, depthWrite: false}));
      edges.layers.set(1); mesh.add(edges); group.add(mesh);
    }
    if (kind === 'cam') this.constraintGuides(group, world);
    this.layers.set(kind, group); this.viewport.scene.add(group); this.configure(this.settings);
  }
  constraintGuides(group, world) {
    for (const record of world.records) {
      const name = `Zone_${record.index}_Constraint`; if (group.children.some(mesh => mesh.name === name)) continue;
      const [a, b, c] = record.constraintGroundPoints, d = [a[0] + c[0] - b[0], a[1] + c[1] - b[1]], points = [];
      if ([6, 7].includes(record.cameraMovementType)) {
        const center = [-a[0], -record.constraintHeights[0], a[1]];
        for (let axis = 0; axis < 3; axis++) {const first = [...center], last = [...center]; first[axis] -= 80; last[axis] += 80; points.push(...first, ...last);}
      } else for (const y of record.constraintHeights) {
        const corners = [a, b, c, d].map(([x, z]) => [-x, -y, z]);
        for (let i = 0; i < 4; i++) points.push(...corners[i], ...corners[(i + 1) % 4]);
      }
      const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
      const guide = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({color: 0x88bbc6, transparent: true, opacity: .8, depthWrite: false}));
      guide.name = name; guide.userData = {index:record.index,region:"constraint",baseColor:0x88bbc6}; guide.layers.set(1); guide.renderOrder = 6; group.add(guide);
    }
  }
  configure(settings) {
    this.settings = settings;
    for (const [kind, group] of this.layers) {
      group.visible = settings[kind]?.visible !== false;
      for (const mesh of group.children) {
        const cameraZone = kind === 'cam' ? Number(/^Zone_(\d+)_/.exec(mesh.name)?.[1]) : null;
        const selected = cameraZone === settings.zone;
        mesh.visible = kind === 'cld' ? settings.groups?.[mesh.userData.groupName] !== false :
          (!settings.selectedZoneOnly || selected) && (mesh.name.endsWith('_Activation') ? settings.activation !== false : settings.constraint !== false);
        mesh.material.opacity = mesh.isLineSegments ? .8 : (settings.opacity ?? .18) * (kind === 'cam' && !selected ? .45 : 1);
        mesh.material.depthTest = !settings.xray;
        const edges = mesh.children[0]; if (edges) {edges.material.opacity = kind === 'cam' && !selected ? .35 : .85; edges.material.depthTest = !settings.xray;}
      }
    }
  }
  frame(kind, zone) {
    const group = this.layers.get(kind); if (!group) return;
    const box = new THREE.Box3();
    for (const mesh of group.children) if (mesh.visible && (zone === undefined || mesh.name.startsWith(`Zone_${zone}_`))) box.expandByObject(mesh);
    if (!box.isEmpty()) this.viewport.frameBox(box);
  }
  edit(kind,onEnd) {
    if(this.editKind!==kind)this.endEdit();
    this.editKind=kind;this.onEndEdit=onEnd;
  }
  endEdit() {
    const end=this.onEndEdit;this.editKind=null;this.onEndEdit=null;end?.();
    this.viewport.clearToolTarget();for(const group of this.layers.values())for(const mesh of group.children)this.highlight(mesh,false);if(this.selection)this.selection.visible=false;
  }
  highlight(mesh,selected) {
    mesh.material.color.set(selected?0xffdf97:mesh.userData.baseColor);
    if(mesh.children[0])mesh.children[0].material.color.copy(mesh.material.color);
  }
  selectRecords(kind,records,region) {
    const group=this.layers.get(kind);if(!group)return;
    const box=new THREE.Box3(),ids=new Set(records.map(r=>`${r.group??''}:${r.index}`));
    for(const mesh of group.children){const selected=ids.has(`${mesh.userData.group??''}:${mesh.userData.index}`)&&(kind!=='cam'||mesh.userData.region===region);this.highlight(mesh,selected);if(selected)box.expandByObject(mesh);}
    if(box.isEmpty()&&records.length){const center=new THREE.Vector3(...recordCenter(records[0],region));box.setFromCenterAndSize(center,new THREE.Vector3(160,160,160));}
    if(!this.selection){this.selection=new THREE.Box3Helper(box,0xffdf97);this.selection.layers.set(1);this.selection.material.depthTest=false;this.selection.renderOrder=20;this.viewport.scene.add(this.selection);}
    this.selection.box.copy(box);this.selection.visible=!box.isEmpty();
  }
  frameRecords(kind,records,region) {this.selectRecords(kind,records,region);if(this.selection?.visible)this.viewport.frameBox(this.selection.box);}
  moveReference(point,callback) {
    this.edit('reference',null);
    this.viewport.setToolTarget({position:[-point[0],-point[1],point[2]],mode:'translate',change:transform=>callback([-transform.position[0],-transform.position[1],transform.position[2]])});
  }
  pick(ray,event) {
    if (!this.placing) {
      if(this.editKind==='reference')return true;
      const mode=this.settings.pickMode||'auto';if(mode==='map')return false;
      ray.layers.enable(1);ray.params.Line.threshold=Math.max(1,this.viewport.navigation.speed*.005);
      const objects=[];for(const [kind,group]of this.layers)if(group.visible&&(mode==='auto'||mode===kind))for(const mesh of group.children)if(mesh.visible)objects.push(mesh);
      const hit=ray.intersectObjects(objects,false)[0];
      if(hit){
        const mapHit=mode==='auto'&&!this.settings.xray?ray.intersectObjects(this.viewport.meshes.filter(mesh=>mesh.visible),false)[0]:null;
        if(!mapHit||hit.distance<=mapHit.distance){const kind=hit.object.parent===this.layers.get('cld')?'cld':'cam';this.pickers.get(kind)?.(hit.object.userData,event);return true;}
      }
      if(mode==='auto'){this.endEdit();return false;}return true;
    }
    const hit = ray.intersectObjects(this.viewport.meshes.filter(mesh => mesh.visible), false)[0];
    if (hit) {this.placing = false; this.viewport.syncGizmo(); this.onPlace?.([-hit.point.x, -hit.point.y, hit.point.z]);}
    return true;
  }
  place(callback) {this.endEdit();this.onPlace = callback; this.placing = true; this.viewport.gizmo?.detach();}
  cancelPlace() {this.placing = false; this.viewport.syncGizmo();}
  render() {this.study.render();}
  dispose() {this.endEdit();if(this.selection){this.selection.removeFromParent();this.selection.geometry.dispose();this.selection.material.dispose();}for (const group of this.layers.values()) disposeGroup(group); this.layers.clear(); this.study.dispose();}
}
