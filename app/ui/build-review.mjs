import {reviewDialog,element as el,issueList} from './review-dialog.mjs';
export function reviewBuild(info,drafts,openAsset,build){
  const {dialog,content,footer}=reviewDialog('Review mod build');
  content.append(el('p',`${info.assets.length} changed assets · ${info.patches.length} required runtime patches`));
  content.append(el('h3','Checks'));
  const issues=[...drafts.map(draft=>({key:draft.key,severity:'error',message:`${draft.name}: ${draft.error||'Apply or discard preview edits before building.'}`})),...info.issues];
  issueList(content,issues,key=>{dialog.close();openAsset(key);});
  if(!issues.length)content.append(el('p','All supported structural and resource checks passed.','review-pass'));
  content.append(el('h3','Runtime patches'));
  if(!info.patches.length)content.append(el('p','No resource expansion patches are required.'));
  for(const patch of info.patches){const row=el('div',undefined,'review-patch');row.append(el('p',`${patch.name} · ${patch.reason}`));const related=el('details');related.append(el('summary','Related staged assets'));for(const asset of patch.assets||[]){const link=el('button',asset.name);link.onclick=()=>{dialog.close();openAsset(asset.key);};related.append(link);}row.append(related);content.append(row);}
  content.append(el('p','ASI overlay applies these patches in memory. Replace game files includes a patched executable when needed. The installation mode is chosen next.','hint'));
  const details=el('details');details.open=true;details.append(el('summary','Changed assets'));const table=el('table',undefined,'review-table');
  for(const asset of info.assets){const row=el('tr'),name=el('td'),link=el('button',asset.name);link.onclick=()=>{dialog.close();openAsset(asset.key);};name.append(link);row.append(name,el('td',asset.label),el('td',`${(asset.originalSize/1024).toFixed(1)} → ${(asset.size/1024).toFixed(1)} KiB`));table.append(row);}details.append(table);content.append(details);
  const cancel=el('button','Back to editing');cancel.onclick=()=>dialog.close();const next=el('button','Continue to Build mod…','primary');next.disabled=!info.canBuild||drafts.length>0;next.onclick=()=>{dialog.close();build(info.token);};footer.append(cancel,next);
}
