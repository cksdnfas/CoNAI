import { useState, type ReactNode } from 'react'
import { Pencil, Plus } from 'lucide-react'
import { TOPIC_EVALUATION_LIMITS, type ContentEvaluationSettings, type ContentEvaluationTopic } from '@conai/shared'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Modal, ModalFooter } from '@/components/ui/modal'
import { RowGroup } from '@/components/ui/row-group'
import { SettingRow } from '@/components/ui/setting-row'
import { ErrorState } from '@/components/ui/error-state'
import { ChatFilledLabel } from '@/features/codex-chat/chat-page-context'
import { pageAction, pageChoice, pageObject } from '@/features/codex-chat/page-action-helpers'
import { createRandomUuid } from '@/lib/random-uuid'
import { cn } from '@/lib/utils'
import { useI18n } from '@/i18n'
import { JudgeModelSelect, useDefaultJudge, useDefaultJudgeLabel } from './chat-judge-connection-select'
import { SettingsRowsSkeleton } from './settings-rows'
import { putContentEvaluationTopic } from './content-evaluation-chat'
import { useContentEvaluationChatPage } from './use-content-evaluation-chat-page'
import { CHAT_DOCK_INSET, useSettingsEditorChatPage } from './use-settings-editor-chat-page'

type Props = {
  draft: ContentEvaluationSettings | null
  onPatch: (patch: Partial<Pick<ContentEvaluationSettings, 'modelSlotId' | 'topics'>>) => void
  isSaving: boolean
  dirty: boolean
  onSave: () => Promise<void>
  error: unknown
  onReload: () => void
  /** Rows of the caller's own draft around the judge model row (posts automation, list display). */
  leadingRows?: ReactNode
  trailingRows?: ReactNode
  /** Below the topic list (the caller's advanced limits). */
  footer?: ReactNode
}

/** Topic relevance criteria (shared content-evaluation draft): judge model and topics, with the caller's rows around them. */
export function ContentEvaluationSettingsRows({ draft, onPatch, isSaving, dirty, onSave, error, onReload, leadingRows, trailingRows, footer }: Props) {
  const { t } = useI18n()
  const defaultJudge = useDefaultJudge()
  const defaultJudgeLabel = useDefaultJudgeLabel()
  const [editing, setEditing] = useState<ContentEvaluationTopic | null>(null)
  const [original, setOriginal] = useState<ContentEvaluationTopic | null>(null)
  const openTopic = (topic: ContentEvaluationTopic) => { setOriginal(topic); setEditing({ ...topic }) }
  const topics = draft?.topics ?? []
  const active = topics.filter(topic => topic.enabled).length
  const duplicate = Boolean(editing && topics.some(topic => topic.id !== editing.id && topic.name.normalize('NFC').trim().toLocaleLowerCase() === editing.name.normalize('NFC').trim().toLocaleLowerCase()))
  const originalEnabled = topics.some(topic => topic.id === editing?.id && topic.enabled)
  const valid = Boolean(editing?.name.trim() && editing.description.trim() && editing.name.length <= 40 && editing.description.length <= 1000 && !duplicate && active - (originalEnabled ? 1 : 0) + (editing.enabled ? 1 : 0) <= 20 && (topics.some(topic => topic.id === editing.id) || topics.length < TOPIC_EVALUATION_LIMITS.totalTopics))
  const restorePoint = useContentEvaluationChatPage({ draft, onPatch, isSaving, dirty, onSave, onOpenTopic: openTopic })
  const apply = () => {
    if (!editing || !valid) return
    const patch = { topics: putContentEvaluationTopic(topics, editing) }
    const undo = restorePoint(patch)
    onPatch(patch)
    setEditing(null)
    return undo
  }
  const disable = () => {
    const topic = topics.find(topic => topic.id === editing?.id)
    if (!topic) throw new Error('목록에 있는 주제만 사용 중지할 수 있어.')
    const patch = { topics: topics.map(item => item.id === topic.id ? { ...item, enabled: false } : item) }
    const undo = restorePoint(patch)
    onPatch(patch)
    setEditing(null)
    return undo
  }
  useSettingsEditorChatPage({
    open: editing !== null, title: t({ ko: '평가 주제 편집', en: 'Edit evaluation topic' }), resourceId: `content-topic:${editing?.id ?? 'new'}`,
    dirty: Boolean(editing && JSON.stringify(editing) !== JSON.stringify(original)),
    fields: editing ? [
      { id: 'name', label: t({ ko: '주제 이름', en: 'Topic name' }), type: 'text', value: editing.name },
      { id: 'description', label: t({ ko: '판단 기준', en: 'Criteria' }), type: 'text', value: editing.description },
      { id: 'enabled', label: t({ ko: '평가 사용', en: 'Enable topic' }), type: 'boolean', value: editing.enabled },
    ] : [],
    data: { active, total: topics.length, existing: topics.some(topic => topic.id === editing?.id) },
    apply: patch => { if (editing) setEditing({ ...editing, ...(typeof patch.name === 'string' ? { name: patch.name } : {}), ...(typeof patch.description === 'string' ? { description: patch.description } : {}), ...(typeof patch.enabled === 'boolean' ? { enabled: patch.enabled } : {}) }) },
    actions: [pageAction('settings.content_topic', t({ ko: '주제 변경 적용', en: 'Apply topic changes' }), t({ ko: 'apply: 편집 내용을 설정 초안에 적용하고 닫아. disable: 기존 주제 사용 중지. 저장은 주제 관련도 화면에서 별도로 요청해.', en: 'apply: copy this editor into the settings draft and close. disable: archive the existing topic. Request a save from the topic relevance view separately.' }), pageObject({ operation: pageChoice(['apply', 'disable']) }, ['operation']))],
    applyAction: (id, args) => {
      if (isSaving || id !== 'settings.content_topic') throw new Error('지금 주제 변경을 적용할 수 없어.')
      if (args.operation === 'disable') return disable()
      if (!valid) throw new Error('주제 이름·판단 기준·활성 주제 한도를 확인해줘.')
      return apply()
    },
  })
  if (!draft) return error
    ? <ErrorState error={error} onRetry={onReload} />
    : <SettingsRowsSkeleton rows={5} />
  const seed = () => onPatch({ topics: [
    { id: 'education', name: t({ ko: '교육', en: 'Education' }), description: t({ ko: '학습, 수업, 교수법, 교육 자료를 직접 다루는 정도. 단순히 교육이라는 단어가 등장하는 것만으로 높은 관련도를 주지 않는다.', en: 'Substantive discussion of learning, teaching, pedagogy, and educational materials. A passing mention alone is not high relevance.' }), enabled: true },
    { id: 'ai', name: 'AI', description: t({ ko: '인공지능 기술, 활용, 연구를 중심적으로 다루는 정도.', en: 'How centrally the content discusses artificial intelligence technology, applications, or research.' }), enabled: true },
    { id: 'llm', name: 'LLM', description: t({ ko: '대규모 언어 모델의 원리, 학습, 추론, 활용을 직접 다루는 정도.', en: 'Substantive discussion of large language models, training, inference, principles, or applications.' }), enabled: true },
  ] })
  const modelState = draft.modelSlotId === null && !defaultJudge ? null : draft.modelReady
    ? t({ ko: '준비됨', en: 'Ready' })
    : t({ ko: '저장 후 연결을 확인해줘', en: 'Save, then check the connection' })
  return (
    <div className="space-y-8">
      <RowGroup>
        {leadingRows}
        <SettingRow label={<ChatFilledLabel fieldId="modelSlotId">{t({ ko: '판단 모델', en: 'Judge model' })}</ChatFilledLabel>} controlClassName="flex items-center gap-2">
          {modelState ? <span role="img" aria-label={modelState} title={modelState} className={cn('size-2 shrink-0 rounded-full', draft.modelReady ? 'bg-success' : 'bg-warning')} /> : null}
          <JudgeModelSelect enabled slotId={draft.modelSlotId} emptyLabel={defaultJudgeLabel} ariaLabel={t({ ko: '주제 관련도 판단 모델', en: 'Topic relevance judge model' })} onChange={modelSlotId => onPatch({ modelSlotId })} />
        </SettingRow>
        {trailingRows}
      </RowGroup>
      <RowGroup
        heading={t({ ko: '주제', en: 'Topics' })}
        actions={<>
          <span className="text-xs tabular-nums text-muted-foreground">{active} / {TOPIC_EVALUATION_LIMITS.activeTopics}</span>
          <IconButton size="icon-sm" variant="ghost" label={t({ ko: '주제 추가', en: 'Add topic' })} disabled={isSaving || topics.length >= TOPIC_EVALUATION_LIMITS.totalTopics} onClick={() => openTopic({ id: createRandomUuid(), name: '', description: '', enabled: active < 20 })}><Plus /></IconButton>
        </>}
      >
        {topics.length === 0 ? <div className="py-4"><Button size="sm" variant="subtle" onClick={seed}>{t({ ko: '교육 · AI · LLM 예시 불러오기', en: 'Load Education · AI · LLM examples' })}</Button></div> : topics.map(topic => (
          <div key={topic.id} className={cn('grid min-h-12 grid-cols-[2.25rem_minmax(0,9rem)_minmax(0,1fr)_auto] items-center gap-4 border-b border-line last:border-b-0', !topic.enabled && 'opacity-60')}>
            <Switch checked={topic.enabled} disabled={isSaving || !topic.enabled && active >= 20} aria-label={t({ ko: '{name} 평가 사용', en: 'Evaluate {name}' }, { name: topic.name })} onCheckedChange={enabled => onPatch({ topics: topics.map(item => item.id === topic.id ? { ...item, enabled } : item) })} />
            <span className="truncate text-sm font-medium">{topic.name}</span>
            <span className="truncate text-xs text-muted-foreground" title={topic.description}>{topic.description}</span>
            <IconButton size="icon-sm" variant="ghost" label={t({ ko: '{name} 편집', en: 'Edit {name}' }, { name: topic.name })} onClick={() => openTopic(topic)}><Pencil /></IconButton>
          </div>
        ))}
      </RowGroup>
      {footer}
      <Modal open={editing !== null} title={t({ ko: '평가 주제 편집', en: 'Edit evaluation topic' })} onClose={() => setEditing(null)} size="narrow" sidePanelInset={CHAT_DOCK_INSET} dirty={Boolean(editing && JSON.stringify(editing) !== JSON.stringify(original))} onSave={valid ? apply : undefined}>
        {editing ? <div className="space-y-5">
          <label className="block space-y-2 text-sm"><ChatFilledLabel fieldId="name">{t({ ko: '주제 이름', en: 'Topic name' })}</ChatFilledLabel><Input value={editing.name} maxLength={40} onChange={event => setEditing({ ...editing, name: event.target.value })} /></label>
          <label className="block space-y-2 text-sm"><ChatFilledLabel fieldId="description">{t({ ko: '판단 기준', en: 'Criteria' })}</ChatFilledLabel><Textarea value={editing.description} maxLength={1000} rows={5} onChange={event => setEditing({ ...editing, description: event.target.value })} /></label>
          <label className="flex items-center justify-between gap-3 text-sm"><ChatFilledLabel fieldId="enabled">{t({ ko: '평가 사용', en: 'Enable topic' })}</ChatFilledLabel><Switch checked={editing.enabled} disabled={!editing.enabled && active - (originalEnabled ? 1 : 0) >= 20} aria-label={t({ ko: '평가 사용', en: 'Enable topic' })} onCheckedChange={enabled => setEditing({ ...editing, enabled })} /></label>
          {duplicate ? <p role="alert" className="text-xs text-destructive">{t({ ko: '같은 이름의 주제가 있어.', en: 'A topic already uses this name.' })}</p> : null}
          <ModalFooter>{topics.some(topic => topic.id === editing.id) ? <Button variant="ghost" onClick={disable}>{t({ ko: '사용 중지', en: 'Disable' })}</Button> : null}<Button disabled={!valid || isSaving} onClick={apply}>{t({ ko: '변경 적용', en: 'Apply changes' })}</Button></ModalFooter>
        </div> : null}
      </Modal>
    </div>
  )
}
