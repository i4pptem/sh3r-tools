/** Show the current measured stage in the active operation dialog. */
export function operationProgress(dialog) {
  const root=document.createElement('section');root.className='operation-progress';root.hidden=true;
  root.innerHTML='<strong data-stage></strong><progress max="1" aria-label="Current stage progress"></progress><div class="operation-progress-details"><span data-detail></span><span data-elapsed></span></div>';
  (dialog.querySelector('.replacement-actions')||dialog.lastElementChild).before(root);
  const stage=root.querySelector('[data-stage]'),bar=root.querySelector('progress'),detail=root.querySelector('[data-detail]'),elapsed=root.querySelector('[data-elapsed]');
  let unsubscribe,timer,started;
  const stop=()=>{unsubscribe?.();unsubscribe=null;clearInterval(timer);timer=null;};
  const update=value=>{
    stage.textContent=value.message||'Working…';
    if(Number.isFinite(value.done)&&Number.isFinite(value.total)&&value.total>0){
      bar.value=Math.min(1,Math.max(0,value.done/value.total));
      detail.textContent=`${value.done.toLocaleString()} / ${value.total.toLocaleString()} ${value.unit||'items'} · ${Math.floor(bar.value*100)}% of this stage`;
    } else {bar.removeAttribute('value');detail.textContent=value.detail||'Processing — this stage has no measured total.';}
  };
  dialog.addEventListener('close',stop,{once:true});
  return {cancel(){stop();root.hidden=true;},fail(message){stop();stage.textContent='Export failed';bar.hidden=true;detail.textContent=message;},start(message){stop();root.hidden=false;bar.hidden=false;started=performance.now();update({message});
    const tick=()=>{const seconds=Math.floor((performance.now()-started)/1000);elapsed.textContent=`Elapsed ${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;};
    tick();timer=setInterval(tick,1000);unsubscribe=window.studio.onProgress(update);
  },stop};
}

export function exportProgressDialog(message) {
  if(document.querySelector('dialog[open]'))return null;
  const dialog=document.createElement('dialog');dialog.className='replacement-dialog export-progress-dialog';
  dialog.innerHTML='<h2>Preparing export</h2><p>Choose the destination in the file picker. Progress appears here while the file is prepared.</p><div class="replacement-actions"></div>';
  const progress=operationProgress(dialog);dialog.addEventListener('cancel',event=>event.preventDefault());
  document.body.append(dialog);dialog.showModal();progress.start(message);
  return {close(){progress.stop();dialog.close();dialog.remove();}};
}
