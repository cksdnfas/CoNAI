import type { CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import { AudioLines, Download, ExternalLink, Pause, Play } from 'lucide-react'
import { IconButton } from '@/components/ui/icon-button'
import { hasAuthPermission } from '@/features/auth/auth-permissions'
import { useAuthStatusQuery } from '@/features/auth/use-auth-status-query'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import type { ImageRecordAudio } from '@/types/image'
import { formatSeconds } from './audio-candidate-list'
import { audioPlayer, useAudioPlayer } from './audio-player'
import { WaveformThumb } from './audio-waveform'

/** Whether the viewer can open the audio workspace (where a run's sounds are reviewed). */
function useCanOpenAudioTab() {
  const auth = useAuthStatusQuery().data
  return !!auth?.authenticated && (auth.hasCredentials === false || hasAuthPermission(auth.permissionKeys, 'audio.view'))
}

/** Keep a press on a control from starting the list's drag selection or activating the tile. */
const stopTile = {
  'data-no-select-drag': 'true',
  onMouseDown: (event: { stopPropagation: () => void }) => event.stopPropagation(),
  onClick: (event: { stopPropagation: () => void }) => event.stopPropagation(),
}

/** "Open in Audio" for the sounds' group, when the viewer may see the audio workspace. */
export function OpenSoundsInAudioTab({ sounds }: { sounds: ImageRecordAudio[] }) {
  const { t } = useI18n()
  const navigate = useNavigate()
  const canOpen = useCanOpenAudioTab()
  const groupId = sounds[0]?.groupId
  if (!canOpen || !groupId) return null
  return (
    <IconButton variant="ghost" size="icon-sm" label={t({ ko: '오디오 탭에서 열기', en: 'Open in Audio' })} {...stopTile} onClick={(event) => { event.stopPropagation(); navigate(`/audio?group=${encodeURIComponent(groupId)}`) }}>
      <ExternalLink />
    </IconButton>
  )
}

/**
 * The sounds of one generation run: play in place, waveform with progress. `tile` fits a history list cell, `stage`
 * the large result view.
 */
export function HistoryAudioResult({ sounds, size = 'tile', className, style }: { sounds: ImageRecordAudio[]; size?: 'tile' | 'stage'; className?: string; style?: CSSProperties }) {
  const { t } = useI18n()
  const player = useAudioPlayer()
  const stage = size === 'stage'
  return (
    <div className={cn('flex w-full flex-col justify-center gap-3', stage ? 'max-w-xl px-2' : 'bg-surface-lowest px-3 py-4', className)} style={style}>
      {/* In a list tile the selection checkbox sits top-left: keep the header clear of it. */}
      <div className={cn('flex items-center gap-2 text-muted-foreground', !stage && 'pl-6')}>
        <AudioLines className={stage ? 'size-5' : 'size-4'} />
        <span className="font-mono text-2xs">{t({ ko: '오디오 {count}개', en: '{count} audio' }, { count: sounds.length })}</span>
        <span className="flex-1" />
        {stage ? null : <OpenSoundsInAudioTab sounds={sounds} />}
      </div>
      {sounds.map((sound) => {
        const playing = player.key === sound.id && player.playing
        const progress = player.key === sound.id && player.duration > 0 ? player.currentTime / player.duration : undefined
        return (
          <div key={sound.id} className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-1">
            <IconButton
              variant={playing ? 'secondary' : 'ghost'}
              size={stage ? 'icon' : 'icon-sm'}
              className="row-span-2 rounded-full"
              label={playing ? t({ ko: '정지', en: 'Pause' }) : t({ ko: '재생', en: 'Play' })}
              {...stopTile}
              onClick={(event) => { event.stopPropagation(); audioPlayer.toggle(sound.id, { src: sound.src }) }}
            >
              {playing ? <Pause className="fill-current" /> : <Play className="fill-current" />}
            </IconButton>
            <WaveformThumb candidateId={sound.id} fileHash={sound.fileHash} src={sound.src} progress={progress} className={stage ? 'h-14' : 'h-8'} />
            <div className="flex min-w-0 items-center gap-2 font-mono text-2xs text-muted-foreground">
              <span className="min-w-0 flex-1 truncate">{sound.name}</span>
              <span className="shrink-0">{formatSeconds(sound.duration)}</span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

/** Download link for one run's first sound (the stage's action column). */
export function DownloadSoundButton({ sound }: { sound: ImageRecordAudio }) {
  const { t } = useI18n()
  return (
    <IconButton asChild size="icon-sm" variant="secondary" label={t({ ko: '다운로드', en: 'Download' })}>
      <a href={`${sound.src}?download=1`} download>
        <Download />
      </a>
    </IconButton>
  )
}

/**
 * The sounds of a run that also made a picture: a compact player row per sound. `floating` sits over the picture in a
 * history tile; otherwise it runs under the picture on the result stage, with a waveform.
 */
export function HistorySoundBar({ sounds, floating = false }: { sounds: ImageRecordAudio[]; floating?: boolean }) {
  const { t } = useI18n()
  const player = useAudioPlayer()
  return (
    <div className={cn('flex flex-col gap-1', floating ? 'rounded-sm bg-backdrop/70 p-1 text-white backdrop-blur-sm' : 'w-full')} {...stopTile}>
      {sounds.map((sound) => {
        const playing = player.key === sound.id && player.playing
        const progress = player.key === sound.id && player.duration > 0 ? player.currentTime / player.duration : undefined
        return (
          <div key={sound.id} className="flex min-w-0 items-center gap-2">
            <IconButton
              variant={playing ? 'secondary' : 'ghost'}
              size="icon-xs"
              className="shrink-0 rounded-full"
              label={playing ? t({ ko: '정지', en: 'Pause' }) : t({ ko: '재생', en: 'Play' })}
              {...stopTile}
              onClick={(event) => { event.stopPropagation(); audioPlayer.toggle(sound.id, { src: sound.src }) }}
            >
              {playing ? <Pause className="fill-current" /> : <Play className="fill-current" />}
            </IconButton>
            {floating ? <AudioLines className="size-3.5 shrink-0 opacity-80" /> : null}
            <span className={cn('min-w-0 truncate font-mono text-2xs', floating ? 'flex-1' : 'w-40 shrink-0 text-muted-foreground')}>{sound.name}</span>
            {floating ? null : <WaveformThumb candidateId={sound.id} fileHash={sound.fileHash} src={sound.src} progress={progress} className="h-6 min-w-0 flex-1" />}
            <span className={cn('shrink-0 font-mono text-2xs', floating ? 'opacity-80' : 'text-muted-foreground')}>{formatSeconds(sound.duration)}</span>
          </div>
        )
      })}
    </div>
  )
}
