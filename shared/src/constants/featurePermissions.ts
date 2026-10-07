/** Data capabilities are independent of navigation and mutation/execution grants. */
export const FEATURE_READ_PERMISSION_CATALOG = [
  { permissionKey: 'prompts.view', resource: 'prompts', action: 'view', description: 'Read prompt collections, groups and presets.' },
  { permissionKey: 'wildcards.view', resource: 'wildcards', action: 'view', description: 'Read and expand wildcard entries.' },
] as const;
