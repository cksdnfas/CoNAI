import { BookOpen } from 'lucide-react'
import { ToggleChip } from '@/components/ui/chip'
import { Field } from '@/components/ui/field'
import { NumberStepperInput } from '@/components/ui/number-stepper-input'
import { useI18n } from '@/i18n'
import type { ChatLorebook, ChatProfileDefaults } from '@/lib/api-codex-chat'
import { numberOrNull, SwitchLine, type Draft, type PatchDraft } from './chat-profile-editor-fields'
import { EditorGroup } from '@/components/ui/editor-group'

/**
 * What the model is given from before: how much of the conversation, and the lorebooks with how much of them.
 * The lorebook numbers are advanced fields.
 */
export function ChatProfileMemoryPanel({ draft, patch, defaults, lorebooks, advanced }: {
  draft: Draft
  patch: PatchDraft
  defaults: ChatProfileDefaults | undefined
  /** The linkable lorebooks; undefined until they load. */
  lorebooks: ChatLorebook[] | undefined
  advanced: boolean
}) {
  const { t } = useI18n()
  const isCodex = draft.engine === 'codex'

  return (
    <div className="space-y-4">
      <EditorGroup label={t({ ko: '대화', en: 'Conversation' })}>
        <div className="grid gap-3 md:grid-cols-2">
          {isCodex ? (
            <Field label={t({ ko: '압축 기준', en: 'Compact at' })} info={t({ ko: '토큰. Codex가 대화를 압축하는 기준.', en: 'In tokens. The size at which Codex compacts the conversation.' })}>
              <NumberStepperInput
                variant="settings"
                allowEmpty
                step={8000}
                min={defaults?.codexCompactTokens.min ?? 48_000}
                value={draft.contextTokens}
                placeholder={`${t({ ko: '기본', en: 'Default' })} (${(defaults?.codexCompactTokens.default ?? 64_000).toLocaleString()})`}
                onValueCommit={(value) => patch({ contextTokens: numberOrNull(value) })}
              />
            </Field>
          ) : (
            <>
              <Field label={t({ ko: '최근 턴 수', en: 'Recent turns' })} info={t({ ko: '요청마다 보내는 최근 대화. 사용자 메시지 하나와 그 답변이 한 턴.', en: 'The recent conversation sent with each request. One user message and its reply make a turn.' })}>
                <NumberStepperInput variant="settings" step={1} min={1} max={200} value={draft.contextTurns} onValueCommit={(value) => patch({ contextTurns: numberOrNull(value) ?? draft.contextTurns })} />
              </Field>
              <Field
                label={t({ ko: '컨텍스트 길이', en: 'Context length' })}
                info={t({ ko: '토큰. 비우면 제한 없음. 정하면 시스템 프롬프트·요약·도구 설명·답변 몫을 뺀 만큼만 최근 턴을 보내.', en: 'In tokens. Empty means no limit. When set, only as many recent turns are sent as fit after the system prompt, summary, tool descriptions and the reply allowance.' })}
              >
                <NumberStepperInput variant="settings" allowEmpty step={1024} min={1024} value={draft.contextTokens} placeholder={t({ ko: '제한 없음', en: 'No limit' })} onValueCommit={(value) => patch({ contextTokens: numberOrNull(value) })} />
              </Field>
            </>
          )}
        </div>
      </EditorGroup>

      <EditorGroup label={t({ ko: '로어북', en: 'Lorebooks' })}>
        <div className="flex flex-wrap gap-1.5">
          {(lorebooks ?? []).map((lorebook) => {
            const linked = draft.lorebookIds.includes(lorebook.id)
            return (
              <ToggleChip key={lorebook.id} pressed={linked} onClick={() => patch({ lorebookIds: linked ? draft.lorebookIds.filter((id) => id !== lorebook.id) : [...draft.lorebookIds, lorebook.id] })}>
                <BookOpen className="size-3.5 text-resource-lorebook" />
                {lorebook.name}
                {lorebook.kind === 'account' ? <span className="opacity-60">{t({ ko: '계정', en: 'Account' })}</span> : null}
                <span className="opacity-60">{lorebook.entries.length}</span>
              </ToggleChip>
            )
          })}
          {lorebooks && lorebooks.length === 0 ? <span className="text-sm text-muted-foreground">{t({ ko: '가져온 로어북이 없어.', en: 'No lorebooks yet.' })}</span> : null}
        </div>
        <SwitchLine label={t({ ko: '대화 중 로어 제안 받기', en: 'Allow lore proposals' })} checked={draft.allowLoreProposals} onCheckedChange={(allowLoreProposals) => patch({ allowLoreProposals })} />
        {advanced ? (
          <div className="grid gap-3 md:grid-cols-3">
            <Field label={t({ ko: '로어북 최근 메시지', en: 'Lorebook recent messages' })}>
              <NumberStepperInput variant="settings" min={1} max={100} value={draft.loreScanDepth} onValueCommit={(value) => patch({ loreScanDepth: numberOrNull(value) ?? 4 })} />
            </Field>
            <Field label={t({ ko: '로어북 토큰 상한', en: 'Lorebook token budget' })}>
              <NumberStepperInput variant="settings" min={0} max={32768} step={128} value={draft.loreTokenBudget} onValueCommit={(value) => patch({ loreTokenBudget: numberOrNull(value) ?? 1024 })} />
            </Field>
            {draft.engine === 'llm' ? (
              <Field label={t({ ko: '로어북 삽입 위치', en: 'Lorebook insert depth' })} info={t({ ko: '대화 끝에서 몇 턴 앞에 넣을지.', en: 'How many turns before the end of the chat to insert it.' })}>
                <NumberStepperInput variant="settings" min={0} max={20} value={draft.loreDepth} onValueCommit={(value) => patch({ loreDepth: numberOrNull(value) ?? 4 })} />
              </Field>
            ) : null}
          </div>
        ) : null}
      </EditorGroup>
    </div>
  )
}
