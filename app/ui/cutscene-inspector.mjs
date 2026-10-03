import {importSceneDialog} from './scene-import-dialog.mjs';
import {sceneModelCandidates,defaultSceneModel} from '../../core/cutscene-models.mjs';
import {sceneSample} from '../../core/cutscene-camera.mjs';
import {exportSceneDialog} from './scene-export-dialog.mjs';
import {CutsceneViewport} from './cutscene-viewport.mjs';
const $=id=>document.getElementById('scene-'+id);
function element(tag,text){const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node;}
function option(value,text){const node=element('option',text);node.value=value;return node;}

export function cutsceneInspector(state,run,notify,openSource) {
  let catalog=null,selected=null,viewer=null,loading=false,generation=0,visible=false;
  function setBusy(busy){for(const id of ['play','stop','frame'])$(id).disabled=busy||loading||!viewer?.data;for(const id of ['refresh','load','open','export','import'])$(id).disabled=busy||loading||!state.library||(id!=='refresh'&&!selected);}
  function tick(player){$('play').textContent=player.playing?'Pause':'Play';$('frame').value=player.frame;$('time').textContent=`${Math.floor(player.frame)} / ${(player.data?.frameCount||1)-1} · ${(player.frame/30).toFixed(2)}s`; $('masks').textContent=player.data?.masks.map(track=>`Map mask ${track.modelId}:${track.index}: 0x${sceneSample(track,player.frame,player.data.cuts,true)[0].toString(16).toUpperCase().padStart(8,'0')}`).join(' · ')||'';}
  function list(){const query=$('search').value.toLowerCase();$('list').replaceChildren();const scenes=catalog?.scenes.filter(s=>s.name.toLowerCase().includes(query))||[];
    $('count').textContent=`${scenes.length} cutscenes · 30 FPS`;for(const scene of scenes){const button=element('button');button.setAttribute('role','option');button.setAttribute('aria-selected',String(selected?.id===scene.id));button.className='scene-item';button.append(element('strong',scene.name),element('span',`${scene.actors.length} characters · ${(scene.frameCount/30).toFixed(1)}s`));button.onclick=()=>select(scene);$('list').append(button);}}
  function resources(scene){$('actors').replaceChildren();for(const actor of scene.actors){const row=element('div');row.className='scene-actor';const label=element('label',`Character 0x${actor.modelId.toString(16).toUpperCase()}`),select=element('select');select.dataset.model=actor.modelId;
      const candidates=sceneModelCandidates(catalog.models,actor);for(const model of candidates)select.append(option(model.key,model.name.split('/').pop()));select.append(option('',candidates.length?'Hidden':'Matching model is missing'));const preferred=defaultSceneModel(candidates,actor);if(preferred)select.value=preferred.key;label.append(select);const open=element('button','Open ↗');open.onclick=()=>{if(select.value)openSource(select.value);};row.append(label,open);$('actors').append(row);}
    $('audio').replaceChildren(option('','Silent'));for(const audio of catalog.audio.filter(a=>a.archive===scene.archive))$('audio').append(option(audio.key,`Entry ${audio.index}${audio.index===scene.native?.audioEntry?' · native soundtrack':''}`));$('audio').value=catalog.audio.find(a=>a.archive===scene.archive&&a.index===scene.native?.audioEntry)?.key||'';
    $('maps').replaceChildren(...catalog.maps.map(map=>option(map.key,map.name.replace(/^data\/tmp\//,''))));
  }
  async function select(scene){if(state.busy||loading)return;selected=scene;resources(scene);list();$('title').textContent=scene.name;await load(false);}
  async function load(custom){if(!selected||loading)return;loading=true;const token=++generation;setBusy(state.busy);viewer?.pause();$('empty').classList.remove('hidden');$('empty').textContent='Loading scene resources…';
    try{const options=custom?{models:Object.fromEntries([...$('actors').querySelectorAll('select')].map(s=>[s.dataset.model,s.value])),maps:[...$('maps').selectedOptions].map(o=>o.value),audio:$('audio').value}:{};
      const result=await run('cutscenePreview',{id:selected.id,options},'Loading cutscene…');if(token!==generation)return;if(!result){$('empty').textContent='Scene loading was cancelled.';return;}
      if(!viewer)viewer=new CutsceneViewport($('viewer'),tick,message=>notify(message));viewer.setVisible(visible);
      if(!await viewer.load(result)||token!==generation)return;
      viewer.setMode($('view').value);viewer.visibilityEnabled=$('visibility').checked;viewer.apply();viewer.letterbox=$('aspect').checked;viewer.loop=$('loop').checked;viewer.audio.muted=$('mute').checked;
      $('empty').classList.add('hidden');for(const id of ['play','stop','frame'])$(id).disabled=false;$('frame').max=result.frameCount-1;
      for(const item of $('maps').options)item.selected=result.environment.some(e=>e.key===item.value);$('audio').value=result.audioKey;
      $('note').textContent=[result.note,catalog.note].filter(Boolean).join(' ');$('issues').replaceChildren(...result.issues.map(text=>element('li',text)));
      $('summary').textContent=`${result.actors.length} characters · ${result.environment.length} maps · ${viewer.props.length} moving map parts · ${result.audio?'audio ready':'silent'} · frames 0–${result.frameCount-1}${result.issues.length?' · resource notes':''}`;
    }catch(error){if(token===generation){$('empty').textContent='Scene could not be loaded. '+error.message;notify(error.message);}}
    finally{if(token===generation){loading=false;setBusy(state.busy);}}
  }
  async function show(force=false){if(!state.library||loading)return;if(catalog&&!force&&catalog.revision===state.library.textureRevision)return;loading=true;setBusy(state.busy);
    try{const result=await run('cutsceneCatalog',{force},'Scanning cutscene resources…');if(result){catalog=result;list();if(selected)$('note').textContent='Resources changed. Select the scene again to reload staged assets.';if(result.issues.length)notify(`${result.issues.length} source(s) could not be indexed. Other cutscenes remain available.`);}}
    finally{loading=false;setBusy(state.busy);}}
  $('visibility').onchange=()=>{if(viewer){viewer.visibilityEnabled=$('visibility').checked;viewer.apply();}};
  $('import').onclick=()=>{if(viewer?.data)importSceneDialog(selected.id,run,notify,()=>load(true));};
  $('export').onclick=()=>{if(viewer?.data)exportSceneDialog(viewer.data,selected,viewer.visibilityEnabled,run,notify);};
  $('search').oninput=list;$('refresh').onclick=()=>show(true);$('load').onclick=()=>load(true);$('open').onclick=()=>selected&&openSource(selected.key);
  $('resources-toggle').onclick=()=>{const hidden=$('resources').classList.toggle('hidden');$('resources-toggle').setAttribute('aria-expanded',String(!hidden));};
  $('play').onclick=()=>viewer?.playing?viewer.pause():viewer?.play();$('stop').onclick=()=>{viewer?.pause();viewer?.seek(0);};$('frame').oninput=()=>viewer?.seek(Number($('frame').value));
  $('view').onchange=()=>viewer?.setMode($('view').value);$('aspect').onchange=()=>{if(viewer)viewer.letterbox=$('aspect').checked;};$('loop').onchange=()=>{if(viewer)viewer.loop=$('loop').checked;};$('mute').onchange=()=>{if(viewer)viewer.audio.muted=$('mute').checked;};
  return {show,setBusy,setVisible(value){visible=value;viewer?.setVisible(value);},reset(){++generation;loading=false;catalog=null;selected=null;viewer?.dispose();viewer=null;$('list').replaceChildren();$('title').textContent='Select a cutscene';$('empty').classList.remove('hidden');$('empty').textContent='Choose a scene from the catalog.';for(const id of ['play','stop','frame'])$(id).disabled=true;}};
}
