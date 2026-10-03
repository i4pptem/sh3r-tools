export function element(tag,text,className){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(className)e.className=className;return e;}
export function reviewDialog(title){
  const dialog=element('dialog',undefined,'review-dialog'),heading=element('header'),close=element('button','×');close.type='button';close.setAttribute('aria-label','Close');close.onclick=()=>dialog.close();heading.append(element('h2',title),close);
  const content=element('div',undefined,'review-content'),footer=element('footer');dialog.append(heading,content,footer);document.body.append(dialog);dialog.addEventListener('close',()=>dialog.remove(),{once:true});dialog.showModal();return {dialog,content,footer};
}
export function issueList(host,issues,openAsset){for(const issue of issues){const row=element('div',undefined,'review-issue '+issue.severity);row.append(element('strong',issue.severity.toUpperCase()),element('span',issue.message));if(issue.key&&openAsset){const button=element('button','Open asset ↗');button.onclick=()=>openAsset(issue.key);row.append(button);}host.append(row);}}
