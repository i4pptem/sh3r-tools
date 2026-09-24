const $ = selector => document.querySelector(selector);

/** Persist panel visibility; focus mode temporarily overrides it without losing preferences. */
export function workspaceLayout() {
  const stored = key => localStorage.getItem('sh3tools.layout.' + key) !== 'hidden';
  const panels = {library: stored('library'), inspector: stored('inspector')};
  let focused = false;
  function update() {
    for (const name of Object.keys(panels)) {
      const visible = panels[name] && !focused;
      document.body.classList.toggle(name + '-collapsed', !visible);
      const button = $('#toggle-' + name);
      button.setAttribute('aria-expanded', String(visible));
      button.classList.toggle('active', visible);
      button.title = (visible ? 'Hide ' : 'Show ') + (name === 'library' ? 'asset library (Ctrl+Shift+L)' : 'inspector');
    }
    document.body.classList.toggle('preview-focused', focused);
    $('#focus-preview').setAttribute('aria-pressed', String(focused));
    $('#focus-preview').textContent = focused ? 'Exit focus' : 'Focus preview';
  }
  function showLibrary() {focused = false; panels.library = true; localStorage.setItem('sh3tools.layout.library', 'shown'); update();}
  for (const name of Object.keys(panels)) $('#toggle-' + name).onclick = () => {
    if (focused) {focused = false; panels[name] = true;}
    else panels[name] = !panels[name];
    localStorage.setItem('sh3tools.layout.' + name, panels[name] ? 'shown' : 'hidden'); update();
  };
  $('#focus-preview').onclick = () => {focused = !focused; update();};
  document.addEventListener('keydown', event => {
    if (document.querySelector('dialog[open]')) return;
    if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.code === 'KeyL') {event.preventDefault(); $('#toggle-library').click();}
    if (event.key === 'Escape' && focused) {focused = false; update();}
  });
  update();
  return {showLibrary};
}
