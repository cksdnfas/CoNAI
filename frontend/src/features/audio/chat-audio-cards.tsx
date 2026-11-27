import { CONTENT_PERMISSIONS } from '@conai/shared'
import { useQueries, useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { AudioLines, CircleAlert, Download, ExternalLink, LoaderCircle, Music, Pause, Play } from 'lucide-react'
import type { ChatToolCall } from '@conai/shared'
import { IconButton } from '@/components/ui/icon-button'
import { hasAuthPermission } from '@/features/auth/auth-permissions'
import { useAuthStatusQuery } from '@/features/auth/use-auth-status-query'
import { useStreamFallbackInterval } from '@/features/runtime-events/use-runtime-event-stream'
import { useI18n } from '@/i18n'
import { AUDIO_QUERY_KEY, getAudioCandidate, getAudioGroup, listAudioCandidates, type AudioCandidate } from '@/lib/api-audio'
import { FILES_QUERY_KEY, getStoredFile, storedFileDownloadUrl, storedFileViewUrl } from '@/lib/api-files'
import { formatSeconds, ReviewPill } from './audio-candidate-list'
import { audioPlayer, useAudioPlayer } from './audio-player'
import { WaveformThumb } from './audio-waveform'

/** Tool calls of the audio workspace (orders, takes): everything they make or fail is a sound, never an image. */
export function isAudioWorkspaceCall(call: ChatToolCall) {
  return /audio/.test(call.tool)
}

/** Tool calls with sounds to show: audio workspace calls, and image generations whose run also saved a sound. */
function isChatAudioCall(call: ChatToolCall) {
  return isAudioWorkspaceCall(call) || Boolean(call.audioCandidateIds?.length)
}

/** Larger files play but skip the waveform: drawing one decodes the whole file in the browser. */
const FILE_WAVEFORM_MAX_BYTES = 20 * 1024 * 1024

function argumentGroupId(call: ChatToolCall): string | null {
  const args = call.arguments as Record<string, unknown> | null
  const value = args && typeof args === 'object' ? args.audio_group_id ?? args.group_id : null
  return typeof value === 'string' && value ? value : null
}

/**
 * Sounds a reply made or referenced, one card per group: play in place, open the group in the 오디오 tab to review.
 * The card links to the audio page for manual review; requested review changes are also available through chat tools.
 */
export function ChatAudioCards({ calls }: { calls: ChatToolCall[] }) {
  const auth = useAuthStatusQuery().data
  const signedIn = !!auth?.authenticated
  const canView = signedIn && (auth.hasCredentials === false || hasAuthPermission(auth.permissionKeys, CONTENT_PERMISSIONS.read))
  const canViewFiles = signedIn && (auth.hasCredentials === false || hasAuthPermission(auth.permissionKeys, CONTENT_PERMISSIONS.read))
  // Audio files the reply's file-store lookups found: played straight from the file store.
  const fileIds = canViewFiles ? [...new Set(calls.flatMap((call) => call.audioFileIds ?? []))] : []
  const fileCard = fileIds.length > 0 ? <ChatAudioFileCard ids={fileIds} /> : null
  const audioCalls = calls.filter(isChatAudioCall)
  const ids = [...new Set(audioCalls.flatMap((call) => call.audioCandidateIds ?? []))]
  // Jobs still running when the reply was stored: matched to their takes by job id once they land.
  const pending = audioCalls.flatMap((call) => (call.pendingJobIds ?? []).map((jobId) => ({ jobId, groupId: argumentGroupId(call) })))
  // Failed audio jobs: the image grid skips audio calls, so the card reports them.
  const failed = [...new Map(calls.filter(isAudioWorkspaceCall).flatMap((call) => (call.failedJobs ?? []).map((job) => [job.jobId, { ...job, groupId: argumentGroupId(call) }] as const))).values()]
  if (!canView || (ids.length === 0 && pending.length === 0 && failed.length === 0)) return fileCard
  return <>{<ChatAudioCardList ids={ids} pending={pending} failed={failed} />}{fileCard}</>
}

/** Shared files a reply found, one row each: play in place with the same player and waveform as the takes. */
function ChatAudioFileCard({ ids }: { ids: string[] }) {
  const { t } = useI18n()
  const player = useAudioPlayer()
  // A file deleted or moved out of reach since the reply drops out of the card.
  const queries = useQueries({ queries: ids.map((id) => ({ queryKey: [...FILES_QUERY_KEY, 'chat-audio', id], queryFn: () => getStoredFile(id), retry: false, staleTime: 30_000 })) })
  const files = queries.flatMap((query) => (query.data && query.data.kind === 'file' ? [query.data] : []))
  if (files.length === 0) return null
  return (
    <div className="mt-2 max-w-md rounded-md border border-line">
      <div className="flex items-center gap-2 border-b border-line py-1.5 pr-3 pl-3 text-sm font-semibold">
        <Music className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate">{t({ ko: '파일', en: 'Files' })}</span>
        <span className="font-mono text-xs font-normal text-muted-foreground">{files.length}</span>
      </div>
      <div className="divide-y divide-line">
        {files.map((file) => {
          const key = `file:${file.id}`
          const src = storedFileViewUrl(file.id)
          const active = player.key === key
          const playing = active && player.playing
          return (
            <div key={file.id} className="grid grid-cols-[2rem_minmax(0,1fr)_auto_auto] items-center gap-x-3 py-1.5 pr-1.5 pl-2">
              <IconButton variant={playing ? 'secondary' : 'ghost'} size="icon-sm" label={playing ? t({ ko: '정지', en: 'Pause' }) : t({ ko: '재생', en: 'Play' })} onClick={() => audioPlayer.toggle(key, { src })}>
                {playing ? <Pause className="fill-current" /> : <Play className="fill-current" />}
              </IconButton>
              <div className="min-w-0">
                <WaveformThumb
                  candidateId={key}
                  fileHash={file.updatedAt}
                  src={src}
                  ghost={file.size > FILE_WAVEFORM_MAX_BYTES}
                  progress={active && player.duration > 0 ? player.currentTime / player.duration : undefined}
                  duration={active && player.duration > 0 ? player.duration : 0}
                  onToggle={() => audioPlayer.toggle(key, { src })}
                  onSeek={(seconds) => audioPlayer.seekOrPlay(key, seconds, { src })}
                  className="h-5"
                />
                <p className="truncate text-2xs text-muted-foreground" title={file.name}>{file.name}</p>
              </div>
              <span className="font-mono text-2xs text-muted-foreground">{active && player.duration > 0 ? formatSeconds(player.duration) : ''}</span>
              <IconButton asChild variant="ghost" size="icon-xs" label={t({ ko: '내려받기', en: 'Download' })}>
                <a href={storedFileDownloadUrl(file.id)} download={file.name}><Download /></a>
              </IconButton>
            </div>
          )
        })}
      </div>
    </div>
  )
}

type FailedAudioJob = NonNullable<ChatToolCall['failedJobs']>[number] & { groupId: string | null }

function ChatAudioCardList({ ids, pending, failed }: { ids: string[]; pending: Array<{ jobId: number; groupId: string | null }>; failed: FailedAudioJob[] }) {
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
  // A take deleted in the audio workspace leaves the reply too.
  const known = candidateQueries.flatMap((query) => (query.data && !query.data.deleted_at ? [query.data] : []))
  const landed = pendingQueries.flatMap((query) => query.data?.items ?? []).filter((item) => item.job_id !== null && pending.some((entry) => String(entry.jobId) === String(item.job_id)))
  const candidates = [...new Map([...known, ...landed].map((item) => [item.id, item])).values()]
  const landedJobs = new Set(landed.map((item) => String(item.job_id)))
  const waiting = pending.filter((entry) => !landedJobs.has(String(entry.jobId)))

  const byGroup = new Map<string, { candidates: AudioCandidate[]; waiting: number; failed: FailedAudioJob[] }>()
  const cardOf = (key: string) => {
    const card = byGroup.get(key) ?? { candidates: [], waiting: 0, failed: [] }
    byGroup.set(key, card)
    return card
  }
  for (const candidate of candidates) cardOf(candidate.group_id).candidates.push(candidate)
  for (const entry of waiting) cardOf(entry.groupId ?? '').waiting += 1
  for (const job of failed) cardOf(job.groupId ?? '').failed.push(job)

  return (
    <div className="mt-2 flex flex-col gap-2">
      {[...byGroup.entries()].map(([groupId, card]) => <ChatAudioCard key={groupId || 'unknown'} groupId={groupId || null} candidates={card.candidates} waiting={card.waiting} failed={card.failed} />)}
    </div>
  )
}

function ChatAudioCard({ groupId, candidates, waiting, failed }: { groupId: string | null; candidates: AudioCandidate[]; waiting: number; failed: FailedAudioJob[] }) {
  const { t } = useI18n()
  const navigate = useNavigate()
  const player = useAudioPlayer()
  const group = useQuery({ queryKey: [AUDIO_QUERY_KEY, 'group', groupId], queryFn: () => getAudioGroup(groupId!), enabled: Boolean(groupId), retry: false, staleTime: 30_000 })
  const total = candidates.length + waiting + failed.length
  return (
    <div className="max-w-md rounded-md border border-line">
      <div className="flex items-center gap-2 border-b border-line py-1.5 pr-1.5 pl-3 text-sm font-semibold">
        <AudioLines className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate">{group.data?.name ?? t({ ko: '오디오', en: 'Audio' })}</span>
        <span className="font-mono text-xs font-normal text-muted-foreground">{candidates.length} / {total}</span>
        {groupId ? <IconButton variant="ghost" size="icon-xs" label={t({ ko: '오디오 탭에서 열기', en: 'Open in Audio' })} onClick={() => navigate(`/audio?group=${encodeURIComponent(groupId)}`)}><ExternalLink /></IconButton> : null}
      </div>
      <div className="divide-y divide-line">
        {candidates.map((candidate) => {
          const playing = player.key === candidate.id && player.playing
          const progress = player.key === candidate.id && player.duration > 0 ? player.currentTime / player.duration : undefined
          const seed = candidate.provenance?.seed
          return (
            <div key={candidate.id} className="grid grid-cols-[2rem_minmax(0,1fr)_auto_auto] items-center gap-x-3 py-1.5 pr-3 pl-2">
              <IconButton variant={playing ? 'secondary' : 'ghost'} size="icon-sm" label={playing ? t({ ko: '정지', en: 'Pause' }) : t({ ko: '재생', en: 'Play' })} onClick={() => audioPlayer.toggle(candidate.id)}>
                {playing ? <Pause className="fill-current" /> : <Play className="fill-current" />}
              </IconButton>
              <div className="min-w-0">
                <WaveformThumb
                  candidateId={candidate.id}
                  fileHash={candidate.file_hash}
                  progress={progress}
                  duration={player.key === candidate.id && player.duration > 0 ? player.duration : candidate.file.duration ?? 0}
                  onToggle={() => audioPlayer.toggle(candidate.id)}
                  onSeek={(seconds) => audioPlayer.seekOrPlay(candidate.id, seconds)}
                  className="h-5"
                />
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
        {failed.map((job) => (
          <div key={job.jobId} className="flex items-center gap-3 py-2 pr-3 pl-4 text-xs text-destructive">
            <CircleAlert className="size-4 shrink-0" />
            <span className="min-w-0 truncate">{job.failureMessage}</span>
            <span className="ml-auto shrink-0 font-mono text-2xs text-muted-foreground">#{job.jobId}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
