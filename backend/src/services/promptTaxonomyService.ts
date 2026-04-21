import { cleanPromptTerm } from '@conai/shared';
import { db } from '../database/init';
import type {
  PromptRelationPromptType,
  PromptTaxonomyEdgeItem,
  PromptTaxonomyGraphResult,
  PromptTaxonomyInferredType,
  PromptTaxonomyNodeItem,
  PromptTaxonomyRelationKind,
  PromptTaxonomyRebuildResult,
} from '../types/promptRelations';

interface PromptTermRow {
  id: number;
  prompt: string;
  usage_count: number;
  group_id: number | null;
}

interface AnalysisRecord {
  prompt_type: PromptRelationPromptType;
  prompt: string;
  normalized_prompt: string;
  inferred_type: PromptTaxonomyInferredType;
  subtype: string | null;
  cluster_id: string | null;
  canonical_prompt: string | null;
  usage_count: number;
  group_id: number | null;
  tokens: string[];
}

interface SimilarityRelationRecord {
  prompt_type: PromptRelationPromptType;
  source_prompt: string;
  target_prompt: string;
  relation_kind: PromptTaxonomyRelationKind;
  score: number;
  evidence_json: string | null;
}

interface TaxonomyGraphRow {
  source_prompt: string;
  target_prompt: string;
  relation_kind: PromptTaxonomyRelationKind;
  score: number;
  source_id: number;
  source_usage_count: number;
  source_group_id: number | null;
  source_inferred_type: PromptTaxonomyInferredType;
  source_cluster_id: string | null;
  source_canonical_prompt: string | null;
  target_id: number;
  target_usage_count: number;
  target_group_id: number | null;
  target_inferred_type: PromptTaxonomyInferredType;
  target_cluster_id: string | null;
  target_canonical_prompt: string | null;
}

const ANALYSIS_VERSION = 1;
const STOP_TOKENS = new Set(['a', 'an', 'and', 'the', 'of', 'with', 'on', 'in', 'at', 'to', 'from']);
const QUALITY_TOKENS = new Set(['masterpiece', 'best', 'quality', 'amazing', 'great', 'highres', 'absurdres', 'ultra', 'detailed', 'detaileds', 'detailedly']);
const COUNT_OR_COMPOSITION_TOKENS = new Set(['solo', 'duo', 'group', 'multiple', 'portrait', 'close', 'up', 'shot', 'cowboy', 'full', 'upper', 'body', 'from', 'above', 'below', 'looking', 'viewer']);
const SUBJECT_TOKENS = new Set(['girl', 'girls', 'boy', 'boys', 'woman', 'women', 'man', 'men', 'person', 'people', 'character']);
const HAIR_FACE_TOKENS = new Set(['hair', 'bangs', 'ponytail', 'braid', 'braids', 'eyes', 'eye', 'eyebrows', 'eyelashes', 'face', 'lips', 'mouth', 'teeth', 'smile']);
const BODY_EXPRESSION_TOKENS = new Set(['blush', 'smile', 'smiling', 'crying', 'tears', 'breasts', 'chest', 'hips', 'legs', 'arm', 'arms', 'hand', 'hands', 'expression', 'embarrassed']);
const POSE_ACTION_TOKENS = new Set(['standing', 'sitting', 'lying', 'kneeling', 'running', 'walking', 'jumping', 'dancing', 'hugging', 'holding', 'posing']);
const CLOTHING_TOKENS = new Set(['dress', 'shirt', 'skirt', 'jacket', 'coat', 'hoodie', 'sweater', 'uniform', 'gloves', 'boots', 'shoes', 'hat', 'cap', 'ribbon', 'tie', 'bikini', 'underwear']);
const BACKGROUND_TOKENS = new Set(['room', 'bedroom', 'street', 'city', 'school', 'classroom', 'forest', 'park', 'beach', 'sky', 'clouds', 'tree', 'trees', 'flower', 'flowers', 'water', 'indoors', 'outdoors']);
const LIGHTING_TOKENS = new Set(['light', 'lighting', 'shadow', 'shadows', 'sunlight', 'backlight', 'backlighting', 'glow', 'glowing', 'dark', 'bright', 'night', 'sunset']);
const STYLE_TOKENS = new Set(['anime', 'realistic', 'illustration', 'painting', 'sketch', 'render', 'pixel', 'cinematic', 'stylized']);
const META_TOKENS = new Set(['lora', 'score', 'source', 'watermark', 'signature', 'text', 'username', 'commentary']);
const FAMILY_ANCHOR_TOKENS = new Set([
  ...HAIR_FACE_TOKENS,
  ...BODY_EXPRESSION_TOKENS,
  ...POSE_ACTION_TOKENS,
  ...CLOTHING_TOKENS,
  ...BACKGROUND_TOKENS,
  ...LIGHTING_TOKENS,
  ...STYLE_TOKENS,
  ...SUBJECT_TOKENS,
]);

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

function normalizePrompt(prompt: string): string {
  return cleanPromptTerm(prompt).trim().toLowerCase();
}

function tokenizePrompt(prompt: string): string[] {
  return normalizePrompt(prompt)
    .replace(/[_\-/]+/g, ' ')
    .replace(/[^a-z0-9\s]+/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

function buildCompactKey(prompt: string): string {
  return normalizePrompt(prompt).replace(/[^a-z0-9]+/g, '');
}

function getAnchorToken(tokens: string[]): string | null {
  const prioritized = [...tokens].reverse().find((token) => FAMILY_ANCHOR_TOKENS.has(token));
  if (prioritized) {
    return prioritized;
  }

  const fallback = [...tokens].reverse().find((token) => !STOP_TOKENS.has(token) && token.length >= 3);
  return fallback ?? null;
}

function inferPromptType(prompt: string, tokens: string[]): { inferredType: PromptTaxonomyInferredType; subtype: string | null } {
  const normalized = normalizePrompt(prompt);
  const tokenSet = new Set(tokens);
  const hasAny = (values: Set<string>) => [...values].some((value) => tokenSet.has(value));

  if (normalized.startsWith('by ') || normalized.includes('artist:')) {
    return { inferredType: 'artist_or_source', subtype: 'artist' };
  }

  if (normalized.startsWith('score_') || normalized.startsWith('source_') || hasAny(META_TOKENS)) {
    return { inferredType: 'meta_or_technical', subtype: null };
  }

  if (hasAny(QUALITY_TOKENS)) {
    return { inferredType: 'quality', subtype: null };
  }

  if (hasAny(COUNT_OR_COMPOSITION_TOKENS)) {
    return { inferredType: 'count_or_composition', subtype: getAnchorToken(tokens) };
  }

  if (hasAny(POSE_ACTION_TOKENS)) {
    return { inferredType: 'pose_or_action', subtype: getAnchorToken(tokens) };
  }

  if (hasAny(HAIR_FACE_TOKENS)) {
    return { inferredType: 'hair_or_face', subtype: getAnchorToken(tokens) };
  }

  if (hasAny(BODY_EXPRESSION_TOKENS)) {
    return { inferredType: 'body_or_expression', subtype: getAnchorToken(tokens) };
  }

  if (hasAny(CLOTHING_TOKENS)) {
    return { inferredType: 'clothing_or_accessory', subtype: getAnchorToken(tokens) };
  }

  if (hasAny(BACKGROUND_TOKENS)) {
    return { inferredType: 'background_or_setting', subtype: getAnchorToken(tokens) };
  }

  if (hasAny(LIGHTING_TOKENS)) {
    return { inferredType: 'lighting_or_mood', subtype: getAnchorToken(tokens) };
  }

  if (hasAny(STYLE_TOKENS)) {
    return { inferredType: 'style', subtype: getAnchorToken(tokens) };
  }

  if (hasAny(SUBJECT_TOKENS)) {
    return { inferredType: 'subject', subtype: getAnchorToken(tokens) };
  }

  return { inferredType: 'unknown', subtype: getAnchorToken(tokens) };
}

function buildClusterId(inferredType: PromptTaxonomyInferredType, subtype: string | null, tokens: string[]): string | null {
  if (inferredType === 'quality') {
    return 'quality:general';
  }

  if (inferredType === 'artist_or_source') {
    return 'artist_or_source:general';
  }

  if (inferredType === 'meta_or_technical') {
    const anchor = subtype ?? getAnchorToken(tokens) ?? 'general';
    return `meta_or_technical:${anchor}`;
  }

  const anchor = subtype ?? getAnchorToken(tokens);
  if (!anchor) {
    return inferredType === 'unknown' ? null : `${inferredType}:general`;
  }

  return `${inferredType}:${anchor}`;
}

function getTokenOverlapScore(leftTokens: string[], rightTokens: string[]): number {
  const left = new Set(leftTokens);
  const right = new Set(rightTokens);
  const intersectionCount = [...left].filter((token) => right.has(token)).length;
  const unionCount = new Set([...left, ...right]).size;
  if (intersectionCount <= 0 || unionCount <= 0) {
    return 0;
  }
  return intersectionCount / unionCount;
}

function getUsageBalanceScore(leftUsage: number, rightUsage: number): number {
  if (leftUsage <= 0 || rightUsage <= 0) {
    return 0;
  }
  return Math.min(leftUsage, rightUsage) / Math.max(leftUsage, rightUsage);
}

function buildEvidenceJson(payload: Record<string, unknown>) {
  return JSON.stringify(payload);
}

export class PromptTaxonomyService {
  private static getAnalysisInsertStatement() {
    return db.prepare(`
      INSERT INTO prompt_term_analysis (
        prompt_type,
        prompt,
        normalized_prompt,
        inferred_type,
        subtype,
        cluster_id,
        canonical_prompt,
        analysis_version,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);
  }

  private static getSimilarityInsertStatement() {
    return db.prepare(`
      INSERT INTO prompt_term_similarity_relations (
        prompt_type,
        source_prompt,
        target_prompt,
        relation_kind,
        score,
        evidence_json,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `);
  }

  static rebuildAll(): PromptTaxonomyRebuildResult {
    let processed = 0;
    let nodes = 0;
    let clusters = 0;
    let relations = 0;

    const transaction = db.transaction(() => {
      db.prepare('DELETE FROM prompt_term_similarity_relations').run();
      db.prepare('DELETE FROM prompt_term_analysis').run();

      for (const type of ['positive', 'negative', 'auto'] as PromptRelationPromptType[]) {
        const result = this.rebuildForType(type);
        processed += result.processed;
        nodes += result.nodes;
        clusters += result.clusters;
        relations += result.relations;
      }
    });

    transaction();

    return { processed, nodes, clusters, relations };
  }

  static getGraph(
    type: PromptRelationPromptType = 'positive',
    options?: {
      inferredType?: PromptTaxonomyInferredType | 'all';
      minScore?: number;
      limit?: number;
    },
  ): PromptTaxonomyGraphResult {
    const inferredType = options?.inferredType ?? 'all';
    const minScore = Number.isFinite(options?.minScore) ? Math.max(0, Math.min(1, Number(options?.minScore))) : 0.58;
    const limit = Number.isFinite(options?.limit) ? Math.max(20, Math.min(800, Math.round(Number(options?.limit)))) : 180;

    const rows = inferredType === 'all'
      ? db.prepare(`
          SELECT
            rel.source_prompt,
            rel.target_prompt,
            rel.relation_kind,
            rel.score,
            sourceCollection.id AS source_id,
            sourceCollection.usage_count AS source_usage_count,
            sourceCollection.group_id AS source_group_id,
            sourceAnalysis.inferred_type AS source_inferred_type,
            sourceAnalysis.cluster_id AS source_cluster_id,
            sourceAnalysis.canonical_prompt AS source_canonical_prompt,
            targetCollection.id AS target_id,
            targetCollection.usage_count AS target_usage_count,
            targetCollection.group_id AS target_group_id,
            targetAnalysis.inferred_type AS target_inferred_type,
            targetAnalysis.cluster_id AS target_cluster_id,
            targetAnalysis.canonical_prompt AS target_canonical_prompt
          FROM prompt_term_similarity_relations rel
          INNER JOIN prompt_term_analysis sourceAnalysis
            ON sourceAnalysis.prompt_type = rel.prompt_type
           AND sourceAnalysis.prompt = rel.source_prompt
          INNER JOIN prompt_term_analysis targetAnalysis
            ON targetAnalysis.prompt_type = rel.prompt_type
           AND targetAnalysis.prompt = rel.target_prompt
          INNER JOIN ${getPromptTableName(type)} sourceCollection
            ON sourceCollection.prompt = rel.source_prompt
          INNER JOIN ${getPromptTableName(type)} targetCollection
            ON targetCollection.prompt = rel.target_prompt
          WHERE rel.prompt_type = ?
            AND rel.score >= ?
          ORDER BY rel.score DESC, sourceCollection.usage_count DESC, targetCollection.usage_count DESC
          LIMIT ?
        `).all(type, minScore, limit) as TaxonomyGraphRow[]
      : db.prepare(`
          SELECT
            rel.source_prompt,
            rel.target_prompt,
            rel.relation_kind,
            rel.score,
            sourceCollection.id AS source_id,
            sourceCollection.usage_count AS source_usage_count,
            sourceCollection.group_id AS source_group_id,
            sourceAnalysis.inferred_type AS source_inferred_type,
            sourceAnalysis.cluster_id AS source_cluster_id,
            sourceAnalysis.canonical_prompt AS source_canonical_prompt,
            targetCollection.id AS target_id,
            targetCollection.usage_count AS target_usage_count,
            targetCollection.group_id AS target_group_id,
            targetAnalysis.inferred_type AS target_inferred_type,
            targetAnalysis.cluster_id AS target_cluster_id,
            targetAnalysis.canonical_prompt AS target_canonical_prompt
          FROM prompt_term_similarity_relations rel
          INNER JOIN prompt_term_analysis sourceAnalysis
            ON sourceAnalysis.prompt_type = rel.prompt_type
           AND sourceAnalysis.prompt = rel.source_prompt
          INNER JOIN prompt_term_analysis targetAnalysis
            ON targetAnalysis.prompt_type = rel.prompt_type
           AND targetAnalysis.prompt = rel.target_prompt
          INNER JOIN ${getPromptTableName(type)} sourceCollection
            ON sourceCollection.prompt = rel.source_prompt
          INNER JOIN ${getPromptTableName(type)} targetCollection
            ON targetCollection.prompt = rel.target_prompt
          WHERE rel.prompt_type = ?
            AND rel.score >= ?
            AND sourceAnalysis.inferred_type = ?
            AND targetAnalysis.inferred_type = ?
          ORDER BY rel.score DESC, sourceCollection.usage_count DESC, targetCollection.usage_count DESC
          LIMIT ?
        `).all(type, minScore, inferredType, inferredType, limit) as TaxonomyGraphRow[];

    const nodeMap = new Map<string, PromptTaxonomyNodeItem>();
    const edges: PromptTaxonomyEdgeItem[] = [];

    for (const row of rows) {
      if (!nodeMap.has(row.source_prompt)) {
        nodeMap.set(row.source_prompt, {
          id: row.source_id,
          prompt: row.source_prompt,
          usage_count: row.source_usage_count,
          group_id: row.source_group_id,
          inferred_type: row.source_inferred_type,
          cluster_id: row.source_cluster_id,
          canonical_prompt: row.source_canonical_prompt,
        });
      }

      if (!nodeMap.has(row.target_prompt)) {
        nodeMap.set(row.target_prompt, {
          id: row.target_id,
          prompt: row.target_prompt,
          usage_count: row.target_usage_count,
          group_id: row.target_group_id,
          inferred_type: row.target_inferred_type,
          cluster_id: row.target_cluster_id,
          canonical_prompt: row.target_canonical_prompt,
        });
      }

      edges.push({
        source_prompt: row.source_prompt,
        target_prompt: row.target_prompt,
        relation_kind: row.relation_kind,
        score: row.score,
      });
    }

    return {
      nodes: [...nodeMap.values()].sort((left, right) => right.usage_count - left.usage_count || left.prompt.localeCompare(right.prompt)),
      edges,
      filters: {
        type,
        inferred_type: inferredType,
        min_score: minScore,
        limit,
      },
    };
  }

  private static rebuildForType(type: PromptRelationPromptType) {
    const rows = db.prepare(`
      SELECT id, prompt, usage_count, group_id
      FROM ${getPromptTableName(type)}
      WHERE usage_count > 0
      ORDER BY usage_count DESC, prompt ASC
    `).all() as PromptTermRow[];

    const analyses = rows.map((row) => {
      const normalizedPrompt = normalizePrompt(row.prompt);
      const tokens = tokenizePrompt(row.prompt);
      const { inferredType, subtype } = inferPromptType(row.prompt, tokens);
      const clusterId = buildClusterId(inferredType, subtype, tokens);

      return {
        prompt_type: type,
        prompt: row.prompt,
        normalized_prompt: normalizedPrompt,
        inferred_type: inferredType,
        subtype,
        cluster_id: clusterId,
        canonical_prompt: null,
        usage_count: row.usage_count,
        group_id: row.group_id,
        tokens,
      } satisfies AnalysisRecord;
    });

    const analysesByCluster = new Map<string, AnalysisRecord[]>();
    for (const analysis of analyses) {
      if (!analysis.cluster_id) {
        continue;
      }
      const group = analysesByCluster.get(analysis.cluster_id) ?? [];
      group.push(analysis);
      analysesByCluster.set(analysis.cluster_id, group);
    }

    for (const group of analysesByCluster.values()) {
      const canonicalPrompt = [...group].sort((left, right) => right.usage_count - left.usage_count || left.prompt.localeCompare(right.prompt))[0]?.prompt ?? null;
      for (const member of group) {
        member.canonical_prompt = canonicalPrompt;
      }
    }

    const relations = this.buildRelationsForType(type, analyses, analysesByCluster);

    const insertAnalysis = this.getAnalysisInsertStatement();
    for (const analysis of analyses) {
      insertAnalysis.run(
        analysis.prompt_type,
        analysis.prompt,
        analysis.normalized_prompt,
        analysis.inferred_type,
        analysis.subtype,
        analysis.cluster_id,
        analysis.canonical_prompt,
        ANALYSIS_VERSION,
      );
    }

    const insertSimilarity = this.getSimilarityInsertStatement();
    for (const relation of relations) {
      insertSimilarity.run(
        relation.prompt_type,
        relation.source_prompt,
        relation.target_prompt,
        relation.relation_kind,
        relation.score,
        relation.evidence_json,
      );
    }

    return {
      processed: rows.length,
      nodes: analyses.length,
      clusters: analysesByCluster.size,
      relations: relations.length,
    };
  }

  private static buildRelationsForType(
    type: PromptRelationPromptType,
    analyses: AnalysisRecord[],
    analysesByCluster: Map<string, AnalysisRecord[]>,
  ) {
    const relations = new Map<string, SimilarityRelationRecord>();

    for (const [clusterId, members] of analysesByCluster.entries()) {
      const orderedMembers = [...members].sort((left, right) => right.usage_count - left.usage_count || left.prompt.localeCompare(right.prompt));
      for (let index = 0; index < orderedMembers.length; index += 1) {
        const source = orderedMembers[index];
        const candidates = orderedMembers.filter((candidate) => candidate.prompt !== source.prompt);
        const ranked = candidates
          .map((candidate) => ({
            candidate,
            score: this.calculateFamilyScore(source, candidate, clusterId),
          }))
          .filter((item) => item.score >= 0.58)
          .sort((left, right) => right.score - left.score || right.candidate.usage_count - left.candidate.usage_count)
          .slice(0, 6);

        for (const item of ranked) {
          this.upsertRelation(relations, {
            prompt_type: type,
            source_prompt: source.prompt,
            target_prompt: item.candidate.prompt,
            relation_kind: 'same_family',
            score: item.score,
            evidence_json: buildEvidenceJson({ clusterId, inferredType: source.inferred_type }),
          });
        }
      }
    }

    const compactGroups = new Map<string, AnalysisRecord[]>();
    for (const analysis of analyses) {
      const compactKey = buildCompactKey(analysis.prompt);
      if (compactKey.length < 3) {
        continue;
      }
      const group = compactGroups.get(compactKey) ?? [];
      group.push(analysis);
      compactGroups.set(compactKey, group);
    }

    for (const group of compactGroups.values()) {
      if (group.length < 2) {
        continue;
      }

      const limited = [...group].sort((left, right) => right.usage_count - left.usage_count || left.prompt.localeCompare(right.prompt)).slice(0, 12);
      for (let leftIndex = 0; leftIndex < limited.length; leftIndex += 1) {
        for (let rightIndex = leftIndex + 1; rightIndex < limited.length; rightIndex += 1) {
          const left = limited[leftIndex];
          const right = limited[rightIndex];
          const variantScore = roundScore(0.9 + getUsageBalanceScore(left.usage_count, right.usage_count) * 0.1);
          this.upsertRelation(relations, {
            prompt_type: type,
            source_prompt: left.prompt,
            target_prompt: right.prompt,
            relation_kind: 'string_variant',
            score: variantScore,
            evidence_json: buildEvidenceJson({ compactKey: buildCompactKey(left.prompt) }),
          });
        }
      }
    }

    return [...relations.values()].sort((left, right) => right.score - left.score || left.source_prompt.localeCompare(right.source_prompt));
  }

  private static calculateFamilyScore(source: AnalysisRecord, target: AnalysisRecord, clusterId: string) {
    const tokenOverlapScore = getTokenOverlapScore(source.tokens, target.tokens);
    const usageBalanceScore = getUsageBalanceScore(source.usage_count, target.usage_count);
    const sameSubtypeBonus = source.subtype && target.subtype && source.subtype === target.subtype ? 0.12 : 0;
    const sameClusterBonus = source.cluster_id && source.cluster_id === target.cluster_id ? 0.28 : 0;
    const sameTypeBonus = source.inferred_type === target.inferred_type ? 0.16 : 0;
    const qualityBonus = clusterId === 'quality:general' ? 0.12 : 0;
    const score = sameClusterBonus + sameTypeBonus + sameSubtypeBonus + qualityBonus + tokenOverlapScore * 0.22 + usageBalanceScore * 0.1;
    return roundScore(Math.min(0.99, score));
  }

  private static upsertRelation(target: Map<string, SimilarityRelationRecord>, relation: SimilarityRelationRecord) {
    const left = relation.source_prompt.localeCompare(relation.target_prompt) <= 0 ? relation.source_prompt : relation.target_prompt;
    const right = left === relation.source_prompt ? relation.target_prompt : relation.source_prompt;
    const key = `${relation.prompt_type}\u0000${relation.relation_kind}\u0000${left}\u0000${right}`;
    const normalizedRelation: SimilarityRelationRecord = {
      ...relation,
      source_prompt: left,
      target_prompt: right,
    };

    const existing = target.get(key);
    if (!existing || existing.score < normalizedRelation.score) {
      target.set(key, normalizedRelation);
    }
  }
}
