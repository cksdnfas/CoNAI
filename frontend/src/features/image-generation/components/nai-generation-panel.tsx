import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, Download, ExternalLink, Plus, Save, Sparkles, Trash2, WandSparkles } from 'lucide-react'
import { SectionHeading } from '@/components/common/section-heading'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { SegmentedControl } from '@/components/common/segmented-control'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { ToggleRow } from '@/components/ui/toggle-row'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { SettingsModal } from '@/features/settings/components/settings-modal'
import { triggerBlobDownload } from '@/lib/api-client'
import {
  createNaiModuleFromSnapshot,
  deleteNaiCharacterReferenceAsset,
  deleteNaiVibeAsset,
  encodeNaiVibe,
  generateNaiImage,
  getNaiCostEstimate,
  getNaiUserData,
  listNaiCharacterReferenceAssets,
  listNaiVibeAssets,
  loginNai,
  loginNaiWithToken,
  saveNaiCharacterReferenceAsset,
  saveNaiVibeAsset,
  upscaleNaiImage,
} from '@/lib/api'
import {
  buildNaiCharacterPromptPayload,
  buildNaiCharacterReferencePayload,
  buildNaiModuleFieldOptions,
  buildNaiModuleSnapshot,
  buildNaiModuleUiSchema,
  buildNaiVibePayload,
  canUseNaiCharacterPositions,
  clampNaiSampleCount,
  DEFAULT_NAI_FORM,
  EMPTY_NAI_CHARACTER_PROMPT,
  EMPTY_NAI_CHARACTER_REFERENCE,
  EMPTY_NAI_VIBE,
  FormField,
  getErrorMessage,
  NAI_SAMPLE_COUNT_MAX,
  NAI_SAMPLE_COUNT_MIN,
  NAI_ACTION_OPTIONS,
  NAI_CHARACTER_GRID_X_OPTIONS,
  NAI_CHARACTER_GRID_Y_OPTIONS,
  NAI_MODEL_OPTIONS,
  NAI_RESOLUTION_PRESETS,
  NAI_SAMPLER_OPTIONS,
  NAI_SCHEDULER_OPTIONS,
  normalizeNaiCharacterPromptDrafts,
  parseNumberInput,
  readFileAsDataUrl,
  resolveNaiResolutionPreset,
  shouldUseNaiCharacterPositions,
  supportsNaiCharacterPrompts,
  supportsNaiCharacterReferences,
  type NAICharacterPromptDraft,
  type NAICharacterReferenceDraft,
  type NAIFormDraft,
  type NAIVibeDraft,
  type SelectedImageDraft,
} from '../image-generation-shared'
import { NaiCharacterPositionBoard } from './nai-character-position-board'
import { NaiModuleSaveModal } from './nai-module-save-modal'
import { PromptToggleField } from './prompt-toggle-field'

type NaiGenerationPanelProps = {
  refreshNonce: number
  onHistoryRefresh: () => void
}

type NaiLoginMode = 'account' | 'token'

/** Convert a base64 PNG payload into a Blob download. */
function decodeBase64Png(data: string) {
  const binary = atob(data)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }

  return new Blob([bytes], { type: 'image/png' })
}

/** Render a compact selected-image preview card. */
function SelectedImageCard({ image, alt, onRemove }: { image: SelectedImageDraft; alt: string; onRemove: () => void }) {
  return (
    <div className="theme-surface-nested space-y-2 rounded-sm border border-border p-3">
      <div className="text-xs text-muted-foreground">{image.fileName}</div>
      <img src={image.dataUrl} alt={alt} className="max-h-48 rounded-sm border border-border object-contain" />
      <div className="flex justify-end">
        <Button type="button" size="sm" variant="ghost" onClick={onRemove}>
          제거
        </Button>
      </div>
    </div>
  )
}

type FilePickerButtonProps = {
  label: string
  accept?: string
  onSelect: (file?: File) => void
}

/** Render a shared file-picker trigger that keeps the native input hidden. */
function FilePickerButton({ label, accept = 'image/*', onSelect }: FilePickerButtonProps) {
  return (
    <Button type="button" variant="outline" asChild>
      <label>
        <input
          type="file"
          accept={accept}
          hidden
          onChange={(event) => {
            onSelect(event.target.files?.[0])
            event.currentTarget.value = ''
          }}
        />
        {label}
      </label>
    </Button>
  )
}

type NaiAuthModalProps = {
  open: boolean
  loginMode: NaiLoginMode
  isSubmitting: boolean
  username: string
  password: string
  token: string
  connectionHint: string
  showStatusHint: boolean
  onClose: () => void
  onLoginModeChange: (mode: NaiLoginMode) => void
  onUsernameChange: (value: string) => void
  onPasswordChange: (value: string) => void
  onTokenChange: (value: string) => void
  onSubmit: () => void
}

/** Render the NovelAI authentication modal used from the status header. */
function NaiAuthModal({
  open,
  loginMode,
  isSubmitting,
  username,
  password,
  token,
  connectionHint,
  showStatusHint,
  onClose,
  onLoginModeChange,
  onUsernameChange,
  onPasswordChange,
  onTokenChange,
  onSubmit,
}: NaiAuthModalProps) {
  const submitDisabled = isSubmitting || (loginMode === 'account' ? username.trim().length === 0 || password.length === 0 : token.trim().length === 0)

  return (
    <SettingsModal
      open={open}
      onClose={onClose}
      title="NovelAI 로그인"
      description="계정 로그인 또는 access token 저장으로 연결할 수 있어. 토큰은 서버에 저장돼."
      widthClassName="max-w-2xl"
    >
      <div className="space-y-4">
        <SegmentedControl
          value={loginMode}
          items={[
            { value: 'account', label: '로그인' },
            { value: 'token', label: '토큰' },
          ]}
          onChange={(nextMode) => onLoginModeChange(nextMode as NaiLoginMode)}
          fullWidth
          size="sm"
        />

        {loginMode === 'account' ? (
          <div className="grid gap-4 md:grid-cols-2">
            <FormField label="Username">
              <Input value={username} onChange={(event) => onUsernameChange(event.target.value)} autoComplete="username" />
            </FormField>
            <FormField label="Password">
              <Input type="password" value={password} onChange={(event) => onPasswordChange(event.target.value)} autoComplete="current-password" />
            </FormField>
          </div>
        ) : (
          <FormField label="Access Token">
            <Input
              value={token}
              onChange={(event) => onTokenChange(event.target.value)}
              placeholder=""
              autoComplete="off"
            />
          </FormField>
        )}

        {showStatusHint ? <div className="text-xs text-[#ffb4ab]">{connectionHint}</div> : null}

        <div className="flex justify-end border-t border-border/70 pt-4">
          <Button type="button" onClick={onSubmit} disabled={submitDisabled}>
            {isSubmitting ? '연결 중…' : loginMode === 'account' ? '로그인' : '토큰 저장'}
          </Button>
        </div>
      </div>
    </SettingsModal>
  )
}

/** Render the NAI login, generation, and module-authoring workflow. */
export function NaiGenerationPanel({ refreshNonce, onHistoryRefresh }: NaiGenerationPanelProps) {
  const { showSnackbar } = useSnackbar()
  const [loginMode, setLoginMode] = useState<NaiLoginMode>('account')
  const [naiUsernameInput, setNaiUsernameInput] = useState('')
  const [naiPasswordInput, setNaiPasswordInput] = useState('')
  const [naiTokenInput, setNaiTokenInput] = useState('')
  const [isNaiAuthModalOpen, setIsNaiAuthModalOpen] = useState(false)
  const [isNaiLoggingIn, setIsNaiLoggingIn] = useState(false)
  const [isNaiGenerating, setIsNaiGenerating] = useState(false)
  const [isSavingNaiModule, setIsSavingNaiModule] = useState(false)
  const [isModuleSaveModalOpen, setIsModuleSaveModalOpen] = useState(false)
  const [isUpscaling, setIsUpscaling] = useState(false)
  const [encodingVibeIndex, setEncodingVibeIndex] = useState<number | null>(null)
  const [selectedCharacterIndex, setSelectedCharacterIndex] = useState<number | null>(null)
  const [savedVibeSearch, setSavedVibeSearch] = useState('')
  const [savedCharacterReferenceSearch, setSavedCharacterReferenceSearch] = useState('')
  const [isVibesCollapsed, setIsVibesCollapsed] = useState(true)
  const [isReferencesCollapsed, setIsReferencesCollapsed] = useState(true)
  const [naiForm, setNaiForm] = useState<NAIFormDraft>(DEFAULT_NAI_FORM)
  const [naiModuleName, setNaiModuleName] = useState('NAI Module')
  const [naiModuleDescription, setNaiModuleDescription] = useState('')
  const [naiExposedFieldKeys, setNaiExposedFieldKeys] = useState<string[]>(['prompt', 'negative_prompt', 'characters', 'vibes', 'character_refs', 'seed'])

  const naiUserQuery = useQuery({
    queryKey: ['image-generation-nai-user'],
    queryFn: getNaiUserData,
    retry: false,
  })

  const savedVibesQuery = useQuery({
    queryKey: ['image-generation-nai-vibe-assets', naiForm.model],
    queryFn: () => listNaiVibeAssets(naiForm.model),
    enabled: naiUserQuery.isSuccess,
  })

  const savedCharacterReferencesQuery = useQuery({
    queryKey: ['image-generation-nai-character-reference-assets'],
    queryFn: listNaiCharacterReferenceAssets,
    enabled: naiUserQuery.isSuccess,
  })

  const naiCostInputs = useMemo(
    () => ({
      width: parseNumberInput(naiForm.width, 1024),
      height: parseNumberInput(naiForm.height, 1024),
      steps: parseNumberInput(naiForm.steps, 28),
      n_samples: clampNaiSampleCount(naiForm.samples),
    }),
    [naiForm.height, naiForm.samples, naiForm.steps, naiForm.width],
  )

  const naiCostQuery = useQuery({
    queryKey: ['image-generation-nai-cost', naiCostInputs, naiUserQuery.data?.subscription.tier, naiUserQuery.data?.anlasBalance],
    queryFn: () =>
      getNaiCostEstimate({
        ...naiCostInputs,
        subscriptionTier: naiUserQuery.data?.subscription.tier ?? 0,
        anlasBalance: naiUserQuery.data?.anlasBalance ?? 0,
      }),
    enabled:
      naiUserQuery.isSuccess &&
      naiCostInputs.width > 0 &&
      naiCostInputs.height > 0 &&
      naiCostInputs.steps > 0 &&
      naiCostInputs.n_samples > 0,
  })

  const naiModuleFieldOptions = useMemo(() => buildNaiModuleFieldOptions(naiForm), [naiForm])
  const supportsCharacterPrompts = useMemo(() => supportsNaiCharacterPrompts(naiForm.model), [naiForm.model])
  const supportsCharacterReference = useMemo(() => supportsNaiCharacterReferences(naiForm.model), [naiForm.model])
  const filteredSavedVibes = useMemo(() => {
    const items = savedVibesQuery.data || []
    const keyword = savedVibeSearch.trim().toLowerCase()
    if (!keyword) {
      return items
    }

    return items.filter((item) => `${item.label} ${item.model}`.toLowerCase().includes(keyword))
  }, [savedVibeSearch, savedVibesQuery.data])
  const filteredSavedCharacterReferences = useMemo(() => {
    const items = savedCharacterReferencesQuery.data || []
    const keyword = savedCharacterReferenceSearch.trim().toLowerCase()
    if (!keyword) {
      return items
    }

    return items.filter((item) => `${item.label} ${item.type}`.toLowerCase().includes(keyword))
  }, [savedCharacterReferenceSearch, savedCharacterReferencesQuery.data])

  useEffect(() => {
    if (refreshNonce === 0) {
      return
    }

    void naiUserQuery.refetch()
  }, [naiUserQuery, refreshNonce])

  useEffect(() => {
    const allowedKeys = new Set(naiModuleFieldOptions.map((field) => field.key))
    setNaiExposedFieldKeys((current) => current.filter((key) => allowedKeys.has(key)))
  }, [naiModuleFieldOptions])

  useEffect(() => {
    if (naiForm.characterPositionAiChoice || canUseNaiCharacterPositions(naiForm.characters.length)) {
      return
    }

    setNaiForm((current) => ({
      ...current,
      characterPositionAiChoice: true,
    }))
  }, [naiForm.characterPositionAiChoice, naiForm.characters.length])

  const handleNaiFieldChange = (field: 'prompt' | 'negativePrompt' | 'model' | 'action' | 'sampler' | 'scheduler' | 'width' | 'height' | 'steps' | 'scale' | 'samples' | 'seed' | 'strength' | 'noise', value: string) => {
    if (field === 'samples') {
      const trimmedValue = value.trim()

      if (trimmedValue.length === 0) {
        setNaiForm((current) => ({
          ...current,
          samples: '',
        }))
        return
      }

      const parsedValue = Number(trimmedValue)
      if (!Number.isFinite(parsedValue)) {
        return
      }

      const clampedValue = clampNaiSampleCount(parsedValue)
      if (parsedValue > NAI_SAMPLE_COUNT_MAX) {
        showSnackbar({ message: `Samples는 최대 ${NAI_SAMPLE_COUNT_MAX}개까지 가능해. ${NAI_SAMPLE_COUNT_MAX}로 맞출게.`, tone: 'info' })
      } else if (parsedValue < NAI_SAMPLE_COUNT_MIN) {
        showSnackbar({ message: `Samples는 ${NAI_SAMPLE_COUNT_MIN}~${NAI_SAMPLE_COUNT_MAX}만 가능해.`, tone: 'info' })
      }

      value = String(clampedValue)
    }

    setNaiForm((current) => {
      const nextForm = {
        ...current,
        [field]: value,
      }

      if (field === 'width' || field === 'height') {
        nextForm.resolutionPreset = resolveNaiResolutionPreset(
          field === 'width' ? value : nextForm.width,
          field === 'height' ? value : nextForm.height,
        )
      }

      return nextForm
    })
  }

  const handleResolutionPresetChange = (presetKey: string) => {
    setNaiForm((current) => {
      const preset = NAI_RESOLUTION_PRESETS.find((entry) => entry.key === presetKey)
      if (!preset) {
        return {
          ...current,
          resolutionPreset: 'custom',
        }
      }

      return {
        ...current,
        resolutionPreset: preset.key,
        width: String(preset.width),
        height: String(preset.height),
      }
    })
  }

  const handleNaiImageChange = async (field: 'sourceImage' | 'maskImage', file?: File) => {
    if (!file) {
      setNaiForm((current) => ({
        ...current,
        [field]: undefined,
      }))
      return
    }

    try {
      const dataUrl = await readFileAsDataUrl(file)
      setNaiForm((current) => ({
        ...current,
        [field]: {
          fileName: file.name,
          dataUrl,
        },
      }))
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, '이미지 파일을 읽지 못했어.'), tone: 'error' })
    }
  }

  const handleAddCharacterPrompt = () => {
    setNaiForm((current) => {
      const nextCharacters = normalizeNaiCharacterPromptDrafts([...current.characters, { ...EMPTY_NAI_CHARACTER_PROMPT }])
      setSelectedCharacterIndex(nextCharacters.length - 1)
      return {
        ...current,
        characters: nextCharacters,
      }
    })
  }

  const handleCharacterPromptChange = (index: number, field: keyof NAICharacterPromptDraft, value: string) => {
    setNaiForm((current) => ({
      ...current,
      characters: normalizeNaiCharacterPromptDrafts(current.characters.map((character, characterIndex) => (
        characterIndex === index
          ? {
            ...character,
            [field]: value,
          }
          : character
      ))),
    }))
  }

  const handleRemoveCharacterPrompt = (index: number) => {
    setNaiForm((current) => ({
      ...current,
      characters: normalizeNaiCharacterPromptDrafts(current.characters.filter((_, characterIndex) => characterIndex !== index)),
    }))
    setSelectedCharacterIndex((current) => {
      if (current === null) {
        return null
      }
      if (current === index) {
        return null
      }
      return current > index ? current - 1 : current
    })
  }

  const handleAddVibe = () => {
    setIsVibesCollapsed(false)
    setNaiForm((current) => ({
      ...current,
      vibes: [...current.vibes, { ...EMPTY_NAI_VIBE }],
    }))
  }

  const handleVibeFieldChange = (index: number, field: 'encoded' | 'strength' | 'informationExtracted', value: string) => {
    setNaiForm((current) => ({
      ...current,
      vibes: current.vibes.map((vibe, vibeIndex) => (
        vibeIndex === index
          ? {
            ...vibe,
            [field]: value,
          }
          : vibe
      )),
    }))
  }

  const handleVibeImageChange = async (index: number, file?: File) => {
    if (!file) {
      setNaiForm((current) => ({
        ...current,
        vibes: current.vibes.map((vibe, vibeIndex) => (
          vibeIndex === index
            ? {
              ...vibe,
              image: undefined,
              encoded: '',
            }
            : vibe
        )),
      }))
      return
    }

    try {
      const dataUrl = await readFileAsDataUrl(file)
      setNaiForm((current) => ({
        ...current,
        vibes: current.vibes.map((vibe, vibeIndex) => (
          vibeIndex === index
            ? {
              ...vibe,
              image: {
                fileName: file.name,
                dataUrl,
              },
              encoded: '',
            }
            : vibe
        )),
      }))
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, 'Vibe 이미지를 읽지 못했어.'), tone: 'error' })
    }
  }

  const handleEncodeVibe = async (index: number) => {
    const vibe = naiForm.vibes[index]
    if (!vibe?.image || encodingVibeIndex !== null) {
      return
    }

    try {
      setEncodingVibeIndex(index)
      const response = await encodeNaiVibe({
        image: vibe.image.dataUrl,
        model: naiForm.model,
        information_extracted: parseNumberInput(vibe.informationExtracted, 1),
      })
      setNaiForm((current) => ({
        ...current,
        vibes: current.vibes.map((entry, vibeIndex) => (
          vibeIndex === index
            ? {
              ...entry,
              encoded: response.encoded,
            }
            : entry
        )),
      }))
      await naiUserQuery.refetch()
      showSnackbar({ message: `Vibe ${index + 1} 인코딩 완료. 이 결과를 재사용하면 돼.`, tone: 'info' })
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, 'Vibe 인코딩에 실패했어.'), tone: 'error' })
    } finally {
      setEncodingVibeIndex(null)
    }
  }

  const handleRemoveVibe = (index: number) => {
    setNaiForm((current) => ({
      ...current,
      vibes: current.vibes.filter((_, vibeIndex) => vibeIndex !== index),
    }))
  }

  const handleSaveVibeToStore = async (index: number) => {
    const vibe = naiForm.vibes[index]
    if (!vibe || !vibe.encoded) {
      showSnackbar({ message: '저장하려면 먼저 Vibe 인코딩이 필요해.', tone: 'error' })
      return
    }

    try {
      await saveNaiVibeAsset({
        label: vibe.image?.fileName,
        model: naiForm.model,
        image: vibe.image?.dataUrl,
        encoded: vibe.encoded,
        strength: parseNumberInput(vibe.strength, 0.6),
        information_extracted: parseNumberInput(vibe.informationExtracted, 1),
      })
      await savedVibesQuery.refetch()
      showSnackbar({ message: `Vibe ${index + 1} 저장 완료.`, tone: 'info' })
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, 'Vibe 저장에 실패했어.'), tone: 'error' })
    }
  }

  const handleLoadVibeFromStore = (assetId: string) => {
    const asset = savedVibesQuery.data?.find((entry) => entry.id === assetId)
    if (!asset) {
      return
    }

    setIsVibesCollapsed(false)
    setNaiForm((current) => ({
      ...current,
      vibes: [...current.vibes, {
        image: asset.image_data_url ? { fileName: asset.label, dataUrl: asset.image_data_url } : undefined,
        encoded: asset.encoded,
        strength: String(asset.strength),
        informationExtracted: String(asset.information_extracted),
      }],
    }))
    showSnackbar({ message: `${asset.label} 불러왔어.`, tone: 'info' })
  }

  const handleDeleteVibeFromStore = async (assetId: string) => {
    try {
      await deleteNaiVibeAsset(assetId)
      await savedVibesQuery.refetch()
      showSnackbar({ message: '저장된 Vibe를 삭제했어.', tone: 'info' })
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, '저장된 Vibe 삭제에 실패했어.'), tone: 'error' })
    }
  }

  const handleAddCharacterReference = () => {
    setIsReferencesCollapsed(false)
    setNaiForm((current) => ({
      ...current,
      characterReferences: [...current.characterReferences, { ...EMPTY_NAI_CHARACTER_REFERENCE }],
    }))
  }

  const handleCharacterReferenceFieldChange = (index: number, field: 'type' | 'strength' | 'fidelity', value: string) => {
    setNaiForm((current) => ({
      ...current,
      characterReferences: current.characterReferences.map((reference, referenceIndex) => (
        referenceIndex === index
          ? {
            ...reference,
            [field]: value,
          }
          : reference
      )),
    }))
  }

  const handleCharacterReferenceImageChange = async (index: number, file?: File) => {
    if (!file) {
      setNaiForm((current) => ({
        ...current,
        characterReferences: current.characterReferences.map((reference, referenceIndex) => (
          referenceIndex === index
            ? {
              ...reference,
              image: undefined,
            }
            : reference
        )),
      }))
      return
    }

    try {
      const dataUrl = await readFileAsDataUrl(file)
      setNaiForm((current) => ({
        ...current,
        characterReferences: current.characterReferences.map((reference, referenceIndex) => (
          referenceIndex === index
            ? {
              ...reference,
              image: {
                fileName: file.name,
                dataUrl,
              },
            }
            : reference
        )),
      }))
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, 'Character Reference 이미지를 읽지 못했어.'), tone: 'error' })
    }
  }

  const handleRemoveCharacterReference = (index: number) => {
    setNaiForm((current) => ({
      ...current,
      characterReferences: current.characterReferences.filter((_, referenceIndex) => referenceIndex !== index),
    }))
  }

  const handleSaveCharacterReferenceToStore = async (index: number) => {
    const reference = naiForm.characterReferences[index]
    if (!reference?.image) {
      showSnackbar({ message: '저장하려면 Character Reference 이미지가 필요해.', tone: 'error' })
      return
    }

    try {
      await saveNaiCharacterReferenceAsset({
        label: reference.image.fileName,
        image: reference.image.dataUrl,
        type: reference.type,
        strength: parseNumberInput(reference.strength, 0.6),
        fidelity: parseNumberInput(reference.fidelity, 1),
      })
      await savedCharacterReferencesQuery.refetch()
      showSnackbar({ message: `Reference ${index + 1} 저장 완료.`, tone: 'info' })
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, 'Character Reference 저장에 실패했어.'), tone: 'error' })
    }
  }

  const handleLoadCharacterReferenceFromStore = (assetId: string) => {
    const asset = savedCharacterReferencesQuery.data?.find((entry) => entry.id === assetId)
    if (!asset) {
      return
    }

    setIsReferencesCollapsed(false)
    setNaiForm((current) => ({
      ...current,
      characterReferences: [...current.characterReferences, {
        image: { fileName: asset.label, dataUrl: asset.image_data_url },
        type: asset.type,
        strength: String(asset.strength),
        fidelity: String(asset.fidelity),
      }],
    }))
    showSnackbar({ message: `${asset.label} 불러왔어.`, tone: 'info' })
  }

  const handleDeleteCharacterReferenceFromStore = async (assetId: string) => {
    try {
      await deleteNaiCharacterReferenceAsset(assetId)
      await savedCharacterReferencesQuery.refetch()
      showSnackbar({ message: '저장된 Character Reference를 삭제했어.', tone: 'info' })
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, '저장된 Character Reference 삭제에 실패했어.'), tone: 'error' })
    }
  }

  const handleNaiAccountLogin = async () => {
    const username = naiUsernameInput.trim()
    const password = naiPasswordInput
    if (username.length === 0 || password.length === 0 || isNaiLoggingIn) {
      return
    }

    try {
      setIsNaiLoggingIn(true)
      await loginNai(username, password)
      await naiUserQuery.refetch()
      setNaiPasswordInput('')
      setIsNaiAuthModalOpen(false)
      showSnackbar({ message: 'NovelAI 로그인 완료.', tone: 'info' })
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, 'NovelAI 로그인에 실패했어.'), tone: 'error' })
    } finally {
      setIsNaiLoggingIn(false)
    }
  }

  const handleNaiTokenLogin = async () => {
    const token = naiTokenInput.trim()
    if (token.length === 0 || isNaiLoggingIn) {
      return
    }

    try {
      setIsNaiLoggingIn(true)
      await loginNaiWithToken(token)
      await naiUserQuery.refetch()
      setNaiTokenInput('')
      setIsNaiAuthModalOpen(false)
      showSnackbar({ message: 'NovelAI 토큰 연결 완료.', tone: 'info' })
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, 'NovelAI 토큰 로그인에 실패했어.'), tone: 'error' })
    } finally {
      setIsNaiLoggingIn(false)
    }
  }

  const handleNaiGenerate = async () => {
    if (isNaiGenerating) {
      return
    }

    if (naiForm.prompt.trim().length === 0) {
      showSnackbar({ message: 'NAI 프롬프트를 먼저 넣어줘.', tone: 'error' })
      return
    }

    if ((naiForm.action === 'img2img' || naiForm.action === 'infill') && !naiForm.sourceImage) {
      showSnackbar({ message: 'img2img / infill에는 소스 이미지가 필요해.', tone: 'error' })
      return
    }

    if (naiForm.action === 'infill' && !naiForm.maskImage) {
      showSnackbar({ message: 'infill에는 마스크 이미지도 필요해.', tone: 'error' })
      return
    }

    if (!supportsCharacterReference && naiForm.characterReferences.length > 0) {
      showSnackbar({ message: 'Character Reference는 NAI Diffusion 4.5 모델에서만 쓸 수 있어.', tone: 'error' })
      return
    }

    try {
      const sampleCount = clampNaiSampleCount(naiForm.samples)
      const useCharacterPositions = shouldUseNaiCharacterPositions(naiForm)
      setIsNaiGenerating(true)
      const response = await generateNaiImage({
        prompt: naiForm.prompt.trim(),
        negative_prompt: naiForm.negativePrompt.trim() || undefined,
        model: naiForm.model,
        action: naiForm.action,
        sampler: naiForm.sampler,
        noise_schedule: naiForm.scheduler,
        width: Number(naiForm.width),
        height: Number(naiForm.height),
        steps: Number(naiForm.steps),
        scale: Number(naiForm.scale),
        n_samples: sampleCount,
        seed: naiForm.seed.trim().length > 0 ? Number(naiForm.seed) : undefined,
        use_coords: useCharacterPositions,
        characters: supportsCharacterPrompts ? buildNaiCharacterPromptPayload(naiForm.characters) : undefined,
        vibes: buildNaiVibePayload(naiForm.vibes),
        character_refs: buildNaiCharacterReferencePayload(naiForm.characterReferences),
        variety_plus: naiForm.varietyPlus,
        image: naiForm.action !== 'generate' ? naiForm.sourceImage?.dataUrl : undefined,
        mask: naiForm.action === 'infill' ? naiForm.maskImage?.dataUrl : undefined,
        strength: naiForm.action !== 'generate' ? Number(naiForm.strength) : undefined,
        noise: naiForm.action !== 'generate' ? Number(naiForm.noise) : undefined,
        add_original_image: naiForm.action === 'infill' ? naiForm.addOriginalImage : undefined,
      })

      await naiUserQuery.refetch()
      onHistoryRefresh()
      showSnackbar({ message: `NAI 생성 요청 완료. 히스토리 ${response.count}건 등록됐어.`, tone: 'info' })
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, 'NAI 이미지 생성에 실패했어.'), tone: 'error' })
    } finally {
      setIsNaiGenerating(false)
    }
  }

  const handleUpscale = async () => {
    if (!naiForm.sourceImage || isUpscaling) {
      return
    }

    try {
      setIsUpscaling(true)
      const response = await upscaleNaiImage({
        image: naiForm.sourceImage.dataUrl,
        scale: 2,
      })
      triggerBlobDownload(decodeBase64Png(response.image), response.filename)
      await naiUserQuery.refetch()
      showSnackbar({ message: 'NovelAI 업스케일 완료. PNG 다운로드를 시작할게.', tone: 'info' })
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, 'NovelAI 업스케일에 실패했어.'), tone: 'error' })
    } finally {
      setIsUpscaling(false)
    }
  }

  const handleCreateNaiModule = async () => {
    const moduleName = naiModuleName.trim()

    if (moduleName.length === 0 || isSavingNaiModule) {
      return
    }

    if (naiExposedFieldKeys.length === 0) {
      showSnackbar({ message: '최소 1개는 입력 가능 필드로 열어줘.', tone: 'error' })
      return
    }

    try {
      setIsSavingNaiModule(true)
      const snapshot = buildNaiModuleSnapshot(naiForm)
      const exposedFields = naiModuleFieldOptions
        .filter((field) => naiExposedFieldKeys.includes(field.key))
        .map((field) => ({
          key: field.key,
          label: field.label,
          data_type: field.dataType,
        }))
      const uiSchema = buildNaiModuleUiSchema(naiModuleFieldOptions, snapshot, naiExposedFieldKeys)

      await createNaiModuleFromSnapshot({
        name: moduleName,
        description: naiModuleDescription.trim() || undefined,
        snapshot,
        exposed_fields: exposedFields,
        ui_schema: uiSchema,
      })

      setIsModuleSaveModalOpen(false)
      showSnackbar({ message: '현재 NAI 설정을 모듈로 저장했어.', tone: 'info' })
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, 'NAI 모듈 저장에 실패했어.'), tone: 'error' })
    } finally {
      setIsSavingNaiModule(false)
    }
  }

  const connected = naiUserQuery.isSuccess
  const naiConnectionHint = loginMode === 'account'
    ? 'NovelAI 인증이 필요합니다. 계정으로 로그인하세요.'
    : 'NovelAI 인증이 필요합니다. access token을 입력해 연결하세요.'
  const naiGenerateButtonLabel = isNaiGenerating
    ? '생성 요청 중…'
    : naiCostQuery.isSuccess
      ? naiCostQuery.data.isOpusFree
        ? '생성 (무료)'
        : `생성 (${naiCostQuery.data.estimatedCost} Anlas)`
      : naiCostQuery.isPending
        ? '생성 (계산 중…)'
        : '생성'
  const canUseCharacterPositions = canUseNaiCharacterPositions(naiForm.characters.length)
  const useCharacterPositions = shouldUseNaiCharacterPositions(naiForm)

  return (
    <>
      <div className="space-y-6">
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <div className="truncate text-base font-semibold text-foreground">NovelAI</div>
              {connected ? <Badge variant="secondary">연결됨</Badge> : <Badge variant="outline">미연결</Badge>}
              {connected ? <Badge variant="outline">{naiUserQuery.data.subscription.tierName}</Badge> : null}
              {connected ? <Badge variant="outline">Anlas {naiUserQuery.data.anlasBalance}</Badge> : null}
            </div>
            <div className="flex items-center gap-2">
              {!connected ? (
                <Button type="button" variant="outline" size="sm" onClick={() => setIsNaiAuthModalOpen(true)}>
                  로그인
                </Button>
              ) : null}
              <Button type="button" variant="outline" size="icon-sm" asChild>
                <a href="https://novelai.net/" target="_blank" rel="noreferrer noopener" aria-label="NovelAI 홈페이지 열기" title="NovelAI 홈페이지 열기">
                  <ExternalLink className="h-4 w-4" />
                </a>
              </Button>
            </div>
          </div>
        </section>

        {!connected ? (
          <section className="space-y-3">
            <Card>
              <CardContent className="space-y-4 py-8">
                <div className="space-y-2 text-center">
                  <div className="text-base font-semibold text-foreground">NovelAI 연결이 필요해</div>
                  <div className="text-sm text-muted-foreground">상단의 로그인 버튼을 눌러 계정 로그인 또는 토큰 저장을 진행해줘.</div>
                </div>
                <div className="flex justify-center">
                  <Button type="button" onClick={() => setIsNaiAuthModalOpen(true)}>
                    로그인 열기
                  </Button>
                </div>
              </CardContent>
            </Card>
          </section>
        ) : (
          <>

            <section className="space-y-3">
              <Card>
                <CardContent className="space-y-4">
                  <SectionHeading variant="inside" className="border-b border-border/70 pb-4" heading="Prompt" />
                  <PromptToggleField
                    tool="nai"
                    positiveValue={naiForm.prompt}
                    negativeValue={naiForm.negativePrompt}
                    onPositiveChange={(value) => handleNaiFieldChange('prompt', value)}
                    onNegativeChange={(value) => handleNaiFieldChange('negativePrompt', value)}
                    positiveRows={6}
                    negativeRows={6}
                  />
                </CardContent>
              </Card>
            </section>

            <section className="space-y-3">
              <Card>
                <CardContent className="space-y-4">
                  <SectionHeading variant="inside" className="border-b border-border/70 pb-4" heading="Character Prompt" />
                  <div className="space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-sm border border-border bg-surface-low p-3">
                      <div className="text-sm font-medium text-foreground">Character Prompt</div>
                      <Button type="button" variant="outline" size="sm" onClick={handleAddCharacterPrompt} disabled={!supportsCharacterPrompts}>
                        <Plus className="h-4 w-4" />
                        캐릭터 추가
                      </Button>
                    </div>

                    {!supportsCharacterPrompts ? (
                      <div className="text-xs text-[#ffb4ab]">현재 모델에서는 Character Prompt를 사용할 수 없어.</div>
                    ) : (
                      <>
                        <ToggleRow variant="detail" className="justify-between rounded-sm border border-border bg-surface-low px-3 py-2.5">
                          <div className="space-y-1">
                            <div className="text-sm font-medium text-foreground">AI's Choice</div>
                            <div className="text-xs text-muted-foreground">
                              {canUseCharacterPositions
                                ? "켜두면 위치는 NovelAI가 알아서 정해. 끄면 5x5 위치를 직접 고를 수 있어."
                                : "수동 위치 지정은 캐릭터 2명 이상일 때만 가능해."}
                            </div>
                          </div>
                          <input
                            type="checkbox"
                            checked={naiForm.characterPositionAiChoice}
                            disabled={!canUseCharacterPositions}
                            onChange={(event) => setNaiForm((current) => ({
                              ...current,
                              characterPositionAiChoice: event.target.checked,
                            }))}
                          />
                        </ToggleRow>

                        {useCharacterPositions ? (
                          <NaiCharacterPositionBoard
                            characters={naiForm.characters.map((character, index) => ({
                              label: `Character ${index + 1}`,
                              centerX: character.centerX,
                              centerY: character.centerY,
                            }))}
                            selectedIndex={selectedCharacterIndex}
                            onSelectIndex={setSelectedCharacterIndex}
                            onPositionChange={(index, centerX, centerY) => {
                              handleCharacterPromptChange(index, 'centerX', centerX)
                              handleCharacterPromptChange(index, 'centerY', centerY)
                            }}
                          />
                        ) : null}

                        {naiForm.characters.length === 0 ? (
                          <div className="rounded-sm border border-dashed border-border bg-surface-low px-3 py-4 text-sm text-muted-foreground">
                            캐릭터 없음
                          </div>
                        ) : (
                          <div className="space-y-3">
                            {naiForm.characters.map((character, index) => (
                              <div
                                key={`nai-character-${index}`}
                                className={index === selectedCharacterIndex
                                  ? 'space-y-3 rounded-sm border border-accent bg-surface-low p-3 ring-1 ring-accent/50'
                                  : 'space-y-3 rounded-sm border border-border bg-surface-low p-3'}
                                onClick={() => setSelectedCharacterIndex(index)}
                              >
                                <div className="flex items-center justify-between gap-3">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <div className="text-sm font-medium text-foreground">Character {index + 1}</div>
                                    <Badge variant="outline">{useCharacterPositions ? `${character.centerX} · ${character.centerY}` : "AI's Choice"}</Badge>
                                  </div>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    onClick={(event) => {
                                      event.stopPropagation()
                                      handleRemoveCharacterPrompt(index)
                                    }}
                                  >
                                    <Trash2 className="h-4 w-4" />
                                    제거
                                  </Button>
                                </div>

                                <PromptToggleField
                                  tool="nai"
                                  positiveValue={character.prompt}
                                  negativeValue={character.uc}
                                  onPositiveChange={(value) => handleCharacterPromptChange(index, 'prompt', value)}
                                  onNegativeChange={(value) => handleCharacterPromptChange(index, 'uc', value)}
                                  positiveRows={4}
                                  negativeRows={3}
                                />

                                {useCharacterPositions ? (
                                  <div className="grid gap-4 sm:grid-cols-2">
                                    <FormField label="X">
                                      <Select value={character.centerX} onChange={(event) => handleCharacterPromptChange(index, 'centerX', event.target.value)}>
                                        {NAI_CHARACTER_GRID_X_OPTIONS.map((option) => (
                                          <option key={option.value} value={option.value}>{option.label}</option>
                                        ))}
                                      </Select>
                                    </FormField>
                                    <FormField label="Y">
                                      <Select value={character.centerY} onChange={(event) => handleCharacterPromptChange(index, 'centerY', event.target.value)}>
                                        {NAI_CHARACTER_GRID_Y_OPTIONS.map((option) => (
                                          <option key={option.value} value={option.value}>{option.label}</option>
                                        ))}
                                      </Select>
                                    </FormField>
                                  </div>
                                ) : null}
                              </div>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </CardContent>
              </Card>
            </section>


            <section className="space-y-3">
              <Card>
                <CardContent className="space-y-4">
                  <SectionHeading variant="inside" className="border-b border-border/70 pb-4" heading="Settings" />
                  <div className="space-y-4">
                    <div className="grid gap-4 md:grid-cols-4">
                      <FormField label="Model">
                        <Select value={naiForm.model} onChange={(event) => handleNaiFieldChange('model', event.target.value)}>
                          {NAI_MODEL_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}
                        </Select>
                      </FormField>

                      <FormField label="Action">
                        <Select value={naiForm.action} onChange={(event) => handleNaiFieldChange('action', event.target.value)}>
                          {NAI_ACTION_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}
                        </Select>
                      </FormField>

                      <FormField label="Sampler">
                        <Select value={naiForm.sampler} onChange={(event) => handleNaiFieldChange('sampler', event.target.value)}>
                          {NAI_SAMPLER_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}
                        </Select>
                      </FormField>

                      <FormField label="Scheduler">
                        <Select value={naiForm.scheduler} onChange={(event) => handleNaiFieldChange('scheduler', event.target.value)}>
                          {NAI_SCHEDULER_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}
                        </Select>
                      </FormField>
                    </div>

                    <div className="grid gap-4 md:grid-cols-3">
                      <FormField label="Preset">
                        <Select value={naiForm.resolutionPreset} onChange={(event) => handleResolutionPresetChange(event.target.value)}>
                          {NAI_RESOLUTION_PRESETS.map((preset) => (
                            <option key={preset.key} value={preset.key}>{preset.label}</option>
                          ))}
                          <option value="custom">Custom</option>
                        </Select>
                      </FormField>

                      <div className="space-y-2 md:col-span-2">
                        <div className="text-sm font-medium text-foreground">Variety+</div>
                        <ToggleRow variant="detail" className="justify-between rounded-sm border border-border bg-surface-low px-3 py-2.5">
                          <div className="text-sm text-foreground">사용</div>
                          <input type="checkbox" checked={naiForm.varietyPlus} onChange={(event) => setNaiForm((current) => ({ ...current, varietyPlus: event.target.checked }))} />
                        </ToggleRow>
                      </div>
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                      <FormField label="Width">
                        <Input type="number" min={64} step={64} value={naiForm.width} onChange={(event) => handleNaiFieldChange('width', event.target.value)} />
                      </FormField>
                      <FormField label="Height">
                        <Input type="number" min={64} step={64} value={naiForm.height} onChange={(event) => handleNaiFieldChange('height', event.target.value)} />
                      </FormField>
                      <FormField label="Steps">
                        <Input type="number" min={1} max={100} value={naiForm.steps} onChange={(event) => handleNaiFieldChange('steps', event.target.value)} />
                      </FormField>
                      <FormField label="CFG Scale">
                        <Input type="number" min={1} max={20} step={0.1} value={naiForm.scale} onChange={(event) => handleNaiFieldChange('scale', event.target.value)} />
                      </FormField>
                      <FormField label="Samples">
                        <Input type="number" min={NAI_SAMPLE_COUNT_MIN} max={NAI_SAMPLE_COUNT_MAX} step={1} value={naiForm.samples} onChange={(event) => handleNaiFieldChange('samples', event.target.value)} />
                      </FormField>
                      <FormField label="Seed">
                        <Input type="number" value={naiForm.seed} onChange={(event) => handleNaiFieldChange('seed', event.target.value)} />
                      </FormField>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </section>

            {naiForm.action !== 'generate' ? (
              <section className="space-y-3">
                <Card>
                  <CardContent className="space-y-4">
                    <SectionHeading variant="inside" className="border-b border-border/70 pb-4" heading="Images" />
                    <div className="space-y-4">
                      <FormField label="Source Image">
                        <div className="space-y-3">
                          <FilePickerButton label={naiForm.sourceImage ? '소스 이미지 변경' : '소스 이미지 선택'} onSelect={(file) => void handleNaiImageChange('sourceImage', file)} />
                          {naiForm.sourceImage ? <SelectedImageCard image={naiForm.sourceImage} alt="NAI source" onRemove={() => void handleNaiImageChange('sourceImage')} /> : null}
                        </div>
                      </FormField>

                      {naiForm.action === 'infill' ? (
                        <FormField label="Mask Image">
                          <div className="space-y-3">
                            <FilePickerButton label={naiForm.maskImage ? '마스크 이미지 변경' : '마스크 이미지 선택'} onSelect={(file) => void handleNaiImageChange('maskImage', file)} />
                            {naiForm.maskImage ? <SelectedImageCard image={naiForm.maskImage} alt="NAI mask" onRemove={() => void handleNaiImageChange('maskImage')} /> : null}
                          </div>
                        </FormField>
                      ) : null}

                      <div className="space-y-4 rounded-sm border border-border bg-surface-low p-3">
                        <div className="text-sm font-medium text-foreground">Image Options</div>
                        <div className="grid gap-4 md:grid-cols-2">
                          <FormField label="Strength">
                            <Input type="number" min={0} max={1} step={0.01} value={naiForm.strength} onChange={(event) => handleNaiFieldChange('strength', event.target.value)} />
                          </FormField>
                          <FormField label="Noise">
                            <Input type="number" min={0} max={1} step={0.01} value={naiForm.noise} onChange={(event) => handleNaiFieldChange('noise', event.target.value)} />
                          </FormField>
                        </div>

                        {naiForm.action === 'infill' ? (
                          <ToggleRow variant="detail" className="justify-between rounded-sm border border-border bg-surface-low px-3 py-2.5">
                            <div className="text-sm text-foreground">Original</div>
                            <input type="checkbox" checked={naiForm.addOriginalImage} onChange={(event) => setNaiForm((current) => ({ ...current, addOriginalImage: event.target.checked }))} />
                          </ToggleRow>
                        ) : null}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </section>
            ) : null}


            <section className="space-y-3">
              <Card>
                <CardContent className="space-y-4">
                  <SectionHeading
                    variant="inside"
                    className="border-b border-border/70 pb-4"
                    heading="Vibes"
                    actions={(
                      <>
                        <Badge variant="outline">{naiForm.vibes.length}</Badge>
                        <Button type="button" size="sm" variant="ghost" onClick={() => setIsVibesCollapsed((current) => !current)}>
                          <ChevronDown className={`h-4 w-4 transition-transform ${isVibesCollapsed ? '-rotate-90' : 'rotate-0'}`} />
                          {isVibesCollapsed ? '펼치기' : '접기'}
                        </Button>
                      </>
                    )}
                  />
                  {!isVibesCollapsed ? (
                    <div className="space-y-4">
                      <div className="flex flex-wrap items-center justify-between gap-3 rounded-sm border border-border bg-surface-low p-3">
                        <div>
                          <div className="text-sm font-medium text-foreground">Vibe Transfer</div>
                          <div className="text-xs text-muted-foreground">reference 이미지를 넣고 encoded vibe를 저장하거나 바로 재사용해.</div>
                        </div>
                        <Button type="button" variant="outline" size="sm" onClick={handleAddVibe}>
                          <Plus className="h-4 w-4" />
                          Vibe 추가
                        </Button>
                      </div>

                      {naiForm.vibes.length === 0 ? (
                        <div className="rounded-sm border border-dashed border-border bg-surface-low px-3 py-4 text-sm text-muted-foreground">Vibe 없음</div>
                      ) : (
                        <div className="space-y-3">
                          {naiForm.vibes.map((vibe, index) => (
                            <div key={`nai-vibe-${index}`} className="space-y-3 rounded-sm border border-border bg-surface-low p-3">
                              <div className="flex items-center justify-between gap-3">
                                <div className="flex flex-wrap items-center gap-2">
                                  <div className="text-sm font-medium text-foreground">Vibe {index + 1}</div>
                                  {vibe.encoded ? <Badge variant="secondary">encoded</Badge> : <Badge variant="outline">not encoded</Badge>}
                                </div>
                                <Button type="button" variant="ghost" size="sm" onClick={() => handleRemoveVibe(index)}>
                                  <Trash2 className="h-4 w-4" />
                                  제거
                                </Button>
                              </div>

                              <FormField label="Reference Image">
                                <div className="space-y-3">
                                  <FilePickerButton label={vibe.image ? '참조 이미지 변경' : '참조 이미지 선택'} onSelect={(file) => void handleVibeImageChange(index, file)} />
                                  {vibe.image ? <SelectedImageCard image={vibe.image} alt={`NAI vibe ${index + 1}`} onRemove={() => void handleVibeImageChange(index)} /> : null}
                                </div>
                              </FormField>

                              <div className="grid gap-4 sm:grid-cols-2">
                                <FormField label="Strength">
                                  <Input type="number" min={0.01} max={1} step={0.01} value={vibe.strength} onChange={(event) => handleVibeFieldChange(index, 'strength', event.target.value)} />
                                </FormField>
                                <FormField label="Information Extracted">
                                  <Input type="number" min={0.01} max={1} step={0.01} value={vibe.informationExtracted} onChange={(event) => handleVibeFieldChange(index, 'informationExtracted', event.target.value)} />
                                </FormField>
                              </div>

                              <div className="rounded-sm border border-border bg-surface-low px-3 py-2 text-xs text-muted-foreground break-all">
                                {vibe.encoded ? `encoded: ${vibe.encoded.slice(0, 64)}…` : '아직 인코딩 안 됨'}
                              </div>

                              <div className="flex justify-end gap-2">
                                <Button type="button" variant="outline" onClick={() => void handleSaveVibeToStore(index)} disabled={!vibe.encoded}>
                                  <Save className="h-4 w-4" />
                                  저장
                                </Button>
                                <Button type="button" variant="outline" onClick={() => void handleEncodeVibe(index)} disabled={!vibe.image || encodingVibeIndex !== null}>
                                  <WandSparkles className="h-4 w-4" />
                                  {encodingVibeIndex === index ? '인코딩 중…' : '인코딩'}
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      <div className="space-y-2 rounded-sm border border-border bg-surface-low p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <div className="text-sm font-medium text-foreground">Saved Vibes</div>
                            <Badge variant="outline">{savedVibesQuery.data?.length ?? 0}</Badge>
                          </div>
                          <div className="w-full sm:w-72">
                            <Input value={savedVibeSearch} onChange={(event) => setSavedVibeSearch(event.target.value)} placeholder="이름 / 모델 검색" />
                          </div>
                        </div>
                        {savedVibesQuery.isLoading ? (
                          <div className="text-sm text-muted-foreground">불러오는 중…</div>
                        ) : filteredSavedVibes.length > 0 ? (
                          <div className="grid gap-3 md:grid-cols-2">
                            {filteredSavedVibes.map((asset) => (
                              <div key={asset.id} className="space-y-3 rounded-sm border border-border bg-surface-low p-3">
                                <div className="flex gap-3">
                                  {asset.image_data_url ? (
                                    <img src={asset.image_data_url} alt={asset.label} className="h-20 w-20 shrink-0 rounded-sm border border-border object-contain" />
                                  ) : (
                                    <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-sm border border-dashed border-border text-[11px] text-muted-foreground">
                                      no preview
                                    </div>
                                  )}
                                  <div className="min-w-0 space-y-2">
                                    <div className="truncate text-sm font-medium text-foreground">{asset.label}</div>
                                    <div className="truncate text-xs text-muted-foreground">{asset.model}</div>
                                    <div className="flex flex-wrap gap-1.5">
                                      <Badge variant="outline">strength {asset.strength}</Badge>
                                      <Badge variant="outline">IE {asset.information_extracted}</Badge>
                                    </div>
                                    <div className="text-[11px] text-muted-foreground">{new Date(asset.created_date).toLocaleString('ko-KR')}</div>
                                  </div>
                                </div>
                                <div className="flex justify-end gap-2">
                                  <Button type="button" size="sm" variant="outline" onClick={() => handleLoadVibeFromStore(asset.id)}>불러오기</Button>
                                  <Button type="button" size="sm" variant="ghost" onClick={() => void handleDeleteVibeFromStore(asset.id)}>삭제</Button>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="text-sm text-muted-foreground">검색 결과가 없거나 저장된 vibe가 없어.</div>
                        )}
                      </div>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            </section>


            <section className="space-y-3">
              <Card>
                <CardContent className="space-y-4">
                  <SectionHeading
                    variant="inside"
                    className="border-b border-border/70 pb-4"
                    heading="References"
                    actions={(
                      <>
                        <Badge variant="outline">{naiForm.characterReferences.length}</Badge>
                        <Button type="button" size="sm" variant="ghost" onClick={() => setIsReferencesCollapsed((current) => !current)}>
                          <ChevronDown className={`h-4 w-4 transition-transform ${isReferencesCollapsed ? '-rotate-90' : 'rotate-0'}`} />
                          {isReferencesCollapsed ? '펼치기' : '접기'}
                        </Button>
                      </>
                    )}
                  />
                  {!isReferencesCollapsed ? (
                    <div className="space-y-4">
                      <div className="flex flex-wrap items-center justify-between gap-3 rounded-sm border border-border bg-surface-low p-3">
                        <div>
                          <div className="text-sm font-medium text-foreground">Character Reference</div>
                          <div className="text-xs text-muted-foreground">reference 이미지를 직접 넣거나 저장된 reference를 재사용해.</div>
                        </div>
                        <Button type="button" variant="outline" size="sm" onClick={handleAddCharacterReference} disabled={!supportsCharacterReference}>
                          <Plus className="h-4 w-4" />
                          Reference 추가
                        </Button>
                      </div>

                      {!supportsCharacterReference ? <div className="text-xs text-[#ffb4ab]">현재 모델에서는 Character Reference를 사용할 수 없어.</div> : null}

                      {naiForm.characterReferences.length === 0 ? (
                        <div className="rounded-sm border border-dashed border-border bg-surface-low px-3 py-4 text-sm text-muted-foreground">Reference 없음</div>
                      ) : (
                        <div className="space-y-3">
                          {naiForm.characterReferences.map((reference, index) => (
                            <div key={`nai-character-reference-${index}`} className="space-y-3 rounded-sm border border-border bg-surface-low p-3">
                              <div className="flex items-center justify-between gap-3">
                                <div className="text-sm font-medium text-foreground">Reference {index + 1}</div>
                                <Button type="button" variant="ghost" size="sm" onClick={() => handleRemoveCharacterReference(index)}>
                                  <Trash2 className="h-4 w-4" />
                                  제거
                                </Button>
                              </div>

                              <FormField label="Reference Image">
                                <div className="space-y-3">
                                  <FilePickerButton label={reference.image ? '참조 이미지 변경' : '참조 이미지 선택'} onSelect={(file) => void handleCharacterReferenceImageChange(index, file)} />
                                  {reference.image ? <SelectedImageCard image={reference.image} alt={`NAI character reference ${index + 1}`} onRemove={() => void handleCharacterReferenceImageChange(index)} /> : null}
                                </div>
                              </FormField>

                              <div className="grid gap-4 md:grid-cols-3">
                                <FormField label="Type">
                                  <Select value={reference.type} onChange={(event) => handleCharacterReferenceFieldChange(index, 'type', event.target.value)}>
                                    <option value="character">character</option>
                                    <option value="style">style</option>
                                    <option value="character&style">character&style</option>
                                  </Select>
                                </FormField>
                                <FormField label="Strength">
                                  <Input type="number" min={0} max={1} step={0.01} value={reference.strength} onChange={(event) => handleCharacterReferenceFieldChange(index, 'strength', event.target.value)} />
                                </FormField>
                                <FormField label="Fidelity">
                                  <Input type="number" min={0} max={1} step={0.01} value={reference.fidelity} onChange={(event) => handleCharacterReferenceFieldChange(index, 'fidelity', event.target.value)} />
                                </FormField>
                              </div>

                              <div className="flex justify-end">
                                <Button type="button" variant="outline" onClick={() => void handleSaveCharacterReferenceToStore(index)} disabled={!reference.image}>
                                  <Save className="h-4 w-4" />
                                  저장
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      <div className="space-y-2 rounded-sm border border-border bg-surface-low p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <div className="text-sm font-medium text-foreground">Saved Character References</div>
                            <Badge variant="outline">{savedCharacterReferencesQuery.data?.length ?? 0}</Badge>
                          </div>
                          <div className="w-full sm:w-72">
                            <Input value={savedCharacterReferenceSearch} onChange={(event) => setSavedCharacterReferenceSearch(event.target.value)} placeholder="이름 / 타입 검색" />
                          </div>
                        </div>
                        {savedCharacterReferencesQuery.isLoading ? (
                          <div className="text-sm text-muted-foreground">불러오는 중…</div>
                        ) : filteredSavedCharacterReferences.length > 0 ? (
                          <div className="grid gap-3 md:grid-cols-2">
                            {filteredSavedCharacterReferences.map((asset) => (
                              <div key={asset.id} className="space-y-3 rounded-sm border border-border bg-surface-low p-3">
                                <div className="flex gap-3">
                                  <img src={asset.image_data_url} alt={asset.label} className="h-20 w-20 shrink-0 rounded-sm border border-border object-contain" />
                                  <div className="min-w-0 space-y-2">
                                    <div className="truncate text-sm font-medium text-foreground">{asset.label}</div>
                                    <div className="flex flex-wrap gap-1.5">
                                      <Badge variant="outline">{asset.type}</Badge>
                                      <Badge variant="outline">strength {asset.strength}</Badge>
                                      <Badge variant="outline">fidelity {asset.fidelity}</Badge>
                                    </div>
                                    <div className="text-[11px] text-muted-foreground">{new Date(asset.created_date).toLocaleString('ko-KR')}</div>
                                  </div>
                                </div>
                                <div className="flex justify-end gap-2">
                                  <Button type="button" size="sm" variant="outline" onClick={() => handleLoadCharacterReferenceFromStore(asset.id)}>불러오기</Button>
                                  <Button type="button" size="sm" variant="ghost" onClick={() => void handleDeleteCharacterReferenceFromStore(asset.id)}>삭제</Button>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="text-sm text-muted-foreground">검색 결과가 없거나 저장된 reference가 없어.</div>
                        )}
                      </div>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            </section>

            <section className="space-y-3">
              <Card>
                <CardContent className="space-y-4">
                  <SectionHeading variant="inside" className="border-b border-border/70 pb-4" heading="Actions" />
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" variant="outline" onClick={() => setIsModuleSaveModalOpen(true)}>
                        <Save className="h-4 w-4" />
                        모듈 저장
                      </Button>
                      {naiForm.action !== 'generate' ? (
                        <Button type="button" variant="outline" onClick={handleUpscale} disabled={!naiForm.sourceImage || isUpscaling}>
                          <Download className="h-4 w-4" />
                          {isUpscaling ? '업스케일 중…' : '소스 2x 업스케일'}
                        </Button>
                      ) : null}
                    </div>

                    <div className="flex flex-wrap justify-end gap-2">
                      <Button type="button" variant="ghost" onClick={() => setNaiForm(DEFAULT_NAI_FORM)} disabled={isNaiGenerating || isUpscaling}>
                        초기화
                      </Button>
                      <Button type="button" onClick={handleNaiGenerate} disabled={isNaiGenerating || naiForm.prompt.trim().length === 0}>
                        <Sparkles className="h-4 w-4" />
                        {naiGenerateButtonLabel}
                      </Button>
                    </div>
                  </div>
                  {naiCostQuery.isError ? <div className="text-xs text-[#ffb4ab]">{getErrorMessage(naiCostQuery.error, '예상 비용 계산에 실패했어.')}</div> : null}
                </CardContent>
              </Card>
            </section>
          </>
        )}
      </div>

      <NaiAuthModal
        open={isNaiAuthModalOpen}
        loginMode={loginMode}
        isSubmitting={isNaiLoggingIn}
        username={naiUsernameInput}
        password={naiPasswordInput}
        token={naiTokenInput}
        connectionHint={naiConnectionHint}
        showStatusHint={naiUserQuery.isError}
        onClose={() => setIsNaiAuthModalOpen(false)}
        onLoginModeChange={setLoginMode}
        onUsernameChange={setNaiUsernameInput}
        onPasswordChange={setNaiPasswordInput}
        onTokenChange={setNaiTokenInput}
        onSubmit={() => void (loginMode === 'account' ? handleNaiAccountLogin() : handleNaiTokenLogin())}
      />

      <NaiModuleSaveModal
        open={isModuleSaveModalOpen}
        moduleName={naiModuleName}
        moduleDescription={naiModuleDescription}
        fieldOptions={naiModuleFieldOptions}
        exposedFieldKeys={naiExposedFieldKeys}
        isSaving={isSavingNaiModule}
        onClose={() => setIsModuleSaveModalOpen(false)}
        onModuleNameChange={setNaiModuleName}
        onModuleDescriptionChange={setNaiModuleDescription}
        onExposedFieldKeysChange={setNaiExposedFieldKeys}
        onSave={() => void handleCreateNaiModule()}
      />
    </>
  )
}


