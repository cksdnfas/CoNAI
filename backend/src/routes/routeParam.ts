export function routeParam(value: string | string[] | undefined, label = 'Route parameter'): string {
  if (Array.isArray(value)) {
    const first = value[0];
    if (!first) {
      throw new Error(`${label} is required`);
    }
    return first;
  }

  if (!value) {
    throw new Error(`${label} is required`);
  }

  return value;
}
