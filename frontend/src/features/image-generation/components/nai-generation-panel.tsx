import { Suspense, lazy, useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Plus, Save, Trash2 } from 'lucide-react'
import { SectionHeading } from '@/components/common/section-heading'
import { ImageSaveOptionsModal } from '@/components/media/image-save-options-modal'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { SegmentedControl } from '@/components/common/segmented-control'
import { Input } from '@/components/ui/input'
import { ScrubbableNumberInput } from '@/components/ui/scrubbable-number-input'
import { Select } from '@/components/ui/select'
import { ToggleRow } from '@/components/ui/toggle-row'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { SettingsModal } from '@/features/settings/components/settings-modal'
import { triggerBlobDownload } from '@/lib/api-client'
import { DEFAULT_IMAGE_SAVE_SETTINGS, buildImageSaveOutput, buildImageSaveOutputFileName, loadImageSaveSourceInfo, type ImageSaveSourceInfo } from '@/lib/image-save-output'
import {
  createNaiModuleFromSnapshot,
  deleteNaiCharacterReferenceAsset,
  deleteNaiVibeAsset,
  encodeNaiVibe,
  generateNaiImage,
  getAppSettings,
  getNaiCostEstimate,
  getNaiUserData,
  listNaiCharacterReferenceAssets,
  listNaiVibeAssets,
  loginNai,
  loginNaiWithToken,
  saveNaiCharacterReferenceAsset,
  saveNaiVibeAsset,
  updateNaiCharacterReferenceAsset,
  updateNaiVibeAsset,
  upscaleNaiImage,
} from '@/lib/api'
import {
  buildNaiCharacterPromptPayload,
  buildNaiCharacterReferencePayload,
  buildNaiModuleFieldOptions,
  buildNaiModuleSnapshot,
  buildNaiModuleUiSchema,
  buildNaiVibePayload,
  buildSelectedImageDraftFromDataUrl,
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
  NAI_MODEL_OPTIONS,
  NAI_RESOLUTION_PRESETS,
  NAI_SAMPLER_OPTIONS,
  NAI_SCHEDULER_OPTIONS,
  normalizeNaiCharacterPromptDrafts,
  parseNumberInput,
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
import { ImageAttachmentPickerButton } from './image-attachment-picker'
import { NaiReferencesSection } from './nai-references-section'
import { NaiSelectedImageCard } from './nai-selected-image-card'
import { NaiVibesSection } from './nai-vibes-section'
import { NaiAssetSaveModal } from './nai-asset-save-modal'
import { NaiCharacterPositionBoard } from './nai-character-position-board'
import { NaiModuleSaveModal } from './nai-module-save-modal'
import { PromptToggleField } from './prompt-toggle-field'
import { decodeNaiBase64Png, deriveNaiAssetLabel, buildNaiEditedImageFileName } from './nai-generation-panel-helpers'
import { NaiActionSection, NaiConnectionHeader, NaiPromptSection } from './nai-generation-panel-sections'
import type { ImageSaveSettings } from '@/types/settings'

const ImageEditorModal = lazy(() => import('@/features/image-editor/image-editor-modal'))

type NaiGenerationPanelProps = {
  refreshNonce: number
  onHistoryRefresh: () => void
}

type NaiLoginMode = 'account' | 'token'

type AssetSaveTarget =
  | { mode: 'create'; kind: 'vibe'; index: number }
  | { mode: 'create'; kind: 'reference'; index: number }
  | { mode: 'edit'; kind: 'vibe'; assetId: string }
  | { mode: 'edit'; kind: 'reference'; assetId: string }

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
  const [isSavingAsset, setIsSavingAsset] = useState(false)
  const [assetSaveTarget, setAssetSaveTarget] = useState<AssetSaveTarget | null>(null)
  const [assetSaveName, setAssetSaveName] = useState('')
  const [assetSaveDescription, setAssetSaveDescription] = useState('')
  const [isUpscaling, setIsUpscaling] = useState(false)
  const [isImageEditorOpen, setIsImageEditorOpen] = useState(false)
  const [pendingImageEditorSave, setPendingImageEditorSave] = useState<{ sourceImageDataUrl: string; maskImageDataUrl?: string } | null>(null)
  const [pendingImageEditorSaveInfo, setPendingImageEditorSaveInfo] = useState<ImageSaveSourceInfo | null>(null)
  const [imageEditorSaveOptions, setImageEditorSaveOptions] = useState<ImageSaveSettings>(DEFAULT_IMAGE_SAVE_SETTINGS)
  const [encodingVibeIndex, setEncodingVibeIndex] = useState<number | null>(null)
  const [selectedCharacterIndex, setSelectedCharacterIndex] = useState<number | null>(null)
  const [savedVibeSearch, setSavedVibeSearch] = useState('')
  const [savedCharacterReferenceSearch, setSavedCharacterReferenceSearch] = useState('')
  const [naiForm, setNaiForm] = useState<NAIFormDraft>(DEFAULT_NAI_FORM)
  const [naiModuleName, setNaiModuleName] = useState('NAI Module')
  const [naiModuleDescription, setNaiModuleDescription] = useState('')
  const [naiExposedFieldKeys, setNaiExposedFieldKeys] = useState<string[]>(['prompt', 'negative_prompt', 'characters', 'vibes', 'character_refs', 'seed'])

  const naiUserQuery = useQuery({
    queryKey: ['image-generation-nai-user'],
    queryFn: getNaiUserData,
    retry: false,
  })

  const appSettingsQuery = useQuery({
    queryKey: ['app-settings'],
    queryFn: getAppSettings,
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

    return items.filter((item) => `${item.label} ${item.description ?? ''} ${item.model}`.toLowerCase().includes(keyword))
  }, [savedVibeSearch, savedVibesQuery.data])
  const filteredSavedCharacterReferences = useMemo(() => {
    const items = savedCharacterReferencesQuery.data || []
    const keyword = savedCharacterReferenceSearch.trim().toLowerCase()
    if (!keyword) {
      return items
    }

    return items.filter((item) => `${item.label} ${item.description ?? ''} ${item.type}`.toLowerCase().includes(keyword))
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

  const handleNaiImageChange = (field: 'sourceImage' | 'maskImage', image?: SelectedImageDraft) => {
    setNaiForm((current) => ({
      ...current,
      [field]: image,
    }))
  }

  const handleOpenImageEditor = () => {
    if (!naiForm.sourceImage) {
      showSnackbar({ message: '먼저 소스 이미지를 선택해.', tone: 'error' })
      return
    }

    setIsImageEditorOpen(true)
  }

  const applyImageEditorSaveOutput = async (
    payload: { sourceImageDataUrl: string; maskImageDataUrl?: string },
    imageSaveSettings: ImageSaveSettings,
  ) => {
    if (!imageSaveSettings.applyToEditorSave) {
      setNaiForm((current) => ({
        ...current,
        sourceImage: buildSelectedImageDraftFromDataUrl(payload.sourceImageDataUrl, buildNaiEditedImageFileName(current.sourceImage?.fileName, 'source-image')),
        maskImage: current.action === 'infill'
          ? payload.maskImageDataUrl
            ? buildSelectedImageDraftFromDataUrl(payload.maskImageDataUrl, buildNaiEditedImageFileName(current.maskImage?.fileName, 'mask-image'))
            : undefined
          : current.maskImage,
      }))
      return
    }

    const sourceOutput = await buildImageSaveOutput(
      {
        source: payload.sourceImageDataUrl,
        sourceMimeType: 'image/png',
      },
      imageSaveSettings,
    )

    const maskOutput = payload.maskImageDataUrl
      ? await buildImageSaveOutput(
        {
          source: payload.maskImageDataUrl,
          sourceMimeType: 'image/png',
        },
        imageSaveSettings,
      )
      : null

    setNaiForm((current) => ({
      ...current,
      sourceImage: buildSelectedImageDraftFromDataUrl(
        sourceOutput.dataUrl,
        buildImageSaveOutputFileName(buildNaiEditedImageFileName(current.sourceImage?.fileName, 'source-image'), sourceOutput.format),
      ),
      maskImage: current.action === 'infill'
        ? maskOutput
          ? buildSelectedImageDraftFromDataUrl(
            maskOutput.dataUrl,
            buildImageSaveOutputFileName(buildNaiEditedImageFileName(current.maskImage?.fileName, 'mask-image'), maskOutput.format),
          )
          : undefined
        : current.maskImage,
    }))
  }

  const handleSaveImageEditor = async (payload: { sourceImageDataUrl: string; maskImageDataUrl?: string }) => {
    const imageSaveSettings = appSettingsQuery.data?.imageSave ?? DEFAULT_IMAGE_SAVE_SETTINGS

    if (imageSaveSettings.applyToEditorSave && imageSaveSettings.alwaysShowDialog) {
      setImageEditorSaveOptions(imageSaveSettings)
      setPendingImageEditorSaveInfo(await loadImageSaveSourceInfo({ source: payload.sourceImageDataUrl, sourceMimeType: 'image/png' }))
      setPendingImageEditorSave(payload)
      return
    }

    await applyImageEditorSaveOutput(payload, imageSaveSettings)
  }

  const handleConfirmImageEditorSave = async () => {
    if (!pendingImageEditorSave) {
      return
    }

    await applyImageEditorSaveOutput(pendingImageEditorSave, imageEditorSaveOptions)
    setPendingImageEditorSave(null)
    setPendingImageEditorSaveInfo(null)
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
    setNaiForm((current) => ({
      ...current,
      vibes: [...current.vibes, { ...EMPTY_NAI_VIBE }],
    }))
  }

  const handleVibeFieldChange = (index: number, field: 'strength' | 'informationExtracted', value: string) => {
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

  const handleVibeImageChange = (index: number, image?: SelectedImageDraft) => {
    setNaiForm((current) => ({
      ...current,
      vibes: current.vibes.map((vibe, vibeIndex) => (
        vibeIndex === index
          ? {
            ...vibe,
            image,
            encoded: '',
          }
          : vibe
      )),
    }))
  }

  const handleEncodeVibe = async (
    index: number,
    options?: {
      silentSuccess?: boolean
      refetchUserData?: boolean
    },
  ) => {
    const vibe = naiForm.vibes[index]
    if (!vibe?.image || encodingVibeIndex !== null) {
      return null
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
      if (options?.refetchUserData !== false) {
        await naiUserQuery.refetch()
      }
      if (!options?.silentSuccess) {
        showSnackbar({ message: `Vibe ${index + 1} 인코딩 완료. 이 결과를 재사용하면 돼.`, tone: 'info' })
      }
      return response.encoded
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, 'Vibe 인코딩에 실패했어.'), tone: 'error' })
      return null
    } finally {
      setEncodingVibeIndex(null)
    }
  }

  const ensureEncodedVibes = async () => {
    const nextVibes = [...naiForm.vibes]
    let encodedCount = 0

    for (const [index, vibe] of nextVibes.entries()) {
      if (!vibe?.image || vibe.encoded.trim().length > 0) {
        continue
      }

      const encoded = await handleEncodeVibe(index, {
        silentSuccess: true,
        refetchUserData: false,
      })

      if (!encoded) {
        return null
      }

      nextVibes[index] = {
        ...vibe,
        encoded,
      }
      encodedCount += 1
    }

    if (encodedCount > 0) {
      await naiUserQuery.refetch()
      showSnackbar({ message: `Vibe ${encodedCount}개 자동 인코딩 완료.`, tone: 'info' })
    }

    return nextVibes
  }

  const handleRemoveVibe = (index: number) => {
    setNaiForm((current) => ({
      ...current,
      vibes: current.vibes.filter((_, vibeIndex) => vibeIndex !== index),
    }))
  }

  const openAssetSaveModal = (target: AssetSaveTarget, initialName: string, initialDescription = '') => {
    setAssetSaveTarget(target)
    setAssetSaveName(initialName)
    setAssetSaveDescription(initialDescription)
  }

  const closeAssetSaveModal = () => {
    setAssetSaveTarget(null)
    setAssetSaveName('')
    setAssetSaveDescription('')
  }

  const handleOpenVibeSaveModal = (index: number) => {
    const vibe = naiForm.vibes[index]
    if (!vibe?.image) {
      showSnackbar({ message: '저장하려면 먼저 Vibe 이미지를 넣어줘.', tone: 'error' })
      return
    }

    openAssetSaveModal({ mode: 'create', kind: 'vibe', index }, deriveNaiAssetLabel(vibe.image.fileName, `Vibe ${index + 1}`))
  }

  const handleOpenEditVibeFromStore = (assetId: string) => {
    const asset = savedVibesQuery.data?.find((entry) => entry.id === assetId)
    if (!asset) {
      return
    }

    openAssetSaveModal({ mode: 'edit', kind: 'vibe', assetId }, asset.label, asset.description ?? '')
  }

  const handleLoadVibeFromStore = (assetId: string) => {
    const asset = savedVibesQuery.data?.find((entry) => entry.id === assetId)
    if (!asset) {
      return
    }

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

  const handleCharacterReferenceImageChange = (index: number, image?: SelectedImageDraft) => {
    setNaiForm((current) => ({
      ...current,
      characterReferences: current.characterReferences.map((reference, referenceIndex) => (
        referenceIndex === index
          ? {
            ...reference,
            image,
          }
          : reference
      )),
    }))
  }

  const handleRemoveCharacterReference = (index: number) => {
    setNaiForm((current) => ({
      ...current,
      characterReferences: current.characterReferences.filter((_, referenceIndex) => referenceIndex !== index),
    }))
  }

  const handleOpenCharacterReferenceSaveModal = (index: number) => {
    const reference = naiForm.characterReferences[index]
    if (!reference?.image) {
      showSnackbar({ message: '저장하려면 Character Reference 이미지가 필요해.', tone: 'error' })
      return
    }

    openAssetSaveModal({ mode: 'create', kind: 'reference', index }, deriveNaiAssetLabel(reference.image.fileName, `Reference ${index + 1}`))
  }

  const handleOpenEditCharacterReferenceFromStore = (assetId: string) => {
    const asset = savedCharacterReferencesQuery.data?.find((entry) => entry.id === assetId)
    if (!asset) {
      return
    }

    openAssetSaveModal({ mode: 'edit', kind: 'reference', assetId }, asset.label, asset.description ?? '')
  }

  const handleLoadCharacterReferenceFromStore = (assetId: string) => {
    const asset = savedCharacterReferencesQuery.data?.find((entry) => entry.id === assetId)
    if (!asset) {
      return
    }

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

  const handleConfirmAssetSave = async () => {
    if (!assetSaveTarget) {
      return
    }

    const trimmedName = assetSaveName.trim()
    if (!trimmedName) {
      showSnackbar({ message: '저장 이름을 입력해줘.', tone: 'error' })
      return
    }

    try {
      setIsSavingAsset(true)

      if (assetSaveTarget.kind === 'vibe') {
        if (assetSaveTarget.mode === 'edit') {
          await updateNaiVibeAsset(assetSaveTarget.assetId, {
            label: trimmedName,
            description: assetSaveDescription.trim() || undefined,
          })
          await savedVibesQuery.refetch()
          showSnackbar({ message: '저장된 Vibe를 수정했어.', tone: 'info' })
        } else {
          const vibe = naiForm.vibes[assetSaveTarget.index]
          if (!vibe?.image) {
            throw new Error('저장할 Vibe 이미지를 찾지 못했어.')
          }

          const encoded = vibe.encoded || await handleEncodeVibe(assetSaveTarget.index, {
            silentSuccess: true,
          })
          if (!encoded) {
            return
          }

          await saveNaiVibeAsset({
            label: trimmedName,
            description: assetSaveDescription.trim() || undefined,
            model: naiForm.model,
            image: vibe.image.dataUrl,
            encoded,
            strength: parseNumberInput(vibe.strength, 0.6),
            information_extracted: parseNumberInput(vibe.informationExtracted, 1),
          })
          await savedVibesQuery.refetch()
          showSnackbar({ message: `Vibe ${assetSaveTarget.index + 1} 저장 완료.`, tone: 'info' })
        }
      } else if (assetSaveTarget.mode === 'edit') {
        await updateNaiCharacterReferenceAsset(assetSaveTarget.assetId, {
          label: trimmedName,
          description: assetSaveDescription.trim() || undefined,
        })
        await savedCharacterReferencesQuery.refetch()
        showSnackbar({ message: '저장된 Character Reference를 수정했어.', tone: 'info' })
      } else {
        const reference = naiForm.characterReferences[assetSaveTarget.index]
        if (!reference?.image) {
          throw new Error('저장할 Character Reference 이미지를 찾지 못했어.')
        }

        await saveNaiCharacterReferenceAsset({
          label: trimmedName,
          description: assetSaveDescription.trim() || undefined,
          image: reference.image.dataUrl,
          type: reference.type,
          strength: parseNumberInput(reference.strength, 0.6),
          fidelity: parseNumberInput(reference.fidelity, 1),
        })
        await savedCharacterReferencesQuery.refetch()
        showSnackbar({ message: `Reference ${assetSaveTarget.index + 1} 저장 완료.`, tone: 'info' })
      }

      closeAssetSaveModal()
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, '저장에 실패했어.'), tone: 'error' })
    } finally {
      setIsSavingAsset(false)
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

    if (!connected) {
      showSnackbar({ message: 'NAI 생성 전에 먼저 로그인해줘. 상단 로그인 버튼을 눌러줘.', tone: 'error' })
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
      const encodedVibes = await ensureEncodedVibes()
      if (!encodedVibes) {
        return
      }

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
        vibes: buildNaiVibePayload(encodedVibes),
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
      triggerBlobDownload(decodeNaiBase64Png(response.image), response.filename)
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
      const encodedVibes = await ensureEncodedVibes()
      if (!encodedVibes) {
        return
      }

      setIsSavingNaiModule(true)
      const snapshot = buildNaiModuleSnapshot({
        ...naiForm,
        vibes: encodedVibes,
      })
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
    : !connected
      ? '로그인 후 생성'
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
        <NaiConnectionHeader
          connected={connected}
          tierName={naiUserQuery.data?.subscription.tierName}
          anlasBalance={naiUserQuery.data?.anlasBalance}
          onOpenAuth={() => setIsNaiAuthModalOpen(true)}
        />

        <NaiPromptSection
          prompt={naiForm.prompt}
          negativePrompt={naiForm.negativePrompt}
          onPromptChange={(value) => handleNaiFieldChange('prompt', value)}
          onNegativePromptChange={(value) => handleNaiFieldChange('negativePrompt', value)}
        />

            <section className="space-y-3">
              <Card>
                <CardContent className="space-y-4">
                  <SectionHeading
                    variant="inside"
                    className="border-b border-border/70 pb-4"
                    heading="Character Prompt"
                    actions={(
                      <>
                        <Badge variant="outline">{naiForm.characters.length}</Badge>
                        <Button
                          type="button"
                          size="icon-sm"
                          variant="outline"
                          onClick={handleAddCharacterPrompt}
                          disabled={!supportsCharacterPrompts}
                          aria-label="캐릭터 추가"
                          title="캐릭터 추가"
                        >
                          <Plus className="h-4 w-4" />
                        </Button>
                      </>
                    )}
                  />
                  <div className="space-y-4">
                    {!supportsCharacterPrompts ? (
                      <div className="text-xs text-[#ffb4ab]">현재 모델에서는 Character Prompt를 사용할 수 없어.</div>
                    ) : (
                      <>
                        <ToggleRow variant="detail" className="justify-between rounded-sm border border-border bg-surface-low px-3 py-2.5">
                          <div className="text-sm font-medium text-foreground">AI's Choice</div>
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

                            </div>
                          ))}
                        </div>
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
                  <div className="space-y-5">
                    <div className="space-y-3">
                      <div className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Core</div>
                      <div className="grid gap-4 md:grid-cols-4">
                        <div className="md:col-span-3">
                          <FormField label="Model">
                            <Select value={naiForm.model} onChange={(event) => handleNaiFieldChange('model', event.target.value)}>
                              {NAI_MODEL_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                              ))}
                            </Select>
                          </FormField>
                        </div>

                        <FormField label="Action">
                          <Select value={naiForm.action} onChange={(event) => handleNaiFieldChange('action', event.target.value)}>
                            {NAI_ACTION_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                          </Select>
                        </FormField>
                      </div>
                    </div>

                    <div className="space-y-3">
                      <div className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Sampling</div>
                      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
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

                        <FormField label="Steps">
                          <Input type="number" min={1} max={100} value={naiForm.steps} onChange={(event) => handleNaiFieldChange('steps', event.target.value)} />
                        </FormField>

                        <FormField label="CFG Scale">
                          <Input type="number" min={1} max={20} step={0.1} value={naiForm.scale} onChange={(event) => handleNaiFieldChange('scale', event.target.value)} />
                        </FormField>
                      </div>
                    </div>

                    <div className="space-y-3">
                      <div className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Output</div>
                      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                        <FormField label="Preset">
                          <Select value={naiForm.resolutionPreset} onChange={(event) => handleResolutionPresetChange(event.target.value)}>
                            {NAI_RESOLUTION_PRESETS.map((preset) => (
                              <option key={preset.key} value={preset.key}>{preset.label}</option>
                            ))}
                            <option value="custom">Custom</option>
                          </Select>
                        </FormField>

                        <FormField label="Width">
                          <Input type="number" min={64} step={64} value={naiForm.width} onChange={(event) => handleNaiFieldChange('width', event.target.value)} />
                        </FormField>

                        <FormField label="Height">
                          <Input type="number" min={64} step={64} value={naiForm.height} onChange={(event) => handleNaiFieldChange('height', event.target.value)} />
                        </FormField>

                        <FormField label="Samples">
                          <Input type="number" min={NAI_SAMPLE_COUNT_MIN} max={NAI_SAMPLE_COUNT_MAX} step={1} value={naiForm.samples} onChange={(event) => handleNaiFieldChange('samples', event.target.value)} />
                        </FormField>

                        <FormField label="Seed">
                          <Input type="number" value={naiForm.seed} onChange={(event) => handleNaiFieldChange('seed', event.target.value)} />
                        </FormField>

                        <div className="space-y-2">
                          <div className="text-sm font-medium text-foreground">Variety+</div>
                          <ToggleRow variant="detail" className="justify-between rounded-sm border border-border bg-surface-low px-3 py-2.5">
                            <div className="text-sm text-foreground">사용</div>
                            <input type="checkbox" checked={naiForm.varietyPlus} onChange={(event) => setNaiForm((current) => ({ ...current, varietyPlus: event.target.checked }))} />
                          </ToggleRow>
                        </div>
                      </div>
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
                          <div className="flex flex-wrap gap-2">
                            <ImageAttachmentPickerButton label={naiForm.sourceImage ? '소스 이미지 변경' : '소스 이미지 선택'} modalTitle="소스 이미지 선택" onSelect={(image) => handleNaiImageChange('sourceImage', image)} />
                            <Button type="button" variant="secondary" onClick={handleOpenImageEditor} disabled={!naiForm.sourceImage}>
                              {naiForm.action === 'infill' ? '소스/마스크 편집' : '소스 편집'}
                            </Button>
                            {naiForm.sourceImage ? (
                              <Button type="button" variant="ghost" onClick={() => void handleNaiImageChange('sourceImage')}>
                                제거
                              </Button>
                            ) : null}
                          </div>
                          {naiForm.sourceImage ? <NaiSelectedImageCard image={naiForm.sourceImage} alt="NAI source" /> : null}
                        </div>
                      </FormField>

                      {naiForm.action === 'infill' ? (
                        <FormField label="Mask Image">
                          <div className="space-y-3">
                            <div className="text-xs text-muted-foreground">소스 편집기에서 마스크를 같이 만들 수 있어. 필요하면 외부 마스크를 따로 붙여도 돼.</div>
                            <div className="flex flex-wrap gap-2">
                              <ImageAttachmentPickerButton label={naiForm.maskImage ? '마스크 이미지 변경' : '마스크 이미지 선택'} modalTitle="마스크 이미지 선택" onSelect={(image) => handleNaiImageChange('maskImage', image)} />
                              {naiForm.maskImage ? (
                                <Button type="button" variant="ghost" onClick={() => void handleNaiImageChange('maskImage')}>
                                  제거
                                </Button>
                              ) : null}
                            </div>
                            {naiForm.maskImage ? <NaiSelectedImageCard image={naiForm.maskImage} alt="NAI mask" /> : null}
                          </div>
                        </FormField>
                      ) : null}

                      <div className="space-y-4 rounded-sm border border-border bg-surface-low p-3">
                        <div className="text-sm font-medium text-foreground">Image Options</div>
                        <div className="grid gap-4 md:grid-cols-2">
                          <FormField label="Strength">
                            <ScrubbableNumberInput min={0} max={1} step={0.01} value={naiForm.strength} onChange={(value) => handleNaiFieldChange('strength', value)} />
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


            <NaiVibesSection
              vibes={naiForm.vibes}
              encodingVibeIndex={encodingVibeIndex}
              savedVibes={filteredSavedVibes}
              savedVibeSearch={savedVibeSearch}
              savedVibesLoading={savedVibesQuery.isLoading}
              onSavedVibeSearchChange={setSavedVibeSearch}
              onAddVibe={handleAddVibe}
              onRemoveVibe={handleRemoveVibe}
              onVibeImageChange={handleVibeImageChange}
              onVibeFieldChange={handleVibeFieldChange}
              onOpenVibeSaveModal={handleOpenVibeSaveModal}
              onLoadVibeFromStore={handleLoadVibeFromStore}
              onEditVibeFromStore={handleOpenEditVibeFromStore}
              onDeleteVibeFromStore={(assetId) => void handleDeleteVibeFromStore(assetId)}
            />


            <NaiReferencesSection
              supportsCharacterReference={supportsCharacterReference}
              references={naiForm.characterReferences}
              savedReferences={filteredSavedCharacterReferences}
              savedReferenceSearch={savedCharacterReferenceSearch}
              savedReferencesLoading={savedCharacterReferencesQuery.isLoading}
              onSavedReferenceSearchChange={setSavedCharacterReferenceSearch}
              onAddReference={handleAddCharacterReference}
              onRemoveReference={handleRemoveCharacterReference}
              onReferenceImageChange={handleCharacterReferenceImageChange}
              onReferenceFieldChange={handleCharacterReferenceFieldChange}
              onOpenReferenceSaveModal={handleOpenCharacterReferenceSaveModal}
              onLoadReferenceFromStore={handleLoadCharacterReferenceFromStore}
              onEditReferenceFromStore={handleOpenEditCharacterReferenceFromStore}
              onDeleteReferenceFromStore={(assetId) => void handleDeleteCharacterReferenceFromStore(assetId)}
            />

        <NaiActionSection
          canUpscale={naiForm.action !== 'generate' && Boolean(naiForm.sourceImage)}
          isUpscaling={isUpscaling}
          isGenerating={isNaiGenerating}
          canGenerate={naiForm.prompt.trim().length > 0}
          generateButtonLabel={naiGenerateButtonLabel}
          costErrorMessage={naiCostQuery.isError ? getErrorMessage(naiCostQuery.error, '예상 비용 계산에 실패했어.') : null}
          onOpenModuleSave={() => setIsModuleSaveModalOpen(true)}
          onUpscale={handleUpscale}
          onReset={() => setNaiForm(DEFAULT_NAI_FORM)}
          onGenerate={handleNaiGenerate}
        />
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

      <NaiAssetSaveModal
        open={assetSaveTarget !== null}
        title={assetSaveTarget?.mode === 'edit'
          ? assetSaveTarget.kind === 'vibe'
            ? 'Vibe 수정'
            : 'Character Reference 수정'
          : assetSaveTarget?.kind === 'vibe'
            ? 'Vibe 저장'
            : 'Character Reference 저장'}
        submitLabel={assetSaveTarget?.mode === 'edit' ? '수정' : '저장'}
        name={assetSaveName}
        description={assetSaveDescription}
        isSaving={isSavingAsset}
        onClose={closeAssetSaveModal}
        onNameChange={setAssetSaveName}
        onDescriptionChange={setAssetSaveDescription}
        onSave={() => void handleConfirmAssetSave()}
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

      {isImageEditorOpen ? (
        <Suspense fallback={null}>
          <ImageEditorModal
            open={isImageEditorOpen}
            title={naiForm.action === 'infill' ? 'Source and Mask Editor' : 'Source Image Editor'}
            sourceImageDataUrl={naiForm.sourceImage?.dataUrl}
            sourceFileName={naiForm.sourceImage?.fileName}
            maskImageDataUrl={naiForm.maskImage?.dataUrl}
            enableMaskEditing={naiForm.action === 'infill'}
            onClose={() => setIsImageEditorOpen(false)}
            onSave={handleSaveImageEditor}
          />
        </Suspense>
      ) : null}

      <ImageSaveOptionsModal
        open={pendingImageEditorSave !== null}
        title="Image Save"
        options={imageEditorSaveOptions}
        sourceInfo={pendingImageEditorSaveInfo}
        isSaving={false}
        onClose={() => {
          setPendingImageEditorSave(null)
          setPendingImageEditorSaveInfo(null)
        }}
        onOptionsChange={(patch) => setImageEditorSaveOptions((current) => ({ ...current, ...patch }))}
        onConfirm={() => void handleConfirmImageEditorSave()}
      />
    </>
  )
}


