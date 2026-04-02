/** Build normalized search variants shared by SQL builders and in-memory auto-tag matching. */
export function normalizeAutoTagSearchTerm(term: string, exactMatch = false): string[] {
  const variants: Set<string> = new Set();
  const normalized = term.trim().toLowerCase();

  if (!normalized) return [];

  variants.add(normalized);

  if (normalized.includes('_')) {
    variants.add(normalized.replace(/_/g, ' '));
    variants.add(normalized.replace(/_/g, ''));
  }

  if (normalized.includes(' ')) {
    variants.add(normalized.replace(/ /g, '_'));
    variants.add(normalized.replace(/ /g, ''));
  }

  if (!exactMatch) {
    const tokens = normalized.split(/[_ ]+/).filter((token) => token.length >= 2);
    if (tokens.length > 1) {
      for (const token of tokens) {
        if (token.length >= 2) {
          variants.add(token);
        }
      }
    }
  }

  if (normalized.includes('-')) {
    variants.add(normalized.replace(/-/g, '_'));
    variants.add(normalized.replace(/-/g, ' '));
    variants.add(normalized.replace(/-/g, ''));
  }

  return Array.from(variants);
}

/** Find JSON keys that match any normalized search variant. */
export function findAutoTagMatchingKeys(jsonObject: any, searchTerm: string): string[] {
  if (!jsonObject || typeof jsonObject !== 'object') {
    return [];
  }

  const variants = normalizeAutoTagSearchTerm(searchTerm);
  const matchingKeys: string[] = [];

  for (const key of Object.keys(jsonObject)) {
    const normalizedKey = key.toLowerCase();

    for (const variant of variants) {
      if (normalizedKey.includes(variant)) {
        matchingKeys.push(key);
        break;
      }
    }
  }

  return matchingKeys;
}
