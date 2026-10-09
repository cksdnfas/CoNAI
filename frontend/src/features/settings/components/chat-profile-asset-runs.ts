import { useEffect, useMemo, useRef, useState } from 'react'
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useImagePermissions } from '@/features/auth/use-image-permissions'
import { useI18n } from '@/i18n'
import {
  CHAT_ADMIN_PROFILES_QUERY_KEY,
  CHAT_GENERATION_PRESETS_QUERY_KEY,
  CHAT_PROFILES_QUERY_KEY,
  applyChatAssetSlot,
  cancelChatAssetSlot,
  chatAssetBatchQueryKey,
  chatProfileEmoticonsQueryKey,
  createChatAssetBatch,
  getChatAssetBatch,
  listChatAdminProfiles,
  listChatGenerationPresets,
  type ChatAssetApplyResult,
  type ChatAssetBatch,
  type ChatAssetBatchInput,
  type ChatAssetKind,
  type ChatGenerationPreset,
  type ChatProfile,
} from '@/lib/api-codex-chat'
import { getErrorMessage } from '@/lib/error-message'
import { getPromptPresets } from '@/lib/api-prompt-presets'
import { createRandomUuid } from '@/lib/random-uuid'

type Attempt = ChatAssetBatch['slots'][number]['attempts'][number]
type Run = { id: number; auto: boolean }

const terminal = (status: string) => ['completed', 'failed', 'cancelled'].includes(status)
const live = (attempt: Attempt) => !terminal(attempt.status)
const running = (batch?: ChatAssetBatch) => batch?.slots.some((slot) => slot.attempts.some(live)) === true
const MAX_RUNS = 16

/** Slot keys the editor uses for the single-image assets (expression slots use their emotion names). */
export const REFERENCE_SLOT = '기준 이미지'
export const BACKGROUND_SLOT = '배경'
const SLOT_RECIPES: Record<'reference' | 'background', { slotKey: string; prompt: string }> = {
  reference: { slotKey: REFERENCE_SLOT, prompt: 'solo, full body, simple background, character reference' },
  background: { slotKey: BACKGROUND_SLOT, prompt: 'scenery, background, no humans' },
}
const DEFAULT_EXPRESSION_PRESET = '기본 캐릭터 표정'

function storageKey(profileId: number) { return `conai:chat-asset-runs:${profileId}` }
function readRuns(profileId: number | null): Run[] {
  if (!profileId) return []
  try {
    const parsed: unknown = JSON.parse(sessionStorage.getItem(storageKey(profileId)) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((run): run is Run => Number.isSafeInteger(run?.id) && run.id > 0).map((run) => ({ id: run.id, auto: run.auto === true })) : []
  } catch { return [] }
}
function writeRuns(profileId: number, runs: Run[]) {
  try { sessionStorage.setItem(storageKey(profileId), JSON.stringify(runs)) } catch { /* Storage can be unavailable. */ }
}
function readChoice(key: string) {
  try { const value = Number(localStorage.getItem(key)); return Number.isSafeInteger(value) && value > 0 ? value : null } catch { return null }
}
function writeChoice(key: string, value: number | null) {
  try { if (value) localStorage.setItem(key, String(value)); else localStorage.removeItem(key) } catch { /* Storage can be unavailable. */ }
}

/** What one slot shows: its newest candidates first, whether a job is still working on it, and whether the last one failed. */
export type AssetSlotState = {
  working: boolean
  failed: boolean
  /** Why the newest job failed (queue failure code), when it did. */
  failure: string | null
  candidates: Array<{ hash: string; batchId: number; review?: ChatAssetBatch['slots'][number]['attempts'][number]['candidates'][number]['review'] }>
}
const EMPTY_SLOT: AssetSlotState = { working: false, failed: false, failure: null, candidates: [] }

/** Presets sorted for asset generation: ones drawing from the reference first, then text-only, then unusable. */
export function assetPresetRank(preset: ChatGenerationPreset) {
  return preset.assetSupport?.mode === 'reference' ? 0 : preset.assetSupport?.mode === 'appearance' ? 1 : 2
}

/**
 * Character asset generation inside the profile editor. Each request is a batch the server tracks; this keeps the
 * session's batch ids, polls the ones still working, puts the first result straight into slots that were empty when
 * asked (`auto`), and applies a picked candidate to just its slot.
 */
export function useProfileAssetRuns({ profileId, ensureProfile, onApplied }: {
  profileId: number | null
  /** Saves the profile (name, appearance, reference) and returns it; a new profile is created here. */
  ensureProfile: () => Promise<ChatProfile>
  onApplied: (result: ChatAssetApplyResult, slot: { kind: ChatAssetKind; hash: string }, profile?: ChatProfile) => void
}) {
  const { t } = useI18n()
  const { showSnackbar } = useSnackbar()
  const { canViewImages } = useImagePermissions()
  const queryClient = useQueryClient()
  const [runs, setRuns] = useState<Run[]>(() => readRuns(profileId))
  const [pending, setPending] = useState<string[]>([])
  const [loadedFor, setLoadedFor] = useState(profileId)
  if (loadedFor !== profileId) { setLoadedFor(profileId); setRuns(readRuns(profileId)) }

  const presetsQuery = useQuery({ queryKey: CHAT_GENERATION_PRESETS_QUERY_KEY, queryFn: listChatGenerationPresets, enabled: canViewImages })
  const presets = useMemo(() => [...(presetsQuery.data ?? [])].sort((a, b) => assetPresetRank(a) - assetPresetRank(b)), [presetsQuery.data])
  const [presetChoice, setPresetChoice] = useState(() => readChoice('conai:chat-asset-preset'))
  const preset = presets.find((entry) => entry.id === presetChoice && entry.assetSupport?.mode) ?? presets.find((entry) => entry.assetSupport?.mode) ?? null
  const expressionPresetsQuery = useQuery({ queryKey: ['prompt-presets', 'chat-assets'], queryFn: () => getPromptPresets({ withItems: true }), enabled: canViewImages })
  const [expressionChoice, setExpressionChoice] = useState(() => readChoice('conai:chat-asset-expressions'))
  const expressionPresets = expressionPresetsQuery.data ?? []
  const expressionPreset = expressionPresets.find((entry) => entry.id === expressionChoice) ?? expressionPresets.find((entry) => entry.name === DEFAULT_EXPRESSION_PRESET) ?? expressionPresets[0] ?? null
  const emotionNames = (expressionPreset?.items ?? []).map((item) => item.description).filter(Boolean)
  const [visionChoice, setVisionChoice] = useState(() => readChoice('conai:chat-asset-vision'))

  const queries = useQueries({
    queries: runs.map((run) => ({
      queryKey: chatAssetBatchQueryKey(profileId ?? 0, run.id),
      queryFn: ({ signal }: { signal: AbortSignal }) => getChatAssetBatch(profileId!, run.id, signal),
      enabled: Boolean(profileId),
      retry: false,
      refetchInterval: (query: { state: { data?: ChatAssetBatch } }) => (running(query.state.data) ? 3000 : false),
    })),
  })
  const batches = queries.map((query) => query.data)
  const batchKey = batches.map((batch) => (batch ? `${batch.id}:${batch.slots.map((slot) => `${slot.slotKey}=${slot.status}/${slot.chosenHash ?? ''}/${slot.attempts.map((attempt) => attempt.candidates.length).join('.')}`).join(',')}` : '-')).join('|')

  // A run whose batch is gone (profile reset, other session) is dropped.
  const missing = runs.filter((_, index) => queries[index]?.isError).map((run) => run.id).join(',')
  useEffect(() => {
    if (!missing || !profileId) return
    const gone = new Set(missing.split(',').map(Number))
    setRuns((current) => { const next = current.filter((run) => !gone.has(run.id)); writeRuns(profileId, next); return next })
  }, [missing, profileId])

  const slotState = useMemo(() => {
    const states = new Map<string, AssetSlotState>()
    batches.forEach((batch) => {
      if (!batch) return
      for (const slot of batch.slots) {
        const latest = slot.attempts.at(-1)
        const previous = states.get(slot.slotKey) ?? EMPTY_SLOT
        const failed = Boolean(latest && (latest.status === 'failed' || (latest.status === 'completed' && latest.candidates.length === 0))) && !slot.attempts.some(live)
        const candidates = slot.attempts.flatMap((attempt) => attempt.candidates.map((candidate) => ({ hash: candidate.compositeHash, batchId: batch.id, review: candidate.review }))).reverse()
        states.set(slot.slotKey, {
          working: previous.working || slot.attempts.some(live),
          // The newest run decides whether the slot shows a failure.
          failed,
          failure: failed ? latest?.failureCode ?? latest?.status ?? null : null,
          candidates: [...candidates, ...previous.candidates.filter((entry) => !candidates.some((candidate) => candidate.hash === entry.hash))],
        })
      }
    })
    return (key: string) => states.get(key) ?? EMPTY_SLOT
    // eslint-disable-next-line react-hooks/exhaustive-deps -- batchKey captures every field read here
  }, [batchKey])

  const refreshAfterApply = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: CHAT_PROFILES_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: ['groups-hierarchy-all'] }),
      queryClient.invalidateQueries({ queryKey: ['chat-asset-candidates'] }),
      queryClient.invalidateQueries({ queryKey: ['group-emoticons'] }),
      profileId ? queryClient.invalidateQueries({ queryKey: chatProfileEmoticonsQueryKey(profileId) }) : Promise.resolve(),
    ])
  }

  const apply = async (slotKey: string, hash: string) => {
    if (!profileId) return
    const batch = batches.find((entry) => entry?.slots.some((slot) => slot.slotKey === slotKey && slot.attempts.some((attempt) => attempt.candidates.some((candidate) => candidate.compositeHash === hash))))
    const slot = batch?.slots.find((entry) => entry.slotKey === slotKey)
    if (!batch || !slot) return
    setPending((current) => [...current, slotKey])
    try {
      const result = await applyChatAssetSlot(profileId, batch.id, slotKey, hash)
      const profiles = await listChatAdminProfiles()
      queryClient.setQueryData(CHAT_ADMIN_PROFILES_QUERY_KEY, profiles)
      onApplied(result, { kind: slot.kind, hash }, profiles.find((entry) => entry.id === profileId))
      await Promise.all([refreshAfterApply(), queryClient.invalidateQueries({ queryKey: chatAssetBatchQueryKey(profileId, batch.id) })])
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, t({ ko: '적용하지 못했어.', en: 'Could not apply.' })), tone: 'error' })
    } finally {
      setPending((current) => current.filter((key) => key !== slotKey))
    }
  }

  // Slots that were empty when asked take their first result on their own, once per slot of a run.
  const autoApplied = useRef(new Set<string>())
  useEffect(() => {
    batches.forEach((batch, index) => {
      const run = runs[index]
      if (!batch || !run?.auto) return
      for (const slot of batch.slots) {
        const first = slot.attempts.flatMap((attempt) => attempt.candidates)[0]
        const key = `${batch.id}:${slot.slotKey}`
        if (!first || slot.chosenHash || autoApplied.current.has(key)) continue
        autoApplied.current.add(key)
        void apply(slot.slotKey, first.compositeHash)
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs again when any batch changes
  }, [batchKey])

  /** Queue one request; `auto` puts the first result straight in (for slots that are empty now). */
  const start = async (request: { kind: 'expressions'; names: string[] } | { kind: 'reference' | 'background' }, auto: boolean) => {
    if (!preset) return
    const keys = request.kind === 'expressions' ? request.names : [SLOT_RECIPES[request.kind].slotKey]
    setPending((current) => [...current, ...keys])
    try {
      const current = await ensureProfile()
      const input: ChatAssetBatchInput = request.kind === 'expressions'
        ? { idempotencyKey: createRandomUuid(), presetId: preset.id, expressionPresetId: expressionPreset?.id, expressions: request.names }
        : { idempotencyKey: createRandomUuid(), presetId: preset.id, slots: [{ slotKey: SLOT_RECIPES[request.kind].slotKey, kind: request.kind, prompt: SLOT_RECIPES[request.kind].prompt }] }
      const batch = await createChatAssetBatch(current.id, input)
      queryClient.setQueryData(chatAssetBatchQueryKey(current.id, batch.id), batch)
      const next = [...readRuns(current.id), { id: batch.id, auto }].slice(-MAX_RUNS)
      writeRuns(current.id, next)
      setLoadedFor(current.id)
      setRuns(next)
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, t({ ko: '생성을 시작하지 못했어.', en: 'Could not start generating.' })), tone: 'error' })
    } finally {
      setPending((current) => current.filter((key) => !keys.includes(key)))
    }
  }

  const cancel = async (slotKey: string) => {
    if (!profileId) return
    const targets = batches.filter((batch) => batch?.slots.some((slot) => slot.slotKey === slotKey && slot.attempts.some(live)))
    try {
      for (const batch of targets) if (batch) queryClient.setQueryData(chatAssetBatchQueryKey(profileId, batch.id), await cancelChatAssetSlot(profileId, batch.id, slotKey))
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, t({ ko: '취소하지 못했어.', en: 'Could not cancel.' })), tone: 'error' })
    }
  }

  return {
    presets,
    presetsLoaded: presetsQuery.isSuccess,
    preset,
    choosePreset: (id: number) => { setPresetChoice(id); writeChoice('conai:chat-asset-preset', id) },
    expressionPresets,
    expressionPreset,
    chooseExpressionPreset: (id: number) => { setExpressionChoice(id); writeChoice('conai:chat-asset-expressions', id) },
    emotionNames,
    visionSlotId: visionChoice,
    chooseVision: (id: number | null) => { setVisionChoice(id); writeChoice('conai:chat-asset-vision', id) },
    slotState,
    isPending: (slotKey: string) => pending.includes(slotKey),
    start,
    apply,
    cancel,
    refreshAfterApply,
    /** The batch a candidate came from (vision review needs it). */
    batchOf: (hash: string) => batches.find((batch) => batch?.slots.some((slot) => slot.attempts.some((attempt) => attempt.candidates.some((candidate) => candidate.compositeHash === hash)))) ?? null,
  }
}

export type ProfileAssetRuns = ReturnType<typeof useProfileAssetRuns>
