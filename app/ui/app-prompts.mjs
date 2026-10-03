/** Render trusted application questions with the same keyboard/focus behavior as other editor dialogs. */
export function appPrompts() {
  window.studio.onPrompt(prompt=>{
    const prior=document.activeElement,dialog=document.createElement('dialog');dialog.className='app-prompt';dialog.setAttribute('aria-labelledby','app-prompt-title');
    const heading=document.createElement('header'),icon=document.createElement('img');icon.src='logo.svg';icon.alt='';heading.append(icon);
    const title=document.createElement('h2');title.id='app-prompt-title';title.textContent=prompt.title||'Silent Hill 3 Tools';heading.append(title);dialog.append(heading);
    const message=document.createElement('h3');message.textContent=prompt.message||'';dialog.append(message);
    const detail=document.createElement('p');detail.className='app-prompt-detail';detail.textContent=prompt.detail||'';dialog.append(detail);
    const check=document.createElement('input');check.type='checkbox';check.checked=!!prompt.checkboxChecked;
    if(prompt.checkboxLabel){const row=document.createElement('label');row.className='reference-toggle';row.append(check,document.createTextNode(prompt.checkboxLabel));dialog.append(row);}
    const footer=document.createElement('footer');dialog.append(footer);let answered=false;
    async function answer(response){
      if(answered)return;answered=true;
      try{await window.studio.answerPrompt({id:prompt.id,response,checkboxChecked:check.checked});dialog.close();dialog.remove();if(prior?.isConnected)prior.focus({preventScroll:true});}
      catch(error){answered=false;detail.textContent=error.message;}
    }
    prompt.buttons.forEach((label,index)=>{const button=document.createElement('button');button.textContent=label;button.type='button';button.className=index===prompt.defaultId?'primary':'';button.onclick=()=>answer(index);footer.append(button);});
    dialog.addEventListener('cancel',event=>{event.preventDefault();void answer(prompt.cancelId);});
    document.body.append(dialog);dialog.showModal();footer.children[prompt.defaultId]?.focus();
  });
}
