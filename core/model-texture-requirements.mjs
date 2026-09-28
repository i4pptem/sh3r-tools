import {STOCK_MODEL_TEXTURE_LIMITS} from './model-limits.mjs';

/** Mirror native registration, including its inherited secondary texture and scan condition. */
export function modelTextureRequirements(model) {
  if (model.textureCount <= 1) return {textureSlots: model.textureCount, primaryRuns: 1, secondaryRuns: 0, requiresModelTexturePatch: false};
  let primaryRuns = 0, secondaryRuns = 0, previous = 0xFFFF;
  for (const mesh of model.meshes.filter(mesh => mesh.group === 0)) {
    if (mesh.texture !== previous) {primaryRuns++; previous = mesh.texture;}
  }
  if (model.textureCount > primaryRuns) for (const mesh of model.meshes.filter(mesh => mesh.group === 1)) {
    if (mesh.texture !== previous) {secondaryRuns++; previous = mesh.texture;}
  }
  const textureSlots = model.textureCount, stock = STOCK_MODEL_TEXTURE_LIMITS;
  return {textureSlots, primaryRuns, secondaryRuns,
    requiresModelTexturePatch: textureSlots > stock.slots || primaryRuns > stock.primaryRuns || secondaryRuns > stock.secondaryRuns};
}
