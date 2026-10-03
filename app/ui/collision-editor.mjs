const node=(tag,text)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;return e;};

/** Bind explicitly chosen solid meshes once; native map staging owns subsequent automatic rebuilds. */
export function collisionEditor(host,state,selected,run,notify,openAsset) {
  const info=state.preview.world.collision,key=state.selected,hash=state.preview.hash,meshes=state.preview.model.meshes;
  host.append(node('h3','Collision from map meshes'),Object.assign(node('p','Choose the solid meshes for each collision group once. Apply, map imports and individual mesh replacements then rebuild that group automatically.'),{className:'hint'}));
  if(!info.candidates.length){host.append(Object.assign(node('p','Open the game data folder or an archive containing the companion CLD.'),{className:'hint'}));return {refresh(){}};}
  const target=node('select');target.setAttribute('aria-label','Collision file');target.add(new Option('Choose collision file…',''));for(const item of info.candidates)target.add(new Option(item.name.split('/').pop(),item.key));target.value=info.selected||'';target.disabled=!!info.configured;target.dataset.unavailable=String(!!info.configured);host.append(target);
  const group=node('select');group.setAttribute('aria-label','Collision group');host.append(group);
  const sources=node('select');sources.multiple=true;sources.size=6;sources.setAttribute('aria-label','Collision source meshes');for(const mesh of meshes)sources.add(new Option(mesh.name,mesh.name));host.append(sources);
  const sourceStatus=node('p');sourceStatus.className='hint';host.append(sourceStatus);
  function choose(names){for(const option of sources.options)option.selected=names.includes(option.value);updateCount();}
  const names=()=>[...sources.selectedOptions].map(option=>option.value);
  function updateCount(){sourceStatus.textContent=`${names().length} source mesh(es). This replaces all polygons in the chosen CLD group; other groups stay unchanged.`;}
  sources.onchange=updateCount;
  function action(parent,label,callback){const b=node('button',label);b.type='button';b.onclick=callback;parent.append(b);return b;}
  action(host,'Use Inspector mesh selection',()=>choose(selected()));
  const quality=node('select');quality.setAttribute('aria-label','Collision detail');quality.add(new Option('Simplified · recommended','simple'));quality.add(new Option('Full source detail','exact'));host.append(node('label','Collision detail'),quality);
  const filter=node('select');filter.setAttribute('aria-label','Collision surfaces');filter.add(new Option('All selected surfaces','all'));filter.add(new Option('Walkable faces only · slopes up to 60°','walkable'));host.append(filter);
  const advanced=node('details');advanced.className='collision-advanced';advanced.append(node('summary','Surface rules & original collision'));host.append(advanced);
  const mode=node('select');mode.setAttribute('aria-label','Collision indexing');mode.add(new Option('Room','room'));mode.add(new Option('Outdoor grid','grid'));mode.value=info.mode;advanced.append(mode);
  function numeric(label,aria){const row=node('label',label),input=node('input');input.type='number';input.step='1';input.min='0';input.setAttribute('aria-label',aria);row.className='map-fields';row.append(input);advanced.append(row);return input;}
  const material=numeric('Material ID','Collision material ID');material.max='4294967295';const template=numeric('Behavior from polygon','Collision template polygon');
  advanced.append(Object.assign(node('p','Floors/ray surfaces accept triangles. Character walls need upright rectangular surfaces; use simple wall meshes. Material and behavior come from this CLD, not the texture material.'),{className:'hint'}));
  const tolerance=numeric('Shape tolerance','Collision shape tolerance');tolerance.step='any';tolerance.max='1000';
  const targetCount=numeric('Target triangles','Collision target triangles');targetCount.min='1';targetCount.max='100000';
  advanced.append(Object.assign(node('p','Simplification removes render seams and redundant triangles, preserves topology and keeps separate obstacles. The target is a goal; openings and the shape tolerance can require more faces. Native wall groups are merged into upright rectangles.'),{className:'hint'}));
  let groups=info.groups,request=0,dead=false;
  const complexity=node('p');complexity.className='auto-collision-status';host.append(complexity);
  function detailState(){const wall=[1,3].includes(Number(group.value));quality.disabled=wall;quality.dataset.unavailable=String(wall);for(const input of [tolerance,targetCount]){input.disabled=wall||quality.value==='exact';input.dataset.unavailable=String(input.disabled);}complexity.textContent='Preview complexity before rebuilding a whole room.';}
  quality.onchange=detailState;
  function fillGroup(){const index=Number(group.value),item=groups[index],binding=info.bindings.find(b=>b.group===index);material.value=binding?.material??item?.materials[0]??0;template.value=binding?.template??(item?.count?0:-1);template.min=item?.count?'0':'-1';template.max=Math.max(0,(item?.count||0)-1);template.disabled=!item?.count;template.dataset.unavailable=String(!item?.count);choose(binding?.parts||selected());quality.value=binding&&!binding.simplification?'exact':'simple';filter.value=binding?.surfaceFilter||(binding?'all':index===0?'walkable':'all');tolerance.value=binding?.simplification?.error??20;targetCount.value=binding?.simplification?.target??Math.max(8,(item?.count||8)*2);detailState();}
  function fillGroups(){group.replaceChildren();groups.forEach((item,i)=>group.add(new Option(`${item.name} · ${item.count} polygons`,i)));fillGroup();}
  group.onchange=fillGroup;fillGroups();
  target.onchange=async()=>{const ticket=++request;groups=[];fillGroups();if(!target.value)return;try{const result=await window.studio.request('collisionInfo',{key,target:target.value});if(dead||ticket!==request)return;groups=result.groups;mode.value=result.mode;fillGroups();}catch(error){notify(error.message);}};
  const status=node('p');status.className='auto-collision-status';status.textContent=info.configured?`Automatic rebuild enabled for ${info.bindings.length} group(s). ${info.groups.filter((g,i)=>info.bindings.some(b=>b.group===i)).map(g=>g.name+': '+g.count+' → '+g.currentCount+' polygons').join(' · ')}. Saved with your project.`:'Automatic rebuild is off. Configure a group below to enable it.';host.append(status);
  const actions=node('div');actions.className='action-stack';host.append(actions);
  function options(){
    if(!target.value||!names().length){notify('Choose a collision file and its source meshes.');return null;}
    if([material,template,tolerance,targetCount].some(input=>!input.disabled&&(!input.validity.valid||input.value===''))){notify('Enter valid collision material, detail and behavior values.');return null;}
    return {target:target.value,mode:mode.value,group:Number(group.value),parts:names(),material:Number(material.value),template:Number(template.value),surfaceFilter:filter.value,
      simplification:quality.value==='simple'&&!quality.disabled?{error:Number(tolerance.value),target:Number(targetCount.value)}:null};
  }
  action(actions,'Preview complexity',async()=>{const value=options();if(!value)return;const result=await run('previewMapCollision',{key,hash,options:value},'Simplifying collision preview…');if(!result||dead)return;const item=result.groups[value.group];complexity.textContent=`${item.count} polygons · original group: ${item.original}. ${item.count>Math.max(512,item.original*4)?'Still detailed: reduce the source selection or adjust Shape tolerance.':'Ready to review in the collision layer after applying.'}`;});
  action(actions,info.configured?'Update binding & rebuild':'Enable auto rebuild',()=>{const value=options();if(value)return run('bindMapCollision',{key,hash,options:value},'Simplifying and linking collision…');}).className='primary';
  const stop=action(actions,'Stop auto rebuild · keep collision',()=>run('bindMapCollision',{key,hash,options:{disconnect:true}},'Keeping collision for manual editing…'));stop.disabled=!info.configured;stop.dataset.unavailable=String(!info.configured);
  action(advanced,'Open CLD asset',()=>{if(target.value)openAsset(target.value);});
  const restore=action(advanced,'Restore original collision & disconnect',()=>run('bindMapCollision',{key,hash,options:null},'Restoring collision before binding…'));restore.disabled=!info.configured;restore.dataset.unavailable=String(!info.configured);
  return {refresh(){updateCount();},dispose(){dead=true;++request;}};
}
