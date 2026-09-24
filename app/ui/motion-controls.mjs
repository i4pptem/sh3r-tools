const $ = selector => document.querySelector(selector);

export function motionControls(state, notify, run) {
  let current = null, selectedKey = null, requestIds = {skeletal: 0, morph: 0}, lastTick = 0;
  $('#motion-settings-toggle').onclick = () => {
    const options = $('#motion-options'), open = options.classList.toggle('hidden') === false;
    $('#motion-settings-toggle').setAttribute('aria-expanded', String(open));
  };
  const controls = {skeletal: $('#skeletal-clip'), morph: $('#morph-clip')};
  function sync(player, full = false) {
    for(const id of ['export-animation','import-animation']) $('#'+id).disabled=state.busy || !player.skeletal?.id?.startsWith('asset:');
    $('#motion-current').textContent = player.skeletal?.name || player.morphClip?.name || 'Bind pose';
    $('#motion-current').title = $('#motion-current').textContent;
    $('#play-motion').textContent = player.playing ? 'Pause' : 'Play';
    $('#play-motion').disabled = !(player.skeletal || player.morphClip);
    $('#stop-motion').disabled = !(player.skeletal || player.morphClip);
    $('#motion-frame').min = player.start; $('#motion-frame').max = player.end; $('#motion-frame').value = player.frame;
    $('#motion-time').textContent = `${Math.floor(player.frame)} / ${player.end}`;
    $('#animate-morph').classList.toggle('active', player.audition);
    $('#animate-morph').textContent = player.audition ? 'Stop preview' : 'Animate';
    $('#bake-morph').disabled = player.audition || !!player.morphClip;
    if (!player.morphClip) {$('#morph-weight').value = player.weight; $('#morph-value').textContent = `${Math.round(player.weight * 100)}%`;}
    if (full) {
      $('#motion-start').value = player.start; $('#motion-end').value = player.end;
      $('#motion-start').max = $('#motion-end').max = player.frameCount - 1;
      $('#motion-fps').value = player.fps; $('#motion-speed').value = player.speed; $('#motion-loop').checked = player.loop;
    }
  }
  async function options() {
    const viewport = current, key = selectedKey;
    const result = await window.studio.request('motionList', {key});
    if (current !== viewport || state.selected !== key) return;
    for (const [type, select] of Object.entries(controls)) {
      const selected = type === 'skeletal' ? viewport.player.skeletal?.id : viewport.player.morphClip?.id;
      select.replaceChildren(new Option(type === 'skeletal' ? 'Bind pose' : 'Manual morph preview', ''));
      for (const clip of result.clips.filter(c => c.type === type)) select.add(new Option(`${clip.name} · ${clip.frameCount} frames`, clip.id));
      select.value = selected || '';
    }
  }
  async function load(type, id) {
    const viewport = current, key = selectedKey, ticket = ++requestIds[type];
    if (!viewport) return;
    if (!id) {viewport.player.clip(type, null); controls[type].value = ''; return;}
    $('#motion-note').textContent = 'Reading animation…';
    try {
      const clip = await window.studio.request('motionClip', {key, id});
      if (current !== viewport || state.selected !== key || ticket !== requestIds[type]) return;
      viewport.player.clip(type, clip); controls[type].value = id;
      if (type === 'morph') {$('#morph-weight').value = 0; $('#morph-value').textContent = '0%';}
      $('#motion-note').textContent = type === 'skeletal'
        ? 'Playing the ANM frame bank. Set a range to isolate an action. FPS is a preview setting.'
        : 'Playing native cutscene morph weights. Scene gaps use a neutral face. FPS is a preview setting.';
    } catch (error) {
      if (current !== viewport || ticket !== requestIds[type]) return;
      controls[type].value = (type === 'skeletal' ? viewport.player.skeletal : viewport.player.morphClip)?.id || '';
      $('#motion-note').textContent = error.message; notify(error.message);
    }
  }
  for (const [type, select] of Object.entries(controls)) select.onchange = () => load(type, select.value);
  $('#open-motion').onclick = async () => {
    const viewport = current, key = selectedKey;
    const result = await run('openMotion', {key}, 'Reading motion for this model…');
    if (!result || current !== viewport || state.selected !== key) return;
    await options(); const first = result.clips[0]; if (first) await load(first.type, first.id);
  };
  $('#export-animation').onclick = () => {
    if(!current?.player.skeletal || state.busy)return;
    const player=current.player;return run('exportAnimation',{key:selectedKey,id:player.skeletal.id,start:player.start,end:player.end,fps:player.fps},'Exporting animation with Blender…');
  };
  $('#import-animation').onclick = async () => {
    if(!current?.player.skeletal || state.busy)return;
    const key=selectedKey,id=current.player.skeletal.id;
    const result=await run('importAnimation',{key,id},'Baking FBX and validating ANM channels…');
    if(!result || state.selected!==key)return;
    await load('skeletal',id);
    const report=result.animationReport;
    if(report && current) {current.player.range(report.start,report.end);current.player.seek(report.start);current.player.playing=true;notify('Staged ANM frames '+report.start+'–'+report.end+'. '+report.changedRotations+' rotation and '+report.changedTranslations+' translation samples changed. Test the built animation in game.',true);}
  };
  $('#play-motion').onclick = () => {
    if (!current) return; const player = current.player;
    if (!player.playing && player.frame >= player.end) player.seek(player.start);
    player.playing = !player.playing; sync(player);
  };
  $('#stop-motion').onclick = () => current?.player.stop();
  $('#motion-frame').oninput = () => current?.player.seek(Number($('#motion-frame').value));
  $('#motion-loop').onchange = () => {if (current) current.player.loop = $('#motion-loop').checked;};
  $('#motion-speed').onchange = () => {if (current) current.player.speed = Number($('#motion-speed').value);};
  $('#motion-fps').onchange = () => {
    if (!current) return; const fps = Number($('#motion-fps').value);
    if (Number.isFinite(fps) && fps >= 1 && fps <= 120) current.player.fps = fps;
    sync(current.player, true);
  };
  for (const input of ['#motion-start', '#motion-end']) $(input).onchange = () => {
    if (!current) return; const start = Number($('#motion-start').value), end = Number($('#motion-end').value);
    if (Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end >= start && end < current.player.frameCount) current.player.range(start, end);
    else {notify('Choose a frame range within the loaded animation.'); sync(current.player, true);}
  };
  $('#animate-morph').onclick = () => {
    if (!current) return;
    current.player.auditionMorph(Number($('#morph-target').value), !current.player.audition); controls.morph.value = '';
    $('#motion-note').textContent = 'Automatic shape preview: neutral to full intensity. This does not change the native asset.';
  };
  return {
    async attach(viewport, key) {
      current = viewport; selectedKey = key; requestIds.skeletal++; requestIds.morph++;
      viewport.player.onChange = player => sync(player, true);
      viewport.player.onTick = player => {if (performance.now() - lastTick > 70) {lastTick = performance.now(); sync(player);}};
      sync(viewport.player, true);
      $('#motion-note').textContent = 'Choose an ANM from the library, or open a cutscene AFS for facial motion. FPS is a preview setting.';
      try {await options();} catch (error) {if (current === viewport) notify(error.message);}
    },
    detach() {current = null; selectedKey = null; requestIds.skeletal++; requestIds.morph++;},
    manual() {controls.morph.value = ''; $('#motion-note').textContent = 'Manual morph preview. Animate sweeps the selected shape automatically; Bake intensity stages an edit.';},
    select(entry) {
      if (!current || !$('#keep-model').checked) return false;
      if (/^anm_?$/.test(entry.extension)) {load('skeletal', `asset:${entry.key}`); return true;}
      if (['kg1', 'kg2'].includes(entry.extension)) {notify('KG1 / KG2 describe shadow geometry. Select an ANM or open a cutscene AFS to animate this model.'); return true;}
      return false;
    },
  };
}
