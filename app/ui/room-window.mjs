import {floatingPanelLayout} from './floating-panel-layout.mjs';
const node=(tag,text)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;return e;};

/** The room panel owns presentation; layer editors retain their selections and transactions. */
export function roomWindow(host,{pickMode,selectMode,apply,undo,discard,session}) {
  const panel=node('section');panel.className='room-window';panel.setAttribute('aria-label','Room editor');host.append(panel);
  const heading=node('header');heading.className='room-heading';heading.tabIndex=0;heading.setAttribute('aria-label','Move Room editor');heading.append(node('strong','ROOM EDITOR'));
  const reset=node('button','↺');reset.title='Reset panel size and position';reset.setAttribute('aria-label','Reset Room editor layout');
  const toggle=node('button','Settings');toggle.setAttribute('aria-label','Expand Room editor');heading.append(reset,toggle);panel.append(heading);
  const toolbar=node('div');toolbar.className='room-toolbar';panel.append(toolbar);
  const pick=node('select');pick.setAttribute('aria-label','Viewport selection layer');for(const [value,label]of [['auto','Pick visible'],['map','Meshes only'],['cld','Collisions only'],['cam','Cameras only']])pick.add(new Option(label,value));pick.onchange=()=>pickMode(pick.value);toolbar.append(pick);
  const tools=[];for(const [mode,label]of [['translate','E · Move'],['rotate','R · Rotate'],['scale','T · Scale']]){const button=node('button',label);button.title=label;button.onclick=()=>selectMode(mode);toolbar.append(button);tools.push({mode,button});}
  const content=node('div');content.className='room-content';content.classList.toggle('hidden',!session.expanded);panel.append(content);const tabs=node('div');tabs.className='room-tabs';tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','Room tools');content.append(tabs);
  const panes={},buttons={};
  for(const [id,label]of [['cld','Collisions'],['cam','Cameras'],['auto','Auto rebuild']]){
    const button=node('button',label);button.dataset.roomTab=id;button.setAttribute('role','tab');button.onclick=()=>show(id);tabs.append(button);buttons[id]=button;
    const pane=node('div');pane.className='room-pane';pane.dataset.roomPane=id;pane.id='room-pane-'+id;pane.setAttribute('role','tabpanel');pane.setAttribute('aria-label',label);button.setAttribute('aria-controls',pane.id);panes[id]=pane;content.append(pane);
    button.onkeydown=event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();event.stopPropagation();const ids=Object.keys(panes),index=event.key==='Home'?0:event.key==='End'?ids.length-1:(ids.indexOf(id)+(event.key==='ArrowRight'?1:-1)+ids.length)%ids.length;show(ids[index]);buttons[ids[index]].focus();};
  }
  const footer=node('footer');footer.className='room-footer';const status=node('p');status.className='room-draft-status';status.setAttribute('role','status');footer.append(status);
  const actions=node('div');actions.className='room-actions';footer.append(actions);for(const [label,callback]of [['Apply room',apply],['Undo',undo],['Discard previews',discard]]){const b=node('button',label);b.onclick=callback;if(label==='Apply room')b.className='primary';actions.append(b);}content.append(footer);
  const resize=node('button');resize.className='motion-panel-resize hidden';resize.setAttribute('aria-label','Resize Room editor');panel.append(resize);
  const layout=floatingPanelLayout({panel,host,heading,resize,reset,toggle,content,storageKey:'sh3tools.layout.roomPanel',defaults:()=>({x:12,y:12,width:420,height:480}),minWidth:320,minHeight:280,onExpanded:open=>session.expanded=open});
  function show(id,expand=false){session.tab=id;for(const name of Object.keys(panes)){const selected=name===id;panes[name].classList.toggle('hidden',!selected);buttons[name].setAttribute('aria-selected',String(selected));buttons[name].tabIndex=selected?0:-1;}if(expand)layout.setExpanded(true);}
  show(panes[session.tab]?session.tab:'cld');
  return {panel,panes,show,setPick(value){pick.value=value;},tool(mode){for(const item of tools)item.button.classList.toggle('active',item.mode===mode);},status(message){status.textContent=message;},dispose(){layout.dispose();panel.remove();}};
}
