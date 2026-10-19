import Database from 'better-sqlite3';
import {
  DanbooruCharacterImageStore,
  type DanbooruBrowserCharacterImageRecord,
} from './danbooruBrowser/characterImages';
import {
  resolveDanbooruDbInfo,
  type DanbooruBrowserDatabaseInfo,
} from './danbooruBrowser/dbResolver';
import type { PromptRandomTokenSpec } from '@conai/shared';
import { resolvePromptGroupPickCount } from './danbooruBrowser/promptGroupSyntax';
import { buildTaxonomyParentKeyByKey } from './danbooruBrowser/taxonomyHierarchy';
import { buildSqlContainsPattern, escapeSqlLikePattern } from '../utils/sqlLike';

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;
const CHARACTER_PAGE_SIZE = 30;
const DEFAULT_RELATED_TAG_LIMIT_PER_CHARACTER = 100;
const MAX_RELATED_TAG_LIMIT_PER_CHARACTER = 500;
const RELATED_TAG_CATEGORY_NAMES = ['general', 'artist', 'copyright', 'character', 'meta'] as const;

type RelatedTagCategoryName = typeof RELATED_TAG_CATEGORY_NAMES[number];

interface CharacterRelatedTagFilterOptions {
  categories?: RelatedTagCategoryName[];
  scoreMin?: number;
  scoreMax?: number;
}

export type DanbooruBrowserSection = 'tags' | 'artists' | 'characters';

export interface DanbooruBrowserTreeNode {
  id: string;
  label: string;
  translatedLabel?: string | null;
  parentId: string | null;
  section: DanbooruBrowserSection;
  count: number;
  directCount?: number;
  filter?: {
    categoryCode?: number;
    taxonomyNodeId?: number;
    copyrightTagId?: number;
  };
}

export interface DanbooruBrowserPagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface DanbooruBrowserTagRecord {
  id: number;
  name: string;
  displayName: string;
  translatedName?: string | null;
  normalizedName: string;
  usageCount: number;
}

export interface DanbooruBrowserArtistRecord {
  tagId: number;
  name: string;
  displayName: string;
  translatedName?: string | null;
  normalizedName: string;
  worksCount: number;
  danbooruUrl: string;
}

export interface DanbooruBrowserRelatedTagRecord {
  id: number;
  name: string;
  displayName: string;
  translatedName?: string | null;
  categoryName: string;
  usageCount: number;
  score: number | null;
}

export interface DanbooruBrowserCopyrightRecord {
  tagId: number;
  name: string;
  displayName: string;
  translatedName?: string | null;
  confidence: number;
  isPrimary: boolean;
}

export type { DanbooruBrowserCharacterImageRecord, DanbooruBrowserDatabaseInfo };

export interface DanbooruBrowserCharacterRecord {
  tagId: number;
  name: string;
  displayName: string;
  translatedName?: string | null;
  normalizedName: string;
  worksCount: number;
  copyrights: DanbooruBrowserCopyrightRecord[];
  relatedTags: DanbooruBrowserRelatedTagRecord[];
  images: DanbooruBrowserCharacterImageRecord[];
  danbooruUrl: string;
}

interface CountRow {
  total: number;
}

interface TagRow {
  id: number;
  name: string;
  normalized_name: string;
  display_name: string | null;
  translated_name?: string | null;
  post_count: number;
  category_code?: number;
  category_name?: string;
}

interface ArtistRow {
  tag_id: number;
  name: string;
  normalized_name: string;
  translated_name?: string | null;
  post_count: number;
}

interface CharacterRow {
  tag_id: number;
  name: string;
  normalized_name: string;
  translated_name?: string | null;
  post_count: number;
}

interface TaxonomyNodeRow {
  id: number;
  node_key: string;
  title: string;
  description: string | null;
  translated_title?: string | null;
  direct_member_tag_count: number;
  member_tag_count: number;
}

interface CopyrightTreeRow {
  tag_id: number;
  name: string;
  translated_name?: string | null;
  post_count: number;
  character_count: number;
}

interface CharacterCopyrightRow {
  character_tag_id: number;
  tag_id: number;
  name: string;
  translated_name?: string | null;
  post_count: number;
  confidence: number;
  is_primary: number;
}

interface CharacterRelatedTagRow {
  character_tag_id: number;
  id: number;
  name: string;
  display_name: string | null;
  translated_name?: string | null;
  category_name: string;
  post_count: number;
  score: number | null;
}

interface PromptGroupTagRow {
  name: string;
  post_count: number;
}

export { resolveDanbooruDbInfo };


function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

function parseRelatedTagCategories(value: unknown): RelatedTagCategoryName[] | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  if (value.trim().length === 0) {
    return [];
  }

  const allowed = new Set<RelatedTagCategoryName>(RELATED_TAG_CATEGORY_NAMES);
  const categories = value
    .split(',')
    .map((item) => item.trim())
    .filter((item): item is RelatedTagCategoryName => allowed.has(item as RelatedTagCategoryName));

  return Array.from(new Set(categories));
}

function parseRelatedTagScore(value: unknown): number | undefined {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }

  return Math.min(1, Math.max(0, parsed));
}

function normalizeQuery(value?: string | null): string {
  return (value ?? '').trim().toLowerCase().replace(/\s+/g, '_');
}

function normalizePromptGroupLookup(value?: string | null): string {
  return normalizeQuery(value).replace(/[^a-z0-9_가-힣ぁ-んァ-ン一-龥]/g, '');
}

function buildDanbooruPostsUrl(tagName: string): string {
  return `https://danbooru.donmai.us/posts?tags=${encodeURIComponent(tagName)}`;
}

function displayName(name: string, displayNameValue?: string | null): string {
  return displayNameValue || name.replace(/_/g, ' ');
}

function buildEmptyListPayload<T>(page: number, limit: number): { items: T[]; pagination: DanbooruBrowserPagination } {
  return {
    items: [],
    pagination: {
      page,
      limit,
      total: 0,
      totalPages: 1,
    },
  };
}

class DanbooruBrowserService {
  private db: Database.Database | null = null;
  private taxonomyDescendantIdsById: Map<number, number[]> | null = null;
  private characterImages = new DanbooruCharacterImageStore();

  close(): void {
    this.db?.close();
    this.db = null;
    this.taxonomyDescendantIdsById = null;
    this.characterImages.clear();
  }

  private hasAvailableDb(): boolean {
    const database = resolveDanbooruDbInfo();
    if (this.db && (!database.available || this.db.name !== database.path)) this.close();
    return database.available;
  }

  private getDb(): Database.Database {
    const database = resolveDanbooruDbInfo();
    if (this.db && this.db.name === database.path && database.available) {
      return this.db;
    }

    this.close();
    if (!database.available) {
      throw new Error(`Danbooru database not found. Place a DB file matching ${database.filePatterns.join(' or ')} in ${database.expectedDirectory}. Download guide: ${database.downloadUrl}`);
    }

    const nextDb = new Database(database.path, { readonly: true, fileMustExist: true });
    nextDb.pragma('query_only = ON');
    this.db = nextDb;
    return nextDb;
  }

  getCharacterImageFilePath(tagId: unknown, fileName: string): string | null {
    const parsedTagId = Number(tagId);
    if (!Number.isFinite(parsedTagId) || !fileName || fileName.includes('/') || fileName.includes('\\')) {
      return null;
    }
    if (!this.hasAvailableDb()) {
      return null;
    }

    const row = this.getDb().prepare(`
      SELECT tag_id, name, normalized_name, post_count
      FROM characters
      WHERE tag_id = ?
    `).get(Math.trunc(parsedTagId)) as CharacterRow | undefined;
    if (!row) {
      return null;
    }

    return this.characterImages.getFilePath(row, fileName);
  }

  getSummary() {
    const database = resolveDanbooruDbInfo();
    if (!database.available) {
      return {
        dbPath: database.path,
        database,
        counts: {
          tags: 0,
          artists: 0,
          characters: 0,
        },
        tree: [
          { id: 'tags', label: 'Tags', parentId: null, section: 'tags', count: 0 },
          { id: 'artists', label: 'Artists', parentId: null, section: 'artists', count: 0 },
          { id: 'characters', label: 'Characters', parentId: null, section: 'characters', count: 0 },
        ] satisfies DanbooruBrowserTreeNode[],
      };
    }

    const db = this.getDb();
    const tagCount = db.prepare('SELECT COUNT(*) AS total FROM tags WHERE is_deprecated = 0').get() as CountRow;
    const artistCount = db.prepare('SELECT COUNT(*) AS total FROM artists').get() as CountRow;
    const characterCount = db.prepare('SELECT COUNT(*) AS total FROM characters').get() as CountRow;
    const taxonomyRows = this.getTaxonomyRows();
    const taxonomyParentKeyByKey = buildTaxonomyParentKeyByKey(taxonomyRows);
    const taxonomyIdByKey = new Map(taxonomyRows.map((row) => [row.node_key, row.id] as const));
    const copyrightNodes = db.prepare(`
      SELECT cp.tag_id, cp.name, tt.translated_name, cp.post_count, COUNT(DISTINCT l.character_tag_id) AS character_count
      FROM copyrights cp
      JOIN character_copyright_links l ON l.copyright_tag_id = cp.tag_id
      LEFT JOIN tag_translations tt ON tt.tag_id = cp.tag_id AND tt.locale = 'ko'
      GROUP BY cp.tag_id, cp.name, tt.translated_name, cp.post_count
      ORDER BY character_count DESC, cp.post_count DESC
      LIMIT 120
    `).all() as CopyrightTreeRow[];

    const tree: DanbooruBrowserTreeNode[] = [
      { id: 'tags', label: 'Tags', parentId: null, section: 'tags', count: tagCount.total },
      ...taxonomyRows.map((node) => {
        const parentKey = taxonomyParentKeyByKey.get(node.node_key) ?? null;
        const parentId = parentKey ? taxonomyIdByKey.get(parentKey) : null;

        return {
          id: `taxonomy:${node.id}`,
          label: node.title,
          translatedLabel: node.translated_title,
          parentId: parentId ? `taxonomy:${parentId}` : 'tags',
          section: 'tags' as const,
          count: node.member_tag_count,
          directCount: node.direct_member_tag_count,
          filter: { taxonomyNodeId: node.id },
        };
      }),
      { id: 'artists', label: 'Artists', parentId: null, section: 'artists', count: artistCount.total },
      { id: 'characters', label: 'Characters', parentId: null, section: 'characters', count: characterCount.total },
      ...copyrightNodes.map((copyright) => ({
        id: `copyright:${copyright.tag_id}`,
        label: copyright.name.replace(/_/g, ' '),
        translatedLabel: copyright.translated_name,
        parentId: 'characters',
        section: 'characters' as const,
        count: copyright.character_count,
        filter: { copyrightTagId: copyright.tag_id },
      })),
    ];

    return {
      dbPath: database.path,
      database,
      counts: {
        tags: tagCount.total,
        artists: artistCount.total,
        characters: characterCount.total,
      },
      tree,
    };
  }

  private getTaxonomyRows(): TaxonomyNodeRow[] {
    return this.getDb().prepare(`
      SELECT n.id, n.node_key, n.title, n.description, nt.translated_title, n.direct_member_tag_count, n.member_tag_count
      FROM taxonomy_nodes n
      LEFT JOIN taxonomy_node_translations nt ON nt.node_key = n.node_key AND nt.locale = 'ko'
      WHERE n.node_type = 'manual_group'
      ORDER BY n.member_tag_count DESC, n.title ASC
    `).all() as TaxonomyNodeRow[];
  }

  private getTaxonomyDescendantIds(taxonomyNodeId: number): number[] {
    if (!this.taxonomyDescendantIdsById) {
      const rows = this.getTaxonomyRows();
      const parentKeyByKey = buildTaxonomyParentKeyByKey(rows);
      const idByKey = new Map(rows.map((row) => [row.node_key, row.id] as const));
      const childIdsById = new Map<number, number[]>();

      for (const row of rows) {
        const parentKey = parentKeyByKey.get(row.node_key) ?? null;
        const parentId = parentKey ? idByKey.get(parentKey) : null;
        if (parentId) {
          const children = childIdsById.get(parentId) ?? [];
          children.push(row.id);
          childIdsById.set(parentId, children);
        }
      }

      const collect = (nodeId: number): number[] => {
        const collected = [nodeId];
        for (const childId of childIdsById.get(nodeId) ?? []) {
          collected.push(...collect(childId));
        }
        return collected;
      };

      this.taxonomyDescendantIdsById = new Map(rows.map((row) => [row.id, collect(row.id)] as const));
    }

    return this.taxonomyDescendantIdsById.get(taxonomyNodeId) ?? [taxonomyNodeId];
  }

  private findPromptGroupNode(groupName: string): TaxonomyNodeRow | null {
    const normalizedGroupName = normalizePromptGroupLookup(groupName);
    if (!normalizedGroupName) {
      return null;
    }

    for (const row of this.getTaxonomyRows()) {
      const nodeKeyLeaf = row.node_key.split('__').at(-1) ?? row.node_key;
      const candidates = [
        row.title,
        row.translated_title,
        row.node_key,
        nodeKeyLeaf,
        row.title.replace(/_/g, ' '),
      ];

      if (candidates.some((candidate) => normalizePromptGroupLookup(candidate) === normalizedGroupName)) {
        return row;
      }
    }

    return null;
  }

  private listPromptGroupTags(node: TaxonomyNodeRow, spec: Pick<PromptRandomTokenSpec, 'usage'>, limit: number): string[] {
    if (limit <= 0) {
      return [];
    }

    const taxonomyNodeIds = this.getTaxonomyDescendantIds(node.id);
    const placeholders = taxonomyNodeIds.map(() => '?').join(',');
    const clauses = [
      'tags.is_deprecated = 0',
      `EXISTS (SELECT 1 FROM taxonomy_tag_memberships tm WHERE tm.tag_id = tags.id AND tm.taxonomy_node_id IN (${placeholders}))`,
    ];
    const values: Array<number | string> = [...taxonomyNodeIds];

    if (spec.usage.min !== undefined) {
      clauses.push('tags.post_count >= ?');
      values.push(spec.usage.min);
    }
    if (spec.usage.max !== undefined) {
      clauses.push('tags.post_count <= ?');
      values.push(spec.usage.max);
    }

    const maxRow = this.getDb().prepare(`
      SELECT MAX(tags.id) as maxId
      FROM tags
      WHERE ${clauses.join(' AND ')}
    `).get(...values) as { maxId: number | null } | undefined;

    if (!maxRow?.maxId) {
      return [];
    }

    const pivot = Math.max(1, Math.floor(Math.random() * maxRow.maxId) + 1);
    const selectFromPivot = (operator: '>=' | '<', rowLimit: number) => this.getDb().prepare(`
      SELECT tags.name, tags.post_count
      FROM tags
      WHERE ${clauses.join(' AND ')}
        AND tags.id ${operator} ?
      ORDER BY tags.id ASC
      LIMIT ?
    `).all(...values, pivot, rowLimit) as PromptGroupTagRow[];

    const rows = selectFromPivot('>=', limit);
    if (rows.length < limit) {
      rows.push(...selectFromPivot('<', limit - rows.length));
    }

    return rows.map((row) => row.name);
  }

  /** Expand one parsed tag-group token (`__tag:hair_color|1-2|1k+__`) into random tags; empty when unresolved. */
  expandPromptGroupToken(spec: Pick<PromptRandomTokenSpec, 'name' | 'pick' | 'usage'>): string {
    if (!this.hasAvailableDb()) {
      return '';
    }

    const node = this.findPromptGroupNode(spec.name);
    if (!node) {
      return '';
    }

    const pickCount = resolvePromptGroupPickCount(spec.pick);
    if (pickCount === 0) {
      return '';
    }

    return this.listPromptGroupTags(node, spec, pickCount).join(', ');
  }

  listTags(params: { q?: string; category?: string; taxonomyNodeId?: string; page?: unknown; limit?: unknown }) {
    const page = clampInteger(params.page, 1, 1, 100_000);
    const limit = clampInteger(params.limit, DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE);
    if (!this.hasAvailableDb()) {
      return buildEmptyListPayload<DanbooruBrowserTagRecord>(page, limit);
    }

    const db = this.getDb();
    const offset = (page - 1) * limit;
    const q = normalizeQuery(params.q);
    const clauses = ['is_deprecated = 0'];
    const values: Array<string | number> = [];

    if (q) {
      clauses.push('(normalized_name LIKE ? ESCAPE \'\\\' OR display_name LIKE ? ESCAPE \'\\\' OR EXISTS (SELECT 1 FROM tag_translations tq WHERE tq.tag_id = tags.id AND tq.locale = \'ko\' AND tq.translated_name LIKE ? ESCAPE \'\\\'))');
      const pattern = buildSqlContainsPattern(q);
      const translatedPattern = buildSqlContainsPattern(String(params.q ?? '').trim().toLowerCase());
      values.push(pattern, pattern.replace(/_/g, ' '), translatedPattern);
    }

    if (params.category !== undefined && params.category !== null && params.category !== '') {
      const categoryCode = Number(params.category);
      if (Number.isFinite(categoryCode)) {
        clauses.push('category_code = ?');
        values.push(Math.trunc(categoryCode));
      }
    }

    const taxonomyNodeId = Number(params.taxonomyNodeId);
    if (Number.isFinite(taxonomyNodeId)) {
      const taxonomyNodeIds = this.getTaxonomyDescendantIds(Math.trunc(taxonomyNodeId));
      const placeholders = taxonomyNodeIds.map(() => '?').join(',');
      clauses.push(`EXISTS (SELECT 1 FROM taxonomy_tag_memberships tm WHERE tm.tag_id = tags.id AND tm.taxonomy_node_id IN (${placeholders}))`);
      values.push(...taxonomyNodeIds);
    }

    const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const total = (db.prepare(`SELECT COUNT(*) AS total FROM tags ${whereSql}`).get(...values) as CountRow).total;
    const rows = db.prepare(`
      SELECT tags.id, tags.name, tags.normalized_name, tags.display_name, tt.translated_name, tags.post_count
      FROM tags
      LEFT JOIN tag_translations tt ON tt.tag_id = tags.id AND tt.locale = 'ko'
      ${whereSql}
      ORDER BY tags.post_count DESC, tags.name ASC
      LIMIT ? OFFSET ?
    `).all(...values, limit, offset) as TagRow[];

    return {
      items: rows.map((row) => ({
        id: row.id,
        name: row.name,
        normalizedName: row.normalized_name,
        displayName: displayName(row.name, row.display_name),
        translatedName: row.translated_name,
        usageCount: row.post_count,
      })),
      pagination: this.buildPagination(page, limit, total),
    };
  }

  listArtists(params: { q?: string; page?: unknown; limit?: unknown }) {
    const page = clampInteger(params.page, 1, 1, 100_000);
    const limit = clampInteger(params.limit, DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE);
    if (!this.hasAvailableDb()) {
      return buildEmptyListPayload<DanbooruBrowserArtistRecord>(page, limit);
    }

    const db = this.getDb();
    const offset = (page - 1) * limit;
    const q = normalizeQuery(params.q);
    const clauses: string[] = [];
    const values: Array<string | number> = [];

    if (q) {
      clauses.push('(a.normalized_name LIKE ? ESCAPE \'\\\' OR EXISTS (SELECT 1 FROM tag_translations tq WHERE tq.tag_id = a.tag_id AND tq.locale = \'ko\' AND tq.translated_name LIKE ? ESCAPE \'\\\'))');
      const pattern = buildSqlContainsPattern(q);
      const translatedPattern = buildSqlContainsPattern(String(params.q ?? '').trim());
      values.push(pattern, translatedPattern);
    }

    const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const total = (db.prepare(`SELECT COUNT(*) AS total FROM artists a ${whereSql}`).get(...values) as CountRow).total;
    const rows = db.prepare(`
      SELECT a.tag_id, a.name, a.normalized_name, tt.translated_name, a.post_count
      FROM artists a
      LEFT JOIN tag_translations tt ON tt.tag_id = a.tag_id AND tt.locale = 'ko'
      ${whereSql}
      ORDER BY a.post_count DESC, a.name ASC
      LIMIT ? OFFSET ?
    `).all(...values, limit, offset) as ArtistRow[];

    return {
      items: rows.map((row) => ({
        tagId: row.tag_id,
        name: row.name,
        normalizedName: row.normalized_name,
        displayName: displayName(row.name),
        translatedName: row.translated_name,
        worksCount: row.post_count,
        danbooruUrl: buildDanbooruPostsUrl(row.name),
      })),
      pagination: this.buildPagination(page, limit, total),
    };
  }

  listCharacters(params: { q?: string; copyrightTagId?: string; page?: unknown; limit?: unknown; relatedTagCategories?: unknown; relatedTagScoreMin?: unknown; relatedTagScoreMax?: unknown; relatedTagLimit?: unknown }) {
    const page = clampInteger(params.page, 1, 1, 100_000);
    const limit = clampInteger(params.limit, CHARACTER_PAGE_SIZE, 1, CHARACTER_PAGE_SIZE);
    if (!this.hasAvailableDb()) {
      return buildEmptyListPayload<DanbooruBrowserCharacterRecord>(page, limit);
    }

    const db = this.getDb();
    const relatedTagLimit = clampInteger(params.relatedTagLimit, DEFAULT_RELATED_TAG_LIMIT_PER_CHARACTER, 0, MAX_RELATED_TAG_LIMIT_PER_CHARACTER);
    const offset = (page - 1) * limit;
    const q = normalizeQuery(params.q);
    const scoreMin = parseRelatedTagScore(params.relatedTagScoreMin);
    const scoreMax = parseRelatedTagScore(params.relatedTagScoreMax);
    const relatedTagFilters: CharacterRelatedTagFilterOptions = {
      categories: parseRelatedTagCategories(params.relatedTagCategories),
      scoreMin: scoreMin !== undefined && scoreMax !== undefined ? Math.min(scoreMin, scoreMax) : scoreMin,
      scoreMax: scoreMin !== undefined && scoreMax !== undefined ? Math.max(scoreMin, scoreMax) : scoreMax,
    };
    const clauses: string[] = [];
    const values: Array<string | number> = [];

    if (q) {
      clauses.push('(c.normalized_name LIKE ? ESCAPE \'\\\' OR EXISTS (SELECT 1 FROM tag_translations tq WHERE tq.tag_id = c.tag_id AND tq.locale = \'ko\' AND tq.translated_name LIKE ? ESCAPE \'\\\'))');
      const pattern = buildSqlContainsPattern(q);
      const translatedPattern = buildSqlContainsPattern(String(params.q ?? '').trim().toLowerCase());
      values.push(pattern, translatedPattern);
    }

    const copyrightTagId = Number(params.copyrightTagId);
    if (Number.isFinite(copyrightTagId)) {
      clauses.push('EXISTS (SELECT 1 FROM character_copyright_links l WHERE l.character_tag_id = c.tag_id AND l.copyright_tag_id = ?)');
      values.push(Math.trunc(copyrightTagId));
    }

    const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const total = (db.prepare(`SELECT COUNT(*) AS total FROM characters c ${whereSql}`).get(...values) as CountRow).total;
    const rows = db.prepare(`
      SELECT c.tag_id, c.name, c.normalized_name, tt.translated_name, c.post_count
      FROM characters c
      LEFT JOIN tag_translations tt ON tt.tag_id = c.tag_id AND tt.locale = 'ko'
      ${whereSql}
      ORDER BY c.post_count DESC, c.name ASC
      LIMIT ? OFFSET ?
    `).all(...values, limit, offset) as CharacterRow[];

    const tagIds = rows.map((row) => row.tag_id);
    const copyrightsByCharacter = this.getCopyrightsByCharacter(tagIds);
    const relatedTagsByCharacter = this.getRelatedTagsByCharacter(tagIds, relatedTagFilters, relatedTagLimit);

    return {
      items: rows.map((row) => ({
        tagId: row.tag_id,
        name: row.name,
        normalizedName: row.normalized_name,
        displayName: displayName(row.name),
        translatedName: row.translated_name,
        worksCount: row.post_count,
        copyrights: copyrightsByCharacter.get(row.tag_id) ?? [],
        relatedTags: relatedTagsByCharacter.get(row.tag_id) ?? [],
        images: this.characterImages.getRecords(row),
        danbooruUrl: buildDanbooruPostsUrl(row.name),
      })),
      pagination: this.buildPagination(page, limit, total),
    };
  }

  /**
   * Run tiered lookups (exact → name prefix → Korean prefix → contains) and keep the first `limit` unique rows.
   * Autocomplete path: no COUNT(*), and the contains scan only runs when the cheaper tiers came up short.
   */
  private collectTiered<Row>(limit: number, keyOf: (row: Row) => number, tiers: Array<(remaining: number) => Row[]>): Row[] {
    const seen = new Set<number>();
    const collected: Row[] = [];
    for (const tier of tiers) {
      const remaining = limit - collected.length;
      if (remaining <= 0) {
        break;
      }
      for (const row of tier(remaining + seen.size)) {
        const key = keyOf(row);
        if (!seen.has(key) && collected.length < limit) {
          seen.add(key);
          collected.push(row);
        }
      }
    }
    return collected;
  }

  /** Tag autocomplete: exact match first, then prefix, then contains, each ordered by post count. */
  suggestTags(rawQuery: string, limit: number): DanbooruBrowserTagRecord[] {
    const q = normalizeQuery(rawQuery);
    if (!q || !this.hasAvailableDb()) {
      return [];
    }

    const db = this.getDb();
    const translated = rawQuery.trim().toLowerCase();
    const select = `
      SELECT tags.id, tags.name, tags.normalized_name, tags.display_name, tt.translated_name, tags.post_count
      FROM tags
      LEFT JOIN tag_translations tt ON tt.tag_id = tags.id AND tt.locale = 'ko'
    `;
    const rows = this.collectTiered<TagRow>(limit, (row) => row.id, [
      (count) => db.prepare(`${select} WHERE tags.is_deprecated = 0 AND tags.normalized_name = ? LIMIT ?`).all(q, count) as TagRow[],
      // Prefix of the name or of any word in it (`miku` → hatsune_miku), by post count.
      (count) => db.prepare(`${select} WHERE tags.is_deprecated = 0 AND ((tags.normalized_name >= ? AND tags.normalized_name < ?) OR tags.normalized_name LIKE ? ESCAPE '\\') ORDER BY tags.post_count DESC LIMIT ?`)
        .all(q, `${q}\uffff`, `%\\_${escapeSqlLikePattern(q)}%`, count) as TagRow[],
      (count) => db.prepare(`${select} WHERE tags.is_deprecated = 0 AND tt.translated_name LIKE ? ESCAPE '\\' ORDER BY tags.post_count DESC LIMIT ?`).all(`${escapeSqlLikePattern(translated)}%`, count) as TagRow[],
      (count) => (q.length < 2 ? [] : db.prepare(`${select} WHERE tags.is_deprecated = 0 AND (tags.normalized_name LIKE ? ESCAPE '\\' OR tt.translated_name LIKE ? ESCAPE '\\') ORDER BY tags.post_count DESC LIMIT ?`)
        .all(buildSqlContainsPattern(q), buildSqlContainsPattern(translated), count) as TagRow[]),
    ]);

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      normalizedName: row.normalized_name,
      displayName: displayName(row.name, row.display_name),
      translatedName: row.translated_name,
      usageCount: row.post_count,
    }));
  }

  /** Character autocomplete with related tags: exact, then prefix, then Korean prefix (no contains scan). */
  suggestCharacters(rawQuery: string, limit: number, relatedTagLimit: number): DanbooruBrowserCharacterRecord[] {
    const q = normalizeQuery(rawQuery);
    if (q.length < 2 || !this.hasAvailableDb()) {
      return [];
    }

    const db = this.getDb();
    const select = `
      SELECT c.tag_id, c.name, c.normalized_name, tt.translated_name, c.post_count
      FROM characters c
      LEFT JOIN tag_translations tt ON tt.tag_id = c.tag_id AND tt.locale = 'ko'
    `;
    const rows = this.collectTiered<CharacterRow>(limit, (row) => row.tag_id, [
      (count) => db.prepare(`${select} WHERE c.normalized_name = ? LIMIT ?`).all(q, count) as CharacterRow[],
      (count) => db.prepare(`${select} WHERE (c.normalized_name >= ? AND c.normalized_name < ?) OR c.normalized_name LIKE ? ESCAPE '\\' ORDER BY c.post_count DESC LIMIT ?`)
        .all(q, `${q}\uffff`, `%\\_${escapeSqlLikePattern(q)}%`, count) as CharacterRow[],
      (count) => db.prepare(`${select} WHERE tt.translated_name LIKE ? ESCAPE '\\' ORDER BY c.post_count DESC LIMIT ?`).all(`${escapeSqlLikePattern(rawQuery.trim().toLowerCase())}%`, count) as CharacterRow[],
    ]);

    const tagIds = rows.map((row) => row.tag_id);
    const copyrightsByCharacter = this.getCopyrightsByCharacter(tagIds);
    const relatedTagsByCharacter = this.getRelatedTagsByCharacter(tagIds, {}, relatedTagLimit);
    return rows.map((row) => ({
      tagId: row.tag_id,
      name: row.name,
      normalizedName: row.normalized_name,
      displayName: displayName(row.name),
      translatedName: row.translated_name,
      worksCount: row.post_count,
      copyrights: copyrightsByCharacter.get(row.tag_id) ?? [],
      relatedTags: relatedTagsByCharacter.get(row.tag_id) ?? [],
      images: this.characterImages.getRecords(row),
      danbooruUrl: buildDanbooruPostsUrl(row.name),
    }));
  }

  private getCopyrightsByCharacter(tagIds: number[]): Map<number, DanbooruBrowserCopyrightRecord[]> {
    const result = new Map<number, DanbooruBrowserCopyrightRecord[]>();
    if (tagIds.length === 0) {
      return result;
    }

    const placeholders = tagIds.map(() => '?').join(',');
    const rows = this.getDb().prepare(`
      SELECT l.character_tag_id, cp.tag_id, cp.name, tt.translated_name, cp.post_count, l.confidence, l.is_primary
      FROM character_copyright_links l
      JOIN copyrights cp ON cp.tag_id = l.copyright_tag_id
      LEFT JOIN tag_translations tt ON tt.tag_id = cp.tag_id AND tt.locale = 'ko'
      WHERE l.character_tag_id IN (${placeholders})
      ORDER BY l.is_primary DESC, l.confidence DESC, cp.post_count DESC
    `).all(...tagIds) as CharacterCopyrightRow[];

    for (const row of rows) {
      const bucket = result.get(row.character_tag_id) ?? [];
      bucket.push({
        tagId: row.tag_id,
        name: row.name,
        displayName: displayName(row.name),
        translatedName: row.translated_name,
        confidence: row.confidence,
        isPrimary: row.is_primary === 1,
      });
      result.set(row.character_tag_id, bucket);
    }

    return result;
  }

  private getRelatedTagsByCharacter(tagIds: number[], filters: CharacterRelatedTagFilterOptions = {}, relatedTagLimit = DEFAULT_RELATED_TAG_LIMIT_PER_CHARACTER): Map<number, DanbooruBrowserRelatedTagRecord[]> {
    const result = new Map<number, DanbooruBrowserRelatedTagRecord[]>();
    if (tagIds.length === 0 || relatedTagLimit <= 0) {
      return result;
    }

    const placeholders = tagIds.map(() => '?').join(',');
    const values: unknown[] = [...tagIds];
    const clauses = [`crt.character_tag_id IN (${placeholders})`, 'rt.is_deprecated = 0'];

    if (filters.categories !== undefined) {
      if (filters.categories.length === 0) {
        return result;
      }
      clauses.push(`rt.category_name IN (${filters.categories.map(() => '?').join(',')})`);
      values.push(...filters.categories);
    }
    if (filters.scoreMin !== undefined) {
      clauses.push('crt.score >= ?');
      values.push(filters.scoreMin);
    }
    if (filters.scoreMax !== undefined) {
      clauses.push('crt.score <= ?');
      values.push(filters.scoreMax);
    }

    const rows = this.getDb().prepare(`
      SELECT crt.character_tag_id, rt.id, rt.name, rt.display_name, tt.translated_name, rt.category_name, rt.post_count, crt.score
      FROM character_related_tags crt
      JOIN tags rt ON rt.id = crt.related_tag_id
      LEFT JOIN tag_translations tt ON tt.tag_id = rt.id AND tt.locale = 'ko'
      WHERE ${clauses.join(' AND ')}
      ORDER BY crt.character_tag_id ASC, crt.score DESC, rt.post_count DESC
    `).all(...values) as CharacterRelatedTagRow[];

    for (const row of rows) {
      const bucket = result.get(row.character_tag_id) ?? [];
      if (bucket.length >= relatedTagLimit) {
        continue;
      }
      bucket.push({
        id: row.id,
        name: row.name,
        displayName: displayName(row.name, row.display_name),
        translatedName: row.translated_name,
        categoryName: row.category_name,
        usageCount: row.post_count,
        score: row.score,
      });
      result.set(row.character_tag_id, bucket);
    }

    return result;
  }

  private buildPagination(page: number, limit: number, total: number): DanbooruBrowserPagination {
    return {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }
}

export const danbooruBrowserService = new DanbooruBrowserService();
