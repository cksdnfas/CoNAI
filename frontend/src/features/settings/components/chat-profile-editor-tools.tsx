import { ToggleChip } from '@/components/ui/chip'
import { Tip } from '@/components/ui/tooltip'
import { getChatScopeCopy } from '@/features/codex-chat/chat-scope-copy'
import { useI18n } from '@/i18n'
import { CHAT_SCOPES, type ChatProfileDefaults } from '@/lib/api-codex-chat'
import { EditorGroup, SwitchLine, type Draft, type PatchDraft } from './chat-profile-editor-fields'
import { ChatProfileToolsAdvanced } from './chat-profile-tools'

/** CoNAI tools (MCP) for the profile: the switch, the granted scopes and the folded per-tool and limit options. */
export function ChatProfileToolsPanel({ open, draft, patch, defaults }: {
  open: boolean
  draft: Draft
  patch: PatchDraft
  defaults: ChatProfileDefaults | undefined
}) {
  const { t } = useI18n()

  return (
    <div className="space-y-4">
      <EditorGroup>
        <SwitchLine label={t({ ko: 'CoNAI 도구(MCP) 사용', en: 'Use CoNAI tools (MCP)' })} checked={draft.mcpEnabled} onCheckedChange={(mcpEnabled) => patch({ mcpEnabled })} />
        {draft.mcpEnabled ? (
          <div className="flex flex-wrap gap-1.5">
            {(defaults?.scopes ?? CHAT_SCOPES).map((scope) => {
              const copy = getChatScopeCopy(scope, t)
              const pressed = draft.mcpScopes.includes(scope)
              return (
                <Tip key={scope} content={copy.description} side="bottom" align="start">
                  <ToggleChip size="sm" pressed={pressed} disabled={pressed && draft.mcpScopes.length === 1} onClick={() => patch({ mcpScopes: pressed ? draft.mcpScopes.filter((item) => item !== scope) : [...draft.mcpScopes, scope] })}>
                    {copy.label}
                  </ToggleChip>
                </Tip>
              )
            })}
          </div>
        ) : null}
        {draft.mcpEnabled ? (
          <div className="border-t border-line">
            <ChatProfileToolsAdvanced
              open={open}
              scopes={draft.mcpScopes}
              allowlist={draft.toolAllowlist}
              isLlm={draft.engine === 'llm'}
              maxToolRounds={draft.maxToolRounds}
              toolOutputLimit={draft.toolOutputLimit}
              onChange={patch}
            />
          </div>
        ) : null}
      </EditorGroup>
    </div>
  )
}
