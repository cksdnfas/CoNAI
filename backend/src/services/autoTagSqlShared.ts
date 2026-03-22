export const AUTO_TAG_GENERAL_JSON_PATHS = [
  '$.general',
  '$.tagger.general',
  '$.kaloscope.general',
  '$.kaloscope.artists',
  '$.kaloscope.artist'
] as const;

export const AUTO_TAG_CHARACTER_JSON_PATHS = [
  '$.character',
  '$.tagger.character'
] as const;

export const AUTO_TAG_MODEL_JSON_PATHS = [
  '$.model',
  '$.tagger.model',
  '$.kaloscope.model'
] as const;

export function buildAutoTagRatingExpr(
  alias: string,
  ratingType: 'general' | 'sensitive' | 'questionable' | 'explicit'
): string {
  return `COALESCE(json_extract(${alias}.auto_tags, '$.rating.${ratingType}'), json_extract(${alias}.auto_tags, '$.tagger.rating.${ratingType}'))`;
}

export function buildAutoTagModelExpr(alias: string): string {
  return `COALESCE(json_extract(${alias}.auto_tags, '$.model'), json_extract(${alias}.auto_tags, '$.tagger.model'), json_extract(${alias}.auto_tags, '$.kaloscope.model'))`;
}

export function buildAutoTagExistsForPaths(alias: string, paths: readonly string[], valueConditionSql: string): string {
  return `(${paths.map((path) => `EXISTS (SELECT 1 FROM json_each(${alias}.auto_tags, '${path}') WHERE ${valueConditionSql})`).join(' OR ')})`;
}

export function pushAutoTagPathMatchParams(
  params: any[],
  pathCount: number,
  variant: string,
  minScore?: number,
  maxScore?: number
): void {
  for (let i = 0; i < pathCount; i++) {
    params.push(`%${variant}%`);
    if (minScore !== undefined) {
      params.push(minScore);
    }
    if (maxScore !== undefined) {
      params.push(maxScore);
    }
  }
}
