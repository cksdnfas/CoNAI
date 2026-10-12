import { useState } from 'react'
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
import { useI18n } from '@/i18n'
import { JudgeModelSelect } from './chat-judge-connection-select'
import { SettingsRowsSkeleton } from './settings-rows'

type Props = {
  draft: ContentEvaluationSettings | null
  onPatch: (patch: Partial<Pick<ContentEvaluationSettings, 'modelSlotId' | 'topics'>>) => void
  isSaving: boolean
  error: unknown
  onReload: () => void
}

export function ContentEvaluationSettingsRows({ draft, onPatch, isSaving, error, onReload }: Props) {
  const { t } = useI18n()
  const [editing, setEditing] = useState<ContentEvaluationTopic | null>(null)
  const [original, setOriginal] = useState<ContentEvaluationTopic | null>(null)
  const openTopic = (topic: ContentEvaluationTopic) => { setOriginal(topic); setEditing({ ...topic }) }
  if (!draft) return error
    ? <ErrorState error={error} onRetry={onReload} />
    : <SettingsRowsSkeleton rows={5} />
  const topics = draft.topics
  const active = topics.filter(topic => topic.enabled).length
  const duplicate = Boolean(editing && topics.some(topic => topic.id !== editing.id && topic.name.trim().toLocaleLowerCase() === editing.name.trim().toLocaleLowerCase()))
  const valid = Boolean(editing?.name.trim() && editing.description.trim() && !duplicate)
  const apply = () => {
    if (!editing || !valid) return
    onPatch({ topics: topics.some(topic => topic.id === editing.id)
      ? topics.map(topic => topic.id === editing.id ? { ...editing, name: editing.name.trim(), description: editing.description.trim() } : topic)
      : [...topics, { ...editing, name: editing.name.trim(), description: editing.description.trim() }] })
    setEditing(null)
  }
  const seed = () => onPatch({ topics: [
    { id: 'education', name: t({ ko: '교육', en: 'Education' }), description: t({ ko: '학습, 수업, 교수법, 교육 자료를 직접 다루는 정도. 단순히 교육이라는 단어가 등장하는 것만으로 높은 관련도를 주지 않는다.', en: 'Substantive discussion of learning, teaching, pedagogy, and educational materials. A passing mention alone is not high relevance.' }), enabled: true },
    { id: 'ai', name: 'AI', description: t({ ko: '인공지능 기술, 활용, 연구를 중심적으로 다루는 정도.', en: 'How centrally the content discusses artificial intelligence technology, applications, or research.' }), enabled: true },
    { id: 'llm', name: 'LLM', description: t({ ko: '대규모 언어 모델의 원리, 학습, 추론, 활용을 직접 다루는 정도.', en: 'Substantive discussion of large language models, training, inference, principles, or applications.' }), enabled: true },
  ] })
  return (
    <div className="space-y-8">
      <RowGroup heading={t({ ko: '주제 관련도', en: 'Topic relevance' })}>
        <p className="pb-4 text-sm text-muted-foreground">{t({ ko: '글이 각 주제를 얼마나 중심적으로 다루는지 평가해. 주제별 점수의 합계에는 제한이 없어.', en: 'Evaluate how centrally a document discusses each topic. Topic scores are independent.' })}</p>
        <SettingRow label={t({ ko: '판단 모델', en: 'Judge model' })}>
          <JudgeModelSelect enabled slotId={draft.modelSlotId} emptyLabel={t({ ko: '사용 안 함', en: 'Off' })} ariaLabel={t({ ko: '콘텐츠 평가 판단 모델', en: 'Content evaluation judge model' })} onChange={modelSlotId => onPatch({ modelSlotId })} />
        </SettingRow>
        <SettingRow label={t({ ko: '평가 척도', en: 'Relevance scale' })}><span className="text-sm tabular-nums text-muted-foreground">0 · 25 · 50 · 75 · 100</span></SettingRow>
        <SettingRow label={t({ ko: '모델 설정 상태', en: 'Model configuration' })}><span className="text-sm text-muted-foreground">{t(draft.modelSlotId === null ? { ko: '모델을 선택해줘.', en: 'Choose a model.' } : draft.modelReady ? { ko: '저장한 판단 모델을 사용할 수 있어.', en: 'The saved judge configuration is available.' } : { ko: '모델 선택을 저장하고 연결 설정을 확인해.', en: 'Save the selection and check the connection settings.' })}</span></SettingRow>
        <SettingRow label={t({ ko: '적용 위치', en: 'Used by' })}><span className="text-sm text-muted-foreground">{t({ ko: '게시판 · 자동 실행은 게시판 설정에서 정해.', en: 'Posts · configure automation in Posts settings.' })}</span></SettingRow>
      </RowGroup>
      <RowGroup heading={t({ ko: '평가 주제 · 활성 {count}/20', en: 'Topics · {count}/20 active' }, { count: active })} actions={<Button size="sm" variant="subtle" disabled={isSaving || topics.length >= TOPIC_EVALUATION_LIMITS.totalTopics} onClick={() => openTopic({ id: crypto.randomUUID(), name: '', description: '', enabled: active < 20 })}><Plus />{t({ ko: '주제 추가', en: 'Add topic' })}</Button>}>
        {topics.length === 0 ? <div className="flex flex-wrap items-center gap-3 py-4"><span className="text-sm text-muted-foreground">{t({ ko: '평가할 주제를 먼저 등록해.', en: 'Add topics to evaluate.' })}</span><Button size="sm" variant="subtle" onClick={seed}>{t({ ko: '교육 · AI · LLM 예시 불러오기', en: 'Load Education · AI · LLM examples' })}</Button></div> : topics.map(topic => (
          <div key={topic.id} className="grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-4 border-b border-line py-4 last:border-b-0">
            <Switch checked={topic.enabled} disabled={isSaving || !topic.enabled && active >= 20} aria-label={t({ ko: '{name} 평가 사용', en: 'Evaluate {name}' }, { name: topic.name })} onCheckedChange={enabled => onPatch({ topics: topics.map(item => item.id === topic.id ? { ...item, enabled } : item) })} />
            <div className="min-w-0"><span className="block break-words text-sm font-medium">{topic.name}</span><p className="mt-1 break-words text-xs text-muted-foreground">{topic.description}</p></div>
            <IconButton size="icon-sm" variant="ghost" label={t({ ko: '{name} 편집', en: 'Edit {name}' }, { name: topic.name })} onClick={() => openTopic(topic)}><Pencil /></IconButton>
          </div>
        ))}
      </RowGroup>
      <p className="text-xs text-muted-foreground">{t({ ko: '주제나 기준을 바꾸면 기존 결과에 기준 변경이 표시돼. 전체 글을 자동으로 다시 평가하지는 않아.', en: 'Changing topics or criteria marks previous results as outdated. Existing posts are not automatically re-evaluated.' })}</p>
      <details className="text-sm"><summary className="cursor-pointer text-muted-foreground">{t({ ko: '관련도 기준 보기', en: 'Show relevance criteria' })}</summary><p className="mt-3 text-xs leading-relaxed text-muted-foreground">{t({ ko: '무관 0 · 단순 언급 25 · 일부 관련 50 · 주요 주제 75 · 핵심 주제 100. 등급별 확률을 가중 평균해서 점수를 계산해. 판단할 수 없거나 응답이 없으면 —로 표시해.', en: 'Unrelated 0 · mention 25 · partial 50 · major 75 · core 100. Scores average the level probabilities. Unknown or missing answers display —.' })}</p></details>
      <Modal open={editing !== null} title={t({ ko: '평가 주제 편집', en: 'Edit evaluation topic' })} onClose={() => setEditing(null)} size="narrow" dirty={Boolean(editing && JSON.stringify(editing) !== JSON.stringify(original))} onSave={valid ? apply : undefined}>
        {editing ? <div className="space-y-5">
          <label className="block space-y-2"><span className="text-sm">{t({ ko: '주제 이름', en: 'Topic name' })}</span><Input value={editing.name} maxLength={40} onChange={event => setEditing({ ...editing, name: event.target.value })} /></label>
          <label className="block space-y-2"><span className="text-sm">{t({ ko: '판단 기준', en: 'Criteria' })}</span><Textarea value={editing.description} maxLength={1000} rows={5} onChange={event => setEditing({ ...editing, description: event.target.value })} /></label>
          {duplicate ? <p role="alert" className="text-xs text-destructive">{t({ ko: '같은 이름의 주제가 있어.', en: 'A topic already uses this name.' })}</p> : null}
          <ModalFooter>{topics.some(topic => topic.id === editing.id) ? <Button variant="ghost" onClick={() => { onPatch({ topics: topics.map(topic => topic.id === editing.id ? { ...topic, enabled: false } : topic) }); setEditing(null) }}>{t({ ko: '사용 중지', en: 'Disable' })}</Button> : null}<Button disabled={!valid || isSaving} onClick={apply}>{t({ ko: '변경 적용', en: 'Apply changes' })}</Button></ModalFooter>
        </div> : null}
      </Modal>
    </div>
  )
}
