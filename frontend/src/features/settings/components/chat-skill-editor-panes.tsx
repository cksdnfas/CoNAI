import { useId } from 'react'
import { ArrowDown, ArrowUp, Scissors, Trash2 } from 'lucide-react'
import { CHAT_SKILL_LIMITS } from '@conai/shared'
import { EditorPaneHeader } from '@/components/ui/editor-split'
import { Field } from '@/components/ui/field'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { Text } from '@/components/ui/text'
import { Textarea } from '@/components/ui/textarea'
import { ChatFilledLabel } from '@/features/codex-chat/chat-page-context'
import { useI18n } from '@/i18n'
import type { ChatSkill, ChatSkillSection } from '@/lib/api-codex-chat'
import type { SectionDraft, SectionProblem, SkillDraft } from './chat-skill-draft'

/** `~1.2k` tokens: a rough figure, never an exact count. */
export function useTokenLabel() {
  const { formatNumber } = useI18n()
  return (tokens: number) => `~${formatNumber(tokens, { notation: 'compact', maximumFractionDigits: 1 })}`
}

/** How often use_skill loaded it, and when last. */
export function UsageLine({ usage }: { usage: Pick<ChatSkillSection, 'loadCount' | 'lastLoadedAt'> }) {
  const { t, formatDateTime } = useI18n()
  return (
    <Text variant="caption">
      {usage.lastLoadedAt
        ? t({ ko: '불러온 횟수 {count} · 마지막 {date}', en: 'Loaded {count} times · last {date}' }, { count: usage.loadCount, date: formatDateTime(usage.lastLoadedAt) })
        : t({ ko: '아직 불러온 적 없어', en: 'Not loaded yet' })}
    </Text>
  )
}

/** 개요: the name and "when to use" the system prompt lists, the category, and what use_skill returns first. */
export function SkillOverviewPane({ draft, onChange, readOnly, categories, tokens, skill, onSplit }: {
  draft: SkillDraft
  onChange: (patch: Partial<Pick<SkillDraft, 'name' | 'description' | 'category' | 'instructions'>>) => void
  readOnly: boolean
  categories: string[]
  tokens: { overview: number; total: number }
  skill: ChatSkill | null
  /** Left out: no `## ` heading to move (or read-only). */
  onSplit?: () => void
}) {
  const { t } = useI18n()
  const tokenLabel = useTokenLabel()
  const categoryListId = useId()
  return (
    <div>
      <EditorPaneHeader
        title={t({ ko: '개요', en: 'Overview' })}
        info={t({ ko: 'use_skill이 처음 돌려주는 본문이야. 그 아래에 섹션 목차가 자동으로 붙고, 모델은 필요한 섹션만 골라 읽어.', en: 'What use_skill returns first. The table of sections is added below it, and the model reads only the sections it needs.' })}
        actions={readOnly ? null : (
          <IconButton size="icon-sm" variant="ghost" disabled={!onSplit} onClick={onSplit} label={t({ ko: '## 제목으로 섹션 나누기', en: 'Split ## headings into sections' })}>
            <Scissors />
          </IconButton>
        )}
      />
      <div className="space-y-4">
        <div className="grid gap-3 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <Field label={<ChatFilledLabel fieldId="name">{t({ ko: '이름', en: 'Name' })}</ChatFilledLabel>} info={t({ ko: '모델이 use_skill을 부를 때 쓰는 이름이야. 짧고 겹치지 않게.', en: 'The name the model passes to use_skill. Keep it short and unique.' })}>
            <Input variant="settings" value={draft.name} maxLength={CHAT_SKILL_LIMITS.name} readOnly={readOnly} onChange={(event) => onChange({ name: event.target.value })} />
          </Field>
          <Field label={<ChatFilledLabel fieldId="category">{t({ ko: '분류', en: 'Category' })}</ChatFilledLabel>} info={t({ ko: '목록에서 같은 분류끼리 묶어. 모델에게는 안 보여.', en: 'Groups skills in the list. Not shown to the model.' })}>
            <Input variant="settings" value={draft.category} maxLength={CHAT_SKILL_LIMITS.category} readOnly={readOnly} list={categoryListId} onChange={(event) => onChange({ category: event.target.value })} />
          </Field>
          <datalist id={categoryListId}>
            {categories.map((category) => <option key={category} value={category} />)}
          </datalist>
        </div>
        <Field label={<ChatFilledLabel fieldId="description">{t({ ko: '언제 쓰는지', en: 'When to use' })}</ChatFilledLabel>} info={t({ ko: '모델은 스킬을 불러오기 전까지 이름과 이 설명만 봐. "Use when …"처럼 어떤 요청에 쓰는지 구체적으로 적어줘.', en: 'Until it loads the skill, the model sees only the name and this text. Say which requests it is for, e.g. "Use when …".' })}>
          <Textarea variant="settings" rows={2} value={draft.description} maxLength={CHAT_SKILL_LIMITS.description} readOnly={readOnly} placeholder="Use when the user asks for …" onChange={(event) => onChange({ description: event.target.value })} />
        </Field>
        <Field label={<ChatFilledLabel fieldId="instructions">{t({ ko: '개요 · {tokens} 토큰', en: 'Overview · {tokens} tokens' }, { tokens: tokenLabel(tokens.overview) })}</ChatFilledLabel>} info={t({ ko: '모든 요청에 공통인 단계와 규칙, 그리고 어떤 섹션을 언제 읽을지 적어. 번호 매긴 명령문이 작은 모델에도 잘 먹혀. {{char}}·{{user}}는 이름으로 바뀌어.', en: 'Steps and rules common to every request, and which section to read when. Numbered, direct steps work best, even for small models. {{char}} and {{user}} become the names.' })}>
          <Textarea variant="settings" rows={14} value={draft.instructions} maxLength={CHAT_SKILL_LIMITS.instructions} readOnly={readOnly} onChange={(event) => onChange({ instructions: event.target.value })} />
        </Field>
        <Text variant="caption">
          {t({ ko: '섹션 {count}/{max} · 전체 {tokens} 토큰 (모델은 개요와 고른 섹션만 읽어)', en: '{count}/{max} sections · {tokens} tokens in all (the model reads the overview and the sections it picks)' }, { count: draft.sections.length, max: CHAT_SKILL_LIMITS.sections, tokens: tokenLabel(tokens.total) })}
        </Text>
        {skill ? <UsageLine usage={skill} /> : null}
        {skill && skill.profiles.length > 0 ? (
          <Text variant="caption">{t({ ko: '연결한 프로필: {names}', en: 'Linked profiles: {names}' }, { names: skill.profiles.map((profile) => profile.name).join(', ') })}</Text>
        ) : null}
      </div>
    </div>
  )
}

/** One section: where it sits (path), its table-of-contents line, and the text use_skill returns for it. */
export function SkillSectionPane({ section, problem, onChange, onMove, onRemove, readOnly, tokens, usage, renamedGuides }: {
  section: SectionDraft
  problem: SectionProblem | null
  onChange: (patch: Partial<Omit<SectionDraft, 'key'>>) => void
  /** Null for a step that has no neighbour in the same group. */
  onMove: { up: (() => void) | null; down: (() => void) | null }
  onRemove: () => void
  readOnly: boolean
  tokens: number
  /** The stored section with this path, if any. */
  usage: ChatSkillSection | undefined
  /** Generation presets whose guide is this section (or its group) under the path it was saved with, when renamed. */
  renamedGuides: string[]
}) {
  const { t } = useI18n()
  const tokenLabel = useTokenLabel()
  const pathMessage = problem === 'path'
    ? t({ ko: '"이름" 또는 "그룹/이름"으로 적어 ({max}자까지). 글자·숫자로 시작하고 글자·숫자·.·_·-만 써.', en: 'Write "name" or "group/name" (up to {max} characters): start with a letter or digit, then letters, digits, ".", "_" or "-".' }, { max: CHAT_SKILL_LIMITS.sectionPath })
    : problem === 'duplicate' ? t({ ko: '같은 경로의 섹션이 이미 있어.', en: 'Another section has this path.' }) : null
  return (
    <div>
      <EditorPaneHeader
        title={section.title.trim() || section.path || t({ ko: '새 섹션', en: 'New section' })}
        actions={readOnly ? null : (
          <>
            <IconButton size="icon-sm" variant="ghost" disabled={!onMove.up} onClick={onMove.up ?? undefined} label={t({ ko: '위로', en: 'Move up' })}><ArrowUp /></IconButton>
            <IconButton size="icon-sm" variant="ghost" disabled={!onMove.down} onClick={onMove.down ?? undefined} label={t({ ko: '아래로', en: 'Move down' })}><ArrowDown /></IconButton>
            <IconButton size="icon-sm" variant="destructive-ghost" onClick={onRemove} label={t({ ko: '섹션 삭제', en: 'Delete section' })}><Trash2 /></IconButton>
          </>
        )}
      />
      <div className="space-y-4">
        <div className="grid gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <Field label={t({ ko: '경로', en: 'Path' })} info={t({ ko: 'use_skill이 섹션을 부르는 이름이야. "그룹/이름"으로 적으면 목차에서 그룹으로 묶여 (한 단계까지). 바꾸면 트리의 자리도 따라가.', en: 'The name use_skill loads the section by. "group/name" files it under a group in the table (one level). Changing it moves it in the tree.' })}>
            <Input variant="settings" mono value={section.path} maxLength={CHAT_SKILL_LIMITS.sectionPath} readOnly={readOnly} aria-invalid={pathMessage !== null} onChange={(event) => onChange({ path: event.target.value })} />
          </Field>
          <Field label={t({ ko: '제목', en: 'Title' })}>
            <Input variant="settings" value={section.title} maxLength={CHAT_SKILL_LIMITS.sectionTitle} readOnly={readOnly} aria-invalid={problem === 'title'} onChange={(event) => onChange({ title: event.target.value })} />
          </Field>
        </div>
        {pathMessage ? <Text variant="caption" tone="destructive">{pathMessage}</Text> : null}
        {problem === 'length' ? <Text variant="caption" tone="destructive">{t({ ko: '너무 길어: 제목 {title}·목차 요약 {summary}·내용 {content}자까지야.', en: 'Too long: title {title}, table line {summary}, content {content} characters at most.' }, { title: CHAT_SKILL_LIMITS.sectionTitle, summary: CHAT_SKILL_LIMITS.sectionSummary, content: CHAT_SKILL_LIMITS.sectionContent })}</Text> : null}
        {renamedGuides.length > 0 ? <Text variant="caption" tone="warning">{t({ ko: '생성 프리셋 {names}이(가) 저장된 경로 "{path}"를 가이드로 써. 경로를 바꿔 저장하면 그 가이드를 다시 골라줘.', en: 'Generation presets {names} use the saved path "{path}" as their guide. After saving the new path, pick their guide again.' }, { names: renamedGuides.join(', '), path: section.savedPath ?? '' })}</Text> : null}
        <Field label={t({ ko: '목차 요약 — 언제 읽는지', en: 'Table line — when to read it' })} info={t({ ko: '모델이 개요를 읽을 때 목차에 보이는 한 줄이야. 이걸 보고 이 섹션을 읽을지 정해.', en: 'The line the model sees in the table of sections; it decides from this whether to read the section.' })}>
          <Input variant="settings" value={section.summary} maxLength={CHAT_SKILL_LIMITS.sectionSummary} readOnly={readOnly} placeholder={t({ ko: '예: NAI v4로 그릴 때', en: 'e.g. When drawing with NAI v4' })} onChange={(event) => onChange({ summary: event.target.value })} />
        </Field>
        <Field label={t({ ko: '내용 · {tokens} 토큰', en: 'Content · {tokens} tokens' }, { tokens: tokenLabel(tokens) })}>
          <Textarea variant="settings" rows={16} value={section.content} maxLength={CHAT_SKILL_LIMITS.sectionContent} readOnly={readOnly} aria-invalid={problem === 'content'} onChange={(event) => onChange({ content: event.target.value })} />
        </Field>
        {usage ? <UsageLine usage={usage} /> : null}
      </div>
    </div>
  )
}
