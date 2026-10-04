import {operationProgress} from './operation-progress.mjs';

const node = (tag, text) => {const result = document.createElement(tag); if (text !== undefined) result.textContent = text; return result;};

export function batchReplace(library, run, notify, defaults = {}) {
  const dialog = node('dialog'), form = node('form'); dialog.className = 'replacement-dialog batch-dialog'; form.method = 'dialog';
  const title = node('h2', 'Replace from folder'), intro = node('p', 'Match a folder to the open game, review the replacements, then stage the selected files. Originals remain unchanged until you install a built mod.');
  const settings = node('div'); settings.className = 'batch-settings';
  const control = (text, options) => {const label = node('label', text), select = node('select'); for (const [value, text] of options) select.add(new Option(text, value)); label.append(select); settings.append(label); return select;};
  const kind = control('Assets', [['textures', 'Textures · PNG / native'], ['audio', 'Audio · WAV / native']]);
  const scope = control('Match against', [['', 'All opened archives and folders'], ...library.archives.map(archive => [String(archive.id), archive.name])]);
  const mode = control('PNG dimensions', [['fit', 'Fit to original'], ['fullSize', 'Full size · supported textures']]);
  kind.value = defaults.kind || 'textures'; scope.value = defaults.archive === undefined ? '' : String(defaults.archive);
  const help = node('p'); help.className = 'hint';
  const updateHelp = () => {
    mode.parentElement.hidden = kind.value === 'audio';
    help.textContent = kind.value === 'textures'
      ? 'Use PNG names from Texture Inspector (chhaa_0.png), or keep the converted export folders (chhaa.mdl/texture_000.png). Native TEX/PIC files keep their original names. Fit also handles palettes. Full size follows the individual texture restrictions.'
      : 'Use original WAV/ADX/AIX filenames, sd.afs.entries/entry_00000.wav, or converted export folders with track_000.wav for AIX and HD/BD. Bank tracks keep their original duration and need FFmpeg. Standalone ADX replacement needs a native ADX file.';
  }; updateHelp();
  const scan = node('button', 'Choose folder & scan…'); scan.type = 'button';
  const folder = node('p'), summary = node('p'), error = node('p'); folder.className = 'batch-folder hint'; summary.setAttribute('aria-live', 'polite'); error.className = 'batch-error'; error.setAttribute('role', 'alert');
  const review = node('section'); review.hidden = true;
  const tools = node('div'); tools.className = 'batch-review-tools';
  const allLabel = node('label'), all = node('input'); all.type = 'checkbox'; allLabel.append(all, document.createTextNode(' Select all ready'));
  const filter = node('select'); filter.setAttribute('aria-label', 'Filter replacement results'); filter.add(new Option('All files', 'all')); filter.add(new Option('Ready to stage', 'ready')); filter.add(new Option('Needs attention / skipped', 'issues'));
  tools.append(allLabel, filter);
  const list = node('div'); list.className = 'batch-list'; list.setAttribute('role', 'list');
  const pagination = node('div'), previous = node('button', 'Previous'), next = node('button', 'Next'), pageLabel = node('span'); pagination.className = 'batch-pages'; previous.type = next.type = 'button'; pagination.append(previous, pageLabel, next);
  const issues = node('details'), issuesTitle = node('summary'), issueList = node('ul'); issues.append(issuesTitle, issueList);
  review.append(tools, list, pagination, issues);
  const actions = node('div'), cancel = node('button', 'Cancel'), apply = node('button', 'Stage selected'); actions.className = 'replacement-actions'; cancel.type = apply.type = 'button'; apply.className = 'primary'; apply.disabled = true; actions.append(cancel, apply);
  form.append(title, intro, settings, help, scan, folder, summary, error, review, actions); dialog.append(form); document.body.append(dialog);
  const progress = operationProgress(dialog);
  let plan = null, busy = false, page = 0, selected = new Set();
  const ready = () => plan?.rows.filter(row => row.status === 'ready') || [];
  const updateSelection = () => {
    const count = ready().length; all.disabled = busy || !count; all.checked = count > 0 && selected.size === count; all.indeterminate = selected.size > 0 && selected.size < count;
    apply.disabled = busy || !selected.size; apply.textContent = 'Stage ' + selected.size + ' selected';
  };
  const render = () => {
    if (!plan) return;
    const rows = plan.rows.filter(row => filter.value === 'all' || (filter.value === 'ready' ? row.status === 'ready' : row.status !== 'ready'));
    const pages = Math.max(1, Math.ceil(rows.length / 100)); page = Math.min(page, pages - 1); list.replaceChildren();
    for (const row of rows.slice(page * 100, (page + 1) * 100)) {
      const line = node('label'), check = node('input'), content = node('div'), badge = node('span', row.status); line.className = 'batch-row'; line.setAttribute('role', 'listitem'); check.type = 'checkbox'; check.disabled = busy || row.status !== 'ready'; check.checked = selected.has(row.id); check.setAttribute('aria-label', 'Stage ' + row.name);
      check.onchange = () => {if (check.checked) selected.add(row.id); else selected.delete(row.id); updateSelection();};
      badge.className = 'batch-badge ' + row.status;
      content.append(node('strong', row.name), node('span', row.target || row.candidates.join(' / ') || 'No target'), node('small', row.detail));
      line.append(check, content, badge); list.append(line);
    }
    previous.disabled = busy || page === 0; next.disabled = busy || page + 1 === pages; pageLabel.textContent = 'Page ' + (page + 1) + ' / ' + pages + ' · ' + rows.length + ' files'; updateSelection();
  };
  const setBusy = value => {
    busy = value; for (const input of [kind, scope, mode, scan, cancel, filter]) input.disabled = value;
    render(); updateSelection();
  };
  const clear = () => {
    if (plan) window.studio.request('cancelBatchReplace', {token: plan.token}).catch(error => notify(error.message));
    plan = null; selected.clear(); review.hidden = true; summary.textContent = ''; folder.textContent = ''; error.textContent = ''; updateSelection();
  };
  kind.onchange = () => {clear(); updateHelp();}; scope.onchange = mode.onchange = clear;
  filter.onchange = () => {page = 0; render();}; previous.onclick = () => {page--; render();}; next.onclick = () => {page++; render();};
  all.onchange = () => {selected = new Set(all.checked ? ready().map(row => row.id) : []); render();};
  scan.onclick = async () => {
    clear(); setBusy(true); progress.start('Choose a folder, then validate replacements…');
    try {
      plan = await run('prepareBatchReplace', {kind: kind.value, archive: scope.value === '' ? null : Number(scope.value), mode: mode.value}, 'Scanning replacement folder…', message => {error.textContent = message;});
      if (!plan) return;
      folder.textContent = plan.folder; summary.textContent = plan.rows.length + ' files · ' + ready().length + ' ready · ' + plan.rows.filter(row => row.status === 'unchanged').length + ' unchanged · ' + plan.rows.filter(row => !['ready', 'unchanged'].includes(row.status)).length + ' need attention / skipped';
      selected = new Set(ready().map(row => row.id)); page = 0; review.hidden = false;
      issues.hidden = !plan.issues.length; issuesTitle.textContent = plan.issues.length + ' source assets could not be indexed'; issueList.replaceChildren(...plan.issues.map(issue => node('li', issue)));
    } finally {progress.cancel(); setBusy(false);}
  };
  apply.onclick = async () => {
    setBusy(true); error.textContent = ''; progress.start('Preparing selected replacements…');
    try {
      const result = await run('applyBatchReplace', {token: plan.token, ids: [...selected]}, 'Staging batch replacements…', message => {error.textContent = message;});
      if (result) {dialog.close(); notify(result.batchReport.files + ' files applied to ' + result.batchReport.assets + ' assets. Review Staged changes, then Build mod.', true);}
    } finally {progress.cancel(); setBusy(false);}
  };
  cancel.onclick = () => dialog.close(); dialog.addEventListener('cancel', event => {if (busy) event.preventDefault();});
  dialog.addEventListener('close', () => {clear(); dialog.remove();}, {once: true}); dialog.showModal();
}
