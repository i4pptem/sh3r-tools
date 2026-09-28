import {ImageViewport} from './image-viewport.mjs';

const pageSizes = [10, 20, 50, 100];
const $ = id => document.getElementById('texture-' + id);
const basename = name => name.replaceAll('\\', '/').split('/').pop();
function node(tag, className, text) {
  const element = document.createElement(tag); if (className) element.className = className;
  if (text !== undefined) element.textContent = text; return element;
}

/** Present native texture slots while retaining the owning asset for every operation. */
export function textureInspector(state, run, notify, openSource) {
  const savedSize = Number(localStorage.getItem('sh3tools.textures.pageSize'));
  let pageSize = pageSizes.includes(savedSize) ? savedSize : 20;
  $('page-size').value = String(pageSize);
  let catalog, loading = false, selected = null, preview = null, page = 0, gridRequest = 0, previewRequest = 0;
  const viewer = new ImageViewport($('image'), scale => {$('zoom').textContent = Math.round(scale * 100) + '%';});
  function setBusy(busy) {
    $('refresh').disabled = busy || loading || !state.library;
    $('import').disabled = busy || !preview || selected?.readOnly;
    $('export').disabled = busy || !preview;
    $('mode').disabled = busy || !preview;
    $('open-source').disabled = busy || !selected;
  }
  function clearSelection() {
    selected = null; preview = null; previewRequest++;
    $('selection').classList.add('hidden'); $('empty').classList.remove('hidden'); setBusy(state.busy);
  }
  function reset() {
    catalog = null; page = 0; gridRequest++; clearSelection();
    $('grid').replaceChildren(); $('issues').classList.add('hidden'); $('count').textContent = 'Open a data folder to see its textures.';
    $('search').value = ''; $('kind').value = 'all'; $('modified').checked = false;
  }
  async function refresh(force = false) {
    if (loading || state.busy || !state.library || state.page !== 'textures') return;
    loading = true; setBusy(true);
    $('count').textContent = 'Indexing texture sources…';
    try {
      const result = await run('textureCatalog', {force}, 'Indexing textures…');
      if (!result) {$('count').textContent = 'Catalog not refreshed. Apply map preview edits before refreshing.'; return;}
      catalog = result; state.library.textureRevision = result.revision;
      $('issues').classList.toggle('hidden', !result.issues.length);
      $('issues').querySelector('summary').textContent = result.issues.length + ' sources could not be decoded';
      const issueList = $('issues').querySelector('div'); issueList.replaceChildren();
      for (const issue of result.issues) {
        const row = node('p', '', issue.name + ' — ' + issue.reason); issueList.append(row);
      }
      renderGrid();
      if (selected) {
        const current = catalog.items.find(item => item.id === selected.id);
        if (current) await select(current); else clearSelection();
      }
    } finally {loading = false; setBusy(state.busy);}
  }
  function refreshIfVisible() {
    if (state.page === 'textures' && state.library && !state.busy && !loading && (!catalog || catalog.revision !== state.library.textureRevision)) void refresh();
  }
  function filtered() {
    const query = $('search').value.trim().toLowerCase(), kind = $('kind').value;
    return (catalog?.items || []).filter(item => (kind === 'all' || kind === item.kind) && (!$('modified').checked || item.changed) &&
      (!query || (item.name + ' ' + item.archiveName + ' ' + item.label + ' ' + item.usedBy.map(ref => ref.name).join(' ')).toLowerCase().includes(query)));
  }
  async function thumbnails(items, request) {
    try {
      for (let offset = 0; offset < items.length; offset += 32) {
        if (request !== gridRequest) return;
        const results = await window.studio.request('textureThumbnails', {ids: items.slice(offset, offset + 32).map(item => item.id)});
        if (request !== gridRequest) return;
        for (const result of results) {
          const card = [...$('grid').children].find(card => card.dataset.id === result.id); if (!card) continue;
          const image = card.querySelector('img'), placeholder = card.querySelector('.texture-thumb-status');
          if (result.url) {image.src = result.url; image.classList.remove('hidden'); placeholder.remove();}
          else {placeholder.textContent = 'Preview unavailable'; card.title += '\n' + result.error;}
        }
      }
    } catch (error) {if (request === gridRequest) notify(error.message);}
  }
  function renderGrid() {
    const items = filtered(), pages = Math.max(1, Math.ceil(items.length / pageSize));
    page = Math.min(page, pages - 1);
    const visible = items.slice(page * pageSize, (page + 1) * pageSize), request = ++gridRequest, fragment = document.createDocumentFragment();
    $('count').textContent = items.length.toLocaleString('en-US') + ' / ' + (catalog?.items.length || 0).toLocaleString('en-US') + ' textures';
    $('page-number').textContent = 'Page ' + (page + 1) + ' of ' + pages;
    $('prev').disabled = !page; $('next').disabled = page + 1 >= pages;
    for (const item of visible) {
      const card = node('button', 'texture-card' + (item.id === selected?.id ? ' selected' : ''));
      card.dataset.id = item.id; card.title = item.archiveName + ' / ' + item.name + '\n' + item.label;
      card.setAttribute('aria-pressed', String(item.id === selected?.id));
      const art = node('div', 'texture-thumb'), image = node('img', 'hidden'); image.alt = ''; image.draggable = false;
      art.append(image, node('span', 'texture-thumb-status', 'Loading…'));
      const details = node('div', 'texture-card-info');
      details.append(node('strong', '', basename(item.name)), node('span', '', item.label + ' · ' + item.width + ' × ' + item.height));
      details.append(node('small', item.changed ? 'texture-staged' : '', item.kind.toUpperCase() + (item.changed ? ' · Source modified' : item.usedBy.length ? ' · Shared' : '')));
      card.append(art, details); card.onclick = () => {if (!state.busy) void select(item);}; fragment.append(card);
    }
    if (!visible.length) fragment.append(node('p', 'texture-no-results', state.library ? 'No textures match this search.' : 'Open the game data folder to begin.'));
    $('grid').replaceChildren(fragment);
    if (visible.length) void thumbnails(visible, request);
  }
  function modeNote() {
    const mode = $('mode').value;
    $('mode-note').textContent = selected?.readOnly ? 'This compressed archive variant is read-only.' :
      mode === 'fullSize' ? 'Experimental: keeps the PNG dimensions and rebuilds direct-color storage. Build mod includes a runtime patch when required. Test in game.' :
      mode === 'fontHires' ? 'Use an integer atlas scale. Glyph IDs and spacing are preserved; Build mod adds the required font patch.' :
      selected?.font ? 'Preserve the atlas dimensions, glyph cells and spacing.' :
      selected?.kind === 'map' ? 'Fits PNG to the original size and native format, preserving MAP offsets.' :
      selected?.format?.startsWith('BMP') ? 'Fits an opaque PNG to the original bitmap size; preserves its native BMP layout.' :
      selected?.format === 'PNG' ? 'Replaces this PNG with the imported image at its supplied dimensions.' : 'Fits PNG to the original size and native format. Shared palette variants retain their index layout.';
  }
  async function select(item) {
    selected = item; preview = null; const request = ++previewRequest;
    for (const card of $('grid').children) {const active = card.dataset.id === item.id; card.classList.toggle('selected', active); card.setAttribute('aria-pressed', String(active));}
    $('empty').classList.add('hidden'); $('selection').classList.remove('hidden');
    $('slot').textContent = item.label + ' · ' + item.kind;
    $('name').textContent = basename(item.name);
    $('description').textContent = item.width + ' × ' + item.height + ' · ' + item.format + (item.changed ? ' · Source modified' : '');
    $('path').textContent = item.archiveName + ' / ' + item.name;
    $('error').classList.add('hidden'); $('image').classList.add('texture-loading');
    $('mode').replaceChildren();
    for (const [value, label] of [['fit', item.font ? 'Original atlas' : item.format === 'PNG' ? 'Replace PNG' : 'Fit to original'], ...(item.fullSize ? [['fullSize', 'Full size · experimental']] : []), ...(item.font ? [['fontHires', 'High-resolution atlas']] : [])]) {
      const option = node('option', '', label); option.value = value; $('mode').append(option);
    }
    modeNote(); setBusy(state.busy);
    const users = $('users'); users.classList.toggle('hidden', !item.usedBy.length);
    users.querySelector('summary').textContent = 'Used by ' + item.usedBy.length + ' maps — changes affect all';
    const links = users.querySelector('div'); links.replaceChildren();
    for (const ref of item.usedBy) {
      const link = node('button', '', ref.name); link.onclick = () => {if (!state.busy) openSource(ref.key);}; links.append(link);
    }
    try {
      const result = await window.studio.request('texturePreview', {id: item.id});
      if (request !== previewRequest) return;
      preview = result; viewer.show(result.url);
    } catch (error) {
      if (request === previewRequest) {$('error').textContent = error.message; $('error').classList.remove('hidden');}
    } finally {
      if (request === previewRequest) {$('image').classList.toggle('texture-loading', !preview); setBusy(state.busy);}
    }
  }
  async function exchange(action) {
    if (!selected || !preview || state.busy) return;
    const result = await run(action, {id: selected.id, hash: preview.hash, mode: $('mode').value, name: basename(selected.name).replace(/\.[^.]+$/, '') + '_' + selected.index}, action === 'replaceLibraryTexture' ? 'Importing texture…' : 'Exporting texture…');
    if (result?.entries) notify('Texture replacement staged. Use Build mod to create the updated game files.', true);
  }
  $('grid').addEventListener('keydown', event => {
    if (state.busy || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || !event.target.closest('.texture-card')) return;
    const columns = getComputedStyle($('grid')).gridTemplateColumns.split(' ').length;
    const step = {ArrowLeft: -1, ArrowRight: 1, ArrowUp: -columns, ArrowDown: columns}[event.key];
    if (!step) return;
    const items = filtered(), current = items.findIndex(item => item.id === event.target.closest('.texture-card').dataset.id);
    const next = Math.max(0, Math.min(items.length - 1, current + step)); if (!items[next]) return;
    event.preventDefault(); const nextPage = Math.floor(next / pageSize);
    if (nextPage !== page) {page = nextPage; renderGrid();}
    void select(items[next]);
    const card = [...$('grid').children].find(card => card.dataset.id === items[next].id);
    card?.focus({preventScroll: true}); card?.scrollIntoView({block: 'nearest'});
  });
  $('refresh').onclick = () => void refresh(true);
  for (const id of ['search', 'kind', 'modified']) $(id).addEventListener(id === 'search' ? 'input' : 'change', () => {page = 0; renderGrid();});
  $('page-size').onchange = () => {
    const next = Number($('page-size').value); if (!pageSizes.includes(next)) return;
    const selectedIndex = filtered().findIndex(item => item.id === selected?.id);
    const anchor = selectedIndex >= 0 ? selectedIndex : page * pageSize;
    pageSize = next; page = Math.floor(anchor / pageSize);
    localStorage.setItem('sh3tools.textures.pageSize', String(pageSize)); renderGrid();
  };
  $('prev').onclick = () => {page--; renderGrid();};
  $('next').onclick = () => {page++; renderGrid();};
  $('mode').onchange = modeNote;
  $('import').onclick = () => void exchange('replaceLibraryTexture');
  $('export').onclick = () => void exchange('exportLibraryTexture');
  $('open-source').onclick = () => {if (selected && !state.busy) openSource(selected.key);};
  $('zoom-out').onclick = () => viewer.zoom(viewer.scale / 1.25);
  $('zoom-in').onclick = () => viewer.zoom(viewer.scale * 1.25);
  $('fit').onclick = () => viewer.fit(); $('actual').onclick = () => viewer.zoom(1);
  return {setBusy, reset, refreshIfVisible, show() {refreshIfVisible(); if (!state.library) renderGrid();}};
}
