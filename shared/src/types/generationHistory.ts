/** Services that can create generation-history rows and queue jobs (backend and frontend both read this one). */
export type ServiceType = 'comfyui' | 'novelai' | 'codex';

/** Persisted generation-history lifecycle states. */
export type GenerationStatus = 'pending' | 'processing' | 'completed' | 'failed';
