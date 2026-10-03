import {showChannels} from './animation-channels.mjs';
import {animationPanelLayout} from './animation-panel-layout.mjs';
import {animationImportDialog,showAnimationReport} from './animation-import.mjs';
const $ = selector => document.querySelector(selector);

export function motionControls(state, notify, run) {
  let current = null, selectedKey = null, requestIds = {skeletal: 0, morph: 0}, lastTick = 0, availableClips = [];
  animationPanelLayout();
  $('#animation-channels').onclick=async()=>{const info=await run('animationChannels',{key:selectedKey,id:current?.player.skeletal?.id},'Reading native channel flags…');if(info)showChannels(info);};
  $('#motion-auto-play').checked = localStorage.getItem('sh3tools.animation.autoPlay') === 'true';
  const tabs = [...document.querySelectorAll('[data-motion-tab]')];
  function showTab(tab) {
    for (const button of tabs) {
      const selected = button.dataset.motionTab === tab;
      button.setAttribute('aria-selected', String(selected)); button.tabIndex = selected ? 0 : -1;
      $('#motion-pane-' + button.dataset.motionTab).classList.toggle('hidden', !selected);
    }
  }
  for (const button of tabs) {
    button.onclick = () => showTab(button.dataset.motionTab);
    button.onkeydown = event => {
      if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
      event.preventDefault();
      const index = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length-1 : (tabs.indexOf(button)+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;
      showTab(tabs[index].dataset.motionTab); tabs[index].focus();
    };
  }
  let rangeClip = null, selectedRange = null;
  function syncRanges(player) {
    const select = $('#motion-action'), ranges = player.skeletal?.ranges || [];
    if (rangeClip !== player.skeletal) {
      rangeClip = player.skeletal; selectedRange = null;
      select.replaceChildren(new Option('Whole bank', ''), new Option('Custom range', 'custom'));
      for (const range of ranges) select.append(new Option(`${range.name?range.name+' · ':''}Action ${range.id} · ${range.start}–${range.end}${range.loop ? ' · loop' : ''}`, String(range.id)));
      select.disabled = !player.skeletal;
      $('#motion-action-source').textContent = ranges.length ? `${ranges.length} actions · read from sh3.exe` : player.skeletal?.rangeNote || '';
      $('#motion-action-source').title = player.skeletal?.rangeNote || '';
    }
    const whole = player.start === 0 && player.end === player.frameCount-1;
    const preferred = ranges.find(range => String(range.id) === selectedRange && range.start === player.start && range.end === player.end);
    const match = preferred || ranges.find(range => range.start === player.start && range.end === player.end);
    select.value = selectedRange === 'custom' ? 'custom' : preferred ? selectedRange : whole ? '' : match ? String(match.id) : 'custom';
    const index = ranges.findIndex(range => String(range.id) === select.value);
    $('#motion-action-prev').disabled = !ranges.length || index === 0;
    $('#motion-action-next').disabled = !ranges.length || index === ranges.length-1;
  }
  function selectRange(value) {
    selectedRange = value;
    if (!current || value === 'custom') return;
    const player = current.player, range = player.skeletal?.ranges?.find(range => String(range.id) === value);
    if (range) {player.loop = range.loop; if (range.fps > 0) player.fps = range.fps; player.range(range.start,range.end);}
    else player.range(0,player.frameCount-1);
    player.seek(player.start); if (player.autoReplay && player.skeletal?.sourceFormat === 'anm') player.playing = true; sync(player,true);
  }
  $('#motion-action').onchange = () => selectRange($('#motion-action').value);
  for (const [id,step] of [['prev',-1],['next',1]]) $('#motion-action-'+id).onclick = () => {
    const ranges = current?.player.skeletal?.ranges || [], index = ranges.findIndex(range => String(range.id) === $('#motion-action').value);
    const next = ranges[index < 0 ? step > 0 ? 0 : ranges.length-1 : index+step]; if (next) selectRange(String(next.id));
  };
  const controls = {skeletal: $('#skeletal-clip'), morph: $('#morph-clip')};
  function sync(player, full = false) {
    const pack=player.skeletal?.sourceFormat==='pack',asset=player.skeletal?.id?.startsWith('asset:');
    $('#animation-channels').disabled=state.busy||player.skeletal?.sourceFormat!=='anm';
    $('#export-animation').disabled=state.busy || !(asset||pack);
    $('#import-animation').disabled=state.busy || !(asset||(pack&&player.skeletal.assetKey));
    $('#export-animation').textContent=pack?'Export cutscene range…':'Export ANM range…';
    $('#motion-auto-play').disabled = player.skeletal?.sourceFormat !== 'anm';
    $('#motion-current').textContent = player.skeletal?.name || player.morphClip?.name || 'Bind pose';
    $('#motion-current').title = $('#motion-current').textContent;
    $('#play-motion').textContent = player.playing ? 'Pause' : 'Play';
    $('#play-motion').disabled = !(player.skeletal || player.morphClip);
    $('#stop-motion').disabled = !(player.skeletal || player.morphClip);
    $('#motion-frame').min = player.start; $('#motion-frame').max = player.end; $('#motion-frame').value = player.frame;
    const rangeText = `${player.start}–${player.end} inclusive · ${player.end-player.start+1} frames · ${player.loop ? 'loops to '+player.start : player.repeats ? 'auto-replays from '+player.start : 'stops at '+player.end}`;
    $('#motion-range-info').textContent = rangeText; $('#motion-exchange-range').textContent = rangeText;
    $('#motion-time').textContent = `${Math.floor(player.frame)} / ${player.end}`;
    $('#animate-morph').classList.toggle('active', player.audition);
    $('#animate-morph').textContent = player.audition ? 'Stop preview' : 'Animate';
    $('#bake-morph').disabled = player.audition || !!player.morphClip;
    if (!player.morphClip) {$('#morph-weight').value = player.weight; $('#morph-value').textContent = `${Math.round(player.weight * 100)}%`;}
    if (full) {
      syncRanges(player);
      controls.skeletal.value = player.skeletal?.id || ''; controls.morph.value = player.morphClip?.id || '';
      $('#motion-start').value = player.start; $('#motion-end').value = player.end;
      $('#motion-start').max = $('#motion-end').max = player.frameCount - 1;
      $('#motion-fps').value = player.fps; $('#motion-speed').value = player.speed; $('#motion-loop').checked = player.loop;
    }
  }
  async function options() {
    const viewport = current, key = selectedKey;
    const result = await window.studio.request('motionList', {key});
    if (!result || current !== viewport || state.selected !== key) return;
    availableClips = result.clips;
    for (const [type, select] of Object.entries(controls)) {
      const selected = type === 'skeletal' ? viewport.player.skeletal?.id : viewport.player.morphClip?.id;
      select.replaceChildren(new Option(type === 'skeletal' ? 'Bind pose' : 'Manual morph preview', ''));
      for (const [format, label] of [['anm', 'Gameplay / ANM'], ['pack', 'Cutscenes / PACK']]) {
        const clips = result.clips.filter(clip => clip.type === type && clip.sourceFormat === format);
        if (!clips.length) continue;
        const group = document.createElement('optgroup'); group.label = label;
        for (const clip of clips) group.append(new Option(`${clip.name} · ${clip.frameCount} frames`, clip.id));
        select.append(group);
      }
      select.value = selected || '';
    }
  }
  async function load(type, id) {
    const viewport = current, key = selectedKey, ticket = ++requestIds[type];
    if (!viewport) return;
    if (!id) {viewport.player.clip(type, null); controls[type].value = ''; if (type === 'skeletal') viewport.frame(); return;}
    if (type === 'skeletal') requestIds.morph++;
    $('#motion-note').textContent = 'Reading animation…';
    try {
      const clip = await window.studio.request('motionClip', {key, id});
      if (!clip || current !== viewport || state.selected !== key || ticket !== requestIds[type]) return;
      viewport.player.clip(type, clip); controls[type].value = id;
      if (type === 'skeletal') viewport.frame();
      if (type === 'morph') {$('#morph-weight').value = 0; $('#morph-value').textContent = '0%';}
      $('#motion-note').textContent = type === 'skeletal'
        ? clip.sourceFormat === 'pack'
          ? `Playing cutscene motion${clip.morphClip ? ' with its matching facial track' : '; no matching facial track'}. Use Fit to reframe the current pose. FPS is a preview setting. Export a range to Blender / FBX to edit motion and matching shape keys.`
          : 'Choose an action from the range list, or enter custom frame bounds. FPS is a preview setting; in-game rates may vary.'
        : 'Playing native cutscene morph weights. The final facial payload continues and holds its last pose. FPS is a preview setting.';
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
    await options(); const first = result.clips.find(clip => clip.type === 'skeletal') || result.clips[0]; if (first) await load(first.type, first.id);
  };
  $('#export-animation').onclick = () => {
    if(!current?.player.skeletal || state.busy)return;
    const player=current.player;return run('exportAnimation',{key:selectedKey,id:player.skeletal.id,start:player.start,end:player.end,fps:player.fps},'Exporting animation with Blender…');
  };
  $('#import-animation').onclick = async () => {
    if(!current?.player.skeletal || state.busy)return;
    const key=selectedKey,id=current.player.skeletal.id,start=current.player.start;
    const info=await run('prepareAnimationImport',{key,id},'Sampling original bones with Blender…');
    if(!info || state.selected!==key)return;
    const result=await animationImportDialog(info,start,options=>run('applyAnimationImport',{key,id,token:info.token,options},'Writing animation channels…'));
    if(!result || state.selected!==key)return;
    await options();await load('skeletal',result.animationId||id);
    const report=result.animationReport;
    if(report && current) {current.player.range(report.start,report.end);current.player.seek(report.start);current.player.playing=true;showAnimationReport($('#animation-import-result'),report);notify('Animation staged. Review the import result and test the built motion in game.',true);}
  };
  $('#play-motion').onclick = () => {
    if (!current) return; const player = current.player;
    if (!player.playing && player.frame >= player.end) player.seek(player.start);
    player.playing = !player.playing; sync(player);
  };
  $('#stop-motion').onclick = () => current?.player.stop();
  $('#motion-frame').oninput = () => current?.player.seek(Number($('#motion-frame').value));
  $('#motion-loop').onchange = () => {if (current) {current.player.loop = $('#motion-loop').checked;sync(current.player);}};
  $('#motion-auto-play').onchange = () => {
    const enabled = $('#motion-auto-play').checked; localStorage.setItem('sh3tools.animation.autoPlay', String(enabled));
    if (!current) return; const player = current.player; player.autoReplay = enabled;
    if (enabled && player.skeletal?.sourceFormat === 'anm' && player.frame >= player.end) {player.seek(player.start); player.playing = true;}
    sync(player);
  };
  $('#motion-speed').onchange = () => {if (current) current.player.speed = Number($('#motion-speed').value);};
  $('#motion-fps').onchange = () => {
    if (!current) return; const fps = Number($('#motion-fps').value);
    if (Number.isFinite(fps) && fps >= 1 && fps <= 120) current.player.fps = fps;
    sync(current.player, true);
  };
  for (const input of ['#motion-start', '#motion-end']) $(input).onchange = () => {
    if (!current) return; const start = Number($('#motion-start').value), end = Number($('#motion-end').value);
    if (Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end >= start && end < current.player.frameCount) {selectedRange = 'custom'; current.player.range(start, end);}
    else {notify('Choose a frame range within the loaded animation.'); sync(current.player, true);}
  };
  $('#animate-morph').onclick = () => {
    if (!current) return;
    current.player.auditionMorph(Number($('#morph-target').value), !current.player.audition); controls.morph.value = '';
    $('#motion-note').textContent = 'Automatic shape preview: neutral to full intensity. This does not change the native asset.';
  };
  return {
    async attach(viewport, key) {
      if(selectedKey!==key)$('#animation-import-result').hidden=true;
      current = viewport; selectedKey = key; requestIds.skeletal++; requestIds.morph++;
      viewport.player.autoReplay = $('#motion-auto-play').checked;
      viewport.player.onChange = player => sync(player, true);
      viewport.player.onTick = player => {if (performance.now() - lastTick > 70) {lastTick = performance.now(); sync(player);}};
      sync(viewport.player, true);
      $('#motion-note').textContent = 'Choose a bank or a cutscene. Matching facial motion loads automatically. External motion is available here for files outside the workspace.';
      try {await options();} catch (error) {if (current === viewport) notify(error.message);}
    },
    detach() {current = null; selectedKey = null; requestIds.skeletal++; requestIds.morph++;},
    manual() {controls.morph.value = ''; $('#motion-note').textContent = 'Manual morph preview. Animate sweeps the selected shape automatically; Bake intensity stages an edit.';},
    select(entry) {
      if (!current || !$('#keep-model').checked) return false;
      if (entry.detectedFormat === 'pack') {
        const clip = availableClips.find(clip => clip.assetKey === entry.key && clip.type === 'skeletal');
        if (clip) {load('skeletal', clip.id); return true;}
      }
      if (/^anm_?$/.test(entry.extension)) {load('skeletal', `asset:${entry.key}`); return true;}
      if (['kg1', 'kg2'].includes(entry.extension)) {notify('KG1 / KG2 describe shadow geometry. Select an ANM or open a cutscene AFS to animate this model.'); return true;}
      return false;
    },
  };
}
