import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Download, Link2, Lock, Plus, Save } from 'lucide-react'
import { CHAT_DELEGATABLE_PERMISSION_KEYS, PERMISSION_CATALOG } from '@conai/shared'
import { Chip, ToggleChip } from '@/components/ui/chip'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { IconButton } from '@/components/ui/icon-button'
import { Tip } from '@/components/ui/tooltip'
import { getChatScopeCopy } from '@/features/codex-chat/chat-scope-copy'
import { useI18n } from '@/i18n'
import { CHAT_GENERATION_PRESETS_QUERY_KEY, CHAT_SCOPES, CHAT_TOOL_PRESETS_QUERY_KEY, listChatGenerationPresets, listChatToolPresets, type ChatProfileDefaults, type ChatSkill, type ChatToolPreset, type ChatToolPresetInput } from '@/lib/api-codex-chat'
import { CHAT_SKILL_LIMITS } from '@conai/shared'
import { ChatSkillEditorModal } from './chat-skill-editor-modal'
import { CollapsibleRow } from '@/components/ui/collapsible-row'
import { type Draft, type PatchDraft } from './chat-profile-editor-fields'
import { SwitchLine } from '@/components/ui/switch-line'
import { EditorGroup } from '@/components/ui/editor-group'
import { ChatProfileAgentSetting, ChatProfileToolLimits } from './chat-profile-tools'
import { ChatToolPicker, useChatToolGroups } from './chat-tool-picker'
import { ChatToolPresetEditorModal } from './chat-tool-preset-editor-modal'
import { SettingsAdvanced } from './settings-navigation'
import { SecurityPermissionChecklist } from './security-permission-checklist'
import { setPermissionGrant } from './security-permission-catalog'

const DELEGATABLE_PERMISSIONS = PERMISSION_CATALOG
  .filter((permission) => CHAT_DELEGATABLE_PERMISSION_KEYS.some((key) => key === permission.key))
  .map((permission) => ({ permissionKey: permission.key, label: permission.label.en, description: permission.description }))

/**
 * CoNAI tools (MCP) for the profile: the switch, the profile's own scopes and tools (a tool preset only loads a copy),
 * the linked generation presets, and (folded advanced settings) the tool-call limits for API LLM profiles. Skills are
 * the chat's own (use_skill), so they are linked whether or not CoNAI tools are on.
 */
export function ChatProfileToolsPanel({ open, draft, patch, defaults, skills }: {
  open: boolean
  draft: Draft
  patch: PatchDraft
  defaults: ChatProfileDefaults | undefined
  skills: ChatSkill[] | undefined
}) {
  const { t } = useI18n()
  const presetsQuery = useQuery({ queryKey: CHAT_TOOL_PRESETS_QUERY_KEY, queryFn: listChatToolPresets, enabled: open && draft.mcpEnabled })
  const presets = presetsQuery.data ?? []
  const [presetEditor, setPresetEditor] = useState<{ preset: ChatToolPreset | null; initial?: ChatToolPresetInput } | null>(null)
  const [skillEditor, setSkillEditor] = useState(false)
  const skillsFull = draft.skillIds.length >= CHAT_SKILL_LIMITS.perProfile
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
        {draft.mcpEnabled && draft.engine !== 'codex' ? (
          <SettingsAdvanced count={1}>
            <ChatProfileToolLimits toolOutputLimit={draft.toolOutputLimit} onChange={patch} />
          </SettingsAdvanced>
        ) : null}
      </EditorGroup>
      <EditorGroup
        label={t({ ko: '스킬', en: 'Skills' })}
        info={t({ ko: '모델은 연결한 스킬의 이름과 "언제 쓰는지"만 보다가, 요청이 맞으면 use_skill로 지시를 불러와 따라. 스킬은 자원 › 프리셋에서 고쳐.', en: 'The model sees the name and "when to use" of each linked skill and loads its instructions with use_skill when a request fits. Edit skills under Resources › Presets.' })}
        count={draft.skillIds.length}
        actions={<IconButton size="icon-sm" variant="ghost" disabled={skillsFull} onClick={() => setSkillEditor(true)} label={t({ ko: '스킬 추가', en: 'Add skill' })}><Plus /></IconButton>}
      >
        <div className="flex flex-wrap gap-1.5">
          {(skills ?? []).map((skill) => {
            const linked = draft.skillIds.includes(skill.id)
            return (
              <Tip key={skill.id} content={skill.description} className="whitespace-pre-line">
                <ToggleChip
                  pressed={linked}
                  disabled={!linked && skillsFull}
                  onClick={() => patch({ skillIds: linked ? draft.skillIds.filter((id) => id !== skill.id) : [...draft.skillIds, skill.id] })}
                >
                  {skill.name}
                </ToggleChip>
              </Tip>
            )
          })}
          {skills && skills.length === 0 ? <span className="text-sm text-muted-foreground">{t({ ko: '아직 없어.', en: 'None yet.' })}</span> : null}
        </div>
      </EditorGroup>
      <EditorGroup label={t({ ko: '프로필 위임 권한', en: 'Profile-delegated permissions' })} count={draft.delegatedPermissions.length}>
        <p className="text-sm text-muted-foreground">
          {t({ ko: '이 프로필에서 켜고 선택한 도구만 추가 권한을 사용해. 사용자의 페이지·직접 API 권한은 바뀌지 않아. 설정·관리 권한은 위임할 수 없어.', en: 'Only this profile’s enabled and selected tools can use these additional permissions. The user’s own pages and direct API permissions stay unchanged. Configuration and administration privileges cannot be delegated.' })}
        </p>
        <SecurityPermissionChecklist
          permissionCatalog={DELEGATABLE_PERMISSIONS}
          groupKey={null}
          selectedKeys={draft.delegatedPermissions}
          inheritedSources={{}}
          disabled={false}
          onToggle={(key, enabled) => patch({ delegatedPermissions: setPermissionGrant(draft.delegatedPermissions, key, enabled) })}
        />
      </EditorGroup>
      <EditorGroup label={t({ ko: '에이전트', en: 'Agent' })}>
        <ChatProfileAgentSetting agentEnabled={draft.agentEnabled} agentDescription={draft.agentDescription} onChange={patch} />
      </EditorGroup>
      <ChatToolPresetEditorModal
        open={presetEditor !== null}
        preset={presetEditor?.preset ?? null}
        initial={presetEditor?.initial}
        onClose={() => setPresetEditor(null)}
      />
      <ChatSkillEditorModal
        open={skillEditor}
        skill={null}
        onClose={() => setSkillEditor(false)}
        onSaved={(created) => patch({ skillIds: [...draft.skillIds, created.id] })}
      />
    </div>
  )
}
