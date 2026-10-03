/** One owned prompt at a time; answers are bound to the originating main frame. */
module.exports=function appPrompts(ipcMain,getWindow,validateSender) {
  let active=null,sequence=0;
  ipcMain.handle('studio:prompt-answer',(event,answer)=>{
    validateSender(event);
    if(!active||answer?.id!==active.id||!Number.isInteger(answer.response)||answer.response<0||answer.response>=active.options.buttons.length)throw new Error('This prompt is no longer active.');
    const current=active;active=null;current.resolve({response:answer.response,checkboxChecked:!!answer.checkboxChecked});
  });
  return {
    get active(){return !!active;},
    ask(options){
      if(active)throw new Error('Answer the open dialog first.');
      const owner=getWindow(),value={buttons:['OK'],defaultId:0,cancelId:0,...options};
      return new Promise(resolve=>{active={id:++sequence,options:value,resolve};owner.webContents.send('studio:prompt',{id:active.id,...value});});
    },
    cancel(){if(active){const current=active;active=null;current.resolve({response:current.options.cancelId,checkboxChecked:false});}},
  };
};
