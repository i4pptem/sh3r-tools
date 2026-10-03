import catalog from './world-action-names.json' with {type:'json'};
const basename=name=>String(name).replaceAll('\\','/').split('/').at(-1).toLowerCase();
/** A MAP suffix is a coordinate-grid code, not a verified room or floor name. */
export function worldName(name){const file=basename(name);return /\.map$/.test(file)?catalog.prefixes[file.slice(0,2)]||null:null;}
export function bankName(name){return catalog.banks[basename(name)]?.name||null;}
export function actionName(id,bank){const entry=catalog.actions[id];return entry&&(!entry.bank||entry.bank===basename(bank))?entry.name:null;}
