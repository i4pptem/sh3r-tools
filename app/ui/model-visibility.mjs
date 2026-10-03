import {cutscenePartVisible} from '../../core/model-visibility.mjs';
/** Combine user choices with the current animation's native mesh variants. */
export class ModelVisibility {
  constructor(model, meshes) {
    this.parts = model.meshes.map((part,i) => ({mesh:meshes[i], chosen:meshes[i].visible,
      cutsceneVisible:cutscenePartVisible(model,part)}));
    this.cutscene = false;
  }
  setCutscene(enabled) {
    this.cutscene = enabled;
    this.parts.forEach(part => this.apply(part));
  }
  set(name, visible) {
    const part = this.parts.find(part => part.mesh.name === name);
    if (part) {part.chosen = visible; this.apply(part);}
  }
  apply(part) {part.mesh.visible = part.chosen && (!this.cutscene || part.cutsceneVisible);}
}
