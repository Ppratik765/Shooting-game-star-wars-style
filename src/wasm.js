import init from '../pkg/core_engine.js';

// Top-level await guarantees init() is only called once and cached
export const wasm = await init();

export * from '../pkg/core_engine.js';
