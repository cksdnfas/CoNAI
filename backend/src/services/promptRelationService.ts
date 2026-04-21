import { cleanPromptTerm, parsePromptWithLoRAs } from '@conai/shared';
import { db } from '../database/init';
import type {
  PromptGraphEdgeItem,
  PromptGraphNodeItem,
  PromptGraphResult,
  PromptRelationPromptType,
  PromptRelationRebuildResult,
  PromptRelatedPromptItem,
  PromptRelatedPromptResult,
} from '../types/promptRelations';

interface PromptRelationMetadataRow {
  prompt: string | null;
  negative_prompt: string | null;
  character_prompt_text: string | null;
  auto_tags: string | null;
}

interface PromptGraphRelationRow {
  source_id: number;
  source_prompt: string;
  source_usage_count: number;
  source_group_id: number | null;
  target_id: number;
  target_prompt: string;
  target_usage_count: number;
  target_group_id: number | null;
  shared_count: number;
  score: number;
}

const PROMPT_RELATION_KIND = 'co_occurrence';

function getPromptTableName(type: PromptRelationPromptType): string {
  switch (type) {
    case 'negative':
      return 'negative_prompt_collection';
    case 'auto':
      return 'auto_prompt_collection';
    case 'positive':
    default:
      return 'prompt_collection';
  }
}

function roundScore(value: number): number {
  return Math.round(value * 100) / 100;
}

export class PromptRelationService {
  private static getRelationUpsertStatement() {
    return db.prepare(`
      INSERT INTO prompt_term_relations (
        prompt_type,
        source_prompt,
        target_prompt,
        relation_type,
        shared_count,
        score,
        last_seen_at,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, 1, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT(prompt_type, source_prompt, target_prompt, relation_type)
      DO UPDATE SET
        shared_count = prompt_term_relations.shared_count + 1,
        last_seen_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
    `);
  }

  private static getRelationDecrementStatement() {
    return db.prepare(`
      UPDATE prompt_term_relations
      SET
        shared_count = MAX(0, shared_count - 1),
        updated_at = CURRENT_TIMESTAMP
      WHERE prompt_type = ?
        AND source_prompt = ?
        AND target_prompt = ?
        AND relation_type = ?
    `);
  }

  private static getRelationDeleteZeroStatement() {
    return db.prepare(`
      DELETE FROM prompt_term_relations
      WHERE prompt_type = ?
        AND source_prompt = ?
        AND target_prompt = ?
        AND relation_type = ?
        AND shared_count <= 0
    `);
  }

  private static getRelationScoreUpdateStatement() {
    return db.prepare(`
      UPDATE prompt_term_relations
      SET score = ?, updated_at = CURRENT_TIMESTAMP
      WHERE prompt_type = ?
        AND source_prompt = ?
        AND target_prompt = ?
        AND relation_type = ?
    `);
  }

  static collectFromImage(
    prompt: string | null,
    negativePrompt: string | null,
    characterPromptText: string | null = null,
  ): number {
    const positiveTerms = this.buildPositiveTerms(prompt, characterPromptText);
    const negativeTerms = this.extractPromptTerms(negativePrompt);

    let updated = 0;
    updated += this.incrementCoOccurrenceRelations(positiveTerms, 'positive');
    updated += this.incrementCoOccurrenceRelations(negativeTerms, 'negative');
    return updated;
  }

  static collectAutoPromptRelations(tags: string[]): number {
    const normalized = this.extractAutoTermsFromList(tags);
    return this.incrementCoOccurrenceRelations(normalized, 'auto');
  }

  static removeFromImage(
    prompt: string | null,
    negativePrompt: string | null,
    characterPromptText: string | null = null,
    autoTags: string | null = null,
  ): number {
    const positiveTerms = this.buildPositiveTerms(prompt, characterPromptText);
    const negativeTerms = this.extractPromptTerms(negativePrompt);
    const autoTerms = this.extractAutoTermsFromPayload(autoTags);

    let updated = 0;
    updated += this.decrementCoOccurrenceRelations(positiveTerms, 'positive');
    updated += this.decrementCoOccurrenceRelations(negativeTerms, 'negative');
    updated += this.decrementCoOccurrenceRelations(autoTerms, 'auto');
    return updated;
  }

  static getRelatedPrompts(prompt: string, type: PromptRelationPromptType = 'positive', limit = 12): PromptRelatedPromptResult {
    const normalizedPrompt = type === 'auto'
      ? this.normalizeAutoPrompt(prompt)
      : this.normalizePromptTerm(prompt);

    if (!normalizedPrompt) {
      return {
        items: [],
        total: 0,
        source: {
          prompt: '',
          type,
        },
      };
    }

    const tableName = getPromptTableName(type);
    const requestedLimit = Number.isFinite(limit)
      ? Math.max(1, Math.min(50, Math.round(limit)))
      : 12;

    const items = db.prepare(`
      SELECT
        target.id,
        target.prompt,
        target.usage_count,
        target.group_id,
        rel.shared_count,
        rel.score
      FROM prompt_term_relations rel
      INNER JOIN ${tableName} target
        ON target.prompt = rel.target_prompt
      WHERE rel.prompt_type = ?
        AND rel.relation_type = ?
        AND rel.source_prompt = ?
        AND rel.shared_count > 0
        AND target.usage_count > 0
      ORDER BY rel.score DESC, rel.shared_count DESC, target.usage_count DESC, target.prompt ASC
      LIMIT ?
    `).all(type, PROMPT_RELATION_KIND, normalizedPrompt, requestedLimit) as PromptRelatedPromptItem[];

    return {
      items,
      total: items.length,
      source: {
        prompt: normalizedPrompt,
        type,
      },
    };
  }

  static getGraph(
    type: PromptRelationPromptType = 'positive',
    options?: {
      minScore?: number;
      minSharedCount?: number;
      minUsageCount?: number;
      limit?: number;
    },
  ): PromptGraphResult {
    const tableName = getPromptTableName(type);
    const minScore = Number.isFinite(options?.minScore)
      ? Math.max(0, Math.min(1000, Number(options?.minScore)))
      : 55;
    const minSharedCount = Number.isFinite(options?.minSharedCount)
      ? Math.max(1, Math.min(9999, Math.round(Number(options?.minSharedCount))))
      : 3;
    const minUsageCount = Number.isFinite(options?.minUsageCount)
      ? Math.max(1, Math.min(999999, Math.round(Number(options?.minUsageCount))))
      : 2;
    const limit = Number.isFinite(options?.limit)
      ? Math.max(20, Math.min(800, Math.round(Number(options?.limit))))
      : 180;

    const rows = db.prepare(`
      SELECT
        source.id AS source_id,
        source.prompt AS source_prompt,
        source.usage_count AS source_usage_count,
        source.group_id AS source_group_id,
        target.id AS target_id,
        target.prompt AS target_prompt,
        target.usage_count AS target_usage_count,
        target.group_id AS target_group_id,
        rel.shared_count,
        rel.score
      FROM prompt_term_relations rel
      INNER JOIN ${tableName} source
        ON source.prompt = rel.source_prompt
      INNER JOIN ${tableName} target
        ON target.prompt = rel.target_prompt
      WHERE rel.prompt_type = ?
        AND rel.relation_type = ?
        AND rel.source_prompt < rel.target_prompt
        AND rel.shared_count >= ?
        AND rel.score >= ?
        AND source.usage_count >= ?
        AND target.usage_count >= ?
      ORDER BY rel.score DESC, rel.shared_count DESC, (source.usage_count + target.usage_count) DESC, source.prompt ASC, target.prompt ASC
      LIMIT ?
    `).all(type, PROMPT_RELATION_KIND, minSharedCount, minScore, minUsageCount, minUsageCount, limit) as PromptGraphRelationRow[];

    const nodeMap = new Map<string, PromptGraphNodeItem>();
    const edges: PromptGraphEdgeItem[] = [];

    for (const row of rows) {
      const sourceExisting = nodeMap.get(row.source_prompt);
      if (sourceExisting) {
        sourceExisting.degree += 1;
      } else {
        nodeMap.set(row.source_prompt, {
          id: row.source_id,
          prompt: row.source_prompt,
          usage_count: row.source_usage_count,
          group_id: row.source_group_id,
          degree: 1,
        });
      }

      const targetExisting = nodeMap.get(row.target_prompt);
      if (targetExisting) {
        targetExisting.degree += 1;
      } else {
        nodeMap.set(row.target_prompt, {
          id: row.target_id,
          prompt: row.target_prompt,
          usage_count: row.target_usage_count,
          group_id: row.target_group_id,
          degree: 1,
        });
      }

      edges.push({
        source_prompt: row.source_prompt,
        target_prompt: row.target_prompt,
        shared_count: row.shared_count,
        score: row.score,
      });
    }

    return {
      nodes: [...nodeMap.values()].sort((left, right) => {
        if (right.degree !== left.degree) {
          return right.degree - left.degree;
        }
        if (right.usage_count !== left.usage_count) {
          return right.usage_count - left.usage_count;
        }
        return left.prompt.localeCompare(right.prompt);
      }),
      edges,
      filters: {
        type,
        min_score: minScore,
        min_shared_count: minSharedCount,
        min_usage_count: minUsageCount,
        limit,
      },
    };
  }

  static rebuildAll(): PromptRelationRebuildResult {
    const rows = db.prepare(`
      SELECT prompt, negative_prompt, character_prompt_text, auto_tags
      FROM media_metadata
    `).all() as PromptRelationMetadataRow[];

    let processed = 0;
    let updated = 0;
    const clearCount = db.prepare('SELECT COUNT(*) as count FROM prompt_term_relations').get() as { count: number };

    const transaction = db.transaction(() => {
      db.prepare('DELETE FROM prompt_term_relations').run();

      for (const row of rows) {
        processed += 1;
        updated += this.incrementCoOccurrenceRelations(this.buildPositiveTerms(row.prompt, row.character_prompt_text), 'positive', false);
        updated += this.incrementCoOccurrenceRelations(this.extractPromptTerms(row.negative_prompt), 'negative', false);
        updated += this.incrementCoOccurrenceRelations(this.extractAutoTermsFromPayload(row.auto_tags), 'auto', false);
      }

      this.recalculateAllScores();
    });

    transaction();

    return {
      processed,
      updated,
      cleared: clearCount.count,
    };
  }

  private static buildPositiveTerms(prompt: string | null, characterPromptText: string | null): string[] {
    return this.dedupeTerms([
      ...this.extractPromptTerms(prompt),
      ...this.extractPromptTerms(characterPromptText),
    ]);
  }

  private static extractPromptTerms(prompt: string | null | undefined): string[] {
    if (!prompt || typeof prompt !== 'string') {
      return [];
    }

    const { terms } = parsePromptWithLoRAs(prompt);
    return this.dedupeTerms(terms
      .map((term) => this.normalizePromptTerm(term))
      .filter((term): term is string => Boolean(term)));
  }

  private static extractAutoTermsFromPayload(autoTags: string | null | undefined): string[] {
    if (!autoTags || typeof autoTags !== 'string') {
      return [];
    }

    try {
      const parsed = JSON.parse(autoTags) as {
        tagger?: {
          caption?: string | null;
          taglist?: string | null;
        } | null;
      };

      const tagText = parsed?.tagger?.taglist || parsed?.tagger?.caption || '';
      return this.extractAutoTermsFromList(tagText.split(','));
    } catch {
      return [];
    }
  }

  private static extractAutoTermsFromList(tags: string[]): string[] {
    return this.dedupeTerms(tags
      .map((tag) => this.normalizeAutoPrompt(tag))
      .filter((tag): tag is string => Boolean(tag)));
  }

  private static normalizePromptTerm(value: string | null | undefined): string | null {
    if (typeof value !== 'string') {
      return null;
    }

    const cleaned = cleanPromptTerm(value).trim();
    return cleaned.length >= 2 ? cleaned : null;
  }

  private static normalizeAutoPrompt(value: string | null | undefined): string | null {
    if (typeof value !== 'string') {
      return null;
    }

    const cleaned = value.trim();
    return cleaned.length >= 2 ? cleaned : null;
  }

  private static dedupeTerms(terms: string[]): string[] {
    return [...new Set(terms.filter((term) => term.length >= 2))];
  }

  private static buildOrderedPairs(terms: string[]): Array<[string, string]> {
    const pairs: Array<[string, string]> = [];

    for (let sourceIndex = 0; sourceIndex < terms.length; sourceIndex += 1) {
      for (let targetIndex = 0; targetIndex < terms.length; targetIndex += 1) {
        if (sourceIndex === targetIndex) {
          continue;
        }
        pairs.push([terms[sourceIndex], terms[targetIndex]]);
      }
    }

    return pairs;
  }

  private static incrementCoOccurrenceRelations(
    terms: string[],
    type: PromptRelationPromptType,
    recalculateScores = true,
  ): number {
    const normalizedTerms = this.dedupeTerms(terms);
    if (normalizedTerms.length < 2) {
      return 0;
    }

    const relationUpsertStatement = this.getRelationUpsertStatement();
    const affectedPairs = new Set<string>();
    const transaction = db.transaction(() => {
      for (const [sourcePrompt, targetPrompt] of this.buildOrderedPairs(normalizedTerms)) {
        relationUpsertStatement.run(type, sourcePrompt, targetPrompt, PROMPT_RELATION_KIND);
        affectedPairs.add(`${sourcePrompt}\u0000${targetPrompt}`);
      }
    });

    transaction();

    if (recalculateScores) {
      this.recalculateScoresForPairs(type, affectedPairs);
    }

    return affectedPairs.size;
  }

  private static decrementCoOccurrenceRelations(terms: string[], type: PromptRelationPromptType): number {
    const normalizedTerms = this.dedupeTerms(terms);
    if (normalizedTerms.length < 2) {
      return 0;
    }

    const relationDecrementStatement = this.getRelationDecrementStatement();
    const relationDeleteZeroStatement = this.getRelationDeleteZeroStatement();
    const affectedPairs = new Set<string>();
    const transaction = db.transaction(() => {
      for (const [sourcePrompt, targetPrompt] of this.buildOrderedPairs(normalizedTerms)) {
        relationDecrementStatement.run(type, sourcePrompt, targetPrompt, PROMPT_RELATION_KIND);
        relationDeleteZeroStatement.run(type, sourcePrompt, targetPrompt, PROMPT_RELATION_KIND);
        affectedPairs.add(`${sourcePrompt}\u0000${targetPrompt}`);
      }
    });

    transaction();
    this.recalculateScoresForPairs(type, affectedPairs);
    return affectedPairs.size;
  }

  private static recalculateScoresForPairs(type: PromptRelationPromptType, pairKeys: Set<string>): void {
    if (pairKeys.size === 0) {
      return;
    }

    const relationScoreUpdateStatement = this.getRelationScoreUpdateStatement();
    const transaction = db.transaction(() => {
      for (const pairKey of pairKeys) {
        const [sourcePrompt, targetPrompt] = pairKey.split('\u0000');
        const sharedCount = this.getSharedCount(type, sourcePrompt, targetPrompt);

        if (sharedCount <= 0) {
          continue;
        }

        const score = this.calculateScore(type, sourcePrompt, targetPrompt, sharedCount);
        relationScoreUpdateStatement.run(score, type, sourcePrompt, targetPrompt, PROMPT_RELATION_KIND);
      }
    });

    transaction();
  }

  private static recalculateAllScores(): void {
    const rows = db.prepare(`
      SELECT prompt_type, source_prompt, target_prompt, shared_count
      FROM prompt_term_relations
      WHERE relation_type = ?
    `).all(PROMPT_RELATION_KIND) as Array<{
      prompt_type: PromptRelationPromptType;
      source_prompt: string;
      target_prompt: string;
      shared_count: number;
    }>;

    const relationScoreUpdateStatement = this.getRelationScoreUpdateStatement();
    const transaction = db.transaction(() => {
      for (const row of rows) {
        const score = this.calculateScore(row.prompt_type, row.source_prompt, row.target_prompt, row.shared_count);
        relationScoreUpdateStatement.run(score, row.prompt_type, row.source_prompt, row.target_prompt, PROMPT_RELATION_KIND);
      }
    });

    transaction();
  }

  private static calculateScore(type: PromptRelationPromptType, sourcePrompt: string, targetPrompt: string, sharedCount: number): number {
    const sourceUsage = this.getPromptUsageCount(type, sourcePrompt);
    const targetUsage = this.getPromptUsageCount(type, targetPrompt);

    if (sourceUsage <= 0 || targetUsage <= 0 || sharedCount <= 0) {
      return 0;
    }

    return roundScore((sharedCount / Math.sqrt(sourceUsage * targetUsage)) * 100);
  }

  private static getSharedCount(type: PromptRelationPromptType, sourcePrompt: string, targetPrompt: string): number {
    const row = db.prepare(`
      SELECT shared_count
      FROM prompt_term_relations
      WHERE prompt_type = ?
        AND source_prompt = ?
        AND target_prompt = ?
        AND relation_type = ?
      LIMIT 1
    `).get(type, sourcePrompt, targetPrompt, PROMPT_RELATION_KIND) as { shared_count?: number } | undefined;

    return row?.shared_count ?? 0;
  }

  private static getPromptUsageCount(type: PromptRelationPromptType, prompt: string): number {
    const tableName = getPromptTableName(type);
    const row = db.prepare(`SELECT usage_count FROM ${tableName} WHERE prompt = ? LIMIT 1`).get(prompt) as { usage_count?: number } | undefined;
    return row?.usage_count ?? 0;
  }
}
