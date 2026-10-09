import { useEffect, useRef, useState } from 'react'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Check, ImageOff, RotateCcw, ScanEye, Sparkles, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Chip, ToggleChip } from '@/components/ui/chip'
import { FieldInfo } from '@/components/ui/field'
import { IconButton } from '@/components/ui/icon-button'
import { Spinner } from '@/components/ui/loading-state'
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal'
import { Panel } from '@/components/ui/panel'
import { Select } from '@/components/ui/select'
import { Tip } from '@/components/ui/tooltip'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useImagePermissions } from '@/features/auth/use-image-permissions'
import { ChatProfileImage } from '@/features/codex-chat/chat-profile-image'
import { MediaLightbox } from '@/features/images/components/media-lightbox'
import { useImageFeedSafety } from '@/features/images/components/image-list/use-image-feed-safety'
import { useI18n } from '@/i18n'
import { buildApiUrl } from '@/lib/api-client'
import { MODEL_SLOTS_QUERY_KEY, listModelSlots, reviewChatAssetVision, applyChatAssetBatch, cancelChatAssetSlot, chatAssetBatchQueryKey, chatProfileEmoticonsQueryKey, CHAT_ADMIN_PROFILES_QUERY_KEY, CHAT_GENERATION_PRESETS_QUERY_KEY, CHAT_PROFILES_QUERY_KEY, chooseChatAssetSlot, createChatAssetBatch, getChatAssetBatch, listChatAdminProfiles, listChatGenerationPresets, regenerateChatAssetSlot, type ChatAssetApplyResult, type ChatAssetBatch, type ChatAssetBatchInput, type ChatAssetReview, type ChatProfile } from '@/lib/api-codex-chat'
import { getGenerationWorkflows } from '@/lib/api-image-generation-workflows'
import { getImage, getImageDetailQueryKey } from '@/lib/api-images'
import { getPromptPresets } from '@/lib/api-prompt-presets'
import { getErrorMessage } from '@/lib/error-message'
import { createRandomUuid } from '@/lib/random-uuid'
import { cn } from '@/lib/utils'
import { ChatAssetSubmissionError } from '@/lib/api-codex-chat'

const terminal = (status: string) => ['completed', 'failed', 'cancelled'].includes(status)
const activeAttempt = (attempt: ChatAssetBatch['slots'][number]['attempts'][number]) => !terminal(attempt.status)
const running = (batch?: ChatAssetBatch) => batch?.slots.some((slot) => slot.attempts.some(activeAttempt)) === true

export function ReviewChips({ review }: { review?: ChatAssetReview }) {
  const { t } = useI18n()
  if (!review) return null
  const checks = [
    { label: t({ ko: '표정', en: 'Expression' }), check: review.expression },
    { label: t({ ko: '머리', en: 'Hair' }), check: review.hair },
    { label: t({ ko: '눈', en: 'Eyes' }), check: review.eyes },
  ]
  const rating = Object.entries(review.rating).sort((a, b) => b[1] - a[1])[0]
  return <>
    {checks.map(({ label, check }) => check?.matches == null ? null : <Tip key={label} content={'expected' in check ? `${check.expected.join(', ')} → ${check.matched.join(', ')}` : `${check.reference.join(', ')} → ${check.candidate.join(', ')}`}><Chip size="sm" tone={check.matches ? 'success' : 'warning'}>{label}</Chip></Tip>)}
    {rating ? <Tip content={`${Math.round(rating[1] * 100)}%`}><Chip size="sm" tone="muted">{rating[0]}</Chip></Tip> : null}
    {review.similarSlots.length ? <Tip content={review.similarSlots.map((slot) => `${slot.slotKey} ${slot.confidence}%`).join(', ')}><Chip size="sm" tone="warning">{t({ ko: '비슷함', en: 'Similar' })}</Chip></Tip> : null}
    {review.judge ? <Tip content={`${review.judge.picked} · ${review.judge.probability.toFixed(2)}`}><Chip size="sm" tone={review.judge.probability >= 0.5 ? 'success' : review.judge.probability >= 0.2 ? 'muted' : 'warning'}>{t({ ko: '판단: {emotion}', en: 'Judge: {emotion}' }, { emotion: review.judge.picked })}</Chip></Tip> : null}
  </>
}

/** Candidate-bound results disappear on a candidate, reference or model change. */
export function SlotVisionReview({ profileId, batchId, slotKey, hash, referenceHash, modelSlotId, disabled }: { profileId: number; batchId: number; slotKey: string; hash?: string; referenceHash?: string | null; modelSlotId: number; disabled: boolean }) {
  const { t } = useI18n()
  const { showSnackbar } = useSnackbar()
  const request = useRef<AbortController | null>(null)
  useEffect(() => () => request.current?.abort(), [])
  const review = useMutation({
    mutationFn: () => {
      const controller = new AbortController()
      request.current = controller
      return reviewChatAssetVision(profileId, batchId, slotKey, modelSlotId, hash!, controller.signal)
    },
    onError: (error) => { if (!request.current?.signal.aborted) showSnackbar({ message: getErrorMessage(error, t({ ko: '비전 검수를 하지 못했어.', en: 'Could not review the images.' })), tone: 'error' }) },
  })
  return <>
    {review.data ? <>
      <Chip size="sm" tone={review.data.samePerson ? 'success' : 'warning'}>{t({ ko: '같은 인물', en: 'Same character' })} {review.data.samePerson ? '✓' : '✗'}</Chip>
      <Tip content={[review.data.expression, review.data.flaw].filter(Boolean).join(' · ')}><Chip size="sm" tone="muted"><span className="max-w-52 truncate">{t({ ko: '표정: {expression}', en: 'Expression: {expression}' }, { expression: review.data.expression })}</span></Chip></Tip>
    </> : null}
    <IconButton variant="ghost" size="icon-sm" disabled={disabled || !hash || !referenceHash || !modelSlotId || review.isPending} label={t({ ko: '비전 검수', en: 'Vision review' })} onClick={() => review.mutate()}>{review.isPending ? <Spinner /> : <ScanEye />}</IconButton>
  </>
}

/** Queue-authoritative slots; the same surface opens from the editor and an approved proposal. */
export function ChatAssetBatchModal({ profile, initialBatchId, referenceOnly = false, onBatchChange, onPrepare, onApplied, onClose }: {
  profile: Pick<ChatProfile, 'id' | 'name' | 'referenceHash'> | null
  initialBatchId?: number | null
  referenceOnly?: boolean
  onBatchChange?: (id: number) => void
  onPrepare?: () => Promise<ChatProfile>
  onApplied?: (result: ChatAssetApplyResult, batch: ChatAssetBatch, profile?: ChatProfile) => void
  onClose: () => void
}) {
  const { t } = useI18n()
  const { showSnackbar } = useSnackbar()
  const { canViewImages } = useImagePermissions()
  const queryClient = useQueryClient()
  const [savedProfile, setSavedProfile] = useState(profile)
  const [batchId, setBatchId] = useState(initialBatchId ?? null)
  const [presetChoice, setPresetChoice] = useState<number | null>(null)
  const [expressionChoice, setExpressionChoice] = useState<number | null>(null)
  const [expressions, setExpressions] = useState(!referenceOnly)
  const [background, setBackground] = useState(false)
  const [full, setFull] = useState(false)
  const [promptChoice, setPromptChoice] = useState('')
  const [visionChoice, setVisionChoice] = useState(0)
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)
  const request = useRef<{ serialized: string; input: ChatAssetBatchInput } | null>(null)
  const creating = useRef(false)
  const regeneration = useRef(new Map<string, number>())
  const profileId = savedProfile?.id ?? 0
  const modelSlots = useQuery({ queryKey: MODEL_SLOTS_QUERY_KEY, queryFn: listModelSlots })
  const visionSlotId = modelSlots.data?.some((slot) => slot.id === visionChoice) ? visionChoice : 0
  const presets = useQuery({ queryKey: CHAT_GENERATION_PRESETS_QUERY_KEY, queryFn: listChatGenerationPresets })
  const expressionPresets = useQuery({ queryKey: ['prompt-presets', 'chat-assets'], queryFn: () => getPromptPresets({ withItems: true }) })
  const presetId = presetChoice ?? presets.data?.[0]?.id ?? 0
  const expressionPresetId = expressionChoice ?? expressionPresets.data?.find((entry) => entry.name === '기본 캐릭터 표정')?.id ?? expressionPresets.data?.[0]?.id ?? 0
  const preset = presets.data?.find((entry) => entry.id === presetId)
  const emotionNames = (expressionPresets.data?.find((entry) => entry.id === expressionPresetId)?.items ?? []).map((entry) => entry.description).filter(Boolean)
  const workflows = useQuery({ queryKey: ['generation-workflows', 'chat-generation-preset'], queryFn: () => getGenerationWorkflows(true), enabled: preset?.kind === 'comfyui', staleTime: 60000 })
  const promptFields = (workflows.data?.find((entry) => entry.id === preset?.comfyui?.workflowId)?.marked_fields ?? []).filter((field) => ['text', 'textarea'].includes(field.type) && preset?.comfyui?.exposedFieldIds.includes(field.id))
  const promptField = promptFields.some((field) => field.id === promptChoice) ? promptChoice : promptFields.length === 1 ? promptFields[0].id : ''
  const queryKey = chatAssetBatchQueryKey(profileId, batchId ?? 0)
  const batchQuery = useQuery({ queryKey, queryFn: ({ signal }) => getChatAssetBatch(profileId, batchId!, signal), enabled: !!profileId && batchId !== null, retry: false, refetchInterval: (query) => running(query.state.data) ? 3000 : false })
  const batch = batchQuery.data
  const candidates = batch?.slots.flatMap((slot) => slot.attempts.flatMap((attempt) => attempt.candidates)) ?? []
  const hashes = [...new Set(candidates.map((candidate) => candidate.compositeHash))]
  const images = useQueries({ queries: hashes.map((hash) => ({ queryKey: getImageDetailQueryKey(hash), queryFn: ({ signal }: { signal: AbortSignal }) => getImage(hash, { signal }), enabled: canViewImages, retry: (count: number, error: Error) => error.message === 'Metadata not found' && count < 10, retryDelay: 3000 })) })
  const safety = useImageFeedSafety({ items: images.flatMap((query) => query.data ? [query.data] : []) })
  const visibleImages = new Map(safety.visibleItems.map((image) => [image.composite_hash, image]))
  const onError = (error: unknown) => showSnackbar({ message: getErrorMessage(error, t({ ko: '자산 작업을 처리하지 못했어.', en: 'Could not process assets.' })), tone: 'error' })
  const accept = (next: ChatAssetBatch) => {
    setBatchId(next.id)
    queryClient.setQueryData(chatAssetBatchQueryKey(next.profileId, next.id), next)
    try { sessionStorage.setItem(`conai:chat-asset-batch:${next.profileId}`, String(next.id)) } catch { /* Storage can be unavailable. */ }
    onBatchChange?.(next.id)
  }
  const create = useMutation({
    mutationFn: async () => {
      const current = onPrepare ? await onPrepare() : savedProfile
      if (!current) throw new Error(t({ ko: '프로필을 먼저 저장해줘.', en: 'Save the profile first.' }))
      setSavedProfile(current)
      const input: Omit<ChatAssetBatchInput, 'idempotencyKey'> = {
        presetId,
        ...(expressions ? { expressionPresetId } : {}),
        ...(preset?.kind === 'comfyui' ? { promptField } : {}),
        slots: [
          ...(referenceOnly || !current.referenceHash ? [{ slotKey: '기준 이미지', kind: 'reference' as const, prompt: 'solo, full body, simple background, character reference' }] : []),
          ...(background ? [{ slotKey: '배경', kind: 'background' as const, prompt: 'scenery, background' }] : []),
          ...(full ? [{ slotKey: '전신', kind: 'full' as const, prompt: 'solo, full body' }] : []),
        ],
      }
      const serialized = JSON.stringify({ profileId: current.id, ...input })
      if (request.current?.serialized !== serialized) {
        try {
          const previous = JSON.parse(sessionStorage.getItem(`conai:chat-asset-request:${current.id}`) ?? 'null')
          if (previous?.serialized === serialized && typeof previous.input?.idempotencyKey === 'string') request.current = { serialized, input: { ...input, idempotencyKey: previous.input.idempotencyKey } }
        } catch { /* Storage can be unavailable. */ }
        if (request.current?.serialized !== serialized) request.current = { serialized, input: { ...input, idempotencyKey: createRandomUuid() } }
      }
      try { sessionStorage.setItem(`conai:chat-asset-request:${current.id}`, JSON.stringify(request.current)) } catch { /* Storage can be unavailable. */ }
      return createChatAssetBatch(current.id, request.current!.input)
    },
    onSuccess: (next) => { accept(next); try { sessionStorage.removeItem(`conai:chat-asset-request:${next.profileId}`) } catch { /* Storage can be unavailable. */ } },
    onError: (error) => {
      if (error instanceof ChatAssetSubmissionError && error.batchId !== null) {
        setBatchId(error.batchId)
        try { sessionStorage.setItem(`conai:chat-asset-batch:${error.profileId}`, String(error.batchId)); sessionStorage.removeItem(`conai:chat-asset-request:${error.profileId}`) } catch { /* Storage can be unavailable. */ }
        onBatchChange?.(error.batchId)
      }
      onError(error)
    },
    onSettled: () => { creating.current = false },
  })
  const slotMutation = useMutation({
    onMutate: () => queryClient.cancelQueries({ queryKey }),
    mutationFn: ({ slotKey, action, hash }: { slotKey: string; action: 'choose' | 'cancel' | 'regenerate'; hash?: string }) => {
      if (action === 'choose') return chooseChatAssetSlot(profileId, batchId!, slotKey, hash!)
      if (action === 'cancel') return cancelChatAssetSlot(profileId, batchId!, slotKey)
      const attempt = regeneration.current.get(slotKey) ?? (batch!.slots.find((slot) => slot.slotKey === slotKey)!.attempts.length + 1)
      regeneration.current.set(slotKey, attempt)
      return regenerateChatAssetSlot(profileId, batchId!, slotKey, attempt)
    },
    onSuccess: (next, variables) => { if (variables.action === 'regenerate') regeneration.current.delete(variables.slotKey); accept(next) },
    onError: (error) => { onError(error); void batchQuery.refetch() },
  })
  const apply = useMutation({
    onMutate: () => queryClient.cancelQueries({ queryKey }),
    mutationFn: () => applyChatAssetBatch(profileId, batchId!),
    onSuccess: async (result) => {
      onApplied?.(result, batch!)
      showSnackbar({ message: t({ ko: '자산을 적용했어.', en: 'Assets applied.' }), tone: 'info' })
      const profiles = await listChatAdminProfiles()
      const updated = profiles.find((entry) => entry.id === profileId)
      if (updated) { setSavedProfile(updated); onApplied?.(result, batch!, updated) }
      queryClient.setQueryData(CHAT_ADMIN_PROFILES_QUERY_KEY, profiles)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: CHAT_PROFILES_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: ['groups-hierarchy-all'] }),
        queryClient.invalidateQueries({ queryKey: ['chat-asset-candidates'] }),
        queryClient.invalidateQueries({ queryKey: ['group-emoticons'] }),
        queryClient.invalidateQueries({ queryKey: chatProfileEmoticonsQueryKey(profileId) }),
      ])
    }, onError,
  })
  const isRunning = running(batch)
  // Reviews are scheduled after GET; take one final read after jobs settle without idle polling.
  useEffect(() => {
    if (!batchId || isRunning) return
    const timer = window.setTimeout(() => void queryClient.invalidateQueries({ queryKey: chatAssetBatchQueryKey(profileId, batchId) }), 3000)
    return () => window.clearTimeout(timer)
  }, [batchId, isRunning, profileId, queryClient])
  const busy = create.isPending || slotMutation.isPending || apply.isPending
  const frozen = busy || isRunning || batchId !== null
  const preview = [
    ...(referenceOnly || !profile?.referenceHash ? [{ slotKey: '기준 이미지', kind: 'reference' as const }] : []),
    ...(expressions ? emotionNames.map((slotKey) => ({ slotKey, kind: 'expression' as const })) : []),
    ...(background ? [{ slotKey: '배경', kind: 'background' as const }] : []),
    ...(full ? [{ slotKey: '전신', kind: 'full' as const }] : []),
  ]
  const selected = batch?.slots.filter((slot) => slot.kind !== 'full' && slot.chosenHash && slot.attempts.some((attempt) => attempt.candidates.some((candidate) => candidate.compositeHash === slot.chosenHash))).length ?? 0
  const complete = batch?.slots.filter((slot) => terminal(slot.status)).length ?? 0
  const displayedPresetId = batch?.presetId ?? presetId
  return <Modal open onClose={onClose} widthClassName="max-w-[1040px] max-sm:fixed max-sm:inset-0 max-sm:h-dvh max-sm:max-h-dvh max-sm:rounded-none" height="tall" title={<>{t({ ko: '자산 만들기', en: 'Create assets' })}<span className="ml-3 text-sm font-normal text-muted-foreground">{savedProfile?.name ?? profile?.name}</span></>}>
    <ModalBody>
      <div className="flex flex-wrap items-center gap-2 border-b border-line pb-3">
        <Select className="w-auto max-w-full" aria-label={t({ ko: '생성 프리셋', en: 'Generation preset' })} value={displayedPresetId} disabled={frozen} onChange={(event) => setPresetChoice(Number(event.target.value))}>
          {!presets.data?.length ? <option value={0}>{t({ ko: '생성 프리셋', en: 'Generation preset' })}</option> : null}
          {batch && !presets.data?.some((entry) => entry.id === batch.presetId) ? <option value={batch.presetId}>{String(batch.snapshot.preset.name ?? `#${batch.presetId}`)}</option> : null}
          {presets.data?.map((entry) => <option key={entry.id} value={entry.id}>{batch?.presetId === entry.id ? String(batch.snapshot.preset.name ?? entry.name) : entry.name}</option>)}
        </Select>
        <Select className="w-auto max-w-full" aria-label={t({ ko: '표정 목록', en: 'Expression list' })} value={batch ? -1 : expressionPresetId} disabled={frozen || referenceOnly} onChange={(event) => setExpressionChoice(Number(event.target.value))}>
          {batch ? <option value={-1}>{t({ ko: '표정 {count}', en: '{count} expressions' }, { count: batch.slots.filter((slot) => slot.kind === 'expression').length })}</option> : null}
          {!expressionPresets.data?.length ? <option value={0}>{t({ ko: '표정 목록', en: 'Expression list' })}</option> : null}
          {expressionPresets.data?.map((entry) => <option key={entry.id} value={entry.id}>{entry.name === '기본 캐릭터 표정' ? t({ ko: '기본 표정 8', en: 'Default 8 expressions' }) : entry.name}</option>)}
        </Select>
        {preset?.kind === 'comfyui' ? <Select className="w-auto max-w-full" value={promptField} disabled={frozen} aria-label={t({ ko: '슬롯 프롬프트 필드', en: 'Slot prompt field' })} onChange={(event) => setPromptChoice(event.target.value)}><option value="">{t({ ko: '프롬프트 필드', en: 'Prompt field' })}</option>{promptFields.map((field) => <option key={field.id} value={field.id}>{field.label}</option>)}</Select> : null}
        <Select className="w-auto max-w-full" aria-label={t({ ko: '비전 검수 모델', en: 'Vision review model' })} value={visionSlotId} disabled={modelSlots.isPending} onChange={(event) => setVisionChoice(Number(event.target.value))}>
          <option value={0}>{t({ ko: '비전 검수 모델', en: 'Vision review model' })}</option>
          {modelSlots.data?.map((slot) => <option key={slot.id} value={slot.id}>{slot.label}</option>)}
        </Select>
        <FieldInfo>{t({ ko: '비전 검수 모델: 후보가 기준 이미지와 같은 인물인지, 표정이 맞는지 보는 모델. 이미지를 볼 수 있는 모델을 골라줘.', en: 'Vision review model: checks that a candidate matches the reference character and expression. Choose a model that can see images.' })}</FieldInfo>
        <span className="mx-1 h-6 w-px bg-line" aria-hidden />
        <ToggleChip pressed={batch ? batch.slots.some((slot) => slot.kind === 'expression') : expressions} disabled={frozen || referenceOnly} onClick={() => setExpressions(!expressions)}>{t({ ko: '표정', en: 'Expressions' })}</ToggleChip>
        <ToggleChip pressed={batch ? batch.slots.some((slot) => slot.kind === 'background') : background} disabled={frozen || referenceOnly} onClick={() => setBackground(!background)}>{t({ ko: '배경', en: 'Background' })}</ToggleChip>
        <ToggleChip pressed={batch ? batch.slots.some((slot) => slot.kind === 'full') : full} disabled={frozen || referenceOnly} onClick={() => setFull(!full)}>{t({ ko: '전신', en: 'Full body' })}</ToggleChip>
        <span className="flex-1" />
        {isRunning ? <span aria-live="polite" className="text-xs tabular-nums text-muted-foreground">{complete} / {batch?.slots.length}</span> : null}
        <Tip content={batchId !== null ? t({ ko: '새 묶음 만들기', en: 'Create a new batch' }) : onPrepare ? t({ ko: '이름·외형·기준 이미지를 저장하고 만들기', en: 'Save name, appearance and reference, then create' }) : null}><Button size="sm" disabled={busy || isRunning || !savedProfile?.name.trim() || (batchId === null && (!presetId || !preview.length || preview.length > 32 || (expressions && !emotionNames.length) || (preset?.kind === 'comfyui' && !promptField)))} onClick={() => { if (batchId !== null) { setBatchId(null); request.current = null } else if (!creating.current) { creating.current = true; create.mutate() } }}>{create.isPending ? <Spinner /> : <Sparkles />}{t({ ko: '만들기', en: 'Create' })}</Button></Tip>
      </div>
      {[presets, expressionPresets, workflows, modelSlots, batchQuery].filter((query) => query.isError).map((query, index) => <div key={index} role="alert" className="flex items-center gap-2 text-sm text-destructive">{getErrorMessage(query.error, t({ ko: '불러오지 못했어.', en: 'Could not load.' }))}<Button size="xs" variant="ghost" onClick={() => void query.refetch()}>{t({ ko: '다시 시도', en: 'Retry' })}</Button></div>)}
      {batchQuery.isPending && batchId !== null ? <Spinner /> : null}
      <div className="divide-y divide-line">
        {(batch?.slots ?? preview).map((entry) => {
          const slot = batch?.slots.find((slot) => slot.slotKey === entry.slotKey)
          const slotCandidates = slot?.attempts.flatMap((attempt) => attempt.candidates) ?? []
          const chosen = slotCandidates.find((candidate) => candidate.compositeHash === slot?.chosenHash)
          const latest = slotCandidates[slotCandidates.length - 1]
          const reviewCandidate = slot?.chosenHash ? chosen : latest
          const reviewHash = reviewCandidate?.compositeHash
          const reviewAttempt = [...(slot?.attempts ?? [])].reverse().find((attempt) => attempt.candidates.some((candidate) => candidate.compositeHash === reviewHash))
          const reviewReference = reviewAttempt?.referenceHash ?? batch?.slots.find((slot) => slot.kind === 'reference')?.chosenHash ?? batch?.snapshot.referenceHash
          const working = slot?.attempts.some(activeAttempt)
          const referenceBlocked = slot?.kind !== 'reference' && batch?.slots.some((slot) => slot.kind === 'reference' && !slot.chosenHash)
          const dimensions = entry.kind === 'background' ? 'h-[135px] w-[240px]' : 'h-[150px] w-[112px]'
          return <section key={entry.slotKey} className="py-3">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Tip content={entry.kind === 'full' ? t({ ko: '전신은 후보 그룹에 보관해', en: 'Full-body images stay in the candidates group' }) : null}><span className="w-16 shrink-0 text-sm font-semibold">{entry.slotKey}</span></Tip><ReviewChips review={chosen?.review ?? latest?.review} /><span className="flex-1" />
              <SlotVisionReview key={`${batch?.id}:${entry.slotKey}:${reviewHash}:${reviewReference}:${visionSlotId}`} profileId={profileId} batchId={batch?.id ?? 0} slotKey={entry.slotKey} hash={reviewHash} referenceHash={reviewReference} modelSlotId={visionSlotId} disabled={!batch || busy || !canViewImages || !reviewHash || !visibleImages.has(reviewHash)} />
              {working ? <IconButton variant="ghost" size="icon-sm" disabled={busy || slot?.attempts.filter(activeAttempt).every((attempt) => attempt.cancelRequested)} label={t({ ko: '취소', en: 'Cancel' })} onClick={() => slotMutation.mutate({ slotKey: entry.slotKey, action: 'cancel' })}><Square /></IconButton> : null}
              <IconButton variant="ghost" size="icon-sm" disabled={!slot || busy || referenceBlocked} label={referenceBlocked ? t({ ko: '기준 이미지를 먼저 골라줘', en: 'Choose the reference first' }) : t({ ko: '다시 만들기', en: 'Regenerate' })} onClick={() => slotMutation.mutate({ slotKey: entry.slotKey, action: 'regenerate' })}><RotateCcw /></IconButton>
            </div>
            <div className="flex gap-3 overflow-x-auto p-1">
              {slotCandidates.map((candidate, index) => {
                const image = visibleImages.get(candidate.compositeHash)
                const imageQuery = images[hashes.indexOf(candidate.compositeHash)]
                const loading = imageQuery?.isPending
                const selected = slot?.chosenHash === candidate.compositeHash
                return <Tip key={`${candidate.historyId}:${index}`} content={image ? t({ ko: '클릭해서 고르기 · 더블클릭해서 크게 보기', en: 'Click to choose · Double-click to view' }) : t({ ko: '이미지를 다시 불러오기', en: 'Reload image' })}><Panel asChild interactive tone="none" padding="none"><button type="button" disabled={create.isPending || apply.isPending || (!image && loading)} aria-pressed={selected} aria-label={t({ ko: '{name} 후보 {index} 고르기', en: 'Choose {name} candidate {index}' }, { name: entry.slotKey, index: index + 1 })} onClick={() => { if (!image) { void imageQuery?.refetch(); return } if (!busy) slotMutation.mutate({ slotKey: entry.slotKey, action: 'choose', hash: candidate.compositeHash }) }} onDoubleClick={() => { const index = safety.visibleItems.findIndex((image) => image.composite_hash === candidate.compositeHash); if (index >= 0) setLightboxIndex(index) }} className={cn('relative shrink-0 overflow-hidden rounded-md bg-foreground/5 outline-none focus-visible:ring-2 focus-visible:ring-ring', dimensions, selected && 'ring-2 ring-primary ring-offset-2 ring-offset-background')}>
                  {image ? <><ChatProfileImage src={buildApiUrl(`/api/images/${candidate.compositeHash}/file`)} className={safety.shouldBlurItemPreview(image) ? 'blur-lg' : undefined} />{safety.renderItemPersistentOverlay(image)}</> : <span className="flex h-full items-center justify-center text-muted-foreground">{loading ? <Spinner /> : <ImageOff />}</span>}
                  {selected ? <span className="absolute right-1 top-1 flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground"><Check className="size-3" /></span> : null}
                </button></Panel></Tip>
              })}
              {slot?.attempts.filter((attempt) => activeAttempt(attempt) || attempt.status === 'failed' || attempt.status === 'cancelled' || !attempt.candidates.length).map((attempt) => <div key={attempt.jobId} title={attempt.failureCode ?? attempt.status} className={cn('flex shrink-0 flex-col items-center justify-center gap-2 rounded-md border border-dashed border-line text-xs text-muted-foreground', dimensions)}>{activeAttempt(attempt) ? attempt.status === 'queued' ? null : <Spinner /> : <AlertTriangle className="size-5 text-warning" />}{activeAttempt(attempt) ? attempt.cancelRequested ? t({ ko: '취소 중', en: 'Cancelling' }) : attempt.status === 'queued' ? t({ ko: '대기', en: 'Waiting' }) : t({ ko: '만드는 중', en: 'Creating' }) : attempt.status === 'cancelled' ? t({ ko: '취소됨', en: 'Cancelled' }) : t({ ko: '실패', en: 'Failed' })}</div>)}
              {!slot?.attempts.length ? <div title={referenceBlocked ? t({ ko: '기준 이미지를 먼저 골라줘', en: 'Choose the reference first' }) : undefined} className={cn('flex shrink-0 items-center justify-center rounded-md border border-dashed border-line text-xs text-muted-foreground', dimensions)}>{slot?.status === 'blocked' ? t({ ko: '차단됨', en: 'Blocked' }) : null}</div> : null}
            </div>
          </section>
        })}
      </div>
    </ModalBody>
    <ModalFooter><Button size="sm" disabled={!selected || busy} onClick={() => apply.mutate()}>{apply.isPending ? <Spinner /> : <Check />}{t({ ko: '적용 {count}', en: 'Apply {count}' }, { count: selected })}</Button></ModalFooter>
    <MediaLightbox items={safety.visibleItems} index={lightboxIndex} onIndexChange={setLightboxIndex} onClose={() => setLightboxIndex(null)} />
  </Modal>
}
