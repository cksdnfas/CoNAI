import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { SquarePen, X } from 'lucide-react'
import { skillSectionPathKey } from '@conai/shared'
import { ToggleChip } from '@/components/ui/chip'
import { EditorGroup } from '@/components/ui/editor-group'
import { Field } from '@/components/ui/field'
import { IconButton } from '@/components/ui/icon-button'
import { NumberStepperInput } from '@/components/ui/number-stepper-input'
import { Select } from '@/components/ui/select'
import { SettingRow } from '@/components/ui/setting-row'
import { Textarea } from '@/components/ui/textarea'
import { ChatFilledLabel } from '@/features/codex-chat/chat-page-context'
import { useI18n } from '@/i18n'
import { CHAT_PRESET_PREVIOUS_IMAGES_MAX, CHAT_SKILLS_QUERY_KEY, listChatSkills, type ChatPresetPrompting, type ChatPresetPromptingInput } from '@/lib/api-codex-chat'
import { sectionGroups } from './chat-skill-draft'
import { ChatSkillEditorModal } from './chat-skill-editor-modal'

export const EMPTY_PROMPTING: ChatPresetPromptingInput = { timing: 'inline', guide: '', guideSkill: null, previousImages: 0 }

/** A saved preset's prompting as the editor keeps it. */
export function promptingInputOf(prompting: ChatPresetPrompting | undefined): ChatPresetPromptingInput {
  if (!prompting) return EMPTY_PROMPTING
  const guideSkill = prompting.guideSkill ? { skillId: prompting.guideSkill.skillId, path: prompting.guideSkill.path } : null
  return { timing: prompting.timing, guide: prompting.guide, guideSkill, previousImages: prompting.previousImages }
}

type GuideSkill = ChatPresetPromptingInput['guideSkill']

/**
 * 가이드: one section of a shared skill, or a whole group of them (`group/`, all its sections in order). Pick the skill,
 * then the section; a link whose skill or section is gone shows as missing. The pen opens that skill's editor.
 */
function GuideSkillSelect({ value, onChange }: { value: GuideSkill; onChange: (value: GuideSkill) => void }) {
  const { t } = useI18n()
  const skillsQuery = useQuery({ queryKey: CHAT_SKILLS_QUERY_KEY, queryFn: listChatSkills })
  // A skill chosen before any of its sections (or one without sections yet).
  const [pendingSkillId, setPendingSkillId] = useState<number | null>(null)
  const [editing, setEditing] = useState(false)
  const skills = skillsQuery.data ?? []
  const skillId = value?.skillId ?? pendingSkillId
  const skill = skills.find((entry) => entry.id === skillId)
  const groups = skill ? sectionGroups(skill.sections) : []
  const missingSkill = skillsQuery.isSuccess && skillId !== null && !skill
  const targets = groups.flatMap(({ group, sections }) => [
    ...(group === null ? [] : [{ path: `${group}/`, label: t({ ko: '{group}/ (전체 {count}개)', en: '{group}/ (all {count})' }, { group, count: sections.length }) }]),
    ...sections.map((section) => ({ path: section.path, label: section.title ? `${section.path} — ${section.title}` : section.path })),
  ])
  const pathListed = value ? targets.some((target) => skillSectionPathKey(target.path) === skillSectionPathKey(value.path)) : false
  const missingPath = Boolean(value) && skill !== undefined && !pathListed

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
      <Select
        variant="settings"
        controlSize="compact"
        className="w-48 max-w-full"
        value={skillId === null ? '' : String(skillId)}
        disabled={skillsQuery.isPending}
        aria-invalid={missingSkill}
        aria-label={t({ ko: '가이드 스킬', en: 'Guide skill' })}
        onChange={(event) => {
          const next = event.target.value ? Number(event.target.value) : null
          const picked = skills.find((entry) => entry.id === next)
          const first = picked ? sectionGroups(picked.sections).flatMap((entry) => entry.sections)[0] : undefined
          setPendingSkillId(next)
          onChange(next !== null && first ? { skillId: next, path: first.path } : null)
        }}
      >
        <option value="">{t({ ko: '없음', en: 'None' })}</option>
        {missingSkill ? <option value={String(skillId)}>{t({ ko: '찾을 수 없는 스킬', en: 'Skill not found' })}</option> : null}
        {skills.map((entry) => {
          const label = entry.category ? `${entry.category} · ${entry.name}` : entry.name
          // A plugin's skill stays pickable while the plugin is off, but its guide is not read then.
          return <option key={entry.id} value={String(entry.id)}>{entry.enabled ? label : t({ ko: '{label} (꺼짐)', en: '{label} (off)' }, { label })}</option>
        })}
      </Select>
      {skill ? (
        <Select
          variant="settings"
          mono
          controlSize="compact"
          className="w-64 max-w-full"
          value={value?.path ?? ''}
          disabled={targets.length === 0}
          aria-invalid={missingPath}
          aria-label={t({ ko: '가이드 섹션', en: 'Guide section' })}
          onChange={(event) => onChange(event.target.value ? { skillId: skill.id, path: event.target.value } : null)}
        >
          {value === null ? <option value="">{targets.length === 0 ? t({ ko: '섹션이 없어', en: 'No sections' }) : t({ ko: '섹션 고르기', en: 'Pick a section' })}</option> : null}
          {missingPath && value ? <option value={value.path}>{t({ ko: '찾을 수 없는 섹션 ({path})', en: 'Section not found ({path})' }, { path: value.path })}</option> : null}
          {targets.map((target) => <option key={target.path} value={target.path}>{target.label}</option>)}
        </Select>
      ) : null}
      {skill ? <IconButton size="icon-sm" variant="ghost" label={t({ ko: '스킬 편집기 열기', en: 'Open the skill editor' })} onClick={() => setEditing(true)}><SquarePen /></IconButton> : null}
      {skillId !== null ? <IconButton size="icon-sm" variant="ghost" label={t({ ko: '연결 풀기', en: 'Unlink' })} onClick={() => { setPendingSkillId(null); onChange(null) }}><X /></IconButton> : null}
      {editing && skill ? <ChatSkillEditorModal open skillId={skill.id} onClose={() => setEditing(false)} /> : null}
    </div>
  )
}

/**
 * 프롬프트 작성: when the scene prompt is written (with the reply, or from the finished reply), the guide the writer
 * follows (a few lines here, and/or a linked skill section), and how many of the chat's latest pictures it sees.
 */
export function PresetPromptingFields({ value, onChange }: { value: ChatPresetPromptingInput; onChange: (value: ChatPresetPromptingInput) => void }) {
  const { t } = useI18n()
  const patch = (next: Partial<ChatPresetPromptingInput>) => onChange({ ...value, ...next })
  return (
    <EditorGroup label={t({ ko: '프롬프트 작성', en: 'Prompt writing' })} info={t({ ko: '답변 끝난 뒤: 답변이 끝나면 완성된 본문으로 프롬프트를 따로 써서 생성해. 캐릭터 생김새는 프로필의 외형 설명만 보고 써. 시스템 프롬프트와 섹션은 안 봐.', en: "After the reply: once the reply is done, the prompt is written from the finished text and generated. The character's looks come only from the profile's appearance, not its system prompt or sections." })}>
      <div className="border-t border-line">
        <SettingRow label={<ChatFilledLabel fieldId="timing">{t({ ko: '작성 시점', en: 'When' })}</ChatFilledLabel>}>
          <div className="flex gap-1.5">
            <ToggleChip size="sm" pressed={value.timing === 'inline'} onClick={() => patch({ timing: 'inline' })}>{t({ ko: '답변과 같이', en: 'With the reply' })}</ToggleChip>
            <ToggleChip size="sm" pressed={value.timing === 'after'} onClick={() => patch({ timing: 'after' })}>{t({ ko: '답변 끝난 뒤', en: 'After the reply' })}</ToggleChip>
          </div>
        </SettingRow>
        <SettingRow label={t({ ko: '가이드', en: 'Guide' })} info={t({ ko: '프롬프트를 쓸 때 따를 스킬 섹션이야. "그룹/"을 고르면 그 그룹의 섹션을 순서대로 전부 읽어.', en: 'The skill section the prompt writer follows. A "group/" choice reads all of that group’s sections in order.' })}>
          <GuideSkillSelect value={value.guideSkill} onChange={(guideSkill) => patch({ guideSkill })} />
        </SettingRow>
        <SettingRow label={<ChatFilledLabel fieldId="previousImages">{t({ ko: '이전 이미지 참고', en: 'Earlier pictures shown' })}</ChatFilledLabel>} info={t({ ko: '이 채팅에서 최근에 만든 이미지를 이만큼 보여줘. 이미지를 못 보는 모델에는 안 보내.', en: "Shows this many of the chat's latest pictures. Not sent to models that cannot see images." })}>
          <NumberStepperInput
            variant="settings"
            className="w-32"
            step={1}
            min={0}
            max={CHAT_PRESET_PREVIOUS_IMAGES_MAX}
            value={value.previousImages}
            onValueCommit={(raw) => {
              const number = Math.round(Number(raw))
              if (raw.trim() !== '' && Number.isFinite(number)) patch({ previousImages: Math.min(CHAT_PRESET_PREVIOUS_IMAGES_MAX, Math.max(0, number)) })
            }}
            aria-label={t({ ko: '이전 이미지 참고', en: 'Earlier pictures shown' })}
          />
        </SettingRow>
      </div>
      <Field label={<ChatFilledLabel fieldId="guide">{t({ ko: '작성 가이드', en: 'Writing guide' })}</ChatFilledLabel>}>
        <Textarea variant="settings" rows={3} maxLength={4000} value={value.guide} onChange={(event) => patch({ guide: event.target.value })} />
      </Field>
    </EditorGroup>
  )
}
