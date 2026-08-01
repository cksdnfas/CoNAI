// Leaf module without database imports so type-level consumers (e.g. validate.ts) stay side-effect free.

/** Resolve the stable system operation key for a module. internal_fixed_values wins over template_defaults. */
export function resolveSystemOperationKey(moduleDefinition: {
  internal_fixed_values?: Record<string, any> | null
  template_defaults?: Record<string, any> | null
}): string | null {
  const fixedOperationKey = moduleDefinition.internal_fixed_values?.operation_key
  if (typeof fixedOperationKey === 'string' && fixedOperationKey) {
    return fixedOperationKey
  }

  const defaultOperationKey = moduleDefinition.template_defaults?.operation_key
  if (typeof defaultOperationKey === 'string' && defaultOperationKey) {
    return defaultOperationKey
  }

  return null
}
