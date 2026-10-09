import { useLayoutEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, Download, Save, Trash2 } from 'lucide-react'
import { Checkbox } from '@/components/ui/checkbox'
import { ToggleChip } from '@/components/ui/chip'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { Field, FieldInfo } from '@/components/ui/field'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal'
import { NumberStepperInput } from '@/components/ui/number-stepper-input'
import { Select } from '@/components/ui/select'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { Textarea } from '@/components/ui/textarea'
import { NAI_MODEL_OPTIONS, NAI_RESOLUTION_PRESETS, NAI_SAMPLER_OPTIONS, NAI_SCHEDULER_OPTIONS } from '@/features/image-generation/image-generation-shared'
import { useI18n } from '@/i18n'
import {
  CHAT_ADMIN_PROFILES_QUERY_KEY,
  CHAT_GENERATION_PRESETS_QUERY_KEY,
  createChatGenerationPreset,
  deleteChatGenerationPreset,
  updateChatGenerationPreset,
  type ChatComfyPresetConfig,
  type ChatGenerationPreset,
  type ChatGenerationPresetInput,
  type ChatNaiPresetConfig,
} from '@/lib/api-codex-chat'
import { getGenerationWorkflows } from '@/lib/api-image-generation-workflows'
import type { WorkflowMarkedField } from '@/lib/api-image-generation-types'
import { getErrorMessage } from '@/lib/error-message'
import { EditorGroup, SwitchLine } from './chat-profile-editor-fields'
import { downloadChatGenerationPresetFile } from './chat-generation-preset-file'
import { CHAT_DOCK_INSET, useSettingsEditorChatPage } from './use-settings-editor-chat-page'
import { ChatFilledLabel } from '@/features/codex-chat/chat-page-context'
import type { ChatPageField, ChatPageValue } from '@conai/shared'

export const EMPTY_NAI_PRESET: ChatNaiPresetConfig = {
  model: 'nai-diffusion-4-5-curated',
  sampler: 'k_euler_ancestral',
  noiseSchedule: 'karras',
  steps: 28,
  scale: 5,
  varietyPlus: false,
  transparentBackground: false,
  promptPrefix: '',
  promptSuffix: '',
  negativePrompt: '',
  sizes: [{ label: 'Portrait 832×1216', width: 832, height: 1216 }],
  characters: [],
  useCoords: false,
  vibes: [],
  characterRefs: [],
}

function emptyDraft(kind: 'nai' | 'comfyui'): ChatGenerationPresetInput {
  return kind === 'nai'
    ? { name: '', instruction: '', kind, nai: EMPTY_NAI_PRESET, comfyui: null }
    : { name: '', instruction: '', kind, nai: null, comfyui: { workflowId: 0, serverId: null, serverTag: null, fixedInputs: {}, exposedFieldIds: [] } }
}

function numberOrKeep(value: string, keep: number) {
  const number = Number(value)
  return value.trim() === '' || !Number.isFinite(number) ? keep : number
}

/** The fixed NAI setup: what the model never sees, plus the sizes it may choose from. */
function NaiPresetFields({ config, onChange }: { config: ChatNaiPresetConfig; onChange: (config: ChatNaiPresetConfig) => void }) {
  const { t } = useI18n()
  const patch = (next: Partial<ChatNaiPresetConfig>) => onChange({ ...config, ...next })
  // Sizes saved from the panel may be custom; they stay selectable next to the standard presets.
  const sizeOptions = [...NAI_RESOLUTION_PRESETS.map((preset) => ({ label: preset.label, width: preset.width, height: preset.height }))]
  for (const size of config.sizes) if (!sizeOptions.some((option) => option.width === size.width && option.height === size.height)) sizeOptions.push(size)
  const toggleSize = (option: { label: string; width: number; height: number }) => {
    const index = config.sizes.findIndex((size) => size.width === option.width && size.height === option.height)
    if (index >= 0) {
      if (config.sizes.length === 1) return
      patch({ sizes: config.sizes.filter((_, i) => i !== index) })
    } else {
      patch({ sizes: [...config.sizes, option] })
    }
  }
  const assetNote = [
    config.vibes.length > 0 ? t({ ko: '바이브 {count}개', en: '{count} vibes' }, { count: config.vibes.length }) : null,
    config.characterRefs.length > 0 ? t({ ko: '캐릭터 레퍼런스 {count}개', en: '{count} character references' }, { count: config.characterRefs.length }) : null,
    config.characters.length > 0 ? t({ ko: '고정 캐릭터 프롬프트 {count}개', en: '{count} fixed character prompts' }, { count: config.characters.length }) : null,
  ].filter(Boolean)

  return (
    <div className="space-y-4">
      <EditorGroup label={t({ ko: '모델', en: 'Model' })}>
        <div className="grid gap-3 md:grid-cols-3">
          <Field label={<ChatFilledLabel fieldId="model">{t({ ko: '모델', en: 'Model' })}</ChatFilledLabel>}>
            <Select variant="settings" className="px-3" value={config.model} onChange={(event) => patch({ model: event.target.value })}>
              {NAI_MODEL_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              {NAI_MODEL_OPTIONS.some((option) => option.value === config.model) ? null : <option value={config.model}>{config.model}</option>}
            </Select>
          </Field>
          <Field label={<ChatFilledLabel fieldId="sampler">{t({ ko: '샘플러', en: 'Sampler' })}</ChatFilledLabel>}>
            <Select variant="settings" className="px-3" value={config.sampler} onChange={(event) => patch({ sampler: event.target.value })}>
              {NAI_SAMPLER_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              {NAI_SAMPLER_OPTIONS.some((option) => option.value === config.sampler) ? null : <option value={config.sampler}>{config.sampler}</option>}
            </Select>
          </Field>
          <Field label={<ChatFilledLabel fieldId="noiseSchedule">{t({ ko: '스케줄러', en: 'Scheduler' })}</ChatFilledLabel>}>
            <Select variant="settings" className="px-3" value={config.noiseSchedule} onChange={(event) => patch({ noiseSchedule: event.target.value })}>
              {NAI_SCHEDULER_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </Select>
          </Field>
          <Field label={<ChatFilledLabel fieldId="steps">{t({ ko: '스텝', en: 'Steps' })}</ChatFilledLabel>}>
            <NumberStepperInput variant="settings" step={1} min={1} max={50} value={config.steps} onValueCommit={(value) => patch({ steps: numberOrKeep(value, config.steps) })} />
          </Field>
          <Field label={<ChatFilledLabel fieldId="scale">{t({ ko: 'CFG', en: 'CFG scale' })}</ChatFilledLabel>}>
            <NumberStepperInput variant="settings" step={0.5} min={0} max={30} value={config.scale} onValueCommit={(value) => patch({ scale: numberOrKeep(value, config.scale) })} />
          </Field>
        </div>
        <SwitchLine label="Variety+" checked={config.varietyPlus} onCheckedChange={(varietyPlus) => patch({ varietyPlus })} />
        <SwitchLine label={t({ ko: '투명 배경', en: 'Transparent background' })} checked={config.transparentBackground} onCheckedChange={(transparentBackground) => patch({ transparentBackground })} />
      </EditorGroup>
      <EditorGroup label={t({ ko: '모델이 고를 수 있는 크기', en: 'Sizes the model may pick' })} info={t({ ko: '하나만 고르면 크기 필드가 모델에게 보이지 않아.', en: 'With one size picked, the model sees no size field.' })}>
        <div className="flex flex-wrap gap-1.5">
          {sizeOptions.map((option) => {
            const pressed = config.sizes.some((size) => size.width === option.width && size.height === option.height)
            return <ToggleChip key={`${option.width}x${option.height}`} size="sm" pressed={pressed} disabled={pressed && config.sizes.length === 1} onClick={() => toggleSize(option)}>{option.label}</ToggleChip>
          })}
        </div>
      </EditorGroup>
      <EditorGroup label={t({ ko: '고정 프롬프트', en: 'Fixed prompt' })} info={t({ ko: '모델은 상황 프롬프트만 써. 서버가 앞부분, 상황, 뒷부분 순서로 합쳐.', en: 'The model writes only the scene; the server joins before, scene, after.' })}>
        <Field label={<ChatFilledLabel fieldId="promptPrefix">{t({ ko: '앞부분 (퀄리티·작가·화풍)', en: 'Before the scene (quality, artist, style)' })}</ChatFilledLabel>}>
          <Textarea variant="settings" rows={3} value={config.promptPrefix} onChange={(event) => patch({ promptPrefix: event.target.value })} />
        </Field>
        <Field label={<ChatFilledLabel fieldId="promptSuffix">{t({ ko: '뒷부분', en: 'After the scene' })}</ChatFilledLabel>}>
          <Textarea variant="settings" rows={2} value={config.promptSuffix} onChange={(event) => patch({ promptSuffix: event.target.value })} />
        </Field>
        <Field label={<ChatFilledLabel fieldId="negativePrompt">{t({ ko: '네거티브', en: 'Negative prompt' })}</ChatFilledLabel>}>
          <Textarea variant="settings" rows={3} value={config.negativePrompt} onChange={(event) => patch({ negativePrompt: event.target.value })} />
        </Field>
      </EditorGroup>
      {assetNote.length > 0 ? (
        <EditorGroup label={t({ ko: '패널에서 가져온 자산', en: 'Assets from the panel' })}>
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="text-muted-foreground">{assetNote.join(' · ')}</span>
            <IconButton size="icon-sm" variant="ghost" onClick={() => patch({ vibes: [], characterRefs: [], characters: [] })} label={t({ ko: '자산 비우기', en: 'Clear assets' })}><Trash2 /></IconButton>
          </div>
        </EditorGroup>
      ) : null}
    </div>
  )
}

/** The ComfyUI setup: one workflow, and per marked field whether the model fills it or a fixed value applies. */
function ComfyPresetFields({ config, onChange }: { config: ChatComfyPresetConfig; onChange: (config: ChatComfyPresetConfig) => void }) {
  const { t } = useI18n()
  const workflowsQuery = useQuery({ queryKey: ['generation-workflows', 'chat-generation-preset'], queryFn: () => getGenerationWorkflows(true), staleTime: 60_000 })
  const workflows = workflowsQuery.data ?? []
  const workflow = workflows.find((entry) => entry.id === config.workflowId) ?? null
  const fields: WorkflowMarkedField[] = workflow?.marked_fields ?? []
  const patch = (next: Partial<ChatComfyPresetConfig>) => onChange({ ...config, ...next })

  const setExposed = (fieldId: string, exposed: boolean) => {
    patch({ exposedFieldIds: exposed ? [...new Set([...config.exposedFieldIds, fieldId])] : config.exposedFieldIds.filter((id) => id !== fieldId) })
  }
  const setFixed = (field: WorkflowMarkedField, raw: string) => {
    const fixedInputs = { ...config.fixedInputs }
    if (raw === '') delete fixedInputs[field.id]
    else fixedInputs[field.id] = field.type === 'number' ? Number(raw) : raw
    patch({ fixedInputs })
  }

  return (
    <div className="space-y-4">
      <EditorGroup label={t({ ko: '워크플로', en: 'Workflow' })}>
        <Select variant="settings" className="px-3" value={String(config.workflowId || '')} onChange={(event) => patch({ workflowId: Number(event.target.value) || 0, fixedInputs: {}, exposedFieldIds: [], referenceField: null, promptField: null })}>
          <option value="">{t({ ko: '워크플로 선택', en: 'Pick a workflow' })}</option>
          {workflows.map((entry) => <option key={entry.id} value={String(entry.id)}>{entry.name}</option>)}
        </Select>
        {workflowsQuery.isSuccess && config.workflowId && !workflow ? <p className="text-xs text-destructive">{t({ ko: '이 워크플로는 지금 목록에 없어 (삭제됐거나 비활성).', en: 'This workflow is not listed now (deleted or inactive).' })}</p> : null}
      </EditorGroup>
      {workflow ? (
        <EditorGroup label={t({ ko: '필드', en: 'Fields' })}>
          <div className="grid grid-cols-[auto_1fr_minmax(0,1.2fr)] items-center gap-x-3 gap-y-2 text-sm">
            <span className="text-2xs font-semibold tracking-overline text-muted-foreground uppercase">{t({ ko: '모델이 작성', en: 'Model fills' })}</span>
            <span className="text-2xs font-semibold tracking-overline text-muted-foreground uppercase">{t({ ko: '필드', en: 'Field' })}</span>
            <span className="flex items-center gap-1 text-2xs font-semibold tracking-overline text-muted-foreground uppercase">{t({ ko: '고정 값', en: 'Fixed value' })}<FieldInfo>{t({ ko: '비우면 워크플로 기본값', en: 'Empty: the workflow default' })}</FieldInfo></span>
            {fields.map((field) => {
              const exposed = config.exposedFieldIds.includes(field.id)
              const fixed = config.fixedInputs[field.id]
              const editable = field.type === 'text' || field.type === 'textarea' || field.type === 'number' || field.type === 'select'
              return [
                <div key={`${field.id}-x`} className="flex justify-center"><Checkbox checked={exposed} onCheckedChange={(checked) => setExposed(field.id, checked === true)} /></div>,
                <div key={`${field.id}-l`} className="min-w-0">
                  <div className="truncate">{field.label}{field.required ? <span className="text-destructive"> *</span> : null}</div>
                  <div className="truncate font-mono text-2xs text-muted-foreground">{field.id} · {field.type}</div>
                </div>,
                <div key={`${field.id}-v`} className="min-w-0">
                  {exposed ? (
                    <span className="text-xs text-muted-foreground">{t({ ko: '모델이 채움', en: 'Filled by the model' })}</span>
                  ) : field.type === 'select' && field.options ? (
                    <Select variant="settings" className="h-9 px-3" value={typeof fixed === 'string' ? fixed : ''} onChange={(event) => setFixed(field, event.target.value)}>
                      <option value="">{t({ ko: '기본값', en: 'Default' })}</option>
                      {field.options.map((option) => <option key={option} value={option}>{option}</option>)}
                    </Select>
                  ) : editable ? (
                    <Input variant="settings" className="h-9" type={field.type === 'number' ? 'number' : 'text'} value={fixed === undefined || fixed === null ? '' : String(fixed)} placeholder={field.default_value === undefined || field.default_value === null || typeof field.default_value === 'object' ? '' : String(field.default_value)} onChange={(event) => setFixed(field, event.target.value)} />
                  ) : (
                    <span className="text-xs text-muted-foreground">{fixed !== undefined ? t({ ko: '저장값', en: 'Saved' }) : t({ ko: '기본값', en: 'Default' })}</span>
                  )}
                </div>,
              ]
            })}
          </div>
          {fields.length === 0 ? <p className="text-xs text-muted-foreground">{t({ ko: '이 워크플로에는 표시된 필드가 없어.', en: 'This workflow has no marked fields.' })}</p> : null}
        </EditorGroup>
      ) : null}
      {workflow ? <ComfyAssetFieldPicks config={config} fields={fields} onChange={patch} /> : null}
    </div>
  )
}

const isTextField = (field: WorkflowMarkedField) => field.type === 'text' || field.type === 'textarea'
const namedLikePrompt = (field: WorkflowMarkedField) => /positive|prompt|프롬프트|긍정/i.test(`${field.id} ${field.label}`) && !/negative|neg_|부정|undesired/i.test(`${field.id} ${field.label}`)

/**
 * Where character assets put the reference image and the slot prompt. Shown only when the workflow leaves it open
 * (several image fields, or no clear prompt field) or a choice is already saved; otherwise the server finds them.
 */
function ComfyAssetFieldPicks({ config, fields, onChange }: { config: ChatComfyPresetConfig; fields: WorkflowMarkedField[]; onChange: (next: Partial<ChatComfyPresetConfig>) => void }) {
  const { t } = useI18n()
  const images = fields.filter((field) => field.type === 'image')
  const texts = fields.filter(isTextField)
  const exposed = texts.filter((field) => config.exposedFieldIds.includes(field.id))
  const promptClear = [exposed, exposed.filter(namedLikePrompt), texts.filter(namedLikePrompt), texts].some((list) => list.length === 1)
  const askReference = images.length > 1 || Boolean(config.referenceField)
  const askPrompt = (texts.length > 1 && !promptClear) || Boolean(config.promptField)
  if (!askReference && !askPrompt) return null
  return (
    <EditorGroup label={t({ ko: '캐릭터 자산', en: 'Character assets' })}>
      <div className="grid gap-3 md:grid-cols-2">
        {askReference ? (
          <Field label={t({ ko: '기준 이미지 필드', en: 'Reference image field' })}>
            <Select variant="settings" className="px-3" value={config.referenceField ?? ''} onChange={(event) => onChange({ referenceField: event.target.value || null })}>
              <option value="">{images.length === 1 ? t({ ko: '자동 · {label}', en: 'Auto · {label}' }, { label: images[0].label }) : t({ ko: '없음 (외형 설명만)', en: 'None (appearance only)' })}</option>
              {images.map((field) => <option key={field.id} value={field.id}>{field.label}</option>)}
            </Select>
          </Field>
        ) : null}
        {askPrompt ? (
          <Field label={t({ ko: '프롬프트 필드', en: 'Prompt field' })}>
            <Select variant="settings" className="px-3" value={config.promptField ?? ''} onChange={(event) => onChange({ promptField: event.target.value || null })}>
              <option value="">{promptClear ? t({ ko: '자동', en: 'Auto' }) : t({ ko: '고르기', en: 'Choose' })}</option>
              {texts.map((field) => <option key={field.id} value={field.id}>{field.label}</option>)}
            </Select>
          </Field>
        ) : null}
      </div>
    </EditorGroup>
  )
}

/** Create or edit one generation preset. Saving reaches every profile that links it. */
export function ChatGenerationPresetEditorModal({ open, preset, onClose, onDuplicate, duplicating }: {
  open: boolean
  preset: ChatGenerationPreset | null
  onClose: () => void
  /** Copy the opened preset (only offered when editing an existing one). */
  onDuplicate?: (preset: ChatGenerationPreset) => void
  duplicating?: boolean
}) {
  const { t } = useI18n()
  const confirm = useConfirm()
  const { showSnackbar } = useSnackbar()
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState<ChatGenerationPresetInput>(() => emptyDraft('nai'))
  const initial = useMemo<ChatGenerationPresetInput>(() => (preset ? { name: preset.name, instruction: preset.instruction, kind: preset.kind, nai: preset.nai, comfyui: preset.comfyui } : emptyDraft('nai')), [preset])

  useLayoutEffect(() => {
    if (open) setDraft(initial)
  }, [open, initial])

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: CHAT_GENERATION_PRESETS_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: CHAT_ADMIN_PROFILES_QUERY_KEY }),
    ])
  }
  const saveMutation = useMutation({
    mutationFn: () => (preset ? updateChatGenerationPreset(preset.id, draft) : createChatGenerationPreset(draft)),
    onSuccess: async () => {
      await refresh()
      onClose()
    },
    onError: (error) => showSnackbar({ message: getErrorMessage(error, t({ ko: '저장하지 못했어.', en: 'Could not save.' })), tone: 'error' }),
  })
  const deleteMutation = useMutation({
    mutationFn: () => deleteChatGenerationPreset(preset?.id ?? 0),
    onSuccess: async () => {
      await refresh()
      onClose()
    },
    onError: (error) => showSnackbar({ message: getErrorMessage(error, t({ ko: '삭제하지 못했어.', en: 'Could not delete.' })), tone: 'error' }),
  })

  const handleDelete = async () => {
    const linked = preset?.profiles.length ?? 0
    if (linked > 0) {
      showSnackbar({ message: t({ ko: '프로필 {count}개가 쓰는 중이야. 먼저 그 프로필에서 연결을 풀어줘.', en: 'Used by {count} profiles. Unlink it there first.' }, { count: linked }), tone: 'error' })
      return
    }
    const confirmed = await confirm({
      title: t({ ko: '생성 프리셋 삭제', en: 'Delete generation preset' }),
      description: t({ ko: '이 생성 프리셋을 지울까?', en: 'Delete this generation preset?' }),
      confirmLabel: t({ ko: '삭제', en: 'Delete' }),
      tone: 'destructive',
    })
    if (confirmed) deleteMutation.mutate()
  }

  const nameMissing = draft.name.trim().length === 0
  useGenerationPresetChatPage({ open, preset, draft, setDraft, dirty: JSON.stringify(draft) !== JSON.stringify(initial), save: () => saveMutation.mutateAsync() })
  const comfyIncomplete = draft.kind === 'comfyui' && !(draft.comfyui?.workflowId)
  const kindLabel = useMemo(() => ({ nai: 'NovelAI', comfyui: 'ComfyUI' }), [])

  return (
    <Modal open={open} onClose={onClose} title={preset ? t({ ko: '생성 프리셋 편집', en: 'Edit generation preset' }) : t({ ko: '생성 프리셋 추가', en: 'Add generation preset' })} widthClassName="max-w-3xl" sidePanelInset={CHAT_DOCK_INSET}>
      <ModalBody className="space-y-4">
        <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
          <Field label={<ChatFilledLabel fieldId="name">{t({ ko: '이름', en: 'Name' })}</ChatFilledLabel>}>
            <Input variant="settings" value={draft.name} maxLength={80} autoFocus onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
          </Field>
          <Field label={<ChatFilledLabel fieldId="instruction">{t({ ko: '용도 (모델에게 보여줌)', en: 'Purpose (shown to the model)' })}</ChatFilledLabel>}>
            <Input variant="settings" value={draft.instruction} maxLength={400} onChange={(event) => setDraft({ ...draft, instruction: event.target.value })} />
          </Field>
          <Field label={t({ ko: '종류', en: 'Kind' })}>
            {preset ? (
              <div className="flex h-10 items-center text-sm">{kindLabel[draft.kind]}</div>
            ) : (
              <Select variant="settings" className="px-3" value={draft.kind} onChange={(event) => setDraft({ ...emptyDraft(event.target.value as 'nai' | 'comfyui'), name: draft.name, instruction: draft.instruction })}>
                <option value="nai">NovelAI</option>
                <option value="comfyui">ComfyUI</option>
              </Select>
            )}
          </Field>
        </div>
        {draft.kind === 'nai' ? <NaiPresetFields config={draft.nai ?? EMPTY_NAI_PRESET} onChange={(nai) => setDraft({ ...draft, nai })} /> : null}
        {draft.kind === 'comfyui' && draft.comfyui ? <ComfyPresetFields config={draft.comfyui} onChange={(comfyui) => setDraft({ ...draft, comfyui })} /> : null}
      </ModalBody>
      <ModalFooter>
        {preset ? (
          <IconButton size="icon-sm" variant="destructive" onClick={() => void handleDelete()} disabled={deleteMutation.isPending} label={t({ ko: '삭제', en: 'Delete' })}>
            <Trash2 />
          </IconButton>
        ) : null}
        <IconButton size="icon-sm" variant="ghost" onClick={() => downloadChatGenerationPresetFile(draft)} disabled={nameMissing} label={t({ ko: 'JSON으로 내보내기', en: 'Export as JSON' })}>
          <Download />
        </IconButton>
        {preset && onDuplicate ? (
          <IconButton size="icon-sm" variant="ghost" onClick={() => onDuplicate(preset)} disabled={duplicating} label={t({ ko: '복제', en: 'Duplicate' })}>
            <Copy />
          </IconButton>
        ) : null}
        <span className="flex-1" />
        <IconButton size="icon-sm" variant="default" onClick={() => saveMutation.mutate()} disabled={nameMissing || comfyIncomplete || saveMutation.isPending} label={t({ ko: '저장', en: 'Save' })}>
          <Save />
        </IconButton>
      </ModalFooter>
    </Modal>
  )
}

/** NAI settings a connected chat may fill; the vibes, references and fixed characters stay with the panel import. */
const NAI_TEXT_KEYS = ['promptPrefix', 'promptSuffix', 'negativePrompt'] as const

/** Registers the open generation preset editor with a connected chat: it fills the draft, and asks to save with a card. */
function useGenerationPresetChatPage({ open, preset, draft, setDraft, dirty, save }: {
  open: boolean
  preset: ChatGenerationPreset | null
  draft: ChatGenerationPresetInput
  setDraft: (update: (current: ChatGenerationPresetInput) => ChatGenerationPresetInput) => void
  dirty: boolean
  save: () => Promise<unknown>
}) {
  const { t } = useI18n()
  const workflowsQuery = useQuery({ queryKey: ['generation-workflows', 'chat-generation-preset'], queryFn: () => getGenerationWorkflows(true), staleTime: 60_000, enabled: open && draft.kind === 'comfyui' })
  const nai = draft.nai
  const fields: ChatPageField[] = [
    { id: 'name', label: t({ ko: '이름', en: 'Name' }), type: 'text', value: draft.name },
    { id: 'instruction', label: t({ ko: '용도 (모델에게 보여줌)', en: 'Purpose (shown to the model)' }), type: 'text', value: draft.instruction },
    ...(preset ? [] : [{ id: 'kind', label: t({ ko: '종류', en: 'Kind' }), type: 'select' as const, value: draft.kind, options: ['nai', 'comfyui'] }]),
    ...(draft.kind === 'nai' && nai ? [
      { id: 'model', label: t({ ko: '모델', en: 'Model' }), type: 'select' as const, value: nai.model, options: [...new Set([...NAI_MODEL_OPTIONS.map((option) => option.value), nai.model])] },
      { id: 'sampler', label: t({ ko: '샘플러', en: 'Sampler' }), type: 'select' as const, value: nai.sampler, options: [...new Set([...NAI_SAMPLER_OPTIONS.map((option) => option.value), nai.sampler])] },
      { id: 'noiseSchedule', label: t({ ko: '스케줄러', en: 'Scheduler' }), type: 'select' as const, value: nai.noiseSchedule, options: [...new Set([...NAI_SCHEDULER_OPTIONS.map((option) => option.value), nai.noiseSchedule])] },
      { id: 'steps', label: t({ ko: '스텝', en: 'Steps' }), type: 'number' as const, value: nai.steps, min: 1, max: 50, integer: true },
      { id: 'scale', label: 'CFG', type: 'number' as const, value: nai.scale, min: 0, max: 30 },
      { id: 'varietyPlus', label: 'Variety+', type: 'boolean' as const, value: nai.varietyPlus },
      { id: 'transparentBackground', label: t({ ko: '투명 배경', en: 'Transparent background' }), type: 'boolean' as const, value: nai.transparentBackground },
      { id: 'promptPrefix', label: t({ ko: '고정 프롬프트 앞부분 (퀄리티·작가·화풍)', en: 'Fixed prompt before the scene (quality, artist, style)' }), type: 'text' as const, value: nai.promptPrefix },
      { id: 'promptSuffix', label: t({ ko: '고정 프롬프트 뒷부분', en: 'Fixed prompt after the scene' }), type: 'text' as const, value: nai.promptSuffix },
      { id: 'negativePrompt', label: t({ ko: '네거티브', en: 'Negative prompt' }), type: 'text' as const, value: nai.negativePrompt },
    ] : []),
    ...(draft.kind === 'comfyui' && draft.comfyui && workflowsQuery.data?.length ? [
      { id: 'workflowId', label: t({ ko: 'ComfyUI 워크플로', en: 'ComfyUI workflow' }), type: 'select' as const, value: draft.comfyui.workflowId ? String(draft.comfyui.workflowId) : '', options: ['', ...workflowsQuery.data.map((entry) => String(entry.id))] },
    ] : []),
  ]
  useSettingsEditorChatPage({
    open, dirty, fields,
    title: preset ? t({ ko: '생성 프리셋 편집 · {name}', en: 'Edit generation preset · {name}' }, { name: preset.name }) : t({ ko: '생성 프리셋 추가', en: 'Add generation preset' }),
    resourceId: `generation-preset:${preset?.id ?? 'new'}`,
    data: {
      sizes: nai ? nai.sizes.map((size) => size.label) : [],
      workflows: (workflowsQuery.data ?? []).map((entry) => ({ id: String(entry.id), name: entry.name })),
      selected: { name: draft.name, kind: draft.kind, instruction: draft.instruction },
    },
    save,
    apply: (patch: Record<string, ChatPageValue>) => setDraft((current) => {
      let next = { ...current }
      if (patch.kind !== undefined && !preset && patch.kind !== next.kind) next = { ...emptyDraft(patch.kind as 'nai' | 'comfyui'), name: next.name, instruction: next.instruction }
      if (patch.name !== undefined) next.name = String(patch.name)
      if (patch.instruction !== undefined) next.instruction = String(patch.instruction)
      if (next.nai) {
        const naiPatch: Partial<ChatNaiPresetConfig> = {}
        for (const key of ['model', 'sampler', 'noiseSchedule', ...NAI_TEXT_KEYS] as const) if (patch[key] !== undefined) naiPatch[key] = String(patch[key])
        for (const key of ['steps', 'scale'] as const) if (patch[key] !== undefined) naiPatch[key] = Number(patch[key])
        for (const key of ['varietyPlus', 'transparentBackground'] as const) if (patch[key] !== undefined) naiPatch[key] = Boolean(patch[key])
        next = { ...next, nai: { ...next.nai, ...naiPatch } }
      }
      if (next.comfyui && patch.workflowId !== undefined) next = { ...next, comfyui: { ...next.comfyui, workflowId: Number(patch.workflowId) || 0, fixedInputs: {}, exposedFieldIds: [], referenceField: null, promptField: null } }
      return next
    }),
  })
}
