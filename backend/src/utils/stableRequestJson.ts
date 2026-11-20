/** Existing audio/MCP fingerprints use host collation; new formats use locale-independent JSON key order. */
export function stringifyRequestJson(value: unknown, order: 'ordinal' | 'legacy-locale' = 'ordinal'): string {
  const compare = order === 'legacy-locale' ? (a: string, b: string) => a.localeCompare(b) : undefined;
  const serialize = (item: unknown): string => {
    if (Array.isArray(item)) return `[${item.map(serialize).join(',')}]`;
    if (item && typeof item === 'object') {
      const object = item as Record<string, unknown>;
      const keys = Object.keys(object).filter(key => object[key] !== undefined).sort(compare);
      return `{${keys.map(key => `${JSON.stringify(key)}:${serialize(object[key])}`).join(',')}}`;
    }
    return JSON.stringify(item) ?? 'null';
  };
  return serialize(value);
}
