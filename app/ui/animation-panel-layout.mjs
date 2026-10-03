import {floatingPanelLayout} from './floating-panel-layout.mjs';
export function animationPanelLayout() {
  const panel=document.querySelector('#motion-controls');
  return floatingPanelLayout({panel,host:panel.parentElement,heading:panel.querySelector('.motion-heading'),resize:panel.querySelector('#motion-panel-resize'),reset:panel.querySelector('#motion-panel-reset'),toggle:panel.querySelector('#motion-settings-toggle'),content:panel.querySelector('#motion-options'),storageKey:'sh3tools.layout.animationPanel',defaults:()=>({x:12,y:null,width:620,height:420})});
}
