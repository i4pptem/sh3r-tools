import {Box3,Matrix4,Vector3,Euler,Quaternion} from 'three';

/** Compute selected bounds from document edits, independently of viewport state. */
export function selectionBounds(model,edits,names) {
  const selected=new Set(names),byPart=new Map(edits.map(edit=>[edit.part,edit])),box=new Box3();
  for(const mesh of model.meshes) if(selected.has(mesh.name)) {
    const part=new Box3().setFromArray(mesh.positions),edit=byPart.get(mesh.name);
    if(edit) {
      const center=part.getCenter(new Vector3()),rotation=new Quaternion().setFromEuler(new Euler(...edit.rotation.map(v=>v*Math.PI/180)));
      const matrix=new Matrix4().makeTranslation(...edit.translation).multiply(new Matrix4().makeTranslation(center))
        .multiply(new Matrix4().compose(new Vector3(),rotation,new Vector3(...edit.scale))).multiply(new Matrix4().makeTranslation(center.negate()));
      part.applyMatrix4(matrix);
    }
    box.union(part);
  }
  return box;
}
export function selectionOffset(model,edits,names) {
  return selectionBounds(model,edits,names).getCenter(new Vector3()).sub(selectionBounds(model,[],names).getCenter(new Vector3())).toArray();
}
