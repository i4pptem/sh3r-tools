const fs = require('node:fs');
const path = require('node:path');

/** Native file dialogs with persistent locations shared by related import/export actions. */
module.exports = function createFileDialogs({dialog, parent, userData, defaultDirectory, warn = console.warn}) {
  const file = path.join(userData, 'file-dialogs.json');
  const directories = Object.create(null);
  let lastDirectory;
  try {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (saved?.version === 1) {
      for (const [key, directory] of Object.entries(saved.directories || {})) {
        if (typeof directory === 'string' && path.isAbsolute(directory)) directories[key] = directory;
      }
      if (typeof saved.lastDirectory === 'string' && path.isAbsolute(saved.lastDirectory)) lastDirectory = saved.lastDirectory;
    }
  } catch (error) {
    if (error.code !== 'ENOENT') warn(`Could not read file dialog locations: ${error.message}`);
  }

  function existingDirectory(directory) {
    while (directory) {
      try {if (fs.statSync(directory).isDirectory()) return directory;}
      catch (error) {
        if (!['ENOENT', 'ENOTDIR'].includes(error.code)) {
          warn(`Could not access a remembered folder: ${error.message}`);
          return undefined;
        }
      }
      const next = path.dirname(directory);
      if (next === directory) return undefined;
      directory = next;
    }
  }

  function location(group, options, save) {
    const directory = existingDirectory(directories[group]);
    if (directory) return save ? path.join(directory, path.basename(options.defaultPath)) : directory;
    if (options.defaultPath && path.isAbsolute(options.defaultPath)) return options.defaultPath;
    const fallback = existingDirectory(lastDirectory) || defaultDirectory;
    return save ? path.join(fallback, path.basename(options.defaultPath)) : fallback;
  }

  function remember(group, selected, isDirectory) {
    directories[group] = lastDirectory = isDirectory ? selected : path.dirname(selected);
    try {
      fs.mkdirSync(userData, {recursive: true});
      fs.writeFileSync(file + '.tmp', JSON.stringify({version: 1, lastDirectory, directories}, null, 2) + '\n', {flush: true});
      fs.renameSync(file + '.tmp', file);
    } catch (error) {warn(`Could not save file dialog locations: ${error.message}`);}
  }

  return {
    async open(group, options) {
      const result = await dialog.showOpenDialog(parent(), {...options, defaultPath: location(group, options, false)});
      if (!result.canceled && result.filePaths.length) remember(group, result.filePaths[0], options.properties?.includes('openDirectory'));
      return result;
    },
    async save(group, options) {
      const result = await dialog.showSaveDialog(parent(), {...options, defaultPath: location(group, options, true)});
      if (!result.canceled && result.filePath) remember(group, result.filePath, false);
      return result;
    },
  };
};
