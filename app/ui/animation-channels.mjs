import {reviewDialog,element as el} from './review-dialog.mjs';
export function showChannels(info){
 const {dialog,content,footer}=reviewDialog('Animation channel support');
 content.append(el('p',`Selected ANM · ${info.frames} frames. Channel availability belongs to this bank, not to Blender keyframes.`));
 content.append(el('p','Writable channels accept baked IK/FK transforms. A missing channel is preserved from the game; keys cannot add it. Scale is not stored in ANM.','hint'));
 const filter=el('input');filter.placeholder='Search bone…';filter.setAttribute('aria-label','Search animation channels');const only=el('select');only.append(new Option('All bones','all'),new Option('Position writable','translation'),new Option('Rotation writable','rotation'),new Option('No writable channels','none'));content.append(filter,only);
 const table=el('table',undefined,'review-table');content.append(table);
 function render(){table.replaceChildren();const heading=el('tr');for(const label of ['Bone','Position','Rotation','Scale'])heading.append(el('th',label));table.append(heading);for(const bone of info.bones){if(!bone.name.toLowerCase().includes(filter.value.toLowerCase())||(only.value==='none'?(bone.translation||bone.rotation):only.value!=='all'&&!bone[only.value]))continue;const row=el('tr');row.append(el('td',bone.name),el('td',bone.translation?'Writable':'Preserved by game'),el('td',bone.rotation?'Writable':'Preserved by game'),el('td','Not stored'));table.append(row);}}
 filter.oninput=render;only.onchange=render;render();const close=el('button','Close');close.onclick=()=>dialog.close();footer.append(close);
}
