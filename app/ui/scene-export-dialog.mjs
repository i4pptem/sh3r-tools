import {operationProgress} from './operation-progress.mjs';

export function exportSceneDialog(scene,selected,visibility,run,notify) {
  const dialog=document.createElement('dialog');dialog.className='replacement-dialog scene-exchange-dialog';
  dialog.innerHTML='<h2>Export cutscene to Blender</h2><p>Characters and facial animation, environment, moving objects, camera, lights and soundtrack are exported together. Frames below are inclusive; Blender starts at frame 0.</p><div class="form-row"><label>First frame <input name="start" type="number" min="0" value="0"></label><label>Last frame <input name="end" type="number" min="0"></label></div><p class="muted">PACK visibility is included when Scene visibility is enabled. Reimport supports motion, morphs, camera, lights and moving objects at this duration. Lighting is approximate; geometry, audio and visibility remain separate assets.</p><div class="replacement-actions"><button data-cancel>Cancel</button><button data-export class="primary">Export .blend…</button></div>';
  const first=dialog.querySelector('[name=start]'),last=dialog.querySelector('[name=end]'),button=dialog.querySelector('[data-export]');
  const progress=operationProgress(dialog),cancel=dialog.querySelector('[data-cancel]');let busy=false;
  dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
  first.max=last.max=last.value=scene.frameCount-1;
  function validate(){button.disabled=!(first.validity.valid&&last.validity.valid&&Number(last.value)>=Number(first.value));}
  first.oninput=last.oninput=validate;
  dialog.querySelector('[data-cancel]').onclick=()=>dialog.close();
  button.onclick=async()=>{
    if(button.disabled)return;busy=true;button.disabled=cancel.disabled=first.disabled=last.disabled=true;progress.start('Choose the output file, then preparing scene resources…');
    const models=Object.fromEntries(selected.actors.map(actor=>[actor.modelId,scene.actors.find(a=>a.modelId===actor.modelId)?.key||'']));
    try{const result=await run('exportCutscene',{id:scene.id,options:{models,maps:scene.environment.map(m=>m.key),audio:scene.audioKey,visibility,start:Number(first.value),end:Number(last.value)}},'Exporting cutscene to Blender…',message=>progress.fail(message));
      if(result===null)progress.cancel();
      if(result){dialog.close();notify(`Exported ${result.characters} characters, ${result.maps} maps and ${result.frames} frames.`);}}
    finally{progress.stop();busy=false;cancel.disabled=first.disabled=last.disabled=false;validate();}
  };
  dialog.addEventListener('close',()=>dialog.remove(),{once:true});document.body.append(dialog);dialog.showModal();
}
