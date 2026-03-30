import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ExternalLink, ImagePlus, Plus, Save, Trash2 } from 'lucide-react'
import { SectionHeading } from '@/components/common/section-heading'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { ToggleRow } from '@/components/ui/toggle-row'
import { useSnackbar } from '@/components/ui/snackbar-context'
import {
  createNaiModuleFromSnapshot,
  generateNaiImage,
  getNaiCostEstimate,
  getNaiUserData,
  loginNai,
  loginNaiWithToken,
} from '@/lib/api'
import {
  buildNaiCharacterPromptPayload,
  buildNaiModuleFieldOptions,
  buildNaiModuleSnapshot,
  DEFAULT_NAI_FORM,
  EMPTY_NAI_CHARACTER_PROMPT,
  FormField,
  getErrorMessage,
  parseNumberInput,
  readFileAsDataUrl,
  SummaryChip,
  supportsNaiCharacterPrompts,
  type NAICharacterPromptDraft,
  type NAIFormDraft,
} from '../image-generation-shared'
import { NaiModuleSaveModal } from './nai-module-save-modal'

type NaiGenerationPanelProps = {
  refreshNonce: number
  onHistoryRefresh: () => void
}

type NaiLoginMode = 'account' | 'token'

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
  const [naiForm, setNaiForm] = useState<NAIFormDraft>(DEFAULT_NAI_FORM)
  const [naiModuleName, setNaiModuleName] = useState('NAI Module')
  const [naiModuleDescription, setNaiModuleDescription] = useState('')
  const [naiExposedFieldKeys, setNaiExposedFieldKeys] = useState<string[]>(['prompt', 'negative_prompt', 'characters', 'seed'])

  const naiUserQuery = useQuery({
    queryKey: ['image-generation-nai-user'],
    queryFn: getNaiUserData,
    retry: false,
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

  const handleNaiFieldChange = (field: keyof NAIFormDraft, value: string) => {
    setNaiForm((current) => ({
      ...current,
      [field]: value,
    }))
  }

  const handleAddCharacterPrompt = () => {
    setNaiForm((current) => ({
      ...current,
      characters: [...current.characters, { ...EMPTY_NAI_CHARACTER_PROMPT }],
    }))
  }

  const handleCharacterPromptChange = (index: number, field: keyof NAICharacterPromptDraft, value: string) => {
    setNaiForm((current) => ({
      ...current,
      characters: current.characters.map((character, characterIndex) => (
        characterIndex === index
          ? {
              ...character,
              [field]: value,
            }
          : character
      )),
    }))
  }

  const handleRemoveCharacterPrompt = (index: number) => {
    setNaiForm((current) => ({
      ...current,
      characters: current.characters.filter((_, characterIndex) => characterIndex !== index),
    }))
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

    try {
      setIsNaiGenerating(true)
      const response = await generateNaiImage({
        prompt: naiForm.prompt.trim(),
        negative_prompt: naiForm.negativePrompt.trim() || undefined,
        model: naiForm.model,
        action: naiForm.action,
        sampler: naiForm.sampler,
        width: Number(naiForm.width),
        height: Number(naiForm.height),
        steps: Number(naiForm.steps),
        scale: Number(naiForm.scale),
        n_samples: Number(naiForm.samples),
        seed: naiForm.seed.trim().length > 0 ? Number(naiForm.seed) : undefined,
        characters: buildNaiCharacterPromptPayload(naiForm.characters),
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
                  <SectionHeading
                    variant="inside"
                    className="border-b border-border/70 pb-4"
                    heading="Prompt"
                  />
                  <div className="space-y-4">
                    <FormField label="Prompt">
                      <Textarea value={naiForm.prompt} onChange={(event) => handleNaiFieldChange('prompt', event.target.value)} rows={6} placeholder="1girl, solo, cinematic lighting" />
                    </FormField>

                    <FormField label="Negative Prompt">
                      <Textarea
                        value={naiForm.negativePrompt}
                        onChange={(event) => handleNaiFieldChange('negativePrompt', event.target.value)}
                        rows={6}
                        placeholder="low quality, blurry"
                      />
                    </FormField>

                    <div className="space-y-3 rounded-sm border border-border bg-surface-low p-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="space-y-1">
                          <div className="text-sm font-medium text-foreground">Character Prompt</div>
                          <div className="text-xs text-muted-foreground">
                            캐릭터 프롬프트는 부정 프롬프트 아래에서 관리해. NAI Diffusion 4 / 4.5 기준 구조야.
                          </div>
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
                          아직 캐릭터 프롬프트가 없어. 필요하면 추가해서 prompt / negative / center 좌표를 넣어줘.
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

                              <FormField label="Character Prompt">
                                <Textarea
                                  value={character.prompt}
                                  onChange={(event) => handleCharacterPromptChange(index, 'prompt', event.target.value)}
                                  rows={4}
                                  placeholder="girl, ibuki (blue archive), blonde hair, halo"
                                />
                              </FormField>

                              <FormField label="Character Negative Prompt">
                                <Textarea
                                  value={character.uc}
                                  onChange={(event) => handleCharacterPromptChange(index, 'uc', event.target.value)}
                                  rows={3}
                                  placeholder="narrow waist, wide hips"
                                />
                              </FormField>

                              <div className="grid gap-4 sm:grid-cols-2">
                                <FormField label="Center X">
                                  <Input type="number" min={0} max={1} step={0.01} value={character.centerX} onChange={(event) => handleCharacterPromptChange(index, 'centerX', event.target.value)} />
                                </FormField>
                                <FormField label="Center Y">
                                  <Input type="number" min={0} max={1} step={0.01} value={character.centerY} onChange={(event) => handleCharacterPromptChange(index, 'centerY', event.target.value)} />
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
                  <SectionHeading
                    variant="inside"
                    className="border-b border-border/70 pb-4"
                    heading="Generation Settings"
                  />
                <div className="space-y-4">
                  <div className="grid gap-4 md:grid-cols-3">
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

            {naiForm.action !== 'generate' ? (
              <section className="space-y-3">
                <Card>
                  <CardContent className="space-y-4">
                    <SectionHeading
                      variant="inside"
                      className="border-b border-border/70 pb-4"
                      heading="Source Images"
                    />
                  <div className="space-y-4">
                    <FormField label="Source Image">
                      <div className="space-y-3">
                        <Input type="file" accept="image/*" onChange={(event) => void handleNaiImageChange('sourceImage', event.target.files?.[0])} />
                        {naiForm.sourceImage ? (
                          <div className="space-y-2 rounded-sm border border-border bg-surface-container p-3">
                            <div className="text-xs text-muted-foreground">{naiForm.sourceImage.fileName}</div>
                            <img src={naiForm.sourceImage.dataUrl} alt="NAI source" className="max-h-48 rounded-sm border border-border object-contain" />
                            <div className="flex justify-end">
                              <Button type="button" size="sm" variant="ghost" onClick={() => void handleNaiImageChange('sourceImage')}>
                                소스 제거
                              </Button>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    </FormField>

                    {naiForm.action === 'infill' ? (
                      <FormField label="Mask Image">
                        <div className="space-y-3">
                          <Input type="file" accept="image/*" onChange={(event) => void handleNaiImageChange('maskImage', event.target.files?.[0])} />
                          {naiForm.maskImage ? (
                            <div className="space-y-2 rounded-sm border border-border bg-surface-container p-3">
                              <div className="text-xs text-muted-foreground">{naiForm.maskImage.fileName}</div>
                              <img src={naiForm.maskImage.dataUrl} alt="NAI mask" className="max-h-48 rounded-sm border border-border object-contain" />
                              <div className="flex justify-end">
                                <Button type="button" size="sm" variant="ghost" onClick={() => void handleNaiImageChange('maskImage')}>
                                  마스크 제거
                                </Button>
                              </div>
                            </div>
                          ) : null}
                        </div>
                      </FormField>
                    ) : null}
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
                      <input
                        type="checkbox"
                        checked={naiForm.varietyPlus}
                        onChange={(event) => setNaiForm((current) => ({ ...current, varietyPlus: event.target.checked }))}
                      />
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
                      <input
                        type="checkbox"
                        checked={naiForm.addOriginalImage}
                        onChange={(event) => setNaiForm((current) => ({ ...current, addOriginalImage: event.target.checked }))}
                      />
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
                <SectionHeading
                  variant="inside"
                  className="border-b border-border/70 pb-4"
                  heading="Actions"
                />
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <Button type="button" variant="outline" onClick={() => setIsModuleSaveModalOpen(true)}>
                    <Save className="h-4 w-4" />
                    모듈 저장
                  </Button>

                  <div className="flex flex-wrap justify-end gap-2">
                    <Button type="button" variant="ghost" onClick={() => setNaiForm(DEFAULT_NAI_FORM)} disabled={isNaiGenerating}>
                      초기화
                    </Button>
                    <Button type="button" onClick={handleNaiGenerate} disabled={isNaiGenerating || naiForm.prompt.trim().length === 0}>
                      <ImagePlus className="h-4 w-4" />
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
