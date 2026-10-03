import * as THREE from 'three';
import {cutscenePartVisible} from '../../core/model-visibility.mjs';
import {ModelViewport} from './viewport.mjs';
import {reviewDialog,element as el} from './review-dialog.mjs';
export async function shadowTools(state,run,notify){
 const key=state.selected,preview=state.preview,info=await run('shadowPreview',{key},'Reading game shadow resource…');if(!info)return;
 const {dialog,content,footer}=reviewDialog('KG1 shadow tools');content.append(el('p',info.binding.name));
 content.append(el('p','Gold wireframe shows the rigid shadow proxy over the model in bind pose. KG1 does not follow facial morphs or blended skin weights. Export a simple closed proxy, edit it in Blender and import its GLB. Keep object names; use outward normals and low triangle counts.'));
 if(info.binding.sharedModels.length)content.append(el('p','Shared resource: '+info.binding.sharedModels.join(', '),'review-issue warning'));
 const block=el('select');for(const index of new Set(info.objects.map(o=>o.block)))block.add(new Option(`Shadow block ${index}`,index));block.setAttribute('aria-label','Shadow block');content.append(block);
 const host=el('div',undefined,'model-review-host');content.append(host);const view=new ModelViewport(host);dialog.addEventListener('close',()=>view.dispose(),{once:true});
 const overlay=info.model.meshes.map(mesh=>({...mesh,joints:Array.from({length:mesh.vertexCount*4},(_,i)=>i%4===0?Number(/_Bone(\d+)_/.exec(mesh.name)[1]):0),weights:Array.from({length:mesh.vertexCount*4},(_,i)=>i%4===0?1:0)}));
 await view.load({...preview.model,meshes:[...preview.model.meshes,...overlay]},preview.textures);if(view.dead)return;
 const offset=preview.model.meshes.length;
 view.meshes.slice(offset).forEach(mesh=>{mesh.material.dispose();mesh.material=new THREE.MeshBasicMaterial({color:0xf1c878,wireframe:true,depthTest:false,transparent:true,opacity:.7});mesh.renderOrder=10;});
 const table=el('table',undefined,'review-table'),choices=[];
 for(const object of info.objects){const row=el('tr'),select=el('select');select.append(new Option('Keep / import edited geometry','current'),new Option('Restore opened source','original'),new Option('Disable this shadow object','disable'));select.setAttribute('aria-label',`Shadow block ${object.block} bone ${object.bone}`);row.append(el('td',`Block ${object.block} · bone${String(object.bone).padStart(3,'0')}`),el('td',`${object.triangles} triangles`));const cell=el('td');cell.append(select);row.append(cell);table.append(row);choices.push({object,select,row});}
 content.append(table,el('p','Missing GLB objects are kept. Disable is explicit. Restore opened source uses the archive as opened; open a clean archive first if that source was already modified. Closure and winding are checked after native quantization; intersections still need visual review.','hint'));
 function show(){for(const [i,mesh]of view.meshes.slice(0,offset).entries())if(preview.model.modelId===0x100)mesh.visible=Number(block.value)>0?cutscenePartVisible(preview.model,preview.model.meshes[i]):[0,5].includes(preview.model.meshes[i].visibilityId);for(const {object,row}of choices)row.hidden=object.block!==Number(block.value);for(const mesh of view.meshes.slice(offset))mesh.visible=Number(/_B(\d+)_/.exec(mesh.name)[1])===Number(block.value);}block.onchange=show;show();
 const save=el('button','Export proxy GLB…'),load=el('button','Import edited proxy…'),apply=el('button','Apply object choices','primary');save.onclick=()=>run('exportShadowProxy',{key},'Exporting shadow proxy…');
 async function commit(pickFile){if(state.busy)return;const result=await run('importShadowProxy',{key,hash:info.hash,pickFile,decisions:choices.map(({object,select})=>({block:object.block,bone:object.bone,mode:select.value}))},'Checking and staging shadow proxy…');if(result){dialog.close();notify('KG1 staged. Verify animated RealTime Shadows in the game.',true);}}
 load.onclick=()=>commit(true);apply.onclick=()=>commit(false);footer.append(save,load,apply);
}
