const node=(tag,text)=>{const element=document.createElement(tag);if(text!==undefined)element.textContent=text;return element;};

/** Choose explicit, inclusive source and destination ranges before staging animation. */
export function animationImportDialog(info,selectedStart,apply) {
  return new Promise(resolve=>{
    const pack=info.format==='pack',label=pack?'PACK':'ANM';
    const dialog=node('dialog'),form=node('form');dialog.className='replacement-dialog animation-import-dialog';form.method='dialog';
    form.append(node('h2','Import animation'),node('p',info.sourceFile+' → '+info.targetBank));
    form.append(node('p','Only original game bones are sampled. IK/control bones may remain in the source. Both range endpoints are included.'));
    const fields=node('div');fields.className='animation-import-fields';
    function input(label,value,min,max){const wrapper=node('label',label),field=node('input');field.type='number';field.step='1';field.value=value;field.min=min;field.max=max;field.setAttribute('aria-label',label);wrapper.append(field);fields.append(wrapper);return field;}
    const from=input('Source first',info.sourceStart,info.sourceStart,info.sourceEnd),to=input('Source last (included)',info.sourceEnd,info.sourceStart,info.sourceEnd);
    const initial=info.sameBank?info.exportStart:selectedStart;
    const start=input(label+' first',initial,0,info.targetFrames-1),end=input(label+' last (included)',initial+info.sourceEnd-info.sourceStart,0,info.targetFrames-1);
    form.append(fields);
    const fitLabel=node('label'),fit=node('input');fit.type='checkbox';fitLabel.append(fit,document.createTextNode(' Fit source motion to the destination range'));form.append(fitLabel);
    const count=node('p');count.className='hint';form.append(count);
    const policy=node('select');policy.value='keep';
    const bones=node('input'),morphs=node('input');bones.type=morphs.type='checkbox';bones.checked=true;morphs.checked=!!info.hasMorphs&&!info.morphError;
    if(pack) {
      for(const [input,text] of [[bones,'Import bone motion'],[morphs,'Import facial shape keys']]) {
        const wrapper=node('label');input.setAttribute('aria-label',text);wrapper.append(input,document.createTextNode(' '+text));form.append(wrapper);
      }
      morphs.disabled=!info.hasMorphs||!!info.morphError;
      form.append(node('p',info.morphError||'The selected character and range are replaced. Other characters, camera, audio and scene timing are preserved. Animate the original bones and exported shape keys; object movement is ignored.'));
    } else {
      const policyLabel=node('label','Missing native channels');policy.setAttribute('aria-label','Missing native channels');
      policy.add(new Option('Preserve unsupported channels and report skipped motion','keep'));
      policy.add(new Option('Stop if any motion cannot be written','reject'));policyLabel.append(policy);form.append(policyLabel);
      const note=node('p','ANM banks have fixed native channels. Adding a key in Blender cannot create a game channel. Preserved channels are listed in the import result. In-game action length, loop points and events are stored outside ANM and are not changed.');note.className='hint';form.append(note);
    }
    if(info.ignoredBones.length)form.append(node('p','Control bones ignored: '+info.ignoredBones.join(', ')));
    const actions=node('div');actions.className='replacement-actions';const cancel=node('button','Cancel'),submit=node('button','Stage animation');cancel.type=submit.type='button';submit.className='primary';
    cancel.onclick=()=>dialog.close();actions.append(cancel,submit);form.append(actions);
    const update=()=>{
      const source=+to.value-+from.value+1,target=+end.value-+start.value+1;
      count.textContent=`Source: ${source} samples at ${Number(info.fps.toPrecision(6))} FPS. Destination: ${target} samples, bank 0–${info.targetFrames-1}.`;
      submit.disabled=![from,to,start,end].every(field=>field.checkValidity()&&Number.isInteger(+field.value))||source<1||target<1||(!fit.checked&&source!==target)||(pack&&!bones.checked&&!morphs.checked);
      if(!fit.checked&&source!==target)count.textContent+=' Match the counts or enable Fit.';
    };
    for(const field of [from,to,start,end,fit,bones,morphs])field.oninput=update;update();
    let result=null;
    submit.onclick=async()=>{submit.disabled=cancel.disabled=true;try {result=await apply({sourceStart:+from.value,sourceEnd:+to.value,start:+start.value,end:+end.value,resample:fit.checked,missingChannels:policy.value||'keep',importBones:bones.checked,importMorphs:morphs.checked});if(result)dialog.close();}finally{cancel.disabled=false;update();}};
    dialog.addEventListener('cancel',event=>{if(cancel.disabled)event.preventDefault();});
    dialog.append(form);document.body.append(dialog);dialog.addEventListener('close',()=>{dialog.remove();resolve(result);},{once:true});dialog.showModal();
  });
}

export function showAnimationReport(element,report) {
  element.replaceChildren();element.hidden=false;
  const skipped=report.skippedChannels||[],summary=node('summary',`Imported ${report.frameCount} frames · ${report.changedRotations} rotations · ${report.changedTranslations} translations${report.format==='pack'?' · '+report.changedMorphSamples+' facial samples':''}${skipped.length?' · '+skipped.length+' unsupported channels preserved':''}`);element.append(summary);
  element.append(node('p',`Source ${report.sourceStart}–${report.sourceEnd} → ${report.format==='pack'?'PACK':'ANM'} ${report.start}–${report.end} (inclusive). ${report.format==='pack'?'Other scene tracks and timing are preserved.':'Bank length and game action/loop tables are unchanged.'}`));
  for(const issue of skipped)element.append(node('p',`${issue.bone} · ${issue.channel} · ANM frames ${issue.firstFrame}–${issue.lastFrame}: ${issue.reason}`));
  if(report.ignoredBones?.length)element.append(node('p','Ignored control bones: '+report.ignoredBones.join(', ')));
  element.open=skipped.length>0;
}
