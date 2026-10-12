import { createHash } from 'node:crypto';
import { TOPIC_EVALUATION_LIMITS, type ContentEvaluationSettings, type ContentEvaluationTopic } from '@conai/shared';
import { getUserSettingsDb } from '../../database/userSettingsDb';
import { MODEL_CONNECTION_TYPES, ModelSlotStore, type ModelTarget } from '../codex-chat/modelSlots';
import { isJudgeConnectionReady } from '../judge/judgeEngine';
import { publishRuntimeEvent } from '../runtime-events/runtimeEventBus';

export class ContentEvaluationError extends Error {
  constructor(message: string, readonly statusCode = 400) { super(message); }
}
type SettingsRow = { revision: number; definition_version: number; model_slot_id: number | null; topics_json: string };
export const evaluationHash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const evaluationModelKey = (model: ModelTarget | null) => evaluationHash(model ? [model.id, model.providerName, model.model] : null);

export function loadContentEvaluationSettings(): ContentEvaluationSettings {
  const row = getUserSettingsDb().prepare('SELECT * FROM content_evaluation_settings WHERE id=1').get() as SettingsRow;
  return { revision: row.revision, definitionVersion: row.definition_version, modelSlotId: row.model_slot_id,
    topics: JSON.parse(row.topics_json) as ContentEvaluationTopic[], modelReady: false };
}
export function contentEvaluationStatus(): ContentEvaluationSettings {
  const settings = loadContentEvaluationSettings();
  const model = ModelSlotStore.target(settings.modelSlotId);
  return { ...settings, modelReady: Boolean(model && isJudgeConnectionReady(model.providerName, model.model)) };
}

export function updateContentEvaluationSettings(value: unknown): ContentEvaluationSettings {
  const input = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const db = getUserSettingsDb();
  db.transaction(() => {
    const current = loadContentEvaluationSettings();
    if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision !== current.revision) throw new ContentEvaluationError('평가 설정이 다른 곳에서 바뀌었어. 다시 불러와줘.', 409);
    if (!Array.isArray(input.topics) || input.topics.length > TOPIC_EVALUATION_LIMITS.totalTopics) throw new ContentEvaluationError('평가 주제 목록이 잘못됐어.');
    const ids = new Set<string>(), names = new Set<string>();
    const topics = input.topics.map((raw: unknown): ContentEvaluationTopic => {
      const topic = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
      const id = typeof topic.id === 'string' ? topic.id : '';
      const name = typeof topic.name === 'string' ? topic.name.normalize('NFC').trim() : '';
      const description = typeof topic.description === 'string' ? topic.description.normalize('NFC').trim() : '';
      if (!/^[A-Za-z0-9_-]{1,80}$/.test(id) || ids.has(id)) throw new ContentEvaluationError('평가 주제 ID가 잘못됐거나 중복됐어.');
      if (!name || name.length > TOPIC_EVALUATION_LIMITS.nameCharacters || names.has(name.toLocaleLowerCase())) throw new ContentEvaluationError('주제 이름은 서로 달라야 하고 1~40자로 입력해줘.');
      if (!description || description.length > TOPIC_EVALUATION_LIMITS.descriptionCharacters || typeof topic.enabled !== 'boolean') throw new ContentEvaluationError('판단 기준은 1~1000자로 입력하고 사용 여부를 골라줘.');
      ids.add(id); names.add(name.toLocaleLowerCase());
      return { id, name, description, enabled: topic.enabled };
    });
    if (current.topics.some(topic => !ids.has(topic.id))) throw new ContentEvaluationError('기존 주제는 삭제 대신 사용을 중지해줘.');
    if (topics.filter(topic => topic.enabled).length > TOPIC_EVALUATION_LIMITS.activeTopics) throw new ContentEvaluationError('활성 평가 주제는 최대 20개야.');
    let modelSlotId: number | null = null;
    if (input.modelSlotId !== null) {
      if (!Number.isSafeInteger(input.modelSlotId)) throw new ContentEvaluationError('판단 모델을 다시 골라줘.');
      try { modelSlotId = ModelSlotStore.checked(input.modelSlotId, MODEL_CONNECTION_TYPES); }
      catch { throw new ContentEvaluationError('판단 모델을 찾을 수 없어. 기존 연결에서 다시 골라줘.'); }
    }
    const semantic = (slot: number | null, list: ContentEvaluationTopic[]) => evaluationHash({ modelSlotId: slot, topics: [...list].sort((a,b) => a.id.localeCompare(b.id)) });
    const changed = semantic(modelSlotId, topics) !== semantic(current.modelSlotId, current.topics);
    const version = current.definitionVersion + (changed ? 1 : 0);
    db.prepare('UPDATE content_evaluation_settings SET revision=revision+1,definition_version=?,model_slot_id=?,topics_json=? WHERE id=1')
      .run(version, modelSlotId, JSON.stringify(topics));
    if (changed) db.prepare('INSERT INTO content_evaluation_versions(version,definition_json) VALUES(?,?)').run(version, JSON.stringify({ modelSlotId, topics }));
    if (changed) db.prepare("UPDATE post_topic_evaluation_requests SET status='superseded',reason_code='definition_changed',lease_token=NULL,lease_until=NULL,finished_at=? WHERE status IN ('queued','running')").run(new Date().toISOString());
  }).immediate();
  publishRuntimeEvent({ name: 'posts.changed', topic: 'posts', visibility: 'all', payload: { postId: null, kind: 'post' } });
  return contentEvaluationStatus();
}
