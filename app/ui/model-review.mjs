import * as THREE from 'three';
import {ModelViewport} from './viewport.mjs';
import {cutscenePartVisible} from '../../core/model-visibility.mjs';
import {reviewDialog,element as el,issueList} from './review-dialog.mjs';

/** Review the exact serialized candidate; applying does not rebuild different bytes. */
export async function modelReview(state,run,notify,info,onApplied){
 const {dialog,content,footer}=reviewDialog('Review imported model');dialog.classList.add('model-review');
 const before=info.before,after=info.after,summary=el('p');summary.textContent=`Vertices ${before.diagnostics.vertices.toLocaleString()} → ${after.diagnostics.vertices.toLocaleString()} · Triangles ${before.diagnostics.triangles.toLocaleString()} → ${after.diagnostics.triangles.toLocaleString()} · Textures ${before.diagnostics.textures} → ${after.diagnostics.textures} · Morphs ${after.diagnostics.morphs}`;content.append(summary);
 const tools=el('div',undefined,'review-tools'),mode=el('select'),parts=el('select'),visibility=el('select'),morph=el('select'),weight=el('input');
 for(const [value,label]of [['texture','Textures'],['wire','Wireframe'],['weights','Weight diagnostics'],['uv','UV layout']])mode.add(new Option(label,value));mode.setAttribute('aria-label','Model review display');
 parts.add(new Option('All parts',''));after.model.meshes.forEach((mesh,index)=>parts.add(new Option(`${mesh.name} · Texture ${mesh.texture}`,index)));parts.setAttribute('aria-label','Review model part');
 visibility.append(new Option('All native variants','all'),new Option('Cutscene · known masks','cutscene'),...(after.model.modelId===0x100?[new Option('Gameplay body / face','gameplay')]:[]));for(const id of [...new Set(after.model.meshes.map(mesh=>mesh.visibilityId))].sort((a,b)=>a-b))visibility.append(new Option(`Visibility group ${id}`,String(id)));visibility.setAttribute('aria-label','Review visibility');
 morph.add(new Option('Neutral',''));after.model.morphNames.forEach((name,i)=>morph.add(new Option(name,i)));morph.setAttribute('aria-label','Review morph');weight.type='range';weight.min=0;weight.max=1;weight.step=.01;weight.value=1;weight.setAttribute('aria-label','Review morph intensity');
 tools.append(mode,parts,visibility,morph,weight);content.append(tools,el('p','Heather gameplay shows body/face only; inspect equipment hands using their separate visibility groups. Visibility groups are native part variants, not a complete simulation of gameplay or weapon logic. Red vertices have invalid weights; amber vertices exceed three influences or use bones associated with other original visibility variants.','hint'));
 const views=el('div',undefined,'model-review-views'),hosts=[el('div'),el('div')];hosts.forEach((host,i)=>{const pane=el('section');pane.append(el('strong',i?'Replacement':'Before import'),host);views.append(pane);host.className='model-review-host';});content.append(views);
 const uv=el('canvas');uv.width=uv.height=640;uv.className='review-uv';uv.hidden=true;content.append(uv);
 issueList(content,after.diagnostics.issues);
 const details=el('details');details.append(el('summary','Parts, materials and bone weights'));const table=el('table',undefined,'review-table');for(const mesh of after.diagnostics.meshes){const row=el('tr');row.append(el('td',mesh.name),el('td',`${mesh.vertices} vertices · ${mesh.triangles} triangles`),el('td',`Texture ${mesh.texture} · visibility ${mesh.visibility}`),el('td',`${mesh.maxInfluences} influences · bones ${mesh.bones.join(', ')}`));table.append(row);}details.append(table);content.append(details);
 let viewports=[],disposed=false,syncing=false;
 dialog.addEventListener('close',()=>{disposed=true;viewports.forEach(view=>view.dispose());});
 const cancel=el('button','Back'),apply=el('button','Apply & stage model','primary');cancel.onclick=()=>dialog.close();apply.disabled=true;footer.append(cancel,apply);
 try {
   viewports=hosts.map(host=>new ModelViewport(host));await Promise.all(viewports.map((view,i)=>view.load(i?after.model:before.model,i?after.textures:before.textures)));if(disposed)return;
   viewports[0].restoreView(viewports[1].viewState());
   viewports.forEach((view,i)=>view.controls.addEventListener('change',()=>{if(syncing||disposed)return;syncing=true;viewports[1-i].restoreView(view.viewState());syncing=false;}));
   const animation=el('select'),play=el('button','Pause'),frame=el('input');animation.setAttribute('aria-label','Review animation');animation.add(new Option('Bind pose',''));frame.type='range';frame.min=frame.max=frame.value=0;frame.step=1;frame.setAttribute('aria-label','Review animation frame');play.disabled=frame.disabled=true;tools.append(animation,play,frame);
   const motions=await window.studio.request('motionList',{key:info.key});if(disposed)return;for(const clip of motions.clips.filter(clip=>clip.type==='skeletal'))animation.add(new Option(clip.name,clip.id));
   animation.onchange=async()=>{const id=animation.value,clip=id?await run('motionClip',{key:info.key,id},'Loading comparison animation…'):null;if(disposed||animation.value!==id)return;for(const view of viewports)view.player.clip('skeletal',clip);viewports[0].player.playing=false;frame.max=clip?clip.frameCount-1:0;frame.disabled=play.disabled=!clip;play.textContent=clip?'Pause':'Play';render();};
   play.onclick=()=>{const playing=!viewports[1].player.playing;viewports[1].player.playing=playing;viewports[0].player.playing=false;play.textContent=playing?'Pause':'Play';};frame.oninput=()=>viewports.forEach(view=>{view.player.playing=false;view.player.seek(Number(frame.value));play.textContent='Play';});const syncFrame=player=>{frame.value=player.frame;viewports[0].player.seek(player.frame);};viewports[1].player.onChange=syncFrame;viewports[1].player.onTick=syncFrame;
   const originals=viewports.map(view=>view.meshes.map(mesh=>mesh.material));
   function render(){
     for(const [side,view]of viewports.entries())for(const [index,mesh]of view.meshes.entries()){
       const source=view.model.meshes[index],target=after.model.meshes[Number(parts.value)],samePart=!parts.value||source.name===target?.name;
       mesh.visible=samePart&&(visibility.value==='all'||visibility.value==='cutscene'&&cutscenePartVisible(view.model,source)||visibility.value==='gameplay'&&[0,5].includes(source.visibilityId)||String(source.visibilityId)===visibility.value);
       mesh.material=originals[side][index];mesh.material.wireframe=mode.value==='wire';
       if(mode.value==='weights'){
         if(!mesh.userData.reviewMaterial){const colors=new Float32Array(source.vertexCount*3),diag=(side?after:before).diagnostics.meshes[index],bad=new Set(diag.invalid),warn=new Set([...diag.suspicious,...diag.variantRisk]);for(let v=0;v<source.vertexCount;v++)colors.set(bad.has(v)?[1,.08,.05]:warn.has(v)?[1,.55,.08]:[.25,.6,.45],v*3);mesh.geometry.setAttribute('color',new THREE.BufferAttribute(colors,3));mesh.userData.reviewMaterial=new THREE.MeshBasicMaterial({vertexColors:true,side:THREE.DoubleSide});}
         mesh.material=mesh.userData.reviewMaterial;
       }
     }
     uv.hidden=mode.value!=='uv';views.hidden=!uv.hidden;
     if(!uv.hidden){const ctx=uv.getContext('2d');ctx.fillStyle='#18201d';ctx.fillRect(0,0,640,640);ctx.strokeStyle='#ccd5b8';ctx.lineWidth=.6;for(const [index,mesh]of after.model.meshes.entries()){if(parts.value&&index!==Number(parts.value))continue;for(let i=0;i<mesh.indices.length;i+=3){ctx.beginPath();for(let k=0;k<3;k++){const v=mesh.indices[i+k]*2,x=mesh.uv[v]*640,y=mesh.uv[v+1]*640;k?ctx.lineTo(x,y):ctx.moveTo(x,y);}ctx.closePath();ctx.stroke();}}}
     for(const view of viewports){view.player.target=morph.value===''?-1:view.model.morphNames.indexOf(after.model.morphNames[Number(morph.value)]);view.player.weight=morph.value===''?0:Number(weight.value);if(morph.value!=='')view.player.manual(view.player.target,view.player.weight);view.resize();}
   }
   for(const input of [mode,parts,visibility,morph,weight])input.oninput=render;render();
   dialog.addEventListener('close',()=>{viewports.forEach(view=>view.meshes.forEach((mesh,i)=>{mesh.userData.reviewMaterial?.dispose();originals[viewports.indexOf(view)][i].dispose();}));},{once:true});
   apply.disabled=after.diagnostics.issues.some(issue=>issue.severity==='error');
   apply.onclick=async()=>{if(state.busy)return;apply.disabled=true;const result=await run('applyModelReview',{key:info.key,token:info.token,reviewHash:info.reviewHash},'Staging reviewed model…');if(result){dialog.close();onApplied?.();notify('Reviewed model and textures staged. Test animation and visibility before distributing.',true);}else apply.disabled=false;};
 }catch(error){content.append(el('p',error.message,'review-issue error'));notify(error.message);}
}
