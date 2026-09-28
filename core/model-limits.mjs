import textureRuntime from './model-texture-runtime-profile.json' with {type: 'json'};

export const STOCK_MORPH_NODES = 1536;
// The PC accumulator sign-extends each 16-bit target index.
export const MODEL_LIMITS = Object.freeze({palette: 16, pairs: 256, morphNodes: 32768});

// Native renderInfo has six image pointers and a terminal primary run entry.
export const STOCK_MODEL_TEXTURE_LIMITS = Object.freeze({slots: 6, primaryRuns: 5, secondaryRuns: 1});
export const MODEL_TEXTURE_LIMITS = Object.freeze({slots: textureRuntime.slots, primaryRuns: textureRuntime.primaryRuns, secondaryRuns: textureRuntime.secondaryRuns});
