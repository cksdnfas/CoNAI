import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { ChatExecutionContext, PostKnowledgeAssessmentInput, PostKnowledgeEvidence, PostKnowledgeReference, PostKnowledgeTaskPurpose } from '@conai/shared';
import { getUserSettingsDb } from '../../../database/userSettingsDb';
import type { McpRequestContext, McpRequester } from '../../../mcp/context';
import { isRequesterAdmin, requesterPermissionKeys } from '../../../middleware/featureAccess';
import { ExternalApiProvider } from '../../../models/ExternalApiProvider';
import { ChatProfileStore } from '../../codex-chat/chatProfiles';
import { ModelSlotStore } from '../../codex-chat/modelSlots';
import { BoardCallRooms } from '../boardCallRooms';
import { PostError, requireKey, type PostActor } from '../postActor';
import { PostCommentStore, requirePostRow } from '../postStore';
import { requireKnowledgeRow } from '../knowledgeStore';
import { insertKnowledgeAssessment, knowledgeSearchTaskKey } from '../knowledgeAssessment';
import { loadPostsSettings } from '../postsSettings';
import { mergeKnowledgeIntervals } from './knowledgeUseEvidence';

const db = () => getUserSettingsDb();
export const knowledgeAccountKey = (id: number | null) => id === null ? 'local-owner' : `account:${id}`;
export const knowledgeHash = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

export interface KnowledgeExecutionContext {
  executionId: string;
  rootExecutionId: string;
  accountId: number | null;
  accountKey: string;
  profileId: number | null;
  providerName: string;
  model: string;
  evaluatorFamily: string;
  trust: 'observed_execution' | 'external_unverified';
  taskPurpose?:PostKnowledgeTaskPurpose;
}

export type KnowledgeExecutionRow = {
  execution_id: string; root_execution_id: string; account_id: number | null; account_key: string;
  profile_id: number | null; provider_name: string; model_id: string; evaluator_family: string;
  trust: KnowledgeExecutionContext['trust']; status: 'running' | 'completed' | 'failed' | 'cancelled';
  observed_outcome: 'unknown' | 'succeeded' | 'failed'; root_started_at: string;
};
export type KnowledgeUseRow = {
  id: string; token_hash: string; post_id: number; comment_id: number | null; content_version: number;
  content_hash: string; comment_revision: number | null; comment_hash: string | null;
  scope: 'body' | 'comment'; intervals_json: string; snapshot_body: string | null; task_key:string|null;
  execution_id: string; expires_at: string; evidence_expired: number;
};

export function currentKnowledgeActor(accountId: number | null, profileId: number | null = null, origin: PostActor['origin'] = 'automation'): PostActor {
  const requester: McpRequester = { accountId, accountType: null };
  return { accountId, profileId, origin, isAdmin: isRequesterAdmin(requester), keys: new Set(requesterPermissionKeys(requester)) };
}

/** Connection label/profile labels never count as separate model families. */
export function normalizedKnowledgeEvaluatorFamily(providerName: string, model: string): string {
  const provider = ExternalApiProvider.findByName(providerName);
  let endpoint='';
  if(provider?.base_url) {
    try {const url=new URL(provider.base_url);endpoint=`${url.protocol}//${url.host}${url.pathname.replace(/\/+$/,'')}`.toLowerCase();}
    catch {endpoint=knowledgeHash(provider.base_url);}
  }
  const identity = provider
    ? `${provider.provider_type}:${endpoint}`
    : providerName.trim().toLowerCase();
  return `${identity}:${model.normalize('NFC').trim().toLowerCase() || 'unspecified'}`;
}

export function knowledgeExecutionContextOf(row: KnowledgeExecutionRow): KnowledgeExecutionContext {
  return { executionId: row.execution_id, rootExecutionId: row.root_execution_id, accountId: row.account_id,
    accountKey: row.account_key, profileId: row.profile_id, providerName: row.provider_name, model: row.model_id,
    evaluatorFamily: row.evaluator_family, trust: row.trust };
}

/** Called only with server-issued context/facts. Tool arguments cannot supply execution or identity. */
export function knowledgeExecutionFromMcp(context: McpRequestContext, facts: {
  rootExecutionId?: string; executionId?: string; providerName?: string; model?: string;
} = {}): KnowledgeExecutionContext {
  if (!context.requester) throw new PostError('계정에 연결된 실행에서만 지식 참조를 기록할 수 있어.', 403);
  const accountId = context.requester.accountId;
  const accountKey = knowledgeAccountKey(accountId);
  const chat = context.chatContext;
  if (!chat) {
    if (!context.keyId) throw new PostError('서버 MCP 키 실행을 확인할 수 없어.', 403);
    // No external completion signal or authenticated model identity is available.
    const id = `mcp:${knowledgeHash(context.keyId)}:${new Date().toISOString().slice(0, 10)}`;
    return { executionId: id, rootExecutionId: id, accountId, accountKey, profileId: null,
      providerName: 'external-mcp', model: 'unverified', evaluatorFamily: 'external-mcp:unverified', trust: 'external_unverified' };
  }
  const thread = db().prepare('SELECT account_id FROM codex_chat_threads WHERE id = ?').get(chat.threadId) as { account_id: number | null } | undefined;
  if (!thread || thread.account_id !== accountId || !chat.replyId) throw new PostError('지식 참조 실행의 소유자 또는 응답을 확인할 수 없어.', 403);
  const executionId = facts.executionId ?? chat.knowledgeExecutionId ?? `chat:${chat.threadId}:reply:${chat.replyId}`;
  const existing = db().prepare('SELECT * FROM post_knowledge_executions WHERE execution_id = ?').get(executionId) as KnowledgeExecutionRow | undefined;
  if (existing) {
    if (existing.account_key !== accountKey || existing.profile_id !== chat.profileId) throw new PostError('다른 실행의 참조야.', 403);
    return {...knowledgeExecutionContextOf(existing),...(chat.knowledgeTaskPurpose?{taskPurpose:chat.knowledgeTaskPurpose}:{})};
  }
  const profile = ChatProfileStore.find(chat.profileId);
  if (!profile) throw new PostError('실행 프로필을 찾을 수 없어.', 404);
  const target = ModelSlotStore.target(profile.modelSlotId);
  const providerName = facts.providerName ?? chat.knowledgeProvider ?? target?.providerName ?? profile.engine;
  const model = facts.model ?? chat.knowledgeModel ?? target?.model ?? (profile.model.trim() || 'unspecified');
  let rootExecutionId = facts.rootExecutionId ?? (chat as ChatExecutionContext & { rootExecutionId?: string }).rootExecutionId;
  const boardRunId = BoardCallRooms.runFor(chat.threadId, chat.profileId);
  if (boardRunId) {
    const run = db().prepare('SELECT chain_root_comment_id, run_as_account_id FROM post_bot_runs WHERE id = ?').get(boardRunId) as { chain_root_comment_id: number | null; run_as_account_id: number | null } | undefined;
    if (run && run.run_as_account_id === accountId && run.chain_root_comment_id) rootExecutionId = `board:comment:${run.chain_root_comment_id}`;
  }
  if (!rootExecutionId) {
    const response = db().prepare(`SELECT id FROM codex_chat_messages WHERE thread_id = ? AND json_valid(routing)
      AND json_extract(routing,'$.replyId') = ? ORDER BY id LIMIT 1`).get(chat.threadId, chat.replyId) as { id: number } | undefined;
    const source = db().prepare(`SELECT id FROM codex_chat_messages WHERE thread_id = ? AND role = 'user' AND id < ? ORDER BY id DESC LIMIT 1`)
      .get(chat.threadId, response?.id ?? Number.MAX_SAFE_INTEGER) as { id: number } | undefined;
    rootExecutionId = source ? `chat:${chat.threadId}:user:${source.id}` : `chat:${chat.threadId}:reply:${chat.replyId}`;
  }
  return { executionId, rootExecutionId, accountId, accountKey, profileId: profile.id, providerName, model,
    evaluatorFamily: normalizedKnowledgeEvaluatorFamily(providerName, model), trust: 'observed_execution',...(chat.knowledgeTaskPurpose?{taskPurpose:chat.knowledgeTaskPurpose}:{}) };
}

export function knowledgeExecutionFromChat(requester: McpRequester, chatContext: ChatExecutionContext): KnowledgeExecutionContext {
  return knowledgeExecutionFromMcp({ requester, chatContext, source: 'llm-chat', scopes: ['read', 'organize'] });
}

export function requireKnowledgeExecution(context: KnowledgeExecutionContext): KnowledgeExecutionRow {
  const row = db().prepare('SELECT * FROM post_knowledge_executions WHERE execution_id = ?').get(context.executionId) as KnowledgeExecutionRow | undefined;
  if (!row || row.account_key !== context.accountKey || row.profile_id !== context.profileId || row.root_execution_id !== context.rootExecutionId
    || row.evaluator_family !== context.evaluatorFamily || row.model_id !== context.model || row.trust !== context.trust) throw new PostError('실행 참조의 서버 맥락이 일치하지 않아.', 403);
  return row;
}

export function ensureKnowledgeExecution(context: KnowledgeExecutionContext): KnowledgeExecutionRow {
  if (context.accountKey !== knowledgeAccountKey(context.accountId) || !context.executionId || !context.rootExecutionId) throw new PostError('잘못된 실행 맥락이야.', 403);
  const first = db().prepare('SELECT MIN(root_started_at) AS started_at FROM post_knowledge_executions WHERE root_execution_id = ? AND account_key = ?')
    .get(context.rootExecutionId, context.accountKey) as { started_at: string | null };
  db().prepare(`INSERT INTO post_knowledge_executions
    (execution_id,root_execution_id,account_key,account_id,profile_id,provider_name,model_id,evaluator_family,trust,root_started_at)
    VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(execution_id) DO NOTHING`).run(context.executionId,context.rootExecutionId,context.accountKey,context.accountId,context.profileId,
      context.providerName,context.model,context.evaluatorFamily,context.trust,first.started_at ?? new Date().toISOString());
  const execution=requireKnowledgeExecution(context);
  if(context.trust==='observed_execution'&&context.taskPurpose?.source==='human_order') {
    db().prepare(`INSERT INTO post_knowledge_tasks(execution_id,purpose_kind,condition_key,expires_at) VALUES(?,?,?,?) ON CONFLICT(execution_id) DO NOTHING`)
      .run(context.executionId,context.taskPurpose.kind,context.taskPurpose.conditionKey,new Date(Date.now()+loadPostsSettings().knowledge.privateRetentionDays*86_400_000).toISOString());
  }
  return execution;
}

/** Reusable fit requires the same actual server search and, when known, the same human order category. */
export function knowledgeTaskConditionKey(context:KnowledgeExecutionContext,query:string):string {
  const task=db().prepare('SELECT condition_key FROM post_knowledge_tasks WHERE execution_id=?').get(context.executionId) as {condition_key:string}|undefined;
  const purposeKey=context.taskPurpose?.conditionKey??task?.condition_key;
  const queryKey=knowledgeSearchTaskKey(query);
  return purposeKey?`query:${knowledgeHash(`${queryKey}:${purposeKey}`)}`:queryKey;
}

/** Search summaries are task conditions only. They never create a read receipt or an assessment. */
export function recordKnowledgeSearch(context:KnowledgeExecutionContext,query:string,postIds:number[]):void {
  if(!loadPostsSettings().knowledge.enabled||!query.trim()) return;
  const actor=currentKnowledgeActor(context.accountId,context.profileId,context.trust==='observed_execution'?'chat':'mcp');
  requireKey(actor,'posts.view');
  const taskKey=knowledgeTaskConditionKey(context,query);
  db().transaction(()=>{
    const execution=ensureKnowledgeExecution(context);
    if(execution.status!=='running') return;
    for(const postId of [...new Set(postIds)]) {
      try {
        const knowledge=requireKnowledgeRow(actor,postId);
        if(!knowledge.enabled||knowledge.deleted_at) continue;
        db().prepare(`INSERT INTO post_knowledge_searches(execution_id,post_id,task_key) VALUES(?,?,?)
          ON CONFLICT(execution_id,post_id) DO UPDATE SET task_key=excluded.task_key,created_at=CURRENT_TIMESTAMP`).run(context.executionId,postId,taskKey);
      } catch(error) {if(!(error instanceof PostError)||![403,404].includes(error.status)) throw error;}
    }
  }).immediate();
}

export function recordKnowledgeUse(actor: PostActor, input: {
  postId: number; commentId?: number | null; body: string; intervals: Array<{ start: number; end: number }>; execution: KnowledgeExecutionContext;
}): PostKnowledgeReference | null {
  if (!loadPostsSettings().knowledge.enabled) return null;
  requireKey(actor, 'posts.view');
  if (actor.accountId !== input.execution.accountId || actor.profileId !== input.execution.profileId) throw new PostError('조회 실행자가 일치하지 않아.', 403);
  const current = requirePostRow(actor, input.postId);
  // Ordinary board reads keep their existing contract and cannot accidentally create knowledge votes.
  const knowledge = db().prepare('SELECT enabled FROM post_knowledge WHERE post_id = ?').get(input.postId) as { enabled: number } | undefined;
  if (!knowledge?.enabled) return null;
  const version = requireKnowledgeRow(actor, input.postId);
  const comment = input.commentId ? PostCommentStore.get(actor, input.commentId) : null;
  if (comment && comment.postId !== input.postId) throw new PostError('댓글이 해당 문서에 속하지 않아.', 400);
  const original = comment?.body ?? current.body;
  if (!Array.isArray(input.intervals) || !input.intervals.length || input.intervals.length > 20) throw new PostError('반환 원문 구간이 필요해.');
  let previousEnd = -1;
  const intervals = input.intervals.map(({ start, end }) => {
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start || end > original.length || start < previousEnd) throw new PostError('원문 반환 구간이 잘못됐어.');
    previousEnd = end;
    return { start, end };
  });
  if (intervals.map(({ start, end }) => original.slice(start, end)).join('') !== input.body) throw new PostError('실제 반환된 원문과 참조 기록이 달라.', 409);
  const token = randomBytes(32).toString('base64url');
  const id = randomUUID();
  const expiresAt = new Date(Date.now() + loadPostsSettings().knowledge.privateRetentionDays * 86_400_000).toISOString();
  db().transaction(() => {
    const execution = ensureKnowledgeExecution(input.execution);
    if (execution.status !== 'running') throw new PostError('이미 종료된 실행이야.', 409);
    const search=db().prepare('SELECT task_key FROM post_knowledge_searches WHERE execution_id=? AND post_id=?').get(input.execution.executionId,input.postId) as {task_key:string}|undefined;
    db().prepare(`INSERT INTO post_knowledge_uses (id,token_hash,post_id,comment_id,content_version,content_hash,comment_revision,comment_hash,scope,intervals_json,snapshot_body,task_key,execution_id,expires_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id,knowledgeHash(token),input.postId,comment?.id ?? null,version.content_version,version.content_hash,comment?.revision ?? null,
      comment ? knowledgeHash(comment.body) : null,comment ? 'comment' : 'body',JSON.stringify(intervals),original,search?.task_key??null,input.execution.executionId,expiresAt);
  }).immediate();
  return { useId: id, referenceToken: token, postId: input.postId, commentId: comment?.id ?? null, contentVersion: version.content_version,
    contentHash: version.content_hash, intervals, scope: comment ? 'comment' : 'body', trust: input.execution.trust, expiresAt };
}

export function validateKnowledgeEvidence(use: KnowledgeUseRow, evidence: unknown): PostKnowledgeEvidence[] {
  if (use.evidence_expired || !use.snapshot_body || Date.parse(use.expires_at) <= Date.now()) throw new PostError('참조 원문 보관 기간이 끝났어.', 410);
  if (!Array.isArray(evidence) || evidence.length > loadPostsSettings().knowledge.maxSegmentsPerDocument) throw new PostError('근거 구간이 잘못됐어.');
  const intervals = JSON.parse(use.intervals_json) as Array<{ start: number; end: number }>;
  return evidence.map((value) => {
    const item = value as PostKnowledgeEvidence;
    if (!item || item.scope !== use.scope || !Number.isSafeInteger(item.start) || !Number.isSafeInteger(item.end)
      || item.end <= item.start || typeof item.quote !== 'string' || !item.quote || item.quote.length > 4000
      || !intervals.some((interval) => interval.start <= item.start && interval.end >= item.end)
      || use.snapshot_body?.slice(item.start,item.end) !== item.quote) throw new PostError('근거가 실제 반환된 원문 구간에 없어.', 400);
    return { scope: item.scope, start: item.start, end: item.end, quote: item.quote };
  });
}

function normalizeAssessment(input: PostKnowledgeAssessmentInput, use: KnowledgeUseRow): PostKnowledgeAssessmentInput {
  if (!['provisional','final'].includes(input.stage) || !['up','down','abstain'].includes(input.quality)
    || !['useful','unsuitable','unknown'].includes(input.taskFit)
    || !['error','outdated','insufficient_evidence','reproduction_failed','helpful','scope_mismatch','uncertain'].includes(input.reasonCode)
    || typeof input.idempotencyKey !== 'string' || !input.idempotencyKey.trim() || input.idempotencyKey.length > 160) throw new PostError('평가 계약이 잘못됐어.');
  const evidence = validateKnowledgeEvidence(use,input.evidence);
  if ((input.quality !== 'abstain' || input.taskFit !== 'unknown') && !evidence.length) throw new PostError('추천과 적합성 평가에는 실제 원문 근거가 필요해.');
  if (input.reasonCode === 'scope_mismatch' && input.quality !== 'abstain') throw new PostError('작업 범위 불일치는 문서 품질 비추천이 아니야.');
  if (['insufficient_evidence','uncertain'].includes(input.reasonCode) && input.quality !== 'abstain') throw new PostError('근거가 불충분하면 기권해줘.');
  if ((input.quality==='up'&&input.reasonCode!=='helpful')||(input.quality==='down'&&!['error','outdated','reproduction_failed'].includes(input.reasonCode))) throw new PostError('문서 품질 평가와 근거 이유가 맞지 않아.');
  return { useId: input.useId, referenceToken: input.referenceToken, stage: input.stage, quality: input.quality, taskFit: input.taskFit,
    reasonCode: input.reasonCode, evidence, idempotencyKey: input.idempotencyKey.trim() };
}

function commitUseAssessment(use: KnowledgeUseRow, execution: KnowledgeExecutionRow, input: PostKnowledgeAssessmentInput, id: string): number {
  const actor = currentKnowledgeActor(execution.account_id,execution.profile_id);
  requireKey(actor,'posts.view'); requireKey(actor,'posts.evaluate');
  const post = requirePostRow(actor,use.post_id);
  const knowledge=requireKnowledgeRow(actor,use.post_id);
  if(post.status==='hidden'||!knowledge.enabled) throw new PostError('평가할 지식 문서가 현재 사용 가능하지 않아.',404);
  const version=db().prepare('SELECT post_status FROM post_knowledge_versions WHERE post_id=? AND content_version=?').get(use.post_id,use.content_version) as {post_status:string}|undefined;
  const publicDocument=post.status==='published'&&(version?.post_status==='published'||knowledge.content_hash===use.content_hash);
  if (use.comment_id&&PostCommentStore.get(actor,use.comment_id).status!=='visible') throw new PostError('평가할 댓글이 현재 공개되지 않아.',404);
  const self = execution.profile_id !== null && post.author_profile_id === execution.profile_id;
  const endedNormally = execution.trust === 'observed_execution' && execution.status === 'completed';
  const phase = input.stage === 'final' && (execution.status !== 'running' || execution.trust === 'external_unverified') ? 'final' : 'provisional';
  const outcomeNeeded = input.reasonCode === 'helpful' || input.reasonCode === 'reproduction_failed';
  const outcomeConfirmed = input.reasonCode === 'helpful' ? execution.observed_outcome === 'succeeded'
    : input.reasonCode === 'reproduction_failed' ? execution.observed_outcome === 'failed' : true;
  const sufficientlyGrounded = input.evidence.length > 0 && execution.model_id !== 'unspecified' && execution.trust === 'observed_execution'
    && (!outcomeNeeded || outcomeConfirmed) && (phase === 'provisional' || endedNormally);
  const failed = phase === 'final' && !endedNormally;
  return insertKnowledgeAssessment({ postId: use.post_id,contentVersion: use.content_version,contentHash: use.content_hash,evaluator:'use_ai',
    accountKey: execution.account_key,profileId: execution.profile_id,evaluatorFamily: execution.evaluator_family,rootExecutionId: execution.root_execution_id,
    purpose:use.scope==='comment'?`comment_usage:${use.comment_id}`:'usage',quality: failed || use.scope === 'comment' || !sufficientlyGrounded ? 'abstain' : input.quality,
    taskFit: failed ? 'unknown' : input.taskFit,reasonCode: failed ? execution.status : input.reasonCode,phase,selfAssessment:self,
    evidenceSufficient: sufficientlyGrounded,publicReason: use.scope === 'body' && publicDocument,evidenceQuote: input.evidence.map((e) => e.quote).join('\n').slice(0,1000),
    reason: '',idempotencyKey:`use:${id}:${phase}`,useId:use.id,taskKey:use.task_key??execution.root_execution_id,executionStartedAt:execution.root_started_at });
}

export function submitKnowledgeAssessment(actor: PostActor, executionContext: KnowledgeExecutionContext, input: PostKnowledgeAssessmentInput): { assessmentId: string; phase: 'provisional' | 'final'; eventId: number } {
  requireKey(actor,'posts.evaluate');
  if(!loadPostsSettings().knowledge.enabled) throw new PostError('지식 기능이 꺼져 있어.',409);
  if (actor.accountId !== executionContext.accountId || actor.profileId !== executionContext.profileId) throw new PostError('평가 실행자가 일치하지 않아.',403);
  return db().transaction(() => {
    const execution = requireKnowledgeExecution(executionContext);
    const use = db().prepare('SELECT * FROM post_knowledge_uses WHERE id = ?').get(input.useId) as KnowledgeUseRow | undefined;
    const submittedHash = typeof input.referenceToken === 'string' ? knowledgeHash(input.referenceToken) : '';
    if (!use || use.execution_id !== execution.execution_id || submittedHash.length !== use.token_hash.length
      || !timingSafeEqual(Buffer.from(submittedHash),Buffer.from(use.token_hash))) throw new PostError('서버 참조 토큰 또는 실행이 일치하지 않아.',403);
    const normalized = normalizeAssessment(input,use);
    const payload = JSON.stringify({ ...normalized,referenceToken:undefined });
    const hash = knowledgeHash(payload);
    const existing = db().prepare('SELECT id,payload_hash,event_id FROM post_knowledge_use_assessments WHERE use_id = ? AND idempotency_key = ?')
      .get(use.id,normalized.idempotencyKey) as { id:string;payload_hash:string;event_id:number } | undefined;
    if (existing) {
      if (existing.payload_hash !== hash) throw new PostError('같은 멱등 키로 다른 평가를 제출했어.',409);
      return { assessmentId:existing.id,phase:normalized.stage === 'final' && execution.status !== 'running' ? 'final' as const : 'provisional' as const,eventId:existing.event_id };
    }
    const id = randomUUID();
    const eventId = commitUseAssessment(use,execution,normalized,id);
    db().prepare(`INSERT INTO post_knowledge_use_assessments (id,use_id,stage,payload_json,idempotency_key,payload_hash,event_id) VALUES (?,?,?,?,?,?,?)`)
      .run(id,use.id,normalized.stage,payload,normalized.idempotencyKey,hash,eventId);
    return { assessmentId:id,phase:normalized.stage === 'final' && (execution.status !== 'running' || execution.trust === 'external_unverified') ? 'final' as const : 'provisional' as const,eventId };
  }).immediate();
}

/** Completion is observable server status; an assistant's successful response is never a successful procedure. */
export function finishKnowledgeExecution(context: KnowledgeExecutionContext, result: {
  status: 'completed' | 'failed' | 'cancelled'; observedOutcome?: 'unknown' | 'succeeded' | 'failed';
}): void {
  if (context.trust !== 'observed_execution') return;
  db().transaction(() => {
    const row = db().prepare('SELECT * FROM post_knowledge_executions WHERE execution_id = ?').get(context.executionId) as KnowledgeExecutionRow | undefined;
    if (!row) return; // No documents were read.
    const execution = requireKnowledgeExecution(context);
    if (execution.status !== 'running') return;
    db().prepare(`UPDATE post_knowledge_executions SET status = ?,observed_outcome = ?,finished_at = CURRENT_TIMESTAMP WHERE execution_id = ? AND status = 'running'`)
      .run(result.status,result.status === 'completed' ? result.observedOutcome ?? 'unknown' : 'unknown',context.executionId);
    execution.status = result.status;
    execution.observed_outcome = result.status === 'completed' ? result.observedOutcome ?? 'unknown' : 'unknown';
    const uses = db().prepare('SELECT * FROM post_knowledge_uses WHERE execution_id = ? ORDER BY created_at,id').all(context.executionId) as KnowledgeUseRow[];
    const finalAssessments=db().prepare(`SELECT a.id,a.use_id,a.payload_json FROM post_knowledge_use_assessments a JOIN post_knowledge_uses u ON u.id=a.use_id
      WHERE u.execution_id=? AND a.stage='final' ORDER BY a.rowid`).all(context.executionId) as Array<{id:string;use_id:string;payload_json:string}>;
    for (const final of loadPostsSettings().knowledge.enabled?finalAssessments:[]) {
      const use=uses.find(item=>item.id===final.use_id);
      if (use) {
        try {
          const eventId = commitUseAssessment(use,execution,JSON.parse(final.payload_json) as PostKnowledgeAssessmentInput,final.id);
          db().prepare('UPDATE post_knowledge_use_assessments SET event_id = ? WHERE id = ?').run(eventId,final.id);
        } catch (error) { if (!(error instanceof PostError) || ![403,404,410].includes(error.status)) throw error; }
      }
    }
    if (result.status === 'completed' && loadPostsSettings().knowledge.enabled&&loadPostsSettings().knowledge.autoEvaluationEnabled) queueRootUseReviews(execution);
  }).immediate();
}

function queueRootUseReviews(execution:KnowledgeExecutionRow):void {
  const settings=loadPostsSettings().knowledge;
  const rows=db().prepare(`SELECT u.*,t.purpose_kind FROM post_knowledge_uses u JOIN post_knowledge_executions e ON e.execution_id=u.execution_id
    LEFT JOIN post_knowledge_tasks t ON t.execution_id=e.execution_id WHERE e.root_execution_id=? AND e.account_key=? AND e.status='completed'
    AND e.trust='observed_execution' AND u.scope='body' AND u.evidence_expired=0 AND datetime(u.expires_at)>datetime('now') ORDER BY u.created_at,u.id`)
    .all(execution.root_execution_id,execution.account_key) as Array<KnowledgeUseRow&{purpose_kind:string|null}>;
  const groups=new Map<string,typeof rows>();
  for(const use of rows) {
    const key=JSON.stringify([use.execution_id,use.post_id,use.content_version,use.content_hash,use.task_key,use.purpose_kind]);
    const group=groups.get(key)??[];group.push(use);groups.set(key,group);
  }
  const docs=new Set((db().prepare("SELECT DISTINCT post_id FROM post_evaluation_requests WHERE root_execution_id=? AND requester_account_key=? AND purpose='use_review'")
    .all(execution.root_execution_id,execution.account_key) as Array<{post_id:number}>).map(row=>row.post_id));
  const coverage=(receiptRows:KnowledgeUseRow[])=>{
    let remaining=settings.maxInputCharacters;
    return JSON.stringify(mergeKnowledgeIntervals(receiptRows.flatMap(use=>JSON.parse(use.intervals_json) as Array<{start:number;end:number}>))
      .slice(0,settings.maxSegmentsPerDocument).map(interval=>{const end=Math.min(interval.end,interval.start+remaining);remaining-=end-interval.start;return {start:interval.start,end};}).filter(interval=>interval.end>interval.start));
  };
  for(const [key,group] of groups) {
    const use=group[0];
    if(!docs.has(use.post_id)&&docs.size>=settings.maxDocumentsPerExecution) continue;
    if(group.some(item=>db().prepare("SELECT 1 FROM post_knowledge_use_assessments WHERE use_id=? AND stage='final'").get(item.id))) continue;
    const unique=`use:${knowledgeHash(JSON.stringify([execution.account_key,execution.root_execution_id,key]))}`;
    const before=db().prepare('SELECT id,status FROM post_evaluation_requests WHERE unique_key=?').get(unique) as {id:string;status:string}|undefined;
    const previous=before?(db().prepare('SELECT u.* FROM post_evaluation_request_uses r JOIN post_knowledge_uses u ON u.id=r.use_id WHERE r.request_id=?').all(before.id) as KnowledgeUseRow[]):[];
    const id=before?.id??randomUUID();
    db().prepare(`INSERT INTO post_evaluation_requests (id,unique_key,post_id,content_version,content_hash,use_id,execution_id,task_key,purpose,requester_account_id,requester_account_key,root_execution_id,root_started_at)
      VALUES (?,?,?,?,?,?,?,?,'use_review',?,?,?,?) ON CONFLICT(unique_key) DO NOTHING`).run(id,unique,use.post_id,use.content_version,use.content_hash,use.id,use.execution_id,use.task_key,
        execution.account_id,execution.account_key,execution.root_execution_id,execution.root_started_at);
    for(const item of group) db().prepare('INSERT OR IGNORE INTO post_evaluation_request_uses(request_id,use_id) VALUES(?,?)').run(id,item.id);
    if(before&&coverage(previous)!==coverage(group)) {
      db().prepare(`UPDATE post_evaluation_requests SET evidence_revision=evidence_revision+1,
        status=CASE WHEN status='completed' THEN 'queued' ELSE status END,retry_base_attempt=CASE WHEN status='completed' THEN attempts ELSE retry_base_attempt END,
        retry_after=CASE WHEN status='completed' THEN NULL ELSE retry_after END,finished_at=CASE WHEN status='completed' THEN NULL ELSE finished_at END WHERE id=?`).run(id);
    }
    docs.add(use.post_id);
  }
}
