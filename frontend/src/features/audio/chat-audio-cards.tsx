import { useQueries, useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { AudioLines, ExternalLink, LoaderCircle, Pause, Play } from 'lucide-react'
import type { ChatToolCall } from '@conai/shared'
import { IconButton } from '@/components/ui/icon-button'
import { hasAuthPermission } from '@/features/auth/auth-permissions'
import { useAuthStatusQuery } from '@/features/auth/use-auth-status-query'
import { useStreamFallbackInterval } from '@/features/runtime-events/use-runtime-event-stream'
import { useI18n } from '@/i18n'
import { AUDIO_QUERY_KEY, getAudioCandidate, getAudioGroup, listAudioCandidates, type AudioCandidate } from '@/lib/api-audio'
import { formatSeconds, ReviewPill } from './audio-candidate-list'
import { audioPlayer, useAudioPlayer } from './audio-player'
import { WaveformThumb } from './audio-waveform'

/** Tool calls that belong to the audio workspace; their results are sounds, not images. */
export function isChatAudioCall(call: ChatToolCall) {
  return /audio/.test(call.tool) || Boolean(call.audioCandidateIds?.length)
}

function argumentGroupId(call: ChatToolCall): string | null {
  const args = call.arguments as Record<string, unknown> | null
  const value = args && typeof args === 'object' ? args.audio_group_id ?? args.group_id : null
  return typeof value === 'string' && value ? value : null
}

/**
 * Sounds a reply made or referenced, one card per group: play in place, open the group in the 음향 tab to review.
 * Review stays on the audio page (people review, the bot does not), so the card has no adopt/reject buttons.
 */
export function ChatAudioCards({ calls }: { calls: ChatToolCall[] }) {
  const auth = useAuthStatusQuery().data
  const canView = !!auth?.authenticated && (auth.hasCredentials === false || hasAuthPermission(auth.permissionKeys, 'audio.view'))
  const audioCalls = calls.filter(isChatAudioCall)
  const ids = [...new Set(audioCalls.flatMap((call) => call.audioCandidateIds ?? []))]
  // Jobs still running when the reply was stored: matched to their takes by job id once they land.
  const pending = audioCalls.flatMap((call) => (call.pendingJobIds ?? []).map((jobId) => ({ jobId, groupId: argumentGroupId(call) })))
  if (!canView || (ids.length === 0 && pending.length === 0)) return null
  return <ChatAudioCardList ids={ids} pending={pending} />
}

function ChatAudioCardList({ ids, pending }: { ids: string[]; pending: Array<{ jobId: number; groupId: string | null }> }) {
  const fallback = useStreamFallbackInterval(5_000)
  const candidateQueries = useQueries({ queries: ids.map((id) => ({ queryKey: [AUDIO_QUERY_KEY, 'candidate', id], queryFn: () => getAudioCandidate(id), retry: false, staleTime: 30_000 })) })
  const pendingGroups = [...new Set(pending.map((entry) => entry.groupId).filter((id): id is string => Boolean(id)))]
  const pendingQueries = useQueries({
    queries: pendingGroups.map((groupId) => ({
      queryKey: [AUDIO_QUERY_KEY, 'chat-pending', groupId],
      queryFn: () => listAudioCandidates(groupId, { limit: 200 }),
      refetchInterval: fallback,
      retry: false,
    })),
  })
  const known = candidateQueries.flatMap((query) => (query.data ? [query.data] : []))
  const landed = pendingQueries.flatMap((query) => query.data?.items ?? []).filter((item) => item.job_id !== null && pending.some((entry) => String(entry.jobId) === String(item.job_id)))
  const candidates = [...new Map([...known, ...landed].map((item) => [item.id, item])).values()]
  const landedJobs = new Set(landed.map((item) => String(item.job_id)))
  const waiting = pending.filter((entry) => !landedJobs.has(String(entry.jobId)))

  const byGroup = new Map<string, { candidates: AudioCandidate[]; waiting: number }>()
  for (const candidate of candidates) {
    const card = byGroup.get(candidate.group_id) ?? { candidates: [], waiting: 0 }
    card.candidates.push(candidate)
    byGroup.set(candidate.group_id, card)
  }
  for (const entry of waiting) {
    const key = entry.groupId ?? ''
    const card = byGroup.get(key) ?? { candidates: [], waiting: 0 }
    card.waiting += 1
    byGroup.set(key, card)
  }

  return (
    <div className="mt-2 flex flex-col gap-2">
      {[...byGroup.entries()].map(([groupId, card]) => <ChatAudioCard key={groupId || 'unknown'} groupId={groupId || null} candidates={card.candidates} waiting={card.waiting} />)}
    </div>
  )
}

function ChatAudioCard({ groupId, candidates, waiting }: { groupId: string | null; candidates: AudioCandidate[]; waiting: number }) {
  const { t } = useI18n()
  const navigate = useNavigate()
  const player = useAudioPlayer()
  const group = useQuery({ queryKey: [AUDIO_QUERY_KEY, 'group', groupId], queryFn: () => getAudioGroup(groupId!), enabled: Boolean(groupId), retry: false, staleTime: 30_000 })
  const total = candidates.length + waiting
  return (
    <div className="max-w-md rounded-md border border-line">
      <div className="flex items-center gap-2 border-b border-line py-1.5 pr-1.5 pl-3 text-sm font-semibold">
        <AudioLines className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate">{group.data?.name ?? t({ ko: '음향', en: 'Audio' })}</span>
        <span className="font-mono text-xs font-normal text-muted-foreground">{candidates.length} / {total}</span>
        {groupId ? <IconButton variant="ghost" size="icon-xs" label={t({ ko: '음향 탭에서 열기', en: 'Open in Audio' })} onClick={() => navigate(`/audio?group=${encodeURIComponent(groupId)}`)}><ExternalLink /></IconButton> : null}
      </div>
      <div className="divide-y divide-line">
        {candidates.map((candidate) => {
          const playing = player.key === candidate.id && player.playing
          const progress = player.key === candidate.id && player.duration > 0 ? player.currentTime / player.duration : undefined
          const seed = candidate.provenance?.seed
          return (
            <div key={candidate.id} className="grid grid-cols-[2rem_minmax(0,1fr)_auto_auto] items-center gap-x-3 py-1.5 pr-3 pl-2">
              <IconButton variant={playing ? 'secondary' : 'ghost'} size="icon-sm" className="rounded-full" label={playing ? t({ ko: '정지', en: 'Pause' }) : t({ ko: '재생', en: 'Play' })} onClick={() => audioPlayer.toggle(candidate.id)}>
                {playing ? <Pause className="fill-current" /> : <Play className="fill-current" />}
              </IconButton>
              <div className="min-w-0">
                <WaveformThumb candidateId={candidate.id} fileHash={candidate.file_hash} progress={progress} className="h-5" />
                <p className="truncate font-mono text-2xs text-muted-foreground">{typeof seed === 'number' ? `seed ${seed}` : candidate.name}</p>
              </div>
              <span className="font-mono text-2xs text-muted-foreground">{formatSeconds(candidate.file.duration)}</span>
              <ReviewPill review={candidate.review} />
            </div>
          )
        })}
        {waiting > 0 ? (
          <div className="flex items-center gap-3 py-2 pr-3 pl-4 text-xs text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin" />
            {t({ ko: '생성 중 {count}개', en: 'Generating {count}' }, { count: waiting })}
          </div>
        ) : null}
      </div>
    </div>
  )
}
