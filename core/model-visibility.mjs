// Native gameplay duplicates; PACK does not carry the inventory or scripted prop state.
const heatherGameplayParts = new Set([5,12,13,14,15,16,18,19,21,22,24,25,27,28,30,31,34,35,37,38]);

export const cutscenePartVisible = (model, part) => model.modelId !== 0x100 || !heatherGameplayParts.has(part.visibilityId);
