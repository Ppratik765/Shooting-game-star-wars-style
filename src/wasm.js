import init from '../pkg/core_engine.js';

// Top-level await guarantees init() is only called once and cached
export const wasm = await init();

// Re-export everything from the pkg so consumers can use this as the single source of truth
export * from '../pkg/core_engine.js';
