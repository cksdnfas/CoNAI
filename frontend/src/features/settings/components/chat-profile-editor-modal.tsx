import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Save, Trash2 } from 'lucide-react'
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
  createChatProfile,
  deleteChatProfile,
  listChatConnectionModels,
  updateChatProfile,
  type ChatProfile,
  type ChatProfileDefaults,
  type ChatProfileInput,
} from '@/lib/api-codex-chat'
import { getExternalApiProviders } from '@/lib/api-external-api'
import { getCodexGenerationModels } from '@/lib/api-image-generation-queue'
import { getErrorMessage } from '@/lib/error-message'

const AVATAR_SIZE_PX = 128

type Draft = Required<Omit<ChatProfileInput, 'sortOrder'>> & { sortOrder: number }

function buildDraft(profile: ChatProfile | null, defaults: ChatProfileDefaults | undefined): Draft {
  return {
    name: profile?.name ?? '',
    avatar: profile?.avatar ?? null,
    engine: profile?.engine ?? 'llm',
    providerName: profile?.providerName ?? '',
    model: profile?.model ?? '',
    reasoningEffort: profile?.reasoningEffort ?? '',
    systemPrompt: profile?.systemPrompt ?? '',
    characterDescription: profile?.characterDescription ?? '',
    exampleDialogue: profile?.exampleDialogue ?? '',
    userPersona: profile?.userPersona ?? '',
    greeting: profile?.greeting ?? '',
    temperature: profile?.temperature ?? null,
    maxTokens: profile?.maxTokens ?? null,
    mcpEnabled: profile?.mcpEnabled ?? false,
    mcpScopes: profile?.mcpScopes ?? ['read'],
    contextTurns: profile?.contextTurns ?? defaults?.contextTurns ?? 20,
    contextTokens: profile?.contextTokens ?? null,
    summaryEnabled: profile?.summaryEnabled ?? false,
    summaryTriggerTurns: profile?.summaryTriggerTurns ?? defaults?.summaryTriggerTurns ?? 6,
    summaryPrompt: profile?.summaryPrompt ?? '',
    summaryProviderName: profile?.summaryProviderName ?? null,
    summaryModel: profile?.summaryModel ?? '',
    maxToolRounds: profile?.maxToolRounds ?? defaults?.maxToolRounds ?? 8,
    isEnabled: profile?.isEnabled ?? true,
    sortOrder: profile?.sortOrder ?? 0,
  }
}

/** Square-crop and shrink a picked image to a small WebP data URL for the avatar column. */
function readAvatarFile(file: File) {
  return new Promise<string>((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      const side = Math.min(image.naturalWidth, image.naturalHeight)
      const canvas = document.createElement('canvas')
      canvas.width = AVATAR_SIZE_PX
      canvas.height = AVATAR_SIZE_PX
      canvas.getContext('2d')?.drawImage(image, (image.naturalWidth - side) / 2, (image.naturalHeight - side) / 2, side, side, 0, 0, AVATAR_SIZE_PX, AVATAR_SIZE_PX)
      URL.revokeObjectURL(url)
      resolve(canvas.toDataURL('image/webp', 0.85))
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('image'))
    }
    image.src = url
  })
}

function numberOrNull(value: string) {
  const number = Number(value)
  return value.trim() === '' || !Number.isFinite(number) ? null : number
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3 border-t border-line pt-4 first:border-t-0 first:pt-0">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      {children}
    </section>
  )
}

function SwitchLine({ label, checked, onCheckedChange }: { label: string; checked: boolean; onCheckedChange: (checked: boolean) => void }) {
  return (
    <label className="flex min-h-10 cursor-pointer items-center justify-between gap-3 text-sm">
      <span>{label}</span>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </label>
  )
}

/** Create or edit one chat profile (engine, model, persona, tools, context). */
export function ChatProfileEditorModal({ open, profile, defaults, onClose }: {
  open: boolean
  profile: ChatProfile | null
  defaults: ChatProfileDefaults | undefined
  onClose: () => void
}) {
  const { t } = useI18n()
  const confirm = useConfirm()
  const { showSnackbar } = useSnackbar()
  const queryClient = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [draft, setDraft] = useState<Draft>(() => buildDraft(profile, defaults))

  useEffect(() => {
    if (open) {
      setDraft(buildDraft(profile, defaults))
    }
  }, [defaults, open, profile])

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

  const handleDelete = async () => {
    const confirmed = await confirm({
      title: t({ ko: '프로필 삭제', en: 'Delete profile' }),
      description: t({ ko: '이 프로필을 지울까? 이 프로필로 한 채팅은 남지만 더 보낼 수는 없어.', en: 'Delete this profile? Its chats stay but can no longer send.' }),
      confirmLabel: t({ ko: '삭제', en: 'Delete' }),
      tone: 'destructive',
    })
    if (confirmed) deleteMutation.mutate()
  }

  const connectionDefault = t({ ko: '연결 기본값', en: 'Connection default' })
  const models = modelsQuery.data?.models ?? []
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
        </Section>

        <Section title={t({ ko: '모델', en: 'Model' })}>
          <SegmentedControl
            size="sm"
            value={draft.engine}
            onChange={(engine) => patch({ engine: engine === 'codex' ? 'codex' : 'llm', model: '', reasoningEffort: '' })}
            items={[
              { value: 'llm', label: t({ ko: 'API LLM', en: 'API LLM' }) },
              { value: 'codex', label: 'Codex' },
            ]}
            ariaLabel={t({ ko: '엔진', en: 'Engine' })}
          />
          {isLlm ? (
            <div className="grid gap-3 md:grid-cols-2">
              <Field label={t({ ko: 'LLM 연결', en: 'LLM connection' })}>
                <Select variant="settings" value={draft.providerName} onChange={(event) => patch({ providerName: event.target.value, model: '' })}>
                  <option value="">{t({ ko: '골라줘', en: 'Choose' })}</option>
                  {llmProviders.map((provider) => <option key={provider.provider_name} value={provider.provider_name}>{provider.display_name}</option>)}
                </Select>
              </Field>
              <Field label={t({ ko: '모델', en: 'Model' })}>
                {models.length > 0 ? (
                  <Select variant="settings" value={draft.model} onChange={(event) => patch({ model: event.target.value })}>
                    <option value="">{modelsQuery.data?.defaultModel ? `${connectionDefault} (${modelsQuery.data.defaultModel})` : connectionDefault}</option>
                    {models.map((model) => <option key={model} value={model}>{model}</option>)}
                    {draft.model && !models.includes(draft.model) ? <option value={draft.model}>{draft.model}</option> : null}
                  </Select>
                ) : (
                  <Input variant="settings" value={draft.model} placeholder={connectionDefault} onChange={(event) => patch({ model: event.target.value })} />
                )}
              </Field>
              <Field label={t({ ko: '온도', en: 'Temperature' })}>
                <NumberStepperInput variant="settings" allowEmpty step={0.1} min={0} max={2} value={draft.temperature} placeholder={connectionDefault} onValueCommit={(value) => patch({ temperature: numberOrNull(value) })} />
              </Field>
              <Field label={t({ ko: '최대 토큰', en: 'Max tokens' })}>
                <NumberStepperInput variant="settings" allowEmpty step={256} min={1} value={draft.maxTokens} placeholder={connectionDefault} onValueCommit={(value) => patch({ maxTokens: numberOrNull(value) })} />
              </Field>
            </div>
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
        </Section>

        <Section title={t({ ko: '캐릭터', en: 'Character' })}>
          <Field label={t({ ko: '시스템 프롬프트', en: 'System prompt' })}>
            <Textarea variant="settings" rows={4} value={draft.systemPrompt} onChange={(event) => patch({ systemPrompt: event.target.value })} />
          </Field>
          <Field label={t({ ko: '캐릭터 설명', en: 'Character description' })}>
            <Textarea variant="settings" rows={4} value={draft.characterDescription} onChange={(event) => patch({ characterDescription: event.target.value })} />
          </Field>
          <Field label={t({ ko: '대화 예시', en: 'Example dialogue' })}>
            <Textarea variant="settings" rows={4} value={draft.exampleDialogue} onChange={(event) => patch({ exampleDialogue: event.target.value })} />
          </Field>
          <Field label={t({ ko: '내 페르소나', en: 'My persona' })}>
            <Textarea variant="settings" rows={3} value={draft.userPersona} onChange={(event) => patch({ userPersona: event.target.value })} />
          </Field>
          <Field label={t({ ko: '첫 인사말', en: 'Greeting' })}>
            <Textarea variant="settings" rows={2} value={draft.greeting} onChange={(event) => patch({ greeting: event.target.value })} />
          </Field>
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
          {isLlm && draft.mcpEnabled ? (
            <Field label={t({ ko: '도구 호출 반복 한도', en: 'Tool round limit' })}>
              <NumberStepperInput variant="settings" step={1} min={1} max={20} value={draft.maxToolRounds} onValueCommit={(value) => patch({ maxToolRounds: numberOrNull(value) ?? draft.maxToolRounds })} />
            </Field>
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
                    <Input variant="settings" value={draft.summaryModel} placeholder={draft.summaryProviderName ? connectionDefault : t({ ko: '대화 모델', en: 'Chat model' })} onChange={(event) => patch({ summaryModel: event.target.value })} />
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
    </Modal>
  )
}
