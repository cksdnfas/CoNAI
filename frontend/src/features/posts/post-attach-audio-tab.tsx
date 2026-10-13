import { useState, type Dispatch, type SetStateAction } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Pause, Play } from 'lucide-react'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { IconButton } from '@/components/ui/icon-button'
import { ListRow } from '@/components/ui/list-row'
import { Spinner } from '@/components/ui/loading-state'
import { Select } from '@/components/ui/select'
import { audioPlayer, useAudioPlayer } from '@/features/audio/audio-player'
import { useI18n } from '@/i18n'
import { listAudioCandidates, listAudioGroups, listAudioProjects } from '@/lib/api-audio'
import { AttachToolbar, attachKey, type AttachItem } from './post-attach-shared'

function formatDuration(seconds: number | null | undefined) {
  if (!seconds || !Number.isFinite(seconds)) return ''
  const total = Math.round(seconds)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

/** Audio takes: project, then sound (audio group), then its takes. */
export function AttachAudioTab({ selected, setSelected }: { selected: AttachItem[]; setSelected: Dispatch<SetStateAction<AttachItem[]>> }) {
  const { t } = useI18n()
  const player = useAudioPlayer()
  const projects = useQuery({ queryKey: ['post-picker', 'audio-projects'], queryFn: listAudioProjects })
  const [projectId, setProjectId] = useState<string | null>(null)
  const project = projectId ?? projects.data?.[0]?.id ?? null
  const groups = useQuery({ queryKey: ['post-picker', 'audio-groups', project], queryFn: () => listAudioGroups(project as string), enabled: project !== null })
  const [groupId, setGroupId] = useState<string | null>(null)
  const group = groupId && groups.data?.some((item) => item.id === groupId) ? groupId : groups.data?.[0]?.id ?? null
  const takes = useQuery({ queryKey: ['post-picker', 'audio-takes', group], queryFn: () => listAudioCandidates(group as string, { limit: 200 }), enabled: group !== null })
  const orderByKey = new Map(selected.map((item, index) => [item.key, index + 1]))
  const toggle = (id: string, name: string) => setSelected((current) => current.some((item) => item.key === attachKey.audio(id))
    ? current.filter((item) => item.key !== attachKey.audio(id))
    : [...current, { kind: 'audio', key: attachKey.audio(id), id, name }])

  return (
    <div className="-mx-4 flex min-h-0 flex-1 flex-col border-y border-line md:-mx-5">
      <AttachToolbar>
        <Select className="min-w-40 flex-1" aria-label={t({ ko: '프로젝트', en: 'Project' })} value={project ?? ''} onChange={(event) => { setProjectId(event.target.value); setGroupId(null) }}>
          {(projects.data ?? []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </Select>
        <Select className="min-w-40 flex-1" aria-label={t({ ko: '효과음', en: 'Sound' })} value={group ?? ''} onChange={(event) => setGroupId(event.target.value)}>
          {(groups.data ?? []).map((item) => <option key={item.id} value={item.id}>{item.is_inbox ? t({ ko: '받은 소리', en: 'Inbox' }) : item.label ?? item.name}</option>)}
        </Select>
      </AttachToolbar>
      <div className="min-h-0 flex-1 overflow-y-auto border-t border-line">
        {projects.isPending || takes.isFetching && !takes.data ? <div className="flex justify-center py-8"><Spinner label={t({ ko: '불러오는 중', en: 'Loading' })} /></div> : null}
        {(takes.data?.items ?? []).map((take) => {
          const position = orderByKey.get(attachKey.audio(take.id))
          const playing = player.key === take.id && player.playing
          return (
            <ListRow key={take.id} selected={Boolean(position)} className="gap-2 px-3"
              leading={<IconButton size="icon-sm" variant="ghost" label={playing ? t({ ko: '일시정지', en: 'Pause' }) : t({ ko: '재생', en: 'Play' })} onClick={() => audioPlayer.toggle(take.id)}>{playing ? <Pause /> : <Play />}</IconButton>}
              trailing={<span className="flex items-center gap-3"><span className="text-xs tabular-nums text-muted-foreground">{formatDuration(take.file?.duration)}</span><Checkbox className="mx-1" checked={Boolean(position)} onCheckedChange={() => toggle(take.id, take.name)} aria-label={take.name} /></span>}>
              <Button variant="ghost" size="sm" className="w-full min-w-0 justify-start truncate font-normal" onClick={() => toggle(take.id, take.name)}>{take.name}</Button>
            </ListRow>
          )
        })}
        {takes.data && takes.data.items.length === 0 ? <EmptyState title={t({ ko: '테이크가 없어', en: 'No takes' })} /> : null}
      </div>
    </div>
  )
}
