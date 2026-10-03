import catalog from './model-names.json' with {type:'json'};

/** Labels describe the original asset identity; replacing a model does not rename its game slot. */
export function modelName(name) {
  const file=String(name).replaceAll('\\','/').split('/').at(-1).toLowerCase();
  return catalog.models[file]||null;
}
