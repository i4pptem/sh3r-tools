export function sceneModelCandidates(models,actor) {
  return models.filter(model=>(model.modelId===actor.modelId||model.nativeIds.includes(actor.modelId))&&model.boneCount===actor.boneCount);
}

/** Prefer the native model variant that can play this scene's facial track. */
export function defaultSceneModel(candidates,actor) {
  const facial=actor.morphCounts?.length===1?candidates.filter(model=>model.morphCount===actor.morphCounts[0]):[];
  const matching=facial.length?facial:candidates;
  return matching.find(model=>model.nativeIds.includes(actor.modelId))||matching[0];
}
