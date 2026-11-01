import { BookOpen } from 'lucide-react'
import { ToggleChip } from '@/components/ui/chip'
import { EmptyState } from '@/components/ui/empty-state'
import { Field } from '@/components/ui/field'
import { NumberStepperInput } from '@/components/ui/number-stepper-input'
import { useI18n } from '@/i18n'
import { CHAT_PROFILE_DEFAULTS, CHAT_PROFILE_LIMITS } from '@conai/shared'
import type { ChatLorebookSummary } from '@/lib/api-codex-chat'
import { numberOrNull, type Draft, type PatchDraft } from './chat-profile-editor-fields'
import { SwitchLine } from '@/components/ui/switch-line'
import { EditorGroup } from '@/components/ui/editor-group'
import { ChatProfileLinkedFiles } from './chat-profile-linked-files'
import { ChatProfileWorkspace } from './chat-profile-workspace'
import { SettingsAdvanced } from './settings-navigation'

/**
 * What the model may draw on (the 참고 자료 tab): the lorebooks, linked folders and files, and a default workspace to
 * work in. The lorebook numbers fold away as advanced settings. The recent-turn count is on the model tab, beside the
 * context size it has to fit.
 */
export function ChatProfileMemoryPanel({ draft, patch, lorebooks }: {
  draft: Draft
  patch: PatchDraft
  /** The linkable lorebooks; undefined until they load. */
  lorebooks: ChatLorebookSummary[] | undefined
}) {
  const { t } = useI18n()
  const isPi = draft.engine === 'llm' && draft.llmRuntime === 'pi'

  return (
    <div className="space-y-4">
      <EditorGroup label={t({ ko: '로어북', en: 'Lorebooks' })}>
        <div className="flex flex-wrap gap-1.5">
          {(lorebooks ?? []).map((lorebook) => {
            const linked = draft.lorebookIds.includes(lorebook.id)
            return (
              <ToggleChip key={lorebook.id} pressed={linked} onClick={() => patch({ lorebookIds: linked ? draft.lorebookIds.filter((id) => id !== lorebook.id) : [...draft.lorebookIds, lorebook.id] })}>
                <BookOpen className="size-3.5 text-resource-lorebook" />
                {lorebook.name}
                {lorebook.kind === 'account' ? <span className="opacity-60">{t({ ko: '계정', en: 'Account' })}</span> : null}
                <span className="opacity-60">{lorebook.entryCount}</span>
              </ToggleChip>
            )
          })}
          {lorebooks && lorebooks.length === 0 ? <EmptyState size="compact" title={t({ ko: '아직 로어북이 없어', en: 'No lorebooks yet' })} /> : null}
        </div>
        <SwitchLine label={t({ ko: '대화 중 로어 제안 받기', en: 'Allow lore proposals' })} checked={draft.allowLoreProposals} onCheckedChange={(allowLoreProposals) => patch({ allowLoreProposals })} />
        <SettingsAdvanced count={draft.engine === 'llm' && !isPi ? 4 : 3}>
          <div className="grid gap-3 md:grid-cols-4">
            <Field label={t({ ko: '로어북 최근 메시지', en: 'Lorebook recent messages' })}>
              <NumberStepperInput variant="settings" {...CHAT_PROFILE_LIMITS.loreScanDepth} value={draft.loreScanDepth} onValueCommit={(value) => patch({ loreScanDepth: numberOrNull(value) ?? CHAT_PROFILE_DEFAULTS.loreScanDepth })} />
            </Field>
            <Field label={t({ ko: '로어북 토큰 상한', en: 'Lorebook token budget' })}>
              <NumberStepperInput variant="settings" {...CHAT_PROFILE_LIMITS.loreTokenBudget} step={128} value={draft.loreTokenBudget} onValueCommit={(value) => patch({ loreTokenBudget: numberOrNull(value) ?? CHAT_PROFILE_DEFAULTS.loreTokenBudget })} />
            </Field>
            {draft.engine === 'llm' && !isPi ? (
              <Field label={t({ ko: '로어북 삽입 위치', en: 'Lorebook insert depth' })} info={t({ ko: '대화 끝에서 몇 턴 앞에 넣을지.', en: 'How many turns before the end of the chat to insert it.' })}>
                <NumberStepperInput variant="settings" {...CHAT_PROFILE_LIMITS.loreDepth} value={draft.loreDepth} onValueCommit={(value) => patch({ loreDepth: numberOrNull(value) ?? CHAT_PROFILE_DEFAULTS.loreDepth })} />
              </Field>
            ) : null}
            <Field label={t({ ko: '재귀 단계', en: 'Recursion levels' })} info={t({ ko: '걸린 로어 내용 속 키워드로 다른 항목을 몇 단계까지 더 부를지. 0이면 꺼짐.', en: 'How many levels of entries the chosen lore’s own text can bring in. 0 turns it off.' })}>
              <NumberStepperInput variant="settings" {...CHAT_PROFILE_LIMITS.loreRecursionDepth} value={draft.loreRecursionDepth} onValueCommit={(value) => patch({ loreRecursionDepth: numberOrNull(value) ?? CHAT_PROFILE_DEFAULTS.loreRecursionDepth })} />
            </Field>
          </div>
        </SettingsAdvanced>
      </EditorGroup>

      <ChatProfileLinkedFiles value={draft.linkedFiles} onChange={(linkedFiles) => patch({ linkedFiles })} />
      <ChatProfileWorkspace value={draft.workspaces} onChange={(workspaces) => patch({ workspaces })} />
    </div>
  )
}
