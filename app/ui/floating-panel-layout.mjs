const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

function storedLayout(storageKey,defaults) {
  const saved = localStorage.getItem(storageKey);
  if (!saved) return defaults();
  let value;
  try {value = JSON.parse(saved);} catch (error) {if (!(error instanceof SyntaxError)) throw error; return defaults();}
  if (!value || !['x', 'width', 'height'].every(key => Number.isFinite(value[key])) || !(value.y === null || Number.isFinite(value.y)) || value.width <= 0 || value.height <= 0) return defaults();
  return {x: value.x, y: value.y, width: value.width, height: value.height};
}

/** Keep floating editor windows inside their host and remember user placement. */
export function floatingPanelLayout({panel,host,heading,resize,reset,toggle,content,storageKey,defaults,minWidth=320,minHeight=200,onExpanded=()=>{}}) {
  let preferred = storedLayout(storageKey,defaults), gesture = null, scheduled = false, disposed = false;
  const expanded = () => !content.classList.contains('hidden');
  const save = () => localStorage.setItem(storageKey, JSON.stringify(preferred));

  function limits() {
    const width = Math.max(0, host.clientWidth - 24), height = Math.max(0, host.clientHeight - 24);
    return {width, height, minWidth: Math.min(minWidth, width), minHeight: Math.min(minHeight, height)};
  }
  function layout() {
    if (disposed || !panel.getClientRects().length || !host.clientWidth || !host.clientHeight) return;
    const bounds = limits(), width = clamp(preferred.width, bounds.minWidth, bounds.width);
    panel.style.width = width + 'px';
    panel.style.height = expanded() ? clamp(preferred.height, bounds.minHeight, bounds.height) + 'px' : 'auto';
    const maxX = 12 + bounds.width - width, maxY = Math.max(12, host.clientHeight - 12 - panel.offsetHeight);
    panel.style.left = clamp(preferred.x, 12, maxX) + 'px';
    panel.style.top = (preferred.y === null ? maxY : clamp(preferred.y, 12, maxY)) + 'px';
    panel.style.bottom = 'auto';
  }
  function scheduleLayout() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {scheduled = false; layout();});
  }
  function rect() {
    return {x: panel.offsetLeft, y: panel.offsetTop, width: panel.offsetWidth, height: panel.offsetHeight};
  }
  function setExpanded(open) {
    content.classList.toggle('hidden', !open); resize.classList.toggle('hidden', !open);
    toggle.setAttribute('aria-expanded', String(open));onExpanded(open);layout();
  }
  function moveOrResize(kind, start, dx, dy) {
    const bounds = limits();
    if (kind === 'move') {
      preferred.x = clamp(start.x + dx, 12, Math.max(12, host.clientWidth - 12 - start.width));
      preferred.y = clamp(start.y + dy, 12, Math.max(12, host.clientHeight - 12 - start.height));
    } else {
      preferred.x = start.x; preferred.y = start.y;
      preferred.width = clamp(start.width + dx, bounds.minWidth, host.clientWidth - 12 - start.x);
      preferred.height = clamp(start.height + dy, bounds.minHeight, host.clientHeight - 12 - start.y);
    }
    layout();
  }
  function finish(cancel = false) {
    if (!gesture) return;
    const previous = gesture; gesture = null;
    if (cancel) preferred = previous.saved; else save();
    panel.classList.remove('panel-moving', 'panel-resizing');
    if (previous.target.hasPointerCapture(previous.id)) previous.target.releasePointerCapture(previous.id);
    layout();
  }
  function bindHandle(target, kind) {
    target.addEventListener('pointerdown', event => {
      if (event.button !== 0 || !event.isPrimary || gesture || (kind === 'move' && event.target.closest('button, input, select, a'))) return;
      event.preventDefault(); event.stopPropagation(); target.focus({preventScroll: true});
      gesture = {target, kind, id: event.pointerId, x: event.clientX, y: event.clientY, start: rect(), saved: {...preferred}};
      target.setPointerCapture(event.pointerId); panel.classList.add(kind === 'move' ? 'panel-moving' : 'panel-resizing');
    });
    target.addEventListener('pointermove', event => {
      if (!gesture || gesture.id !== event.pointerId) return;
      moveOrResize(gesture.kind, gesture.start, event.clientX - gesture.x, event.clientY - gesture.y);
    });
    target.addEventListener('pointerup', event => {if (gesture?.id === event.pointerId) finish();});
    target.addEventListener('pointercancel', () => finish(true));
    target.addEventListener('lostpointercapture', () => finish(true));
    target.addEventListener('keydown', event => {
      if (event.target !== target || event.altKey || event.ctrlKey || event.metaKey) return;
      const direction = {ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1]}[event.key];
      if (!direction) return;
      event.preventDefault(); event.stopPropagation();
      const step = event.shiftKey ? 40 : 10;
      moveOrResize(kind, rect(), direction[0] * step, direction[1] * step); save();
    });
  }
  bindHandle(heading, 'move'); bindHandle(resize, 'resize');
  panel.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    if (gesture) {event.preventDefault(); event.stopImmediatePropagation(); finish(true);}
    else if (expanded()) {event.stopPropagation(); setExpanded(false); toggle.focus();}
  });
  toggle.onclick = () => setExpanded(!expanded());
  reset.onclick = () => {finish(true); preferred = defaults(); save(); layout();};
  const observer = new ResizeObserver(scheduleLayout); observer.observe(host); observer.observe(panel);
  setExpanded(expanded());
  return {setExpanded,dispose(){finish(true);disposed=true;observer.disconnect();}};
}
