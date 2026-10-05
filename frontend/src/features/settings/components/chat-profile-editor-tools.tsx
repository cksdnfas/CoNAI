import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Pencil, Plus } from 'lucide-react'
import { Chip, ToggleChip } from '@/components/ui/chip'
import { IconButton } from '@/components/ui/icon-button'
import { Select } from '@/components/ui/select'
import { Tip } from '@/components/ui/tooltip'
import { getChatScopeCopy } from '@/features/codex-chat/chat-scope-copy'
import { chatToolLabel } from '@/features/codex-chat/chat-tool-catalog'
import { useI18n } from '@/i18n'
import { CHAT_GENERATION_PRESETS_QUERY_KEY, CHAT_SCOPES, CHAT_TOOL_PRESETS_QUERY_KEY, listChatGenerationPresets, listChatToolPresets, type ChatProfileDefaults, type ChatToolPreset, type ChatToolPresetInput } from '@/lib/api-codex-chat'
import { CollapsibleRow } from './chat-profile-sections'
import { EditorGroup, SwitchLine, type Draft, type PatchDraft } from './chat-profile-editor-fields'
import { ChatProfileToolLimits } from './chat-profile-tools'
import { ChatToolPicker, useChatToolGroups } from './chat-tool-picker'
import { ChatToolPresetEditorModal } from './chat-tool-preset-editor-modal'

const DIRECT = 'direct'

/**
 * CoNAI tools (MCP) for the profile: the switch, then which tool preset applies (or "direct": the profile's own
 * scopes and tools, picked here), and the folded limits for API LLM profiles.
 */
export function ChatProfileToolsPanel({ open, draft, patch, defaults }: {
  open: boolean
  draft: Draft
  patch: PatchDraft
  defaults: ChatProfileDefaults | undefined
}) {
  const { t } = useI18n()
  const presetsQuery = useQuery({ queryKey: CHAT_TOOL_PRESETS_QUERY_KEY, queryFn: listChatToolPresets, enabled: open && draft.mcpEnabled })
  const presets = presetsQuery.data ?? []
  const preset = presets.find((item) => item.id === draft.toolPresetId) ?? null
  const [presetEditor, setPresetEditor] = useState<{ preset: ChatToolPreset | null; initial?: ChatToolPresetInput } | null>(null)
  const { groups, isPending } = useChatToolGroups(open && draft.mcpEnabled && draft.toolPresetId === null)
  const generationPresetsQuery = useQuery({ queryKey: CHAT_GENERATION_PRESETS_QUERY_KEY, queryFn: listChatGenerationPresets, enabled: open && draft.mcpEnabled })
  const generationPresets = generationPresetsQuery.data ?? []
  const canGenerate = (preset ? preset.scopes : draft.mcpScopes).includes('generate')

  const pickPreset = (value: string) => {
    if (value === DIRECT) {
      // Direct setup continues from the grant the preset gave, so nothing is lost by unlinking.
      patch(preset ? { toolPresetId: null, mcpScopes: preset.scopes, toolAllowlist: preset.toolAllowlist } : { toolPresetId: null })
      return
    }
    patch({ toolPresetId: Number(value) })
  }

  return (
    <div className="space-y-4">
      <EditorGroup>
        <SwitchLine label={t({ ko: 'CoNAI 도구(MCP) 사용', en: 'Use CoNAI tools (MCP)' })} checked={draft.mcpEnabled} onCheckedChange={(mcpEnabled) => patch({ mcpEnabled })} />
        {draft.mcpEnabled ? (
          <div className="flex min-h-10 items-center justify-between gap-3 text-sm">
            <span className="shrink-0">{t({ ko: '도구 프리셋', en: 'Tool preset' })}</span>
            <div className="flex min-w-0 items-center gap-1">
              <Select
                variant="settings"
                className="h-9 w-56 px-3"
                value={draft.toolPresetId === null || !preset ? DIRECT : String(preset.id)}
                onChange={(event) => pickPreset(event.target.value)}
                aria-label={t({ ko: '도구 프리셋', en: 'Tool preset' })}
              >
                {presets.map((item) => <option key={item.id} value={String(item.id)}>{item.name}</option>)}
                <option value={DIRECT}>{t({ ko: '직접 설정', en: 'Set here' })}</option>
              </Select>
              {preset ? (
                <IconButton size="icon-sm" variant="ghost" onClick={() => setPresetEditor({ preset })} label={t({ ko: '프리셋 편집', en: 'Edit preset' })}><Pencil /></IconButton>
              ) : (
                <IconButton
                  size="icon-sm"
                  variant="ghost"
                  onClick={() => setPresetEditor({ preset: null, initial: { name: '', scopes: draft.mcpScopes, toolAllowlist: draft.toolAllowlist } })}
                  label={t({ ko: '이 설정을 프리셋으로 저장', en: 'Save this setup as a preset' })}
                >
                  <Plus />
                </IconButton>
              )}
            </div>
          </div>
        ) : null}
        {draft.mcpEnabled && preset ? (
          <div className="space-y-2 text-xs text-muted-foreground">
            <div className="flex flex-wrap gap-1">
              {preset.scopes.map((scope) => <Chip key={scope} size="sm">{getChatScopeCopy(scope, t).label}</Chip>)}
            </div>
            <p className="leading-relaxed">
              {preset.toolAllowlist === null
                ? t({ ko: '권한 안의 모든 도구를 써.', en: 'Every tool in the scopes.' })
                : preset.toolAllowlist.length === 0
                  ? t({ ko: '고른 도구가 없어.', en: 'No tools picked.' })
                  : preset.toolAllowlist.map((name) => chatToolLabel(name, t)).join(' · ')}
            </p>
          </div>
        ) : null}
        {draft.mcpEnabled && !preset ? (
          <div className="space-y-3">
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
              meta={draft.generationPresetIds.length > 0 ? t({ ko: '{count}개 · 이 프리셋으로만 그려', en: '{count} · draws only with these' }, { count: draft.generationPresetIds.length }) : t({ ko: '없음 · 자유 생성', en: 'None · free-form generation' })}
              defaultOpen={draft.generationPresetIds.length > 0}
            >
              <div className="flex flex-wrap gap-1.5">
                {generationPresets.map((item) => {
                  const linked = draft.generationPresetIds.includes(item.id)
                  return (
                    <ToggleChip
                      key={item.id}
                      pressed={linked}
                      title={item.instruction || undefined}
                      onClick={() => patch({ generationPresetIds: linked ? draft.generationPresetIds.filter((id) => id !== item.id) : [...draft.generationPresetIds, item.id] })}
                    >
                      {item.name}
                      <span className="font-mono opacity-60">{item.kind === 'nai' ? 'NAI' : 'Comfy'}</span>
                    </ToggleChip>
                  )
                })}
                {generationPresetsQuery.isSuccess && generationPresets.length === 0 ? <span className="text-sm text-muted-foreground">{t({ ko: 'NAI나 ComfyUI 생성 패널에서 "채팅 프리셋으로 저장"을 눌러 먼저 만들어.', en: 'Make one first with "Save as chat preset" in the NAI or ComfyUI panel.' })}</span> : null}
              </div>
              {draft.generationPresetIds.length > 0 && !canGenerate ? <p className="text-xs text-destructive">{t({ ko: '생성 권한이 없어서 프리셋 도구가 나타나지 않아.', en: 'Without the generate scope the preset tools do not appear.' })}</p> : null}
              {draft.generationPresetIds.length > 0 ? <p className="text-xs text-muted-foreground">{t({ ko: '프리셋이 연결되면 자유 생성 도구와 워크플로 조회 도구는 숨겨지고, 모델은 프리셋이 열어둔 필드만 채워.', en: 'With presets linked, free-form generation and workflow lookups are withheld; the model fills only the fields the presets expose.' })}</p> : null}
            </CollapsibleRow>
          </div>
        ) : null}
        {draft.mcpEnabled && draft.engine === 'llm' ? (
          <div className="border-t border-line">
            <CollapsibleRow
              title={t({ ko: '고급', en: 'Advanced' })}
              meta={t({ ko: '반복 {rounds}회 · 결과 {chars}자', en: '{rounds} rounds · {chars} chars' }, { rounds: draft.maxToolRounds, chars: draft.toolOutputLimit.toLocaleString() })}
            >
              <ChatProfileToolLimits maxToolRounds={draft.maxToolRounds} toolOutputLimit={draft.toolOutputLimit} onChange={patch} />
            </CollapsibleRow>
          </div>
        ) : null}
      </EditorGroup>
      <ChatToolPresetEditorModal
        open={presetEditor !== null}
        preset={presetEditor?.preset ?? null}
        initial={presetEditor?.initial}
        onClose={() => setPresetEditor(null)}
        onSaved={(saved) => patch({ toolPresetId: saved.id })}
      />
    </div>
  )
}
