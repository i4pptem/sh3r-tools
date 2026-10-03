/** Editor undo must follow the physical shortcut across keyboard layouts without stealing text undo. */
export function isWorldUndo(event, state) {
  if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey || event.defaultPrevented) return false;
  if (event.code !== 'KeyZ' && event.key?.toLowerCase() !== 'z') return false;
  if (!['library','world'].includes(state.page) || !state.mapUndo || state.busy || document.querySelector('dialog[open]')) return false;
  const target = event.target;
  if (target?.closest('textarea,[contenteditable="true"],input') && !target.closest('[data-map-transform]')) return false;
  return true;
}

/** Physical keys match Cinema 4D tools without intercepting typing or file navigation. */
export function worldToolMode(event,state) {
  if(event.defaultPrevented||event.repeat||event.ctrlKey||event.metaKey||event.altKey||state.busy||!['library','world'].includes(state.page)||!state.preview?.world?.editable||document.querySelector('dialog[open]'))return null;
  if(event.target?.closest('input,textarea,select,[contenteditable="true"],.file-panel,.sidebar'))return null;
  return {KeyE:'translate',KeyR:'rotate',KeyT:'scale'}[event.code]||null;
}
