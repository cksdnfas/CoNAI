import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Download, Link2, Lock, Save } from 'lucide-react'
import { Chip, ToggleChip } from '@/components/ui/chip'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { IconButton } from '@/components/ui/icon-button'
import { Tip } from '@/components/ui/tooltip'
import { getChatScopeCopy } from '@/features/codex-chat/chat-scope-copy'
import { useI18n } from '@/i18n'
import { CHAT_GENERATION_PRESETS_QUERY_KEY, CHAT_SCOPES, CHAT_TOOL_PRESETS_QUERY_KEY, listChatGenerationPresets, listChatToolPresets, type ChatProfileDefaults, type ChatToolPreset, type ChatToolPresetInput } from '@/lib/api-codex-chat'
import { CollapsibleRow } from '@/components/ui/collapsible-row'
import { SwitchLine, type Draft, type PatchDraft } from './chat-profile-editor-fields'
import { EditorGroup } from '@/components/ui/editor-group'
import { ChatProfileToolLimits } from './chat-profile-tools'
import { ChatToolPicker, useChatToolGroups } from './chat-tool-picker'
import { ChatToolPresetEditorModal } from './chat-tool-preset-editor-modal'

/**
 * CoNAI tools (MCP) for the profile: the switch, the profile's own scopes and tools (a tool preset only loads a copy),
 * the linked generation presets, and (advanced) the tool-call limits for API LLM profiles.
 */
export function ChatProfileToolsPanel({ open, draft, patch, defaults, advanced }: {
  open: boolean
  draft: Draft
  patch: PatchDraft
  defaults: ChatProfileDefaults | undefined
  /** Shows the tool-call limits. */
  advanced: boolean
}) {
  const { t } = useI18n()
  const presetsQuery = useQuery({ queryKey: CHAT_TOOL_PRESETS_QUERY_KEY, queryFn: listChatToolPresets, enabled: open && draft.mcpEnabled })
  const presets = presetsQuery.data ?? []
  const [presetEditor, setPresetEditor] = useState<{ preset: ChatToolPreset | null; initial?: ChatToolPresetInput } | null>(null)
  const { groups, isPending } = useChatToolGroups(open && draft.mcpEnabled)
  const generationPresetsQuery = useQuery({ queryKey: CHAT_GENERATION_PRESETS_QUERY_KEY, queryFn: listChatGenerationPresets, enabled: open && draft.mcpEnabled })
  const generationPresets = generationPresetsQuery.data ?? []
  // A linked generation preset turns the generate scope on by itself (see resolveChatProfileToolGrant).
  const presetGenerates = draft.generationPresetIds.length > 0

  return (
    <div className="space-y-4">
      <EditorGroup>
        <Tip content={t({ ko: '1:1 채팅을 지금 보는 CoNAI 페이지에 연결해 입력을 읽고 변경안을 제안해. 켜면 입력창에 연결 버튼이 생겨.', en: 'Lets a direct chat connect to the CoNAI page you are on, read its inputs and propose changes. Adds a connect button to the composer.' })} side="bottom" align="start">
          <div><SwitchLine label={t({ ko: '페이지 어시스턴트', en: 'Page assistant' })} checked={draft.pageAssist} onCheckedChange={(pageAssist) => patch({ pageAssist })} /></div>
        </Tip>
        <SwitchLine label={t({ ko: 'CoNAI 도구(MCP) 사용', en: 'Use CoNAI tools (MCP)' })} checked={draft.mcpEnabled} onCheckedChange={(mcpEnabled) => patch({ mcpEnabled })} />
        {draft.mcpEnabled ? (
          <div className="space-y-3">
            <div className="flex min-h-10 items-center gap-3 text-sm">
              <span className="shrink-0">{t({ ko: '범위', en: 'Scopes' })}</span>
              <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
                {(defaults?.scopes ?? CHAT_SCOPES).map((scope) => {
                  const copy = getChatScopeCopy(scope, t)
                  const forced = scope === 'generate' && presetGenerates
                  const pressed = forced || draft.mcpScopes.includes(scope)
                  const tip = forced ? t({ ko: '생성 프리셋이 켰어', en: 'On because a generation preset is linked' })
                    : scope === 'configure' ? `${copy.description} ${t({ ko: '관리자 계정에서만 동작해.', en: 'Works only for administrator accounts.' })}`
                    : copy.description
                  return (
                    <Tip key={scope} content={tip} side="bottom" align="start">
                      <ToggleChip size="sm" pressed={pressed} disabled={forced || (pressed && draft.mcpScopes.length === 1)} onClick={() => patch({ mcpScopes: pressed ? draft.mcpScopes.filter((item) => item !== scope) : [...draft.mcpScopes, scope] })}>
                        {forced ? <Link2 /> : scope === 'configure' ? <Lock /> : null}
                        {copy.label}
                      </ToggleChip>
                    </Tip>
                  )
                })}
              </div>
              <div className="flex shrink-0 items-center gap-0.5">
                <DropdownMenu>
                  <Tip content={t({ ko: '도구 프리셋 불러오기', en: 'Load a tool preset' })}>
                    <DropdownMenuTrigger asChild>
                      <IconButton size="icon-sm" variant="ghost" disabled={presets.length === 0} label={t({ ko: '도구 프리셋 불러오기', en: 'Load a tool preset' })} tooltip={false}><Download /></IconButton>
                    </DropdownMenuTrigger>
                  </Tip>
                  <DropdownMenuContent align="end" className="min-w-48">
                    {presets.map((item) => (
                      <DropdownMenuItem key={item.id} onSelect={() => patch({ mcpScopes: item.scopes, toolAllowlist: item.toolAllowlist })}>
                        <span className="min-w-0 flex-1 truncate">{item.name}</span>
                        <span className="text-xs text-muted-foreground">{item.toolAllowlist === null ? t({ ko: '모든 도구', en: 'All tools' }) : t({ ko: '도구 {count}', en: '{count} tools' }, { count: item.toolAllowlist.length })}</span>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
                <IconButton
                  size="icon-sm"
                  variant="ghost"
                  onClick={() => setPresetEditor({ preset: null, initial: { name: '', scopes: draft.mcpScopes, toolAllowlist: draft.toolAllowlist } })}
                  label={t({ ko: '프리셋으로 저장', en: 'Save as a preset' })}
                >
                  <Save />
                </IconButton>
              </div>
            </div>
            <div className="border-t border-line pt-3">
              <ChatToolPicker groups={groups} scopes={draft.mcpScopes} allowlist={draft.toolAllowlist} onChange={(toolAllowlist) => patch({ toolAllowlist })} loading={isPending} />
            </div>
          </div>
        ) : null}
        {draft.mcpEnabled ? (
          <div className="border-t border-line">
            {/* Generation presets are made from the NAI / ComfyUI panels (or settings › chat); here the profile only links them. */}
            <CollapsibleRow
              title={t({ ko: '생성 프리셋', en: 'Generation presets' })}
              meta={draft.generationPresetIds.length > 0 ? t({ ko: '{count}개', en: '{count}' }, { count: draft.generationPresetIds.length }) : t({ ko: '없음', en: 'None' })}
              defaultOpen={draft.generationPresetIds.length > 0}
            >
              <div className="flex flex-wrap gap-1.5">
                {generationPresets.map((item) => {
                  const linked = draft.generationPresetIds.includes(item.id)
                  return (
                    <Tip key={item.id} content={item.instruction || null} className="whitespace-pre-line">
                      <ToggleChip
                        pressed={linked}
                        onClick={() => patch({ generationPresetIds: linked ? draft.generationPresetIds.filter((id) => id !== item.id) : [...draft.generationPresetIds, item.id] })}
                      >
                        {item.name}
                        <span className="font-mono opacity-60">{item.kind === 'nai' ? 'NAI' : 'Comfy'}</span>
                      </ToggleChip>
                    </Tip>
                  )
                })}
                {generationPresetsQuery.isSuccess && generationPresets.length === 0 ? <span className="text-sm text-muted-foreground">{t({ ko: '아직 없어.', en: 'None yet.' })}</span> : null}
              </div>
              {presetGenerates ? (
                <div className="flex flex-wrap gap-1.5 pt-2">
                  <Chip size="sm" tone="muted">{t({ ko: '생성 범위 켜짐', en: 'Generate scope on' })}</Chip>
                  <Chip size="sm" tone="muted">{t({ ko: '자유 생성·워크플로 조회 숨김', en: 'Free-form generation and workflow lookup hidden' })}</Chip>
                </div>
              ) : null}
            </CollapsibleRow>
          </div>
        ) : null}
        {advanced && draft.mcpEnabled && draft.engine !== 'codex' ? (
          <div className="border-t border-line pt-3">
            <ChatProfileToolLimits maxToolRounds={draft.maxToolRounds} toolOutputLimit={draft.toolOutputLimit} onChange={patch} />
          </div>
        ) : null}
      </EditorGroup>
      <ChatToolPresetEditorModal
        open={presetEditor !== null}
        preset={presetEditor?.preset ?? null}
        initial={presetEditor?.initial}
        onClose={() => setPresetEditor(null)}
      />
    </div>
  )
}
