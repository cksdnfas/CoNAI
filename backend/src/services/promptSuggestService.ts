import { cleanPromptTerm, findPromptRandomTokens, parsePromptWithLoRAs } from '@conai/shared';
import { db } from '../database/init';
import { getPromptCollectionTableName, getPromptGroupTableName, type PromptTableType } from '../utils/promptTables';
import { buildSqlContainsPattern, escapeSqlLikePattern, SQL_LIKE_ESCAPE_CLAUSE } from '../utils/sqlLike';
import { danbooruBrowserService, type DanbooruBrowserCharacterRecord, type DanbooruBrowserTagRecord } from './danbooruBrowserService';
import { PromptSearchIndexService } from './promptSearchIndexService';
import { requestPromptSearchIndexBackfill } from './runtimeJobs/handlers/promptSearchIndexHandlers';

export interface PromptSuggestPrompt {
  id: number;
  prompt: string;
  usageCount: number;
  groupName: string | null;
}

export interface PromptSuggestRelatedTerm {
  term: string;
  /** Recent images (of the sampled set) where this term appeared next to the context terms. */
  count: number;
}

export interface PromptSuggestResult {
  prompts: PromptSuggestPrompt[];
  tags: DanbooruBrowserTagRecord[];
  characters: DanbooruBrowserCharacterRecord[];
  related: PromptSuggestRelatedTerm[];
}

const MAX_CONTEXT_TERMS = 3;
/** Recent images sampled per context term; enough for a stable ranking, small enough for a keystroke. */
const RELATED_SAMPLE_ROWS = 200;
const RELATED_LIMIT = 12;
const MAX_TERMS_PER_PROMPT = 60;
const RELATED_CACHE_TTL_MS = 60_000;
const RELATED_CACHE_MAX_ENTRIES = 200;

const relatedCache = new Map<string, { at: number; terms: PromptSuggestRelatedTerm[] }>();

function normalizeTerm(value: string) {
  return value.trim().toLowerCase().replace(/_/g, ' ').replace(/\s+/g, ' ');
}

/** Distinct normalized terms of one prompt, without LoRA tags and random tokens. */
function extractPromptTerms(prompt: string): string[] {
  const withoutTokens = findPromptRandomTokens(prompt).reduceRight((text, token) => `${text.slice(0, token.start)}${text.slice(token.end)}`, prompt);
  const terms = new Set<string>();
  for (const term of parsePromptWithLoRAs(withoutTokens).terms) {
    const cleaned = normalizeTerm(cleanPromptTerm(term.trim()) ?? '');
    if (cleaned.length >= 2) {
      terms.add(cleaned);
    }
    if (terms.size >= MAX_TERMS_PER_PROMPT) {
      break;
    }
  }
  return [...terms];
}

export class PromptSuggestService {
  /** One autocomplete round trip: my prompts, Danbooru tags and characters (tiered), and terms used with the context. */
  static suggest(params: { query: string; type: PromptTableType; limit: number; relatedTagLimit: number; context: string[] }): PromptSuggestResult {
    const query = params.query.trim();
    return {
      prompts: query ? this.suggestPrompts(query, params.type, params.limit) : [],
      tags: query ? danbooruBrowserService.suggestTags(query, params.limit) : [],
      characters: query ? danbooruBrowserService.suggestCharacters(query, Math.min(params.limit, 6), params.relatedTagLimit) : [],
      related: params.type === 'positive' ? this.relatedTerms(params.context) : [],
    };
  }

  /** My collected prompts: exact, then prefix (uses the UNIQUE(prompt) index), then contains; each by usage. */
  private static suggestPrompts(query: string, type: PromptTableType, limit: number): PromptSuggestPrompt[] {
    const table = getPromptCollectionTableName(type);
    const groups = getPromptGroupTableName(type);
    const select = `
      SELECT p.id, p.prompt, p.usage_count AS usageCount, g.group_name AS groupName
      FROM ${table} p
      LEFT JOIN ${groups} g ON g.id = p.group_id
    `;
    const variants = [...new Set([query, query.replace(/ /g, '_'), query.replace(/_/g, ' ')])];
    const tiers: Array<[string, unknown[]]> = [
      [`p.prompt IN (${variants.map(() => '?').join(',')})`, variants],
      [variants.map(() => `p.prompt LIKE ?${SQL_LIKE_ESCAPE_CLAUSE}`).join(' OR '), variants.map((variant) => `${escapeSqlLikePattern(variant)}%`)],
      [variants.map(() => `p.prompt LIKE ?${SQL_LIKE_ESCAPE_CLAUSE}`).join(' OR '), variants.map((variant) => buildSqlContainsPattern(variant))],
    ];

    const seen = new Set<number>();
    const rows: PromptSuggestPrompt[] = [];
    for (const [where, values] of tiers) {
      if (rows.length >= limit) {
        break;
      }
      const tierRows = db.prepare(`${select} WHERE p.usage_count > 0 AND (${where}) ORDER BY p.usage_count DESC LIMIT ?`)
        .all(...values, limit + rows.length) as PromptSuggestPrompt[];
      for (const row of tierRows) {
        if (!seen.has(row.id) && rows.length < limit) {
          seen.add(row.id);
          rows.push(row);
        }
      }
    }
    return rows;
  }

  /**
   * Terms most often written together with the context terms in the user's own recent images.
   * Samples the newest images containing each context term (through the prompt FTS index when it narrows well,
   * else an early-terminating LIKE scan), so it needs no precomputed pair table.
   */
  static relatedTerms(rawContext: string[]): PromptSuggestRelatedTerm[] {
    const context = [...new Set(rawContext.map(normalizeTerm).filter((term) => term.length >= 2))].slice(-MAX_CONTEXT_TERMS);
    if (context.length === 0) {
      return [];
    }

    const cacheKey = context.join('\n');
    const cached = relatedCache.get(cacheKey);
    if (cached && Date.now() - cached.at < RELATED_CACHE_TTL_MS) {
      return cached.terms;
    }

    const contextSet = new Set(context);
    const counts = new Map<string, number>();
    for (const term of context) {
      // Prompts write the same tag as `blue hair` or `blue_hair`; look for both spellings.
      const spellings = [...new Set([term, term.replace(/ /g, '_')])];
      const params: unknown[] = spellings.map((spelling) => buildSqlContainsPattern(spelling));
      let where = `(${spellings.map(() => `im.prompt LIKE ?${SQL_LIKE_ESCAPE_CLAUSE}`).join(' OR ')})`;
      const prefilters = spellings.map((spelling) => PromptSearchIndexService.buildPrefilter('positive_text', spelling, 'im'));
      if (prefilters.every((prefilter) => prefilter !== null)) {
        where += ` AND (${prefilters.map((prefilter) => prefilter!.sql).join(' OR ')})`;
        params.push(...prefilters.flatMap((prefilter) => prefilter!.params));
      } else {
        requestPromptSearchIndexBackfill();
      }

      const rows = db.prepare(`SELECT im.prompt FROM media_metadata im WHERE ${where} ORDER BY im.rowid DESC LIMIT ?`)
        .all(...params, RELATED_SAMPLE_ROWS) as Array<{ prompt: string | null }>;
      for (const row of rows) {
        const terms = extractPromptTerms(row.prompt ?? '');
        // LIKE matched a substring; count only images that really carry the context term.
        if (!terms.includes(term)) {
          continue;
        }
        for (const other of terms) {
          if (!contextSet.has(other)) {
            counts.set(other, (counts.get(other) ?? 0) + 1);
          }
        }
      }
    }

    const terms = [...counts.entries()]
      .filter(([, count]) => count >= 2)
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .slice(0, RELATED_LIMIT)
      .map(([term, count]) => ({ term, count }));

    if (relatedCache.size >= RELATED_CACHE_MAX_ENTRIES) {
      relatedCache.delete(relatedCache.keys().next().value as string);
    }
    relatedCache.set(cacheKey, { at: Date.now(), terms });
    return terms;
  }
}
