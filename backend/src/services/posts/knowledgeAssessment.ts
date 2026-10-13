import { createHash, randomUUID } from 'crypto';
import type { PostAssessmentEvaluator, PostAssessmentQuality, PostAssessmentTaskFit, PostQualityGroup, PostQualityStats, PostsKnowledgeSettings, PostKnowledgeSearchReceipt, PostTaskFitFeedback, PostAssessmentAuditEntry, PostAssessmentAuditList, PostAssessmentModerationResult, PostAssessmentEventKind } from '@conai/shared';
import { getUserSettingsDb } from '../../database/userSettingsDb';
import { publishRuntimeEvent } from '../runtime-events/runtimeEventBus';
import { PostError, requireKey, requireHumanPostActor, isHumanPostActor, postActorAccountKey, type PostActor } from './postActor';
import { requireKnowledgeRow, findKnowledgeRow, knowledgeIssues } from './knowledgeStore';
import { loadPostsSettings } from './postsSettings';

const db = () => getUserSettingsDb();
export interface KnowledgeAssessmentInput {
  postId: number; contentVersion: number; contentHash: string; evaluator: PostAssessmentEvaluator; accountKey: string;
  profileId?: number | null; evaluatorFamily: string; rootExecutionId: string | null; purpose: string;
  quality: PostAssessmentQuality; taskFit?: PostAssessmentTaskFit; reasonCode?: string | null; reason?: string; evidenceQuote?: string;
  phase: 'provisional' | 'final'; selfAssessment?: boolean; evidenceSufficient?: boolean; publicReason?: boolean;
  idempotencyKey: string; useId?: string | null; requestId?: string | null; taskKey?: string | null; executionStartedAt?: string;
  eventKind?: PostAssessmentEventKind; moderatorAccountKey?: string | null; supersedesEventId?: number | null; moderationReason?: string | null;
}
export type AssessmentRow = { id: number; post_id: number; content_version: number; content_hash: string; logical_key: string; actor_key: string;
  evaluator: PostAssessmentEvaluator; evaluator_family: string; profile_id: number | null; use_id: string | null; request_id: string | null; root_execution_id: string | null; purpose: string; quality: PostAssessmentQuality;
  task_fit: PostAssessmentTaskFit; task_key: string | null; reason_code: string | null; reason: string; evidence_quote: string; phase: 'provisional' | 'final';
  self_assessment: number; evidence_sufficient: number; public_reason: number; execution_started_at: string; created_at: string;
  event_kind: PostAssessmentEventKind; moderator_account_key: string | null; supersedes_event_id: number | null; moderation_reason: string | null };

/** Internal server-only entry point. The caller authenticates evaluator/ref evidence before inserting. */
export function insertKnowledgeAssessment(input: KnowledgeAssessmentInput): number {
  if (!input.accountKey || input.accountKey.length > 200 || !input.idempotencyKey || input.idempotencyKey.length > 200) throw new PostError('평가 계정 키와 멱등 키가 필요해.');
  if (!['human','use_ai','judge'].includes(input.evaluator) || !['up','down','abstain'].includes(input.quality) || !['provisional','final'].includes(input.phase)
    || (input.taskFit !== undefined && !['useful','unsuitable','unknown'].includes(input.taskFit))) throw new PostError('잘못된 평가 값이야.');
  if (input.evaluator !== 'human' && (!input.rootExecutionId || !input.evaluatorFamily || (!input.useId && !input.requestId))) throw new PostError('자동 평가는 서버의 참조 또는 검토 요청에 연결되어야 해.');
  return db().transaction(() => {
    const existing = db().prepare('SELECT * FROM post_assessment_events WHERE actor_key=? AND idempotency_key=?').get(input.accountKey, input.idempotencyKey) as AssessmentRow | undefined;
    if (existing) {
      if (existing.post_id !== input.postId || existing.content_version !== input.contentVersion || existing.content_hash !== input.contentHash || existing.evaluator !== input.evaluator || existing.evaluator_family !== input.evaluatorFamily
        || existing.root_execution_id !== input.rootExecutionId || existing.purpose !== input.purpose || existing.profile_id !== (input.profileId ?? null) || existing.use_id !== (input.useId ?? null) || existing.request_id !== (input.requestId ?? null)
        || existing.quality !== input.quality || existing.task_fit !== (input.taskFit ?? 'unknown') || existing.task_key !== (input.taskKey ?? null) || existing.phase !== input.phase || existing.reason !== (input.reason ?? '').slice(0,4000)
        || existing.reason_code !== (input.reasonCode ?? null) || existing.evidence_quote !== (input.evidenceQuote ?? '').slice(0,4000) || existing.self_assessment !== (input.selfAssessment ? 1 : 0)
        || existing.evidence_sufficient !== (input.evidenceSufficient === false ? 0 : 1) || existing.public_reason !== (input.publicReason === false ? 0 : 1)
        || existing.event_kind !== (input.eventKind ?? 'assessment') || existing.moderator_account_key !== (input.moderatorAccountKey ?? null)
        || existing.supersedes_event_id !== (input.supersedesEventId ?? null) || existing.moderation_reason !== (input.moderationReason ?? null)) throw new PostError('멱등 키를 다른 평가에 재사용할 수 없어.', 409);
      return existing.id;
    }
    if (!db().prepare('SELECT 1 FROM post_knowledge_versions WHERE post_id=? AND content_version=? AND content_hash=?').get(input.postId, input.contentVersion, input.contentHash)) throw new PostError('평가할 내용 판과 해시가 맞지 않아.', 409);
    const logical = JSON.stringify(input.evaluator === 'human' ? (input.purpose === 'task_fit' ? [input.postId,input.accountKey,input.contentHash,'human','task_fit',input.taskKey] : [input.postId,input.accountKey,input.contentHash,'human']) :
      [input.postId,input.contentHash,input.rootExecutionId,input.evaluatorFamily,input.purpose,input.evaluator,input.taskKey??null]);
    const first = input.rootExecutionId ? db().prepare('SELECT execution_started_at FROM post_assessment_events WHERE actor_key=? AND root_execution_id=? ORDER BY id LIMIT 1').get(input.accountKey, input.rootExecutionId) as { execution_started_at: string } | undefined : undefined;
    const timestamp = first?.execution_started_at ?? (input.executionStartedAt && Number.isFinite(Date.parse(input.executionStartedAt)) ? new Date(input.executionStartedAt).toISOString() : new Date().toISOString());
    const id = Number(db().prepare(`INSERT INTO post_assessment_events(post_id,content_version,content_hash,logical_key,actor_key,evaluator,evaluator_family,profile_id,root_execution_id,purpose,
      quality,task_fit,task_key,reason_code,reason,evidence_quote,phase,self_assessment,evidence_sufficient,public_reason,idempotency_key,use_id,request_id,execution_started_at,policy_version,event_kind,moderator_account_key,supersedes_event_id,moderation_reason)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(input.postId,input.contentVersion,input.contentHash,logical,input.accountKey,input.evaluator,input.evaluatorFamily,input.profileId ?? null,input.rootExecutionId,input.purpose,
      input.quality,input.taskFit ?? 'unknown',input.taskKey ?? null,input.reasonCode ?? null,(input.reason ?? '').slice(0,4000),(input.evidenceQuote ?? '').slice(0,4000),input.phase,input.selfAssessment ? 1 : 0,input.evidenceSufficient === false ? 0 : 1,input.publicReason === false ? 0 : 1,input.idempotencyKey,input.useId ?? null,input.requestId ?? null,timestamp,loadPostsSettings().knowledge.policyVersion,input.eventKind ?? 'assessment',input.moderatorAccountKey ?? null,input.supersedesEventId ?? null,input.moderationReason ?? null).lastInsertRowid);
    const head = db().prepare('SELECT e.phase,e.event_kind FROM post_assessment_heads h JOIN post_assessment_events e ON e.id=h.event_id WHERE h.logical_key=?').get(logical) as { phase: string; event_kind: PostAssessmentEventKind } | undefined;
    // A late provisional retry cannot replace an already completed opinion.
    if (!(head?.phase === 'final' && input.phase === 'provisional') && !(head && head.event_kind !== 'assessment' && (!input.eventKind || input.eventKind === 'assessment')))
      db().prepare('INSERT INTO post_assessment_heads(logical_key,event_id) VALUES(?,?) ON CONFLICT(logical_key) DO UPDATE SET event_id=excluded.event_id').run(logical,id);
    db().prepare('DELETE FROM post_quality_stats WHERE post_id=?').run(input.postId);
    const knowledge = findKnowledgeRow(input.postId);
    if (knowledge) {
      const heads = db().prepare('SELECT e.* FROM post_assessment_heads h JOIN post_assessment_events e ON e.id=h.event_id WHERE e.post_id=?').all(input.postId) as AssessmentRow[];
      const stats = aggregateKnowledgeAssessments(heads,knowledge.content_hash,knowledge.content_version,loadPostsSettings().knowledge);
      if (stats.needsReview) {
        db().prepare("UPDATE post_knowledge SET review_status='needs_review' WHERE post_id=?").run(input.postId);
        if (!knowledgeIssues(input.postId).some(issue => !issue.resolvedAt)) db().prepare("INSERT INTO post_review_events(post_id,content_version,action,actor_key,related_assessment_id,reason,public_reason) VALUES(?,?,'request_review','system',?,?,1)")
          .run(input.postId,knowledge.content_version,id,'독립 평가 근거 3개 이상과 높은 비추천 비율로 재검토가 필요해.');
      }
    }
    return id;
  }).immediate();
}

const emptyGroup = (): PostQualityGroup => ({ up: 0, down: 0, abstain: 0, rawCount: 0, independentCount: 0, effectiveWeight: 0 });
const bundleKey = (row: AssessmentRow) => JSON.stringify([row.actor_key,row.root_execution_id,row.purpose]);
const identityKey = (row: AssessmentRow) => row.evaluator === 'human' ? `human:${row.actor_key}` : `auto:${bundleKey(row)}`;

function latestAutomaticOpinions(rows:AssessmentRow[],includeCondition=false) {
  const latest=new Map<string,AssessmentRow>();
  for(const row of rows) {
    const key=row.evaluator==='human'?row.logical_key:JSON.stringify([row.post_id,row.content_hash,row.actor_key,row.root_execution_id,row.evaluator_family,row.purpose,row.evaluator,...(includeCondition?[row.task_key]:[])]);
    const existing=latest.get(key);
    const moderated=row.event_kind!=='assessment',existingModerated=existing&&existing.event_kind!=='assessment';
    if(!existing||(moderated&&!existingModerated)||(moderated===Boolean(existingModerated)&&row.id>existing.id)) latest.set(key,row);
  }
  return [...latest.values()];
}

/** Explainable policy v1, with bundle, daily and global caps in a fixed order. */
function contributions(rows: AssessmentRow[], policy: PostsKnowledgeSettings) {
  const human = emptyGroup(), useAi = emptyGroup(), judge = emptyGroup();
  const groups = { human, use_ai: useAi, judge };
  type Weighted = { row: AssessmentRow; weight: number };
  const auto: Weighted[] = [];
  let humanUp = 0, humanDown = 0;
  for (const row of rows) {
    const group = groups[row.evaluator];
    group.rawCount++;
    if (row.quality === 'abstain') group.abstain++;
    if (row.phase !== 'final' || row.quality === 'abstain' || row.self_assessment || !row.evidence_sufficient) continue;
    if (row.evaluator === 'human') {
      group.independentCount++; group.effectiveWeight += policy.humanWeight;
      if (row.quality === 'up') { humanUp += policy.humanWeight; group.up += policy.humanWeight; }
      else { humanDown += policy.humanWeight; group.down += policy.humanWeight; }
    } else auto.push({ row, weight: row.evaluator === 'use_ai' ? policy.useAiWeight : policy.judgeWeight });
  }
  const bundles = new Map<string, Weighted[]>();
  for (const entry of auto) {
    const key = bundleKey(entry.row);
    const list = bundles.get(key) ?? []; list.push(entry); bundles.set(key,list);
  }
  for (const entries of bundles.values()) {
    const total = entries.reduce((sum,entry) => sum + entry.weight,0);
    const factor = total ? Math.min(1,policy.aiBundleCap / total) : 0;
    entries.forEach(entry => { entry.weight *= factor; });
  }
  // Fix dates by the server's first execution timestamp. Model/profile renaming cannot create new families.
  const days = new Map<string, Set<string>>();
  const ordered = [...auto].sort((a,b) => a.row.execution_started_at.localeCompare(b.row.execution_started_at) || bundleKey(a.row).localeCompare(bundleKey(b.row)) || a.row.id-b.row.id);
  for (const entry of ordered) {
    const key = JSON.stringify([entry.row.actor_key,entry.row.evaluator_family,entry.row.execution_started_at.slice(0,10)]);
    const tasks = days.get(key) ?? new Set<string>(); const task = bundleKey(entry.row);
    if (!tasks.has(task) && tasks.size >= policy.aiDailyFamilyLimit) { entry.weight = 0; continue; }
    tasks.add(task); days.set(key,tasks);
  }
  const rawWeight = auto.reduce((sum,entry) => sum + entry.weight,0);
  const aiCap = Math.max(policy.aiGlobalMinimumCap,(humanUp+humanDown)*policy.aiGlobalHumanRatio);
  const factor = rawWeight ? Math.min(1,aiCap/rawWeight) : 0;
  let aiUp = 0, aiDown = 0;
  const independent = new Set<string>();
  const groupIndependent = { use_ai: new Set<string>(), judge: new Set<string>() };
  for (const entry of auto) {
    entry.weight *= factor;
    if (!entry.weight) continue;
    const group = groups[entry.row.evaluator]; group.effectiveWeight += entry.weight;
    if (entry.row.quality === 'up') { group.up += entry.weight; aiUp += entry.weight; }
    else { group.down += entry.weight; aiDown += entry.weight; }
    independent.add(bundleKey(entry.row));
    groupIndependent[entry.row.evaluator as 'use_ai'|'judge'].add(bundleKey(entry.row));
  }
  useAi.independentCount = groupIndependent.use_ai.size; judge.independentCount = groupIndependent.judge.size;
  return { current: { human,useAi,judge }, up: humanUp+aiUp, down: humanDown+aiDown, independentCount: human.independentCount+independent.size,
    aiRawWeight: rawWeight, aiEffectiveWeight: aiUp+aiDown, aiCap };
}

export function aggregateKnowledgeAssessments(rows: AssessmentRow[], contentHash: string, contentVersion: number, policy: PostsKnowledgeSettings): PostQualityStats {
  // A private execution against a private document cannot later become public ranking evidence merely by publication.
  rows = latestAutomaticOpinions(rows.filter(row => row.purpose !== 'task_fit' && (row.evaluator === 'human' || row.public_reason === 1)));
  const currentRows = rows.filter(row => row.content_hash === contentHash);
  const current = contributions(currentRows,policy);
  const replaced = new Set(currentRows.filter(row => row.phase === 'final').map(identityKey));
  // Keep each evaluator/bundle's most recent old content only; do not add a carried score at every version.
  const newestHash = new Map<string,{ hash: string; version: number; id: number }>();
  for (const row of rows) {
    if (row.phase !== 'final' || row.content_hash === contentHash || replaced.has(identityKey(row))) continue;
    const identity = identityKey(row); const existing = newestHash.get(identity);
    if (!existing || row.content_version > existing.version || (row.content_version === existing.version && row.id > existing.id)) newestHash.set(identity,{ hash: row.content_hash,version: row.content_version,id: row.id });
  }
  const oldRows = rows.filter(row => row.content_hash !== contentHash && newestHash.get(identityKey(row))?.hash === row.content_hash);
  const previous = contributions(oldRows,policy);
  const historyRaw = (previous.up+previous.down)*policy.historyWeight;
  const historicalFactor = historyRaw ? policy.historyWeight*Math.min(1,policy.historyCap/historyRaw) : 0;
  const history = { up: previous.up*historicalFactor,down: previous.down*historicalFactor,effectiveWeight: historyRaw ? Math.min(historyRaw,policy.historyCap) : 0 };
  const up = current.up+history.up, down = current.down+history.down;
  const smoothedDown = (down+2)/(up+down+4);
  const qualityMultiplier = 1-0.7*Math.max(0,2*smoothedDown-1)+0.1*Math.max(0,1-2*smoothedDown);
  return { contentVersion,contentHash,policyVersion: policy.policyVersion,current: current.current,history,up,down,
    sampleCount: currentRows.filter(row => row.phase === 'final').length, independentCount: current.independentCount,
    aiRawWeight: current.aiRawWeight,aiEffectiveWeight: current.aiEffectiveWeight,aiCap: current.aiCap,smoothedDown,qualityMultiplier,
    needsReview: current.independentCount>=3 && smoothedDown>=0.65, ownVote: null,reasons: [] };
}

/** Public aggregate only, for an already-authorized search batch. Stale entries fall back to the normal resolver. */
export function cachedKnowledgeMultipliers(postIds: number[], policy: PostsKnowledgeSettings): Map<number, number> {
  const result = new Map<number, number>();
  if (!postIds.length) return result;
  const hash = createHash('sha256').update(JSON.stringify(policy)).digest('hex');
  const rows = db().prepare(`SELECT k.post_id, k.content_version, s.stats_json
    FROM post_knowledge k JOIN post_quality_stats s ON s.post_id=k.post_id
    WHERE k.post_id IN (SELECT value FROM json_each(?)) AND k.enabled=1
      AND s.content_hash=k.content_hash AND s.settings_hash=?
      AND s.last_event_id=COALESCE((SELECT MAX(e.id) FROM post_assessment_heads h JOIN post_assessment_events e ON e.id=h.event_id WHERE e.post_id=k.post_id),0)`)
    .all(JSON.stringify(postIds), hash) as Array<{ post_id: number; content_version: number; stats_json: string }>;
  for (const row of rows) {
    try {
      const stats = JSON.parse(row.stats_json) as PostQualityStats;
      if (stats.contentVersion === row.content_version && Number.isFinite(stats.qualityMultiplier)) result.set(row.post_id, stats.qualityMultiplier);
    } catch { /* Derived data can be rebuilt. */ }
  }
  return result;
}

export function getKnowledgeQuality(actor: PostActor, postId: number): PostQualityStats {
  const knowledge = requireKnowledgeRow(actor,postId,{ allowDeleted: true });
  const rows = db().prepare('SELECT e.* FROM post_assessment_heads h JOIN post_assessment_events e ON e.id=h.event_id WHERE e.post_id=? ORDER BY e.id').all(postId) as AssessmentRow[];
  const policy = loadPostsSettings().knowledge;
  const settingsHash = createHash('sha256').update(JSON.stringify(policy)).digest('hex');
  const lastEventId = rows[rows.length-1]?.id ?? 0;
  const cached = db().prepare('SELECT content_hash,settings_hash,last_event_id,stats_json FROM post_quality_stats WHERE post_id=?').get(postId) as { content_hash: string; settings_hash: string; last_event_id: number; stats_json: string } | undefined;
  let stats: PostQualityStats | undefined;
  if (cached?.content_hash === knowledge.content_hash && cached.settings_hash === settingsHash && cached.last_event_id === lastEventId) {
    try {
      const stored = JSON.parse(cached.stats_json) as PostQualityStats;
      if (stored.contentVersion === knowledge.content_version) stats = stored;
    } catch { /* a derived cache is always rebuildable */ }
  }
  const fresh = !stats;
  stats ??= aggregateKnowledgeAssessments(rows,knowledge.content_hash,knowledge.content_version,policy);
  const accountKey = postActorAccountKey(actor);
  const own = rows.find(row => row.evaluator === 'human' && row.purpose === 'quality' && row.actor_key === accountKey && row.content_hash === knowledge.content_hash);
  stats.ownVote = own ? { eventId: own.id,quality: own.quality,taskFit: own.task_fit,reasonCode: own.reason_code,reason: own.reason,contentHash: own.content_hash,contentVersion: own.content_version,createdAt: own.created_at } : null;
  stats.reasons = rows.filter(row => row.purpose!=='task_fit' && row.phase === 'final' && (row.public_reason || row.actor_key === accountKey) && (row.reason || row.evidence_quote || row.reason_code))
    .slice(-50).reverse().map(row => ({ eventId: row.id,evaluator: row.evaluator,quality: row.quality,reasonCode: row.reason_code,reason: row.reason,evidenceQuote: row.evidence_quote,contentVersion: row.content_version,current: row.content_hash===knowledge.content_hash,createdAt: row.created_at }));
  const publicStats = { ...stats, ownVote: null, reasons: [] };
  if (fresh) db().prepare(`INSERT INTO post_quality_stats(post_id,content_hash,policy_version,settings_hash,last_event_id,stats_json) VALUES(?,?,?,?,?,?)
    ON CONFLICT(post_id) DO UPDATE SET content_hash=excluded.content_hash,policy_version=excluded.policy_version,settings_hash=excluded.settings_hash,last_event_id=excluded.last_event_id,stats_json=excluded.stats_json,updated_at=CURRENT_TIMESTAMP`)
    .run(postId,knowledge.content_hash,policy.policyVersion,settingsHash,lastEventId,JSON.stringify(publicStats));
  return stats;
}

function announce(postId: number) { publishRuntimeEvent({ name: 'posts.changed', topic: 'posts', visibility: 'all', payload: { postId,kind: 'post' } }); }

/** Receipts describe actual server search results and retain raw private query text only for the configured period. */
export function issueKnowledgeSearchReceipts(actor: PostActor,postIds: number[],query: string): Map<number,PostKnowledgeSearchReceipt> {
  const result = new Map<number,PostKnowledgeSearchReceipt>();
  if (!isHumanPostActor(actor) || !query.trim() || !loadPostsSettings().knowledge.enabled) return result;
  const accountKey=postActorAccountKey(actor),taskKey=knowledgeSearchTaskKey(query),now=new Date().toISOString();
  const expiresAt=new Date(Date.now()+loadPostsSettings().knowledge.privateRetentionDays*86400000).toISOString();
  db().transaction(() => {
    db().prepare('DELETE FROM post_knowledge_search_receipts WHERE expires_at<=?').run(now);
    for(const postId of postIds) {
      const knowledge=findKnowledgeRow(postId);
      if(!knowledge?.enabled||knowledge.deleted_at) continue;
      requireKnowledgeRow(actor,postId);
      db().prepare(`INSERT INTO post_knowledge_search_receipts(token,post_id,content_hash,account_key,task_key,query_text,expires_at) VALUES(?,?,?,?,?,?,?)
        ON CONFLICT(account_key,post_id,content_hash,task_key) DO UPDATE SET query_text=excluded.query_text,expires_at=excluded.expires_at`)
        .run(randomUUID(),postId,knowledge.content_hash,accountKey,taskKey,query.trim(),expiresAt);
      const receipt=db().prepare('SELECT token,query_text,expires_at FROM post_knowledge_search_receipts WHERE account_key=? AND post_id=? AND content_hash=? AND task_key=?')
        .get(accountKey,postId,knowledge.content_hash,taskKey) as {token:string;query_text:string;expires_at:string};
      result.set(postId,{token:receipt.token,query:receipt.query_text,expiresAt:receipt.expires_at});
    }
  }).immediate();
  return result;
}

function requireHumanSearchReceipt(actor:PostActor,postId:number,token:unknown) {
  if(typeof token!=='string'||!token) throw new PostError('실제 검색 결과의 평가 연결 정보가 필요해.',400,'SEARCH_RECEIPT_REQUIRED');
  const receipt=db().prepare('SELECT * FROM post_knowledge_search_receipts WHERE token=? AND post_id=? AND account_key=?')
    .get(token,postId,postActorAccountKey(actor)) as {content_hash:string;task_key:string;expires_at:string}|undefined;
  if(!receipt) throw new PostError('검색 평가 연결 정보를 확인할 수 없어.',404);
  if(Date.parse(receipt.expires_at)<=Date.now()) throw new PostError('검색 평가 연결 정보가 만료됐어. 다시 검색해줘.',410);
  const knowledge=requireKnowledgeRow(actor,postId);
  if(knowledge.content_hash!==receipt.content_hash) throw new PostError('검색 이후 문서 내용이 바뀌었어. 다시 검색해줘.',409);
  return {receipt,knowledge};
}

function taskFitFeedback(row:AssessmentRow):PostTaskFitFeedback {
  return {eventId:row.id,taskFit:row.task_fit,contentVersion:row.content_version,contentHash:row.content_hash,reasonCode:row.reason_code,reason:row.reason,createdAt:row.created_at};
}

function canReadAssessment(actor:PostActor,row:AssessmentRow) {
  return row.actor_key===postActorAccountKey(actor)||(row.public_reason===1&&row.purpose!=='task_fit');
}
function auditEntry(actor:PostActor,row:AssessmentRow,currentHash:string):PostAssessmentAuditEntry {
  const latest=Boolean(db().prepare('SELECT 1 FROM post_assessment_heads WHERE logical_key=? AND event_id=?').get(row.logical_key,row.id));
  return {eventId:row.id,evaluator:row.evaluator,quality:row.quality,taskFit:row.actor_key===postActorAccountKey(actor)?row.task_fit:'unknown',contentVersion:row.content_version,
    currentContent:row.content_hash===currentHash,isLatest:latest,eventKind:row.event_kind,supersedesEventId:row.supersedes_event_id,reasonCode:row.reason_code,reason:row.reason,evidenceQuote:row.evidence_quote,
    moderationReason:row.moderation_reason,canModerate:isHumanPostActor(actor)&&(actor.isAdmin||actor.keys.has('posts.knowledge.review'))&&latest&&row.evaluator!=='human'&&row.phase==='final',createdAt:row.created_at};
}

export const KnowledgeAssessmentStore = {
  vote(actor: PostActor,postId: number,input: { contentVersion?: unknown; idempotencyKey?: unknown; quality?: unknown; taskFit?: unknown; reasonCode?: unknown; reason?: unknown; evidenceQuote?: unknown;searchReceiptToken?:unknown }) {
    requireHumanPostActor(actor); requireKey(actor,'posts.evaluate');
    if (!loadPostsSettings().knowledge.enabled) throw new PostError('지식 기능이 꺼져 있어.',409);
    if(input.reasonCode==='scope_mismatch'||input.reasonCode==='task_unsuitable') {
      KnowledgeAssessmentStore.taskFit(actor,postId,{...input,taskFit:'unsuitable'});
      return getKnowledgeQuality(actor,postId);
    }
    if(input.taskFit!==undefined&&input.taskFit!=='unknown') throw new PostError('작업 적합성은 검색 결과에 연결해 따로 평가해줘.',400,'SEARCH_RECEIPT_REQUIRED');
    db().transaction(() => {
      const knowledge = requireKnowledgeRow(actor,postId);
      if (input.contentVersion !== knowledge.content_version) throw new PostError('평가할 문서 내용이 변경됐어.',409);
      if (typeof input.idempotencyKey !== 'string' || !input.idempotencyKey.trim()) throw new PostError('평가 멱등 키가 필요해.');
      const reasonCode = typeof input.reasonCode === 'string' ? input.reasonCode.slice(0,100) : null;
      const reason = typeof input.reason === 'string' ? input.reason.slice(0,4000) : '';
      const evidence = typeof input.evidenceQuote === 'string' ? input.evidenceQuote.slice(0,4000) : '';
      if (evidence && !knowledge.post.body.includes(evidence)) throw new PostError('평가 근거가 문서 본문에 존재하지 않아.');
      const unsuitable = reasonCode === 'scope_mismatch' || reasonCode === 'task_unsuitable';
      insertKnowledgeAssessment({ postId,contentVersion: knowledge.content_version,contentHash: knowledge.content_hash,evaluator: 'human',accountKey: postActorAccountKey(actor),evaluatorFamily: 'human',rootExecutionId: null,purpose: 'quality',
        quality: unsuitable ? 'abstain' : input.quality as PostAssessmentQuality,taskFit: unsuitable ? 'unsuitable' : input.taskFit as PostAssessmentTaskFit | undefined,reasonCode,reason,evidenceQuote: evidence,publicReason: knowledge.post.status === 'published',phase: 'final',idempotencyKey: input.idempotencyKey });
      const stats = getKnowledgeQuality(actor,postId);
      if (stats.needsReview || knowledgeIssues(postId).some(issue => !issue.resolvedAt)) db().prepare("UPDATE post_knowledge SET review_status='needs_review' WHERE post_id=?").run(postId);
    }).immediate();
    announce(postId);
    return getKnowledgeQuality(actor,postId);
  },
  withdraw(actor: PostActor,postId: number,input: { contentVersion?: unknown; idempotencyKey?: unknown }) {
    return KnowledgeAssessmentStore.vote(actor,postId,{ ...input,quality: 'abstain',taskFit: 'unknown' });
  },

  ownTaskFit(actor:PostActor,postId:number,searchReceiptToken:unknown):PostTaskFitFeedback|null {
    requireHumanPostActor(actor);
    const {receipt}=requireHumanSearchReceipt(actor,postId,searchReceiptToken);
    const row=db().prepare("SELECT e.* FROM post_assessment_heads h JOIN post_assessment_events e ON e.id=h.event_id WHERE e.post_id=? AND e.actor_key=? AND e.content_hash=? AND e.evaluator='human' AND e.purpose='task_fit' AND e.task_key=?")
      .get(postId,postActorAccountKey(actor),receipt.content_hash,receipt.task_key) as AssessmentRow|undefined;
    return row?taskFitFeedback(row):null;
  },

  taskFit(actor:PostActor,postId:number,input:{contentVersion?:unknown;searchReceiptToken?:unknown;taskFit?:unknown;idempotencyKey?:unknown;reasonCode?:unknown;reason?:unknown}):PostTaskFitFeedback {
    requireHumanPostActor(actor);requireKey(actor,'posts.evaluate');
    if(!loadPostsSettings().knowledge.enabled) throw new PostError('지식 기능이 꺼져 있어.',409);
    const eventId=db().transaction(()=>{
      const {receipt,knowledge}=requireHumanSearchReceipt(actor,postId,input.searchReceiptToken);
      if(input.contentVersion!==knowledge.content_version) throw new PostError('평가할 문서 내용 판이 변경됐어.',409);
      if(!['useful','unsuitable','unknown'].includes(String(input.taskFit))||typeof input.idempotencyKey!=='string'||!input.idempotencyKey.trim()) throw new PostError('작업 적합성 평가와 멱등 키가 필요해.');
      return insertKnowledgeAssessment({postId,contentVersion:knowledge.content_version,contentHash:knowledge.content_hash,evaluator:'human',accountKey:postActorAccountKey(actor),evaluatorFamily:'human',rootExecutionId:null,purpose:'task_fit',quality:'abstain',
        taskFit:input.taskFit as PostAssessmentTaskFit,taskKey:receipt.task_key,reasonCode:typeof input.reasonCode==='string'?input.reasonCode.slice(0,100):null,reason:typeof input.reason==='string'?input.reason.slice(0,4000):'',publicReason:false,phase:'final',idempotencyKey:input.idempotencyKey});
    }).immediate();
    announce(postId);
    return taskFitFeedback(db().prepare('SELECT * FROM post_assessment_events WHERE id=?').get(eventId) as AssessmentRow);
  },

  history(actor:PostActor,postId:number,input:{offset?:unknown;limit?:unknown}={}):PostAssessmentAuditList {
    const knowledge=requireKnowledgeRow(actor,postId,{allowDeleted:true});
    const offset=Number(input.offset??0),limit=Number(input.limit??50);
    if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>100) throw new PostError('평가 이력 범위가 잘못됐어.');
    const filter="post_id=? AND (actor_key=? OR (public_reason=1 AND purpose<>'task_fit'))";
    const args=[postId,postActorAccountKey(actor)];
    const rows=db().prepare(`SELECT * FROM post_assessment_events WHERE ${filter} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...args,limit,offset) as AssessmentRow[];
    const total=(db().prepare(`SELECT COUNT(*) AS n FROM post_assessment_events WHERE ${filter}`).get(...args) as {n:number}).n;
    return {items:rows.map(row=>auditEntry(actor,row,knowledge.content_hash)),total,offset,limit};
  },

  moderate(actor:PostActor,postId:number,eventId:number,input:{action?:unknown;expectedHeadEventId?:unknown;reason?:unknown;idempotencyKey?:unknown;quality?:unknown;taskFit?:unknown}):PostAssessmentModerationResult {
    requireHumanPostActor(actor);requireKey(actor,'posts.knowledge.review');
    const reason=typeof input.reason==='string'?input.reason.trim():'';
    if(!['invalidate','correct'].includes(String(input.action))||!reason||reason.length>4000||typeof input.idempotencyKey!=='string'||!input.idempotencyKey.trim()||input.idempotencyKey.length>160)
      throw new PostError('평가 정정 동작, 구체적인 사유와 멱등 키가 필요해.');
    if(input.expectedHeadEventId!==eventId) throw new PostError('평가의 최신 이력을 확인한 뒤 정정해줘.',409);
    if(input.action==='correct'&&(!['up','down','abstain'].includes(String(input.quality))||(input.taskFit!==undefined&&!['useful','unsuitable','unknown'].includes(String(input.taskFit))))) throw new PostError('대체 평가 값이 잘못됐어.');
    const payloadHash=createHash('sha256').update(JSON.stringify([postId,eventId,input.action,reason,input.quality??null,input.taskFit??null])).digest('hex');
    const result=db().transaction(()=>{
      const knowledge=requireKnowledgeRow(actor,postId,{allowDeleted:true});
      const prior=db().prepare('SELECT payload_hash,replacement_event_id FROM post_assessment_moderations WHERE reviewer_account_key=? AND idempotency_key=?')
        .get(postActorAccountKey(actor),input.idempotencyKey) as {payload_hash:string;replacement_event_id:number}|undefined;
      if(prior) {
        if(prior.payload_hash!==payloadHash) throw new PostError('같은 멱등 키를 다른 평가 정정에 사용할 수 없어.',409);
        const replacement=db().prepare('SELECT * FROM post_assessment_events WHERE id=?').get(prior.replacement_event_id) as AssessmentRow;
        return {assessment:auditEntry(actor,replacement,knowledge.content_hash),quality:getKnowledgeQuality(actor,postId)};
      }
      const target=db().prepare('SELECT * FROM post_assessment_events WHERE id=? AND post_id=?').get(eventId,postId) as AssessmentRow|undefined;
      if(!target||!canReadAssessment(actor,target)) throw new PostError('평가 기록을 찾을 수 없어.',404);
      if(target.evaluator==='human') throw new PostError('사람의 표는 해당 사용자만 변경할 수 있어.',403);
      if(input.action==='correct'&&input.taskFit!==undefined&&target.actor_key!==postActorAccountKey(actor)) throw new PostError('다른 계정의 비공개 작업 적합성은 변경할 수 없어.',403);
      if(target.phase!=='final'||!db().prepare('SELECT 1 FROM post_assessment_heads WHERE logical_key=? AND event_id=?').get(target.logical_key,eventId)) throw new PostError('평가 의견이 이미 변경됐어. 최신 이력을 다시 확인해줘.',409);
      const replacementId=insertKnowledgeAssessment({postId,contentVersion:target.content_version,contentHash:target.content_hash,evaluator:target.evaluator,accountKey:target.actor_key,profileId:target.profile_id,
        evaluatorFamily:target.evaluator_family,rootExecutionId:target.root_execution_id,purpose:target.purpose,quality:input.action==='invalidate'?'abstain':input.quality as PostAssessmentQuality,
        taskFit:input.action==='invalidate'?'unknown':input.taskFit===undefined?target.task_fit:input.taskFit as PostAssessmentTaskFit,taskKey:target.task_key,
        reasonCode:input.action==='invalidate'?'review_invalidated':'review_corrected',reason,evidenceQuote:target.evidence_quote,phase:'final',selfAssessment:Boolean(target.self_assessment),
        evidenceSufficient:Boolean(target.evidence_sufficient),publicReason:Boolean(target.public_reason),idempotencyKey:`moderation:${randomUUID()}`,
        useId:target.use_id,requestId:target.request_id,executionStartedAt:target.execution_started_at,eventKind:input.action==='invalidate'?'invalidate':'correction',moderatorAccountKey:postActorAccountKey(actor),supersedesEventId:eventId,moderationReason:reason});
      db().prepare('INSERT INTO post_assessment_moderations(post_id,target_event_id,replacement_event_id,reviewer_account_key,action,reason,idempotency_key,payload_hash) VALUES(?,?,?,?,?,?,?,?)')
        .run(postId,eventId,replacementId,postActorAccountKey(actor),input.action,reason,input.idempotencyKey,payloadHash);
      const replacement=db().prepare('SELECT * FROM post_assessment_events WHERE id=?').get(replacementId) as AssessmentRow;
      return {assessment:auditEntry(actor,replacement,knowledge.content_hash),quality:getKnowledgeQuality(actor,postId)};
    }).immediate();
    announce(postId);
    return result;
  },
};

/** Only the server's actual query defines a reusable condition. No model-supplied task identity is trusted. */
export function knowledgeSearchTaskKey(query: string): string {
  return `query:${createHash('sha256').update(query.normalize('NFC').trim().replace(/\s+/g,' ').toLowerCase()).digest('hex')}`;
}

/** Final fit transfers only to the same account and exact query. Provisional fit stays in its current execution. */
export function knowledgeTaskFitMultiplier(actor: PostActor,postId: number,taskKey: string,currentRootExecutionId?: string): number {
  const knowledge = findKnowledgeRow(postId);
  if (!knowledge) return 1;
  const rows = db().prepare(`SELECT e.* FROM post_assessment_heads h JOIN post_assessment_events e ON e.id=h.event_id
    WHERE e.post_id=? AND e.content_hash=? AND e.actor_key=? AND e.self_assessment=0 AND e.evidence_sufficient=1
      AND ((e.evaluator='human' AND e.purpose='task_fit' AND e.task_key=? AND e.phase='final')
        OR (e.evaluator<>'human' AND e.purpose='usage' AND ((e.task_key=? AND e.phase='final') OR (e.phase='provisional' AND e.root_execution_id=? AND ? IS NOT NULL))))`)
    .all(postId,knowledge.content_hash,postActorAccountKey(actor),taskKey,taskKey,currentRootExecutionId ?? null,currentRootExecutionId ?? null) as AssessmentRow[];
  // Reuse independence/caps by projecting fit into the vote axis; never persist it as global quality.
  // Provisional opinions can affect selection in this same execution; the global quality aggregate still excludes them.
  const fit = contributions(latestAutomaticOpinions(rows,true).map(row => ({ ...row,phase: 'final',public_reason: 1,quality: row.task_fit==='useful' ? 'up' : row.task_fit==='unsuitable' ? 'down' : 'abstain' })),loadPostsSettings().knowledge);
  const smoothed = (fit.down+2)/(fit.up+fit.down+4);
  return 1-0.3*Math.max(0,2*smoothed-1);
}
