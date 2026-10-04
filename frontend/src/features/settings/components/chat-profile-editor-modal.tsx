import { useEffect, useId, useRef, useState, type ChangeEvent, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Eye, Save, Trash2 } from 'lucide-react'
import { SegmentedControl } from '@/components/common/segmented-control'
import { Button } from '@/components/ui/button'
import { ToggleChip } from '@/components/ui/chip'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { Field } from '@/components/ui/field'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal'
import { NumberStepperInput } from '@/components/ui/number-stepper-input'
import { Select } from '@/components/ui/select'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Tip } from '@/components/ui/tooltip'
import { ChatProfileAvatar } from '@/features/codex-chat/chat-profile-avatar'
import { getChatScopeCopy } from '@/features/codex-chat/chat-scope-copy'
import { CodexModelSelect } from '@/features/image-generation/components/codex-model-select'
import { CodexReasoningSelect } from '@/features/image-generation/components/codex-reasoning-select'
import { useI18n } from '@/i18n'
import {
  CHAT_ADMIN_PROFILES_QUERY_KEY,
  CHAT_PROFILES_QUERY_KEY,
  CHAT_SCOPES,
  chatProfileBackgroundUrl,
  createChatProfile,
  deleteChatProfile,
  listChatConnectionModels,
  updateChatProfile,
  type ChatProfile,
  type ChatProfileDefaults,
  type ChatProfileInput,
  type ChatStyle,
} from '@/lib/api-codex-chat'
import { getExternalApiProviders } from '@/lib/api-external-api'
import { getCodexGenerationModels } from '@/lib/api-image-generation-queue'
import { getErrorMessage } from '@/lib/error-message'
import { cn } from '@/lib/utils'

import { ChatDisplayBlocksEditor } from './chat-profile-blocks'
import { ChatCastEditor } from './chat-profile-cast'
import { ChatEmoticonGroupPicker } from './chat-profile-emoticons'
import { readAvatarFile } from './chat-profile-images'
import { ChatProfileLook } from './chat-profile-look'
import { ChatLorebookEditor } from './chat-profile-lorebook'
import { ChatProfilePresetMenu } from './chat-profile-preset-menu'
import { ChatProfilePreviewModal } from './chat-profile-preview-modal'
import { ChatPromptSectionsEditor, CollapsibleRow } from './chat-profile-sections'
import { ChatProfileToolsAdvanced } from './chat-profile-tools'

/** `background` stays undefined until the image is changed or removed, so saving does not resend it. */
type Draft = Required<Omit<ChatProfileInput, 'sortOrder' | 'background'>> & { sortOrder: number; background?: string | null }

/** Shown until the server's defaults load (new profiles only). */
const FALLBACK_STYLE: ChatStyle = { typeface: 'sans', roleplay: false, colors: { dialogue: '', narration: '', thought: '' }, backgroundDim: 55, backgroundBlur: 0, blocks: [], cast: [], emoticonGroupIds: [] }

function buildDraft(profile: ChatProfileInput | null, defaults: ChatProfileDefaults | undefined): Draft {
  return {
    name: profile?.name ?? '',
    tagline: profile?.tagline ?? '',
    lorebook: profile?.lorebook ?? [],
    loreScanDepth: profile?.loreScanDepth ?? defaults?.loreScanDepth ?? 4,
    loreTokenBudget: profile?.loreTokenBudget ?? defaults?.loreTokenBudget ?? 1024,
    avatar: profile?.avatar ?? null,
    engine: profile?.engine ?? 'llm',
    providerName: profile?.providerName ?? '',
    model: profile?.model ?? '',
    reasoningEffort: profile?.reasoningEffort ?? '',
    reasoningBudgetTokens: profile?.reasoningBudgetTokens ?? null,
    extraParams: profile?.extraParams ?? '',
    systemPrompt: profile?.systemPrompt ?? '',
    promptSections: profile?.promptSections ?? [],
    greeting: profile?.greeting ?? '',
    alternateGreetings: profile?.alternateGreetings ?? [],
    temperature: profile?.temperature ?? null,
    maxTokens: profile?.maxTokens ?? null,
    mcpEnabled: profile?.mcpEnabled ?? false,
    mcpScopes: profile?.mcpScopes ?? ['read'],
    toolAllowlist: profile?.toolAllowlist ?? null,
    toolOutputLimit: profile?.toolOutputLimit ?? defaults?.toolOutputLimit ?? 12000,
    contextTurns: profile?.contextTurns ?? defaults?.contextTurns ?? 20,
    contextTokens: profile?.contextTokens ?? null,
    summaryEnabled: profile?.summaryEnabled ?? false,
    summaryTriggerTurns: profile?.summaryTriggerTurns ?? defaults?.summaryTriggerTurns ?? 6,
    summaryPrompt: profile?.summaryPrompt ?? '',
    summaryProviderName: profile?.summaryProviderName ?? null,
    summaryModel: profile?.summaryModel ?? '',
    maxToolRounds: profile?.maxToolRounds ?? defaults?.maxToolRounds ?? 8,
    visionEnabled: profile?.visionEnabled ?? false,
    style: { ...FALLBACK_STYLE, ...(profile?.style ?? defaults?.style) },
    isEnabled: profile?.isEnabled ?? true,
    sortOrder: profile?.sortOrder ?? 0,
  }
}

function numberOrNull(value: string) {
  const number = Number(value)
  return value.trim() === '' || !Number.isFinite(number) ? null : number
}

function Section({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-3 border-t border-line pt-4 first:border-t-0 first:pt-0">
      <div className="flex min-h-8 items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {actions}
      </div>
      {children}
    </section>
  )
}

function SwitchLine({ label, checked, onCheckedChange }: { label: string; checked: boolean; onCheckedChange: (checked: boolean) => void }) {
  const id = useId()
  return (
    <div className="flex min-h-10 items-center justify-between gap-3 text-sm">
      <label htmlFor={id} className="flex-1 cursor-pointer">{label}</label>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  )
}

/** A model of a connection: its listed models, or free text when the server lists none. Empty uses the default. */
function ConnectionModelSelect({ value, models, defaultModel, emptyLabel, onChange }: {
  value: string
  models: string[]
  defaultModel: string | null
  /** What an empty value means; defaults to the connection's default model. */
  emptyLabel?: string
  onChange: (value: string) => void
}) {
  const { t } = useI18n()
  const fallback = emptyLabel ?? (defaultModel ? t({ ko: '연결 기본 모델 ({model})', en: 'Connection default ({model})' }, { model: defaultModel }) : t({ ko: '연결 기본 모델', en: 'Connection default' }))
  if (models.length === 0) {
    return <Input variant="settings" value={value} placeholder={fallback} onChange={(event) => onChange(event.target.value)} />
  }
  return (
    <Select variant="settings" value={value} onChange={(event) => onChange(event.target.value)}>
      <option value="">{fallback}</option>
      {models.map((model) => <option key={model} value={model}>{model}</option>)}
      {value && !models.includes(value) ? <option value={value}>{value}</option> : null}
    </Select>
  )
}

/** Create or edit one chat profile (engine, model, persona, tools, context). */
export function ChatProfileEditorModal({ open, profile, initialDraft, defaults, onClose }: {
  open: boolean
  profile: ChatProfile | null
  initialDraft?: ChatProfileInput
  defaults: ChatProfileDefaults | undefined
  onClose: () => void
}) {
  const { t } = useI18n()
  const confirm = useConfirm()
  const { showSnackbar } = useSnackbar()
  const queryClient = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [draft, setDraft] = useState<Draft>(() => buildDraft(profile ?? initialDraft ?? null, defaults))
  const [previewOpen, setPreviewOpen] = useState(false)

  useEffect(() => {
    if (open) {
      setDraft(buildDraft(profile ?? initialDraft ?? null, defaults))
    }
  }, [defaults, initialDraft, open, profile])

  const patch = (next: Partial<Draft>) => setDraft((current) => ({ ...current, ...next }))
  const isLlm = draft.engine === 'llm'

  const providersQuery = useQuery({ queryKey: ['external-api-providers', 'chat-profiles'], queryFn: getExternalApiProviders, enabled: open })
  const llmProviders = (providersQuery.data ?? []).filter((provider) => provider.provider_type === 'llm_openai_compatible' || provider.provider_type === 'llm_ollama')
  const modelsQuery = useQuery({
    queryKey: ['codex-chat-connection-models', draft.providerName],
    queryFn: () => listChatConnectionModels(draft.providerName),
    enabled: open && isLlm && Boolean(draft.providerName),
    retry: false,
    staleTime: 60_000,
  })
  const summaryModelsQuery = useQuery({
    queryKey: ['codex-chat-connection-models', draft.summaryProviderName || draft.providerName],
    queryFn: () => listChatConnectionModels(draft.summaryProviderName || draft.providerName),
    enabled: open && isLlm && draft.summaryEnabled && Boolean(draft.summaryProviderName || draft.providerName),
    retry: false,
    staleTime: 60_000,
  })
  const codexModelsQuery = useQuery({ queryKey: ['codex-generation-models'], queryFn: getCodexGenerationModels, staleTime: 5 * 60 * 1000, enabled: open && !isLlm })

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: CHAT_ADMIN_PROFILES_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: CHAT_PROFILES_QUERY_KEY }),
    ])
  }
  const saveMutation = useMutation({
    mutationFn: () => (profile ? updateChatProfile(profile.id, draft) : createChatProfile(draft)),
    onSuccess: async () => {
      await refresh()
      onClose()
    },
    onError: (error) => showSnackbar({ message: getErrorMessage(error, t({ ko: '저장하지 못했어.', en: 'Could not save.' })), tone: 'error' }),
  })
  const deleteMutation = useMutation({
    mutationFn: () => deleteChatProfile(profile?.id ?? 0),
    onSuccess: async () => {
      await refresh()
      onClose()
    },
    onError: (error) => showSnackbar({ message: getErrorMessage(error, t({ ko: '삭제하지 못했어.', en: 'Could not delete.' })), tone: 'error' }),
  })

  const handleAvatarFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      patch({ avatar: await readAvatarFile(file) })
    } catch {
      showSnackbar({ message: t({ ko: '이미지를 읽지 못했어.', en: 'Could not read the image.' }), tone: 'error' })
    }
  }

  const applySystemPromptPreset = async (content: string) => {
    if (draft.systemPrompt.trim() && draft.systemPrompt.trim() !== content.trim()) {
      const confirmed = await confirm({
        title: t({ ko: '시스템 프롬프트 바꾸기', en: 'Replace system prompt' }),
        description: t({ ko: '지금 시스템 프롬프트를 프리셋 내용으로 바꿀까?', en: 'Replace the current system prompt with the preset?' }),
        confirmLabel: t({ ko: '바꾸기', en: 'Replace' }),
      })
      if (!confirmed) return
    }
    patch({ systemPrompt: content })
  }

  const handleDelete = async () => {
    const confirmed = await confirm({
      title: t({ ko: '프로필 삭제', en: 'Delete profile' }),
      description: t({ ko: '이 프로필을 지울까? 이 프로필로 한 채팅은 남지만 더 보낼 수는 없어.', en: 'Delete this profile? Its chats stay but can no longer send.' }),
      confirmLabel: t({ ko: '삭제', en: 'Delete' }),
      tone: 'destructive',
    })
    if (confirmed) deleteMutation.mutate()
  }

  const serverDefault = t({ ko: '서버 기본값', en: 'Server default' })
  const extraParamsError = (() => {
    if (!isLlm || !draft.extraParams.trim()) return null
    try {
      const parsed: unknown = JSON.parse(draft.extraParams)
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? null : t({ ko: 'JSON 객체여야 해.', en: 'Must be a JSON object.' })
    } catch {
      return t({ ko: 'JSON 형식이 아니야.', en: 'Not valid JSON.' })
    }
  })()
  const models = modelsQuery.data?.models ?? []
  const backgroundUrl = draft.background !== undefined
    ? draft.background
    : profile?.backgroundVersion ? chatProfileBackgroundUrl(profile.id, profile.backgroundVersion) : null
  const canSave = draft.name.trim().length > 0 && (!isLlm || draft.providerName.length > 0) && !saveMutation.isPending

  return (
    <Modal open={open} onClose={onClose} title={profile ? t({ ko: '프로필 편집', en: 'Edit profile' }) : t({ ko: '프로필 추가', en: 'Add profile' })} widthClassName="max-w-3xl">
      <ModalBody className="space-y-6">
        <Section title={t({ ko: '기본', en: 'Basics' })}>
          <div className="flex items-center gap-4">
            <Tip content={t({ ko: '아바타 바꾸기', en: 'Change avatar' })}>
              {/* eslint-disable-next-line no-restricted-syntax -- the avatar itself is the control; Button padding would crop it */}
              <button type="button" className="shrink-0 cursor-pointer rounded-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40" onClick={() => fileInputRef.current?.click()} aria-label={t({ ko: '아바타 바꾸기', en: 'Change avatar' })}>
                <ChatProfileAvatar name={draft.name || '?'} avatar={draft.avatar} engine={draft.engine} size="xl" />
              </button>
            </Tip>
            <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={(event) => void handleAvatarFile(event)} />
            <Field label={t({ ko: '이름', en: 'Name' })} className="min-w-0 flex-1">
              <Input variant="settings" value={draft.name} maxLength={60} onChange={(event) => patch({ name: event.target.value })} />
            </Field>
            <div className="flex flex-col items-end gap-2 self-stretch pt-1">
              <span className="text-xs text-muted-foreground">{t({ ko: '사용', en: 'On' })}</span>
              <Switch checked={draft.isEnabled} onCheckedChange={(isEnabled) => patch({ isEnabled })} aria-label={t({ ko: '사용', en: 'On' })} />
            </div>
          </div>
          {draft.avatar ? (
            <Button variant="link" size="xs" className="px-0 text-muted-foreground" onClick={() => patch({ avatar: null })}>{t({ ko: '아바타 지우기', en: 'Remove avatar' })}</Button>
          ) : null}
          <Field label={t({ ko: '짧은 소개', en: 'Tagline' })}>
            <Input variant="settings" value={draft.tagline} maxLength={200} onChange={(event) => patch({ tagline: event.target.value })} />
          </Field>
        </Section>

        <Section title={t({ ko: '모델', en: 'Model' })}>
          <SegmentedControl
            size="sm"
            value={draft.engine}
            onChange={(engine) => patch({ engine: engine === 'codex' ? 'codex' : 'llm', model: '', reasoningEffort: '', reasoningBudgetTokens: null })}
            items={[
              { value: 'llm', label: t({ ko: 'API LLM', en: 'API LLM' }) },
              { value: 'codex', label: 'Codex' },
            ]}
            ariaLabel={t({ ko: '엔진', en: 'Engine' })}
          />
          {isLlm ? (
            <>
              <div className="grid gap-3 md:grid-cols-2">
                <Field label={t({ ko: 'LLM 연결', en: 'LLM connection' })}>
                  <Select variant="settings" value={draft.providerName} onChange={(event) => patch({ providerName: event.target.value, model: '' })}>
                    <option value="">{t({ ko: '골라줘', en: 'Choose' })}</option>
                    {llmProviders.map((provider) => <option key={provider.provider_name} value={provider.provider_name}>{provider.display_name}</option>)}
                  </Select>
                </Field>
                <Field label={t({ ko: '모델', en: 'Model' })}>
                  <ConnectionModelSelect value={draft.model} models={models} defaultModel={modelsQuery.data?.defaultModel ?? null} onChange={(model) => patch({ model })} />
                </Field>
                <Field label={t({ ko: '온도', en: 'Temperature' })}>
                  <NumberStepperInput variant="settings" allowEmpty step={0.1} min={0} max={2} value={draft.temperature} placeholder={serverDefault} onValueCommit={(value) => patch({ temperature: numberOrNull(value) })} />
                </Field>
                <Field label={t({ ko: '최대 출력 토큰 (추론 포함)', en: 'Max output tokens (incl. reasoning)' })}>
                  <NumberStepperInput variant="settings" allowEmpty step={1024} min={1} value={draft.maxTokens} placeholder={serverDefault} onValueCommit={(value) => patch({ maxTokens: numberOrNull(value) })} />
                </Field>
                <Field label={t({ ko: '추론 강도', en: 'Reasoning effort' })}>
                  <Select variant="settings" value={draft.reasoningEffort} onChange={(event) => patch({ reasoningEffort: event.target.value as ChatProfileInput['reasoningEffort'] ?? '' })}>
                    <option value="">{serverDefault}</option>
                    <option value="none">{t({ ko: '끔 (none)', en: 'Off (none)' })}</option>
                    <option value="low">low</option>
                    <option value="medium">medium</option>
                    <option value="high">high</option>
                  </Select>
                </Field>
                <Field label={t({ ko: '추론 토큰 예산', en: 'Reasoning token budget' })}>
                  <NumberStepperInput variant="settings" allowEmpty step={1024} min={1} value={draft.reasoningBudgetTokens} placeholder={serverDefault} onValueCommit={(value) => patch({ reasoningBudgetTokens: numberOrNull(value) })} />
                </Field>
              </div>
              <div className="border-t border-line">
                <CollapsibleRow title={t({ ko: '고급', en: 'Advanced' })} meta={draft.extraParams.trim() ? t({ ko: '추가 파라미터 있음', en: 'extra parameters set' }) : null}>
                  <Field label={t({ ko: '추가 파라미터 (JSON)', en: 'Extra parameters (JSON)' })}>
                    <Textarea
                      variant="settings"
                      rows={4}
                      className={cn('font-mono text-xs', extraParamsError && 'border-destructive')}
                      value={draft.extraParams}
                      placeholder={'{\n  "chat_template_kwargs": { "enable_thinking": true }\n}'}
                      onChange={(event) => patch({ extraParams: event.target.value })}
                      aria-invalid={Boolean(extraParamsError)}
                    />
                  </Field>
                  {extraParamsError ? <p className="text-xs text-destructive">{extraParamsError}</p> : null}
                </CollapsibleRow>
              </div>
            </>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              <Field label={t({ ko: 'Codex 모델', en: 'Codex model' })}>
                <CodexModelSelect variant="settings" value={draft.model} models={codexModelsQuery.data?.data.models} onChange={(model) => patch({ model })} aria-label={t({ ko: 'Codex 모델', en: 'Codex model' })} />
              </Field>
              <Field label={t({ ko: '추론 강도', en: 'Reasoning effort' })}>
                <CodexReasoningSelect variant="settings" value={draft.reasoningEffort} model={draft.model} models={codexModelsQuery.data?.data.models} onChange={(reasoningEffort) => patch({ reasoningEffort })} />
              </Field>
            </div>
          )}
          {isLlm ? (
            <SwitchLine label={t({ ko: '이미지를 볼 수 있는 모델', en: 'Model can see images' })} checked={draft.visionEnabled} onCheckedChange={(visionEnabled) => patch({ visionEnabled })} />
          ) : null}
        </Section>

        <Section
          title={t({ ko: '프롬프트', en: 'Prompt' })}
          actions={(
            <div className="flex items-center gap-0.5">
              <ChatProfilePresetMenu
                open={open}
                onSystemPrompt={(preset) => void applySystemPromptPreset(preset.content)}
                onSection={(preset) => patch({ promptSections: [...draft.promptSections, { id: `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, title: preset.name, content: preset.content, kind: 'text', enabled: true }] })}
              />
              <IconButton size="icon-sm" variant="ghost" onClick={() => setPreviewOpen(true)} label={t({ ko: '프롬프트 미리보기', en: 'Prompt preview' })}>
                <Eye />
              </IconButton>
            </div>
          )}
        >
          <Field label={t({ ko: '시스템 프롬프트', en: 'System prompt' })}>
            <Textarea variant="settings" rows={5} value={draft.systemPrompt} onChange={(event) => patch({ systemPrompt: event.target.value })} />
          </Field>
          <ChatPromptSectionsEditor sections={draft.promptSections} onChange={(promptSections) => patch({ promptSections })} />
          <div className="border-t border-line">
            <CollapsibleRow title={t({ ko: '첫 인사말', en: 'Greeting' })} meta={draft.greeting.trim() ? null : t({ ko: '없음', en: 'none' })}>
              <Textarea variant="settings" rows={3} value={draft.greeting} onChange={(event) => patch({ greeting: event.target.value })} aria-label={t({ ko: '첫 인사말', en: 'Greeting' })} />
            </CollapsibleRow>
          </div>
        </Section>

        <Section title={t({ ko: '로어북', en: 'Lorebook' })}>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label={t({ ko: '최근 메시지 수', en: 'Recent messages' })}>
              <NumberStepperInput variant="settings" min={1} max={100} value={draft.loreScanDepth} onValueCommit={(value) => patch({ loreScanDepth: numberOrNull(value) ?? 4 })} />
            </Field>
            <Field label={t({ ko: '토큰 상한', en: 'Token budget' })}>
              <NumberStepperInput variant="settings" min={0} max={32768} step={128} value={draft.loreTokenBudget} onValueCommit={(value) => patch({ loreTokenBudget: numberOrNull(value) ?? 1024 })} />
            </Field>
          </div>
          <ChatLorebookEditor entries={draft.lorebook} onChange={(lorebook) => patch({ lorebook })} />
        </Section>

        <Section title={t({ ko: '꾸미기', en: 'Look' })}>
          <ChatProfileLook
            style={draft.style}
            defaults={defaults?.style}
            backgroundUrl={backgroundUrl}
            onStyleChange={(style) => patch({ style })}
            onBackgroundChange={(background) => patch({ background })}
          />
          <div className="space-y-2 border-t border-line pt-3">
            <h4 className="text-xs font-semibold text-muted-foreground">{t({ ko: '이모티콘 그룹', en: 'Emoticon groups' })}</h4>
            <ChatEmoticonGroupPicker selected={draft.style.emoticonGroupIds} onChange={(emoticonGroupIds) => patch({ style: { ...draft.style, emoticonGroupIds } })} />
          </div>
          <div className="space-y-2 border-t border-line pt-3">
            <h4 className="text-xs font-semibold text-muted-foreground">{t({ ko: '등장인물', en: 'Characters' })}</h4>
            <ChatCastEditor cast={draft.style.cast} onChange={(cast) => patch({ style: { ...draft.style, cast } })} />
          </div>
          <div className="space-y-2 border-t border-line pt-3">
            <h4 className="text-xs font-semibold text-muted-foreground">{t({ ko: '표시 블록', en: 'Display blocks' })}</h4>
            <ChatDisplayBlocksEditor blocks={draft.style.blocks} characterName={draft.name} onChange={(blocks) => patch({ style: { ...draft.style, blocks } })} />
          </div>
        </Section>

        <Section title={t({ ko: '도구', en: 'Tools' })}>
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
                isLlm={isLlm}
                maxToolRounds={draft.maxToolRounds}
                toolOutputLimit={draft.toolOutputLimit}
                onChange={patch}
              />
            </div>
          ) : null}
        </Section>

        {isLlm ? (
          <Section title={t({ ko: '컨텍스트', en: 'Context' })}>
            <div className="grid gap-3 md:grid-cols-2">
              <Field label={t({ ko: '참고할 최근 턴 수', en: 'Recent turns sent' })}>
                <NumberStepperInput variant="settings" step={1} min={1} max={200} value={draft.contextTurns} onValueCommit={(value) => patch({ contextTurns: numberOrNull(value) ?? draft.contextTurns })} />
              </Field>
              <Field label={t({ ko: '컨텍스트 길이 (토큰)', en: 'Context length (tokens)' })}>
                <NumberStepperInput variant="settings" allowEmpty step={1024} min={1024} value={draft.contextTokens} placeholder={t({ ko: '제한 없음', en: 'No limit' })} onValueCommit={(value) => patch({ contextTokens: numberOrNull(value) })} />
              </Field>
            </div>
            <SwitchLine label={t({ ko: '대화 요약', en: 'Conversation summary' })} checked={draft.summaryEnabled} onCheckedChange={(summaryEnabled) => patch({ summaryEnabled })} />
            {draft.summaryEnabled ? (
              <>
                <Field label={t({ ko: '요약 시작 (창 밖으로 밀려난 턴 수)', en: 'Summarize after (turns out of the window)' })}>
                  <NumberStepperInput variant="settings" step={1} min={1} max={200} value={draft.summaryTriggerTurns} onValueCommit={(value) => patch({ summaryTriggerTurns: numberOrNull(value) ?? draft.summaryTriggerTurns })} />
                </Field>
                <div className="grid gap-3 md:grid-cols-2">
                  <Field label={t({ ko: '요약 연결', en: 'Summary connection' })}>
                    <Select variant="settings" value={draft.summaryProviderName ?? ''} onChange={(event) => patch({ summaryProviderName: event.target.value || null })}>
                      <option value="">{t({ ko: '대화 모델 그대로', en: 'Same as chat' })}</option>
                      {llmProviders.map((provider) => <option key={provider.provider_name} value={provider.provider_name}>{provider.display_name}</option>)}
                    </Select>
                  </Field>
                  <Field label={t({ ko: '요약 모델', en: 'Summary model' })}>
                    <ConnectionModelSelect
                      value={draft.summaryModel}
                      models={summaryModelsQuery.data?.models ?? []}
                      defaultModel={draft.summaryProviderName ? summaryModelsQuery.data?.defaultModel ?? null : null}
                      emptyLabel={draft.summaryProviderName ? undefined : t({ ko: '대화 모델 그대로', en: 'Same as chat' })}
                      onChange={(summaryModel) => patch({ summaryModel })}
                    />
                  </Field>
                </div>
                <Field label={t({ ko: '요약 프롬프트', en: 'Summary prompt' })}>
                  <Textarea variant="settings" rows={4} value={draft.summaryPrompt} placeholder={defaults?.summaryPrompt} onChange={(event) => patch({ summaryPrompt: event.target.value })} />
                </Field>
              </>
            ) : null}
          </Section>
        ) : null}
      </ModalBody>
      <ModalFooter>
        {profile ? (
          <IconButton size="icon-sm" variant="destructive" onClick={() => void handleDelete()} disabled={deleteMutation.isPending} label={t({ ko: '삭제', en: 'Delete' })}>
            <Trash2 />
          </IconButton>
        ) : null}
        <span className="flex-1" />
        <IconButton size="icon-sm" variant="default" onClick={() => saveMutation.mutate()} disabled={!canSave} label={t({ ko: '저장', en: 'Save' })}>
          <Save />
        </IconButton>
      </ModalFooter>
      <ChatProfilePreviewModal open={previewOpen} draft={{ ...draft, id: profile?.id }} onClose={() => setPreviewOpen(false)} />
    </Modal>
  )
}
