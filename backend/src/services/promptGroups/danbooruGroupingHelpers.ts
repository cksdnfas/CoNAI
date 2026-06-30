import type { DanbooruBrowserDatabaseInfo } from '../danbooruBrowser/dbResolver';

export type PromptCollectionType = 'positive' | 'negative' | 'auto';

export type DanbooruGroupingMode = 'unclassified-only' | 'overwrite-existing';
export type DanbooruGroupingLanguage = 'ko' | 'en';

export interface DanbooruGroupingOptions {
  mode?: DanbooruGroupingMode;
  language?: DanbooruGroupingLanguage;
  includeAssignedPrompts?: boolean;
}

export interface NormalizedDanbooruGroupingOptions {
  mode: DanbooruGroupingMode;
  language: DanbooruGroupingLanguage;
  includeAssignedPrompts: boolean;
}

export const PROMPT_TYPES: PromptCollectionType[] = ['positive', 'auto', 'negative'];
export const DANBOORU_GROUP_ROOT_NAME_EN = 'Danbooru';
export const DANBOORU_GROUP_ROOT_NAME_KO = '단부루';
export const DANBOORU_GROUP_ROOT_NAMES = [DANBOORU_GROUP_ROOT_NAME_EN, DANBOORU_GROUP_ROOT_NAME_KO];

export interface DanbooruTaxonomyNodeRow {
  id: number;
  node_key: string;
  title: string;
  translated_title?: string | null;
  member_tag_count: number;
}

export interface DanbooruPromptMatchRow {
  prompt_id: number;
  prompt: string;
  usage_count: number;
  taxonomy_node_id: number | null;
  node_key: string;
  title: string;
  translated_title?: string | null;
}

export interface DanbooruGroupingTypeResult {
  type: PromptCollectionType;
  totalPrompts: number;
  eligiblePrompts: number;
  matchedPrompts: number;
  assignedPrompts: number;
  createdGroups: number;
  reusedGroups: number;
  matchedGroups: number;
  skippedAssignedPrompts: number;
  sampleUnmatchedPrompts: Array<{ prompt: string; usage_count: number }>;
}

export interface DanbooruGroupingPreviewResult {
  mode: DanbooruGroupingMode;
  language: DanbooruGroupingLanguage;
  includeAssignedPrompts: boolean;
  database: DanbooruBrowserDatabaseInfo;
  totals: {
    totalPrompts: number;
    eligiblePrompts: number;
    matchedPrompts: number;
    assignedPrompts: number;
    createdGroups: number;
    reusedGroups: number;
    matchedGroups: number;
    skippedAssignedPrompts: number;
  };
  byType: DanbooruGroupingTypeResult[];
}

export function danbooruRootNamePlaceholders(): string {
  return DANBOORU_GROUP_ROOT_NAMES.map(() => '?').join(',');
}

export function normalizeDanbooruGroupTitle(value: string): string {
  return value.trim().replace(/\s+/g, ' ') || 'Untitled';
}

export function resolveTaxonomyParentKeyFromNodeKey(nodeKey: string, nodeKeySet: Set<string>): string | null {
  const parts = nodeKey.split('__');

  for (let length = parts.length - 1; length > 0; length -= 1) {
    const candidate = parts.slice(0, length).join('__');
    if (nodeKeySet.has(candidate)) {
      return candidate;
    }
  }

  return null;
}

export function buildDanbooruParentKeyByKey(rows: DanbooruTaxonomyNodeRow[]): Map<string, string> {
  const nodeKeySet = new Set(rows.map((row) => row.node_key));
  const parentKeyByKey = new Map<string, string>();

  for (const row of rows) {
    const parentKey = resolveTaxonomyParentKeyFromNodeKey(row.node_key, nodeKeySet);
    if (parentKey) {
      parentKeyByKey.set(row.node_key, parentKey);
    }
  }

  return parentKeyByKey;
}

export function resolveDynamicCategoryParentKey(nodeKey: string): string | null {
  if (!nodeKey.startsWith('category__')) {
    return null;
  }

  const parts = nodeKey.split('__');
  if (parts.length <= 2) {
    return null;
  }

  return parts.slice(0, -1).join('__');
}

export function collectDanbooruNodeKeysWithAncestors(nodeKeys: Set<string>, parentKeyByKey: Map<string, string>): Set<string> {
  const collected = new Set<string>();

  for (const nodeKey of nodeKeys) {
    let currentKey: string | undefined = nodeKey;
    while (currentKey && !collected.has(currentKey)) {
      collected.add(currentKey);
      currentKey = parentKeyByKey.get(currentKey) ?? resolveDynamicCategoryParentKey(currentKey) ?? undefined;
    }
  }

  return collected;
}

export function formatDanbooruCategoryTitle(categoryName: string | null, language: DanbooruGroupingLanguage = 'en'): string {
  const normalized = (categoryName || 'other').trim().toLowerCase().replace(/^category__/, '');
  const labels: Record<string, Record<DanbooruGroupingLanguage, string>> = {
    general: { en: 'General Tags', ko: '일반 태그' },
    artist: { en: 'Artist Tags', ko: '작가 태그' },
    copyright: { en: 'Copyright Tags', ko: '작품 태그' },
    character: { en: 'Character Tags', ko: '캐릭터 태그' },
    meta: { en: 'Meta Tags', ko: '메타 태그' },
  };
  return labels[normalized]?.[language] ?? (language === 'ko' ? `${normalized.replace(/_/g, ' ')} 태그` : `${normalized.replace(/_/g, ' ')} Tags`);
}

export function resolveDanbooruNodeTitle(node: DanbooruTaxonomyNodeRow, language: DanbooruGroupingLanguage): string {
  return normalizeDanbooruGroupTitle(language === 'ko' ? (node.translated_title || node.title) : node.title);
}

export function buildDanbooruGroupName(node: DanbooruTaxonomyNodeRow, duplicateTitleCounts: Map<string, number>, language: DanbooruGroupingLanguage): string {
  const title = resolveDanbooruNodeTitle(node, language);
  const duplicateCount = duplicateTitleCounts.get(title.toLowerCase()) ?? 0;
  if (duplicateCount <= 1) {
    return title;
  }
  return `${title} · ${node.node_key.replace(/__/g, ' / ')}`;
}

export function getDanbooruMatchExpression(): string {
  return "lower(replace(replace(trim(pc.prompt), '\\', ''), ' ', '_'))";
}

export function normalizeDanbooruGroupingOptions(optionsOrMode?: DanbooruGroupingOptions | DanbooruGroupingMode): NormalizedDanbooruGroupingOptions {
  if (typeof optionsOrMode === 'string') {
    return {
      mode: optionsOrMode,
      language: 'en',
      includeAssignedPrompts: optionsOrMode === 'overwrite-existing',
    };
  }

  const mode = optionsOrMode?.mode === 'overwrite-existing' || optionsOrMode?.includeAssignedPrompts ? 'overwrite-existing' : 'unclassified-only';
  return {
    mode,
    language: optionsOrMode?.language === 'ko' ? 'ko' : 'en',
    includeAssignedPrompts: Boolean(optionsOrMode?.includeAssignedPrompts) || mode === 'overwrite-existing',
  };
}

export function summarizeDanbooruGrouping(
  options: NormalizedDanbooruGroupingOptions,
  database: DanbooruBrowserDatabaseInfo,
  byType: DanbooruGroupingTypeResult[],
): DanbooruGroupingPreviewResult {
  const totals = byType.reduce((acc, item) => ({
    totalPrompts: acc.totalPrompts + item.totalPrompts,
    eligiblePrompts: acc.eligiblePrompts + item.eligiblePrompts,
    matchedPrompts: acc.matchedPrompts + item.matchedPrompts,
    assignedPrompts: acc.assignedPrompts + item.assignedPrompts,
    createdGroups: acc.createdGroups + item.createdGroups,
    reusedGroups: acc.reusedGroups + item.reusedGroups,
    matchedGroups: acc.matchedGroups + item.matchedGroups,
    skippedAssignedPrompts: acc.skippedAssignedPrompts + item.skippedAssignedPrompts,
  }), {
    totalPrompts: 0,
    eligiblePrompts: 0,
    matchedPrompts: 0,
    assignedPrompts: 0,
    createdGroups: 0,
    reusedGroups: 0,
    matchedGroups: 0,
    skippedAssignedPrompts: 0,
  });

  return { mode: options.mode, language: options.language, includeAssignedPrompts: options.includeAssignedPrompts, database, totals, byType };
}
