import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Download, ExternalLink, Plus, Save, Sparkles, Trash2, WandSparkles } from 'lucide-react'
import { SectionHeading } from '@/components/common/section-heading'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { ToggleRow } from '@/components/ui/toggle-row'
import { useSnackbar } from '@/components/ui/snackbar-context'
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
  buildNaiVibePayload,
  DEFAULT_NAI_FORM,
  EMPTY_NAI_CHARACTER_PROMPT,
  EMPTY_NAI_CHARACTER_REFERENCE,
  EMPTY_NAI_VIBE,
  FormField,
  getErrorMessage,
  NAI_CHARACTER_GRID_X_OPTIONS,
  NAI_CHARACTER_GRID_Y_OPTIONS,
  NAI_RESOLUTION_PRESETS,
  normalizeNaiCharacterPromptDrafts,
  parseNumberInput,
  readFileAsDataUrl,
  resolveNaiResolutionPreset,
  SummaryChip,
  supportsNaiCharacterPrompts,
  supportsNaiCharacterReferences,
  type NAICharacterPromptDraft,
  type NAICharacterReferenceDraft,
  type NAIFormDraft,
  type NAIVibeDraft,
  type SelectedImageDraft,
} from '../image-generation-shared'
import { NaiModuleSaveModal } from './nai-module-save-modal'
import { WildcardInlinePickerField } from './wildcard-inline-picker-field'

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
    <div className="space-y-2 rounded-sm border border-border bg-surface-container p-3">
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

/** Render the NAI login, generation, and module-authoring workflow. */
export function NaiGenerationPanel({ refreshNonce, onHistoryRefresh }: NaiGenerationPanelProps) {
  const { showSnackbar } = useSnackbar()
  const [loginMode, setLoginMode] = useState<NaiLoginMode>('account')
  const [naiUsernameInput, setNaiUsernameInput] = useState('')
  const [naiPasswordInput, setNaiPasswordInput] = useState('')
  const [naiTokenInput, setNaiTokenInput] = useState('')
  const [isNaiLoggingIn, setIsNaiLoggingIn] = useState(false)
  const [isNaiGenerating, setIsNaiGenerating] = useState(false)
  const [isSavingNaiModule, setIsSavingNaiModule] = useState(false)
  const [isModuleSaveModalOpen, setIsModuleSaveModalOpen] = useState(false)
  const [isUpscaling, setIsUpscaling] = useState(false)
  const [encodingVibeIndex, setEncodingVibeIndex] = useState<number | null>(null)
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
      n_samples: parseNumberInput(naiForm.samples, 1),
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

  const handleNaiFieldChange = (field: 'prompt' | 'negativePrompt' | 'model' | 'action' | 'sampler' | 'scheduler' | 'width' | 'height' | 'steps' | 'scale' | 'samples' | 'seed' | 'rating' | 'strength' | 'noise', value: string) => {
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
    setNaiForm((current) => ({
      ...current,
      characters: normalizeNaiCharacterPromptDrafts([...current.characters, { ...EMPTY_NAI_CHARACTER_PROMPT }]),
    }))
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
  }

  const handleAddVibe = () => {
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
        n_samples: Number(naiForm.samples),
        seed: naiForm.seed.trim().length > 0 ? Number(naiForm.seed) : undefined,
        rating: naiForm.rating,
        quality_tags_enabled: naiForm.applyQualityTags,
        characters: buildNaiCharacterPromptPayload(naiForm.characters),
        vibes: buildNaiVibePayload(naiForm.vibes),
        character_refs: buildNaiCharacterReferencePayload(naiForm.characterReferences),
        variety_plus: naiForm.varietyPlus,
        image: naiForm.sourceImage?.dataUrl,
        mask: naiForm.maskImage?.dataUrl,
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

      await createNaiModuleFromSnapshot({
        name: moduleName,
        description: naiModuleDescription.trim() || undefined,
        snapshot,
        exposed_fields: exposedFields,
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

  return (
    <>
      <div className="space-y-6">
        {!connected ? (
          <section className="space-y-3">
            <Card>
              <CardContent className="space-y-4">
                <SectionHeading
                  variant="inside"
                  className="border-b border-border/70 pb-4"
                  heading="NovelAI"
                  actions={(
                    <>
                      <Badge variant="outline">미연결</Badge>
                      <Button type="button" variant="outline" size="icon-sm" asChild>
                        <a href="https://novelai.net/" target="_blank" rel="noreferrer noopener" aria-label="NovelAI 홈페이지 열기" title="NovelAI 홈페이지 열기">
                          <ExternalLink className="h-4 w-4" />
                        </a>
                      </Button>
                    </>
                  )}
                />

                <div className="space-y-4">
                  <div className="flex gap-2 rounded-sm bg-surface-high p-1">
                    <button
                      type="button"
                      onClick={() => setLoginMode('account')}
                      className={loginMode === 'account'
                        ? 'flex-1 rounded-sm bg-surface-container px-3 py-2 text-sm font-medium text-foreground'
                        : 'flex-1 rounded-sm px-3 py-2 text-sm font-medium text-muted-foreground'}
                    >
                      로그인
                    </button>
                    <button
                      type="button"
                      onClick={() => setLoginMode('token')}
                      className={loginMode === 'token'
                        ? 'flex-1 rounded-sm bg-surface-container px-3 py-2 text-sm font-medium text-foreground'
                        : 'flex-1 rounded-sm px-3 py-2 text-sm font-medium text-muted-foreground'}
                    >
                      토큰
                    </button>
                  </div>

                  <div className="space-y-4">
                    {loginMode === 'account' ? (
                      <div className="grid gap-4 md:grid-cols-2">
                        <FormField label="Username">
                          <Input value={naiUsernameInput} onChange={(event) => setNaiUsernameInput(event.target.value)} autoComplete="username" />
                        </FormField>
                        <FormField label="Password">
                          <Input type="password" value={naiPasswordInput} onChange={(event) => setNaiPasswordInput(event.target.value)} autoComplete="current-password" />
                        </FormField>
                      </div>
                    ) : (
                      <FormField label="Access Token">
                        <div className="space-y-3">
                          <Input
                            value={naiTokenInput}
                            onChange={(event) => setNaiTokenInput(event.target.value)}
                            placeholder="NovelAI access token"
                            autoComplete="off"
                          />

                          {naiUserQuery.isPending || naiUserQuery.isError ? (
                            <div className="space-y-1">
                              {naiUserQuery.isPending ? <div className="text-xs text-muted-foreground">연결 확인 중…</div> : null}
                              {naiUserQuery.isError ? <div className="text-xs text-[#ffb4ab]">{naiConnectionHint}</div> : null}
                            </div>
                          ) : null}
                        </div>
                      </FormField>
                    )}

                    {loginMode === 'account' && (naiUserQuery.isPending || naiUserQuery.isError) ? (
                      <div className="space-y-1 pt-1">
                        {naiUserQuery.isPending ? <div className="text-xs text-muted-foreground">연결 확인 중…</div> : null}
                        {naiUserQuery.isError ? <div className="text-xs text-[#ffb4ab]">{naiConnectionHint}</div> : null}
                      </div>
                    ) : null}
                  </div>

                  <div className="flex justify-end border-t border-border/70 pt-4">
                    <Button
                      type="button"
                      onClick={() => void (loginMode === 'account' ? handleNaiAccountLogin() : handleNaiTokenLogin())}
                      disabled={isNaiLoggingIn || (loginMode === 'account' ? naiUsernameInput.trim().length === 0 || naiPasswordInput.length === 0 : naiTokenInput.trim().length === 0)}
                    >
                      {isNaiLoggingIn ? '연결 중…' : loginMode === 'account' ? '로그인' : '토큰 연결'}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </section>
        ) : (
          <>
            <section className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <div className="truncate text-base font-semibold text-foreground">NovelAI</div>
                  <Badge variant="secondary">연결됨</Badge>
                  <Badge variant="outline">{naiUserQuery.data.subscription.tierName}</Badge>
                  <Badge variant="outline">Anlas {naiUserQuery.data.anlasBalance}</Badge>
                </div>
                <Button type="button" variant="outline" size="icon-sm" asChild>
                  <a href="https://novelai.net/" target="_blank" rel="noreferrer noopener" aria-label="NovelAI 홈페이지 열기" title="NovelAI 홈페이지 열기">
                    <ExternalLink className="h-4 w-4" />
                  </a>
                </Button>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <SummaryChip label="cost" value={naiCostQuery.isSuccess ? `${naiCostQuery.data.estimatedCost} Anlas` : naiCostQuery.isPending ? '계산 중…' : '—'} />
                <SummaryChip label="max samples" value={naiCostQuery.isSuccess ? String(naiCostQuery.data.maxSamples) : '—'} />
              </div>
            </section>

            <section className="space-y-3">
              <Card>
                <CardContent className="space-y-4">
                  <SectionHeading variant="inside" className="border-b border-border/70 pb-4" heading="Prompt" />
                  <div className="space-y-4">
                    <FormField label="Prompt" hint="`++`를 입력하면 와일드카드 검색 팝업이 열려.">
                      <WildcardInlinePickerField
                        tool="nai"
                        multiline
                        rows={6}
                        value={naiForm.prompt}
                        onChange={(value) => handleNaiFieldChange('prompt', value)}
                        placeholder="1girl, solo, cinematic lighting"
                      />
                    </FormField>

                    <FormField label="Negative Prompt" hint="`++`를 입력하면 와일드카드 검색 팝업이 열려.">
                      <WildcardInlinePickerField
                        tool="nai"
                        multiline
                        rows={6}
                        value={naiForm.negativePrompt}
                        onChange={(value) => handleNaiFieldChange('negativePrompt', value)}
                        placeholder="low quality, blurry"
                      />
                    </FormField>

                    <div className="space-y-3 rounded-sm border border-border bg-surface-low p-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="space-y-1">
                          <div className="text-sm font-medium text-foreground">Character Prompt</div>
                          <div className="text-xs text-muted-foreground">테스트 API 기준 5x5 grid를 쓰고, 기본값은 중앙(C3)이지만 직접 수정할 수 있어.</div>
                        </div>
                        <Button type="button" variant="outline" size="sm" onClick={handleAddCharacterPrompt} disabled={!supportsCharacterPrompts}>
                          <Plus className="h-4 w-4" />
                          캐릭터 추가
                        </Button>
                      </div>

                      {!supportsCharacterPrompts ? (
                        <div className="text-xs text-[#ffb4ab]">Character Prompt는 NAI Diffusion 4 / 4.5 모델에서만 적용돼.</div>
                      ) : null}

                      {naiForm.characters.length === 0 ? (
                        <div className="rounded-sm border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
                          아직 캐릭터 프롬프트가 없어.
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {naiForm.characters.map((character, index) => (
                            <div key={`nai-character-${index}`} className="space-y-3 rounded-sm border border-border bg-surface-container p-3">
                              <div className="flex items-center justify-between gap-3">
                                <div className="text-sm font-medium text-foreground">Character {index + 1}</div>
                                <Button type="button" variant="ghost" size="sm" onClick={() => handleRemoveCharacterPrompt(index)}>
                                  <Trash2 className="h-4 w-4" />
                                  제거
                                </Button>
                              </div>

                              <FormField label="Character Prompt" hint="`++` wildcard">
                                <WildcardInlinePickerField
                                  tool="nai"
                                  multiline
                                  rows={4}
                                  value={character.prompt}
                                  onChange={(value) => handleCharacterPromptChange(index, 'prompt', value)}
                                  placeholder="girl, ibuki (blue archive), halo"
                                />
                              </FormField>

                              <FormField label="Character Negative Prompt" hint="`++` wildcard">
                                <WildcardInlinePickerField
                                  tool="nai"
                                  multiline
                                  rows={3}
                                  value={character.uc}
                                  onChange={(value) => handleCharacterPromptChange(index, 'uc', value)}
                                  placeholder="bad anatomy, glowing eyes"
                                />
                              </FormField>

                              <div className="grid gap-4 sm:grid-cols-2">
                                <FormField label="Center X" hint="A=0.1, B=0.3, C=0.5, D=0.7, E=0.9">
                                  <Select value={character.centerX} onChange={(event) => handleCharacterPromptChange(index, 'centerX', event.target.value)}>
                                    {NAI_CHARACTER_GRID_X_OPTIONS.map((option) => (
                                      <option key={option.value} value={option.value}>{option.label}</option>
                                    ))}
                                  </Select>
                                </FormField>
                                <FormField label="Center Y" hint="1=0.1, 2=0.3, 3=0.5, 4=0.7, 5=0.9">
                                  <Select value={character.centerY} onChange={(event) => handleCharacterPromptChange(index, 'centerY', event.target.value)}>
                                    {NAI_CHARACTER_GRID_Y_OPTIONS.map((option) => (
                                      <option key={option.value} value={option.value}>{option.label}</option>
                                    ))}
                                  </Select>
                                </FormField>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </section>

            <section className="space-y-3">
              <Card>
                <CardContent className="space-y-4">
                  <SectionHeading variant="inside" className="border-b border-border/70 pb-4" heading="Generation Settings" />
                  <div className="space-y-4">
                    <div className="grid gap-4 md:grid-cols-4">
                      <FormField label="Model">
                        <Select value={naiForm.model} onChange={(event) => handleNaiFieldChange('model', event.target.value)}>
                          <option value="nai-diffusion-4-5-curated">NAI Diffusion 4.5 Curated</option>
                          <option value="nai-diffusion-4-5-full">NAI Diffusion 4.5 Full</option>
                          <option value="nai-diffusion-4-curated-preview">NAI Diffusion 4 Curated</option>
                          <option value="nai-diffusion-3">NAI Diffusion 3</option>
                        </Select>
                      </FormField>

                      <FormField label="Action">
                        <Select value={naiForm.action} onChange={(event) => handleNaiFieldChange('action', event.target.value)}>
                          <option value="generate">generate</option>
                          <option value="img2img">img2img</option>
                          <option value="infill">infill</option>
                        </Select>
                      </FormField>

                      <FormField label="Sampler">
                        <Select value={naiForm.sampler} onChange={(event) => handleNaiFieldChange('sampler', event.target.value)}>
                          <option value="k_euler">k_euler</option>
                          <option value="k_euler_ancestral">k_euler_ancestral</option>
                          <option value="k_dpmpp_2s_ancestral">k_dpmpp_2s_ancestral</option>
                          <option value="k_dpmpp_2m">k_dpmpp_2m</option>
                        </Select>
                      </FormField>

                      <FormField label="Scheduler">
                        <Select value={naiForm.scheduler} onChange={(event) => handleNaiFieldChange('scheduler', event.target.value)}>
                          <option value="karras">karras</option>
                          <option value="native">native</option>
                          <option value="exponential">exponential</option>
                          <option value="polyexponential">polyexponential</option>
                        </Select>
                      </FormField>
                    </div>

                    <div className="grid gap-4 md:grid-cols-3">
                      <FormField label="Resolution Preset">
                        <Select value={naiForm.resolutionPreset} onChange={(event) => handleResolutionPresetChange(event.target.value)}>
                          {NAI_RESOLUTION_PRESETS.map((preset) => (
                            <option key={preset.key} value={preset.key}>{preset.label}</option>
                          ))}
                          <option value="custom">Custom</option>
                        </Select>
                      </FormField>

                      <FormField label="Rating">
                        <Select value={naiForm.rating} onChange={(event) => handleNaiFieldChange('rating', event.target.value)}>
                          <option value="general">general</option>
                          <option value="sensitive">sensitive</option>
                          <option value="questionable">questionable</option>
                          <option value="explicit">explicit</option>
                        </Select>
                      </FormField>

                      <div className="space-y-2">
                        <div className="text-sm font-medium text-foreground">Quality Tags</div>
                        <ToggleRow variant="detail" className="justify-between rounded-sm border border-border bg-surface-container px-3 py-2.5">
                          <div className="text-sm text-foreground">모델별 품질 태그 자동 추가</div>
                          <input type="checkbox" checked={naiForm.applyQualityTags} onChange={(event) => setNaiForm((current) => ({ ...current, applyQualityTags: event.target.checked }))} />
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
                        <Input type="number" min={1} max={8} value={naiForm.samples} onChange={(event) => handleNaiFieldChange('samples', event.target.value)} />
                      </FormField>
                      <FormField label="Seed" hint="비우면 랜덤">
                        <Input type="number" value={naiForm.seed} onChange={(event) => handleNaiFieldChange('seed', event.target.value)} placeholder="random" />
                      </FormField>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </section>

            <section className="space-y-3">
              <Card>
                <CardContent className="space-y-4">
                  <SectionHeading variant="inside" className="border-b border-border/70 pb-4" heading="Source Images" />
                  <div className="space-y-4">
                    <FormField label="Source Image" hint="img2img / infill / upscale 공용">
                      <div className="space-y-3">
                        <Input type="file" accept="image/*" onChange={(event) => void handleNaiImageChange('sourceImage', event.target.files?.[0])} />
                        {naiForm.sourceImage ? <SelectedImageCard image={naiForm.sourceImage} alt="NAI source" onRemove={() => void handleNaiImageChange('sourceImage')} /> : null}
                      </div>
                    </FormField>

                    {naiForm.action === 'infill' ? (
                      <FormField label="Mask Image">
                        <div className="space-y-3">
                          <Input type="file" accept="image/*" onChange={(event) => void handleNaiImageChange('maskImage', event.target.files?.[0])} />
                          {naiForm.maskImage ? <SelectedImageCard image={naiForm.maskImage} alt="NAI mask" onRemove={() => void handleNaiImageChange('maskImage')} /> : null}
                        </div>
                      </FormField>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            </section>

            <section className="space-y-3">
              <Card>
                <CardContent className="space-y-4">
                  <SectionHeading variant="inside" className="border-b border-border/70 pb-4" heading="Vibe Transfer" />
                  <div className="space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-sm border border-border bg-surface-low p-3">
                      <div>
                        <div className="text-sm font-medium text-foreground">Encoded vibes</div>
                        <div className="text-xs text-muted-foreground">encode를 직접 눌러야 Anlas가 사용돼. 인코딩 결과는 그대로 재사용해.</div>
                      </div>
                      <Button type="button" variant="outline" size="sm" onClick={handleAddVibe}>
                        <Plus className="h-4 w-4" />
                        Vibe 추가
                      </Button>
                    </div>

                    {naiForm.vibes.length === 0 ? (
                      <div className="rounded-sm border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">아직 Vibe Transfer 항목이 없어.</div>
                    ) : (
                      <div className="space-y-3">
                        {naiForm.vibes.map((vibe, index) => (
                          <div key={`nai-vibe-${index}`} className="space-y-3 rounded-sm border border-border bg-surface-container p-3">
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
                                <Input type="file" accept="image/*" onChange={(event) => void handleVibeImageChange(index, event.target.files?.[0])} />
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
                                Store 저장
                              </Button>
                              <Button type="button" variant="outline" onClick={() => void handleEncodeVibe(index)} disabled={!vibe.image || encodingVibeIndex !== null}>
                                <WandSparkles className="h-4 w-4" />
                                {encodingVibeIndex === index ? '인코딩 중…' : 'Vibe 인코딩'}
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="space-y-3 rounded-sm border border-border bg-surface-low p-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <div className="text-sm font-medium text-foreground">Saved Vibes</div>
                          <div className="text-xs text-muted-foreground">현재 모델 기준 저장소야. 검색으로 빠르게 골라.</div>
                        </div>
                        <div className="w-full sm:w-72">
                          <Input value={savedVibeSearch} onChange={(event) => setSavedVibeSearch(event.target.value)} placeholder="이름 또는 모델 검색" />
                        </div>
                      </div>
                      {savedVibesQuery.isLoading ? (
                        <div className="text-sm text-muted-foreground">불러오는 중…</div>
                      ) : filteredSavedVibes.length > 0 ? (
                        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                          {filteredSavedVibes.map((asset) => (
                            <div key={asset.id} className="space-y-3 rounded-sm border border-border bg-surface-container p-3">
                              <div className="space-y-1">
                                <div className="text-sm font-medium text-foreground">{asset.label}</div>
                                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                  <span>{asset.model}</span>
                                  <Badge variant="outline">strength {asset.strength}</Badge>
                                  <Badge variant="outline">IE {asset.information_extracted}</Badge>
                                </div>
                              </div>
                              {asset.image_data_url ? <img src={asset.image_data_url} alt={asset.label} className="max-h-40 w-full rounded-sm border border-border object-contain" /> : null}
                              <div className="text-[11px] text-muted-foreground">{new Date(asset.created_date).toLocaleString('ko-KR')}</div>
                              <div className="flex justify-end gap-2">
                                <Button type="button" size="sm" variant="outline" onClick={() => handleLoadVibeFromStore(asset.id)}>불러오기</Button>
                                <Button type="button" size="sm" variant="ghost" onClick={() => void handleDeleteVibeFromStore(asset.id)}>삭제</Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="text-sm text-muted-foreground">검색 결과가 없거나 저장된 Vibe가 아직 없어.</div>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </section>

            <section className="space-y-3">
              <Card>
                <CardContent className="space-y-4">
                  <SectionHeading variant="inside" className="border-b border-border/70 pb-4" heading="Character Reference" />
                  <div className="space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-sm border border-border bg-surface-low p-3">
                      <div>
                        <div className="text-sm font-medium text-foreground">Director reference images</div>
                        <div className="text-xs text-muted-foreground">NAI Diffusion 4.5 전용. 업로드하면 서버에서 자동 레터박싱해서 전달해.</div>
                      </div>
                      <Button type="button" variant="outline" size="sm" onClick={handleAddCharacterReference} disabled={!supportsCharacterReference}>
                        <Plus className="h-4 w-4" />
                        Reference 추가
                      </Button>
                    </div>

                    {!supportsCharacterReference ? <div className="text-xs text-[#ffb4ab]">Character Reference는 NAI Diffusion 4.5 모델에서만 쓸 수 있어.</div> : null}

                    {naiForm.characterReferences.length === 0 ? (
                      <div className="rounded-sm border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">아직 Character Reference가 없어.</div>
                    ) : (
                      <div className="space-y-3">
                        {naiForm.characterReferences.map((reference, index) => (
                          <div key={`nai-character-reference-${index}`} className="space-y-3 rounded-sm border border-border bg-surface-container p-3">
                            <div className="flex items-center justify-between gap-3">
                              <div className="text-sm font-medium text-foreground">Reference {index + 1}</div>
                              <Button type="button" variant="ghost" size="sm" onClick={() => handleRemoveCharacterReference(index)}>
                                <Trash2 className="h-4 w-4" />
                                제거
                              </Button>
                            </div>

                            <FormField label="Reference Image">
                              <div className="space-y-3">
                                <Input type="file" accept="image/*" onChange={(event) => void handleCharacterReferenceImageChange(index, event.target.files?.[0])} />
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
                                Store 저장
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="space-y-3 rounded-sm border border-border bg-surface-low p-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <div className="text-sm font-medium text-foreground">Saved Character References</div>
                          <div className="text-xs text-muted-foreground">4.5 레퍼런스를 이름/타입으로 바로 찾아서 재사용해.</div>
                        </div>
                        <div className="w-full sm:w-72">
                          <Input value={savedCharacterReferenceSearch} onChange={(event) => setSavedCharacterReferenceSearch(event.target.value)} placeholder="이름 또는 타입 검색" />
                        </div>
                      </div>
                      {savedCharacterReferencesQuery.isLoading ? (
                        <div className="text-sm text-muted-foreground">불러오는 중…</div>
                      ) : filteredSavedCharacterReferences.length > 0 ? (
                        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                          {filteredSavedCharacterReferences.map((asset) => (
                            <div key={asset.id} className="space-y-3 rounded-sm border border-border bg-surface-container p-3">
                              <div className="space-y-1">
                                <div className="text-sm font-medium text-foreground">{asset.label}</div>
                                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                  <Badge variant="outline">{asset.type}</Badge>
                                  <Badge variant="outline">strength {asset.strength}</Badge>
                                  <Badge variant="outline">fidelity {asset.fidelity}</Badge>
                                </div>
                              </div>
                              <img src={asset.image_data_url} alt={asset.label} className="max-h-40 w-full rounded-sm border border-border object-contain" />
                              <div className="text-[11px] text-muted-foreground">{new Date(asset.created_date).toLocaleString('ko-KR')}</div>
                              <div className="flex justify-end gap-2">
                                <Button type="button" size="sm" variant="outline" onClick={() => handleLoadCharacterReferenceFromStore(asset.id)}>불러오기</Button>
                                <Button type="button" size="sm" variant="ghost" onClick={() => void handleDeleteCharacterReferenceFromStore(asset.id)}>삭제</Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="text-sm text-muted-foreground">검색 결과가 없거나 저장된 Character Reference가 아직 없어.</div>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </section>

            <section className="space-y-3">
              <Card>
                <CardContent className="space-y-4">
                  <SectionHeading
                    variant="inside"
                    className="border-b border-border/70 pb-4"
                    heading="Advanced"
                    actions={naiCostQuery.isSuccess ? (
                      <Badge variant={naiCostQuery.data.canAfford ? 'secondary' : 'outline'}>
                        {naiCostQuery.data.isOpusFree ? 'Opus 무료 생성' : naiCostQuery.data.canAfford ? '잔액 충분' : '잔액 부족'}
                      </Badge>
                    ) : undefined}
                  />

                  <div className="space-y-4">
                    <div className="space-y-2">
                      <div className="text-sm font-medium text-foreground">Variety+</div>
                      <ToggleRow variant="detail" className="justify-between rounded-sm border border-border bg-surface-container px-3 py-2.5">
                        <div className="text-sm text-foreground">활성</div>
                        <input type="checkbox" checked={naiForm.varietyPlus} onChange={(event) => setNaiForm((current) => ({ ...current, varietyPlus: event.target.checked }))} />
                      </ToggleRow>
                    </div>

                    {naiForm.action !== 'generate' ? (
                      <div className="grid gap-4 md:grid-cols-2">
                        <FormField label="Strength">
                          <Input type="number" min={0} max={1} step={0.01} value={naiForm.strength} onChange={(event) => handleNaiFieldChange('strength', event.target.value)} />
                        </FormField>
                        <FormField label="Noise">
                          <Input type="number" min={0} max={1} step={0.01} value={naiForm.noise} onChange={(event) => handleNaiFieldChange('noise', event.target.value)} />
                        </FormField>
                      </div>
                    ) : null}

                    {naiForm.action === 'infill' ? (
                      <ToggleRow variant="detail" className="justify-between rounded-sm border border-border bg-surface-container px-3 py-2.5">
                        <div className="text-sm text-foreground">Add original image</div>
                        <input type="checkbox" checked={naiForm.addOriginalImage} onChange={(event) => setNaiForm((current) => ({ ...current, addOriginalImage: event.target.checked }))} />
                      </ToggleRow>
                    ) : null}

                    {naiCostQuery.isError ? <div className="text-xs text-[#ffb4ab]">{getErrorMessage(naiCostQuery.error, '예상 비용 계산에 실패했어.')}</div> : null}
                  </div>
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
                      <Button type="button" variant="outline" onClick={handleUpscale} disabled={!naiForm.sourceImage || isUpscaling}>
                        <Download className="h-4 w-4" />
                        {isUpscaling ? '업스케일 중…' : '소스 2x 업스케일'}
                      </Button>
                    </div>

                    <div className="flex flex-wrap justify-end gap-2">
                      <Button type="button" variant="ghost" onClick={() => setNaiForm(DEFAULT_NAI_FORM)} disabled={isNaiGenerating || isUpscaling}>
                        초기화
                      </Button>
                      <Button type="button" onClick={handleNaiGenerate} disabled={isNaiGenerating || naiForm.prompt.trim().length === 0}>
                        <Sparkles className="h-4 w-4" />
                        {isNaiGenerating ? '생성 요청 중…' : 'NAI 생성'}
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </section>
          </>
        )}
      </div>

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
