export async function importSceneDialog(id,run,notify,reload) {
  const plan=await run('prepareCutsceneImport',{id},'Reading the Blender cutscene…');if(!plan)return;
  let committed=false;
  const dialog=document.createElement('dialog');dialog.className='replacement-dialog scene-exchange-dialog';
  dialog.innerHTML='<h2>Import cutscene edits</h2><p data-summary></p><div class="form-row"><label><input name="bones" type="checkbox" checked> Character motion</label><label><input name="morphs" type="checkbox" checked> Facial morphs</label></div><div class="form-row"><label><input name="camera" type="checkbox" checked> Camera</label><label><input name="lights" type="checkbox" checked> Lights</label><label><input name="props" type="checkbox" checked> Moving objects</label></div><ul data-notes></ul><p class="muted">Only existing channels in the exported range are replaced. Build mod writes the staged PACK into its game archive.</p><div class="replacement-actions"><button data-cancel>Cancel</button><button data-apply class="primary">Apply & stage cutscene</button></div>';
  const motion=plan.characters.reduce((n,a)=>n+a.changedRotations+a.changedTranslations,0),morphs=plan.characters.reduce((n,a)=>n+a.changedMorphSamples,0);
  dialog.querySelector('[data-summary]').textContent=`Frames ${plan.start}–${plan.end} · changed samples: ${motion} bone components, ${morphs} morphs, ${plan.camera} camera, ${plan.lights} lights, ${plan.props} moving objects.`;
  if(plan.morphErrors?.length){const input=dialog.querySelector('[name=morphs]');input.checked=false;input.disabled=true;}
  for(const text of [...(plan.notes||[]),...(plan.morphErrors||[])]){const li=document.createElement('li');li.textContent=text;dialog.querySelector('[data-notes]').append(li);}
  dialog.querySelector('[data-cancel]').onclick=()=>dialog.close();
  const apply=dialog.querySelector('[data-apply]');
  const fields=[...dialog.querySelectorAll('input')];fields.forEach(input=>input.onchange=()=>{apply.disabled=!fields.some(f=>f.checked);});
  apply.onclick=async()=>{apply.disabled=true;try{const result=await run('applyCutsceneImport',{id,token:plan.token,options:Object.fromEntries(fields.map(f=>[f.name,f.checked]))},'Staging cutscene edits…');if(result){committed=true;dialog.close();notify('Cutscene edits staged. Build mod to test them in the game.');await reload();}}finally{apply.disabled=false;}};
  dialog.addEventListener('close',()=>{dialog.remove();if(!committed)run('cancelCutsceneImport',{token:plan.token});},{once:true});document.body.append(dialog);dialog.showModal();
}
