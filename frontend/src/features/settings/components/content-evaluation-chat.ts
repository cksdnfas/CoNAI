import { TOPIC_EVALUATION_LIMITS, type ChatPageData, type ContentEvaluationSettings, type ContentEvaluationTopic } from '@conai/shared'
import type { useI18n } from '../../../i18n'
import type { ModelSlot } from '../../../lib/api-codex-chat'
import { pageAction, pageChoice, pageFreeText, pageObject, pageText } from '../../codex-chat/page-action-helpers'
import { createRandomUuid } from '../../../lib/random-uuid'

type Translate = ReturnType<typeof useI18n>['t']
export type ContentEvaluationDraftPatch = Partial<Pick<ContentEvaluationSettings, 'modelSlotId' | 'topics'>>
export const contentEvaluationAuthored = (value: Pick<ContentEvaluationSettings, 'modelSlotId' | 'topics'>) => JSON.stringify({ modelSlotId: value.modelSlotId, topics: value.topics })

/** The connected view carries names and criteria, never connection addresses or credentials. */
export function contentEvaluationChatData(draft: ContentEvaluationSettings, models: ModelSlot[]): Record<string, ChatPageData> {
  return {
    view: 'content-evaluation', modelReady: draft.modelReady, definitionVersion: draft.definitionVersion,
    activeLimit: TOPIC_EVALUATION_LIMITS.activeTopics, totalLimit: TOPIC_EVALUATION_LIMITS.totalTopics,
    models: models.slice(0, 512).map(model => ({ id: model.id, connection: pageFreeText(model.providerLabel), model: pageFreeText(model.model), ...(model.ready === undefined ? {} : { ready: model.ready }) })),
    topics: draft.topics.map(topic => ({ ...topic, name: pageFreeText(topic.name), description: pageFreeText(topic.description) })),
  }
}

export function contentEvaluationChatActions(t: Translate) {
  return [
    pageAction('resource.open', t({ ko: '평가 주제 편집기 열기', en: 'Open a topic editor' }), t({ ko: 'topicId는 data.topics의 ID. 비우면 새 주제 편집기를 열어.', en: 'Use an id from data.topics; omit topicId to open a new topic.' }), pageObject({ topicId: pageText(80) })),
    pageAction('settings.content_topic', t({ ko: '평가 주제 초안 변경', en: 'Change a topic draft' }), t({ ko: 'add는 name·description으로 추가. update/disable은 topicId로 변경·사용 중지. 화면의 초안만 바꿔. 저장은 settings.save로 요청해.', en: 'add: name and description. update/disable: topicId. Changes only the draft; request settings.save to persist.' }), pageObject({
      operation: pageChoice(['add', 'update', 'disable']), topicId: pageText(80), name: pageText(40), description: pageText(1000), enabled: { type: 'boolean' },
    }, ['operation'])),
    pageAction('settings.save', t({ ko: '주제 관련도 설정 저장', en: 'Save topic relevance settings' }), t({ ko: '지금 주제 관련도 초안의 모델·주제·기준을 저장해.', en: 'Save the model, topics and criteria in the current content evaluation draft.' }), undefined, 'save'),
  ]
}

/** Keep stable ids and archived topics, matching the native form and the server's validation. */
export function putContentEvaluationTopic(topics: ContentEvaluationTopic[], topic: ContentEvaluationTopic): ContentEvaluationTopic[] {
  const next = { ...topic, name: topic.name.normalize('NFC').trim(), description: topic.description.normalize('NFC').trim() }
  if (!next.name || next.name.length > TOPIC_EVALUATION_LIMITS.nameCharacters || !next.description || next.description.length > TOPIC_EVALUATION_LIMITS.descriptionCharacters) throw new Error('주제 이름은 1~40자, 판단 기준은 1~1000자로 입력해줘.')
  if (topics.some(item => item.id !== next.id && item.name.normalize('NFC').trim().toLocaleLowerCase() === next.name.toLocaleLowerCase())) throw new Error('같은 이름의 주제가 있어.')
  const updated = topics.some(item => item.id === next.id) ? topics.map(item => item.id === next.id ? next : item) : [...topics, next]
  if (updated.length > TOPIC_EVALUATION_LIMITS.totalTopics || updated.filter(item => item.enabled).length > TOPIC_EVALUATION_LIMITS.activeTopics) throw new Error('평가 주제는 전체 100개, 활성 20개까지 사용할 수 있어.')
  return updated
}

export function contentEvaluationTopicPatch(topics: ContentEvaluationTopic[], args: Record<string, ChatPageData>): ContentEvaluationDraftPatch {
  if (args.operation === 'add') {
    if (typeof args.name !== 'string' || typeof args.description !== 'string') throw new Error('새 주제의 이름과 판단 기준이 필요해.')
    return { topics: putContentEvaluationTopic(topics, { id: createRandomUuid(), name: args.name, description: args.description, enabled: typeof args.enabled === 'boolean' ? args.enabled : topics.filter(item => item.enabled).length < TOPIC_EVALUATION_LIMITS.activeTopics }) }
  }
  const topic = topics.find(item => item.id === args.topicId)
  if (!topic) throw new Error('목록에 없는 평가 주제야.')
  if (args.operation === 'disable') return { topics: topics.map(item => item.id === topic.id ? { ...item, enabled: false } : item) }
  if (args.operation !== 'update') throw new Error('지원하지 않는 주제 변경이야.')
  return { topics: putContentEvaluationTopic(topics, { ...topic,
    ...(typeof args.name === 'string' ? { name: args.name } : {}),
    ...(typeof args.description === 'string' ? { description: args.description } : {}),
    ...(typeof args.enabled === 'boolean' ? { enabled: args.enabled } : {}),
  }) }
}

export function contentEvaluationModelPatch(value: unknown, models: ModelSlot[]): ContentEvaluationDraftPatch {
  if (value === 0) return { modelSlotId: null }
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || !models.some(model => model.id === value)) throw new Error('목록에 있는 판단 모델 ID를 골라줘. 사용하지 않으려면 0을 입력해.')
  return { modelSlotId: value }
}
