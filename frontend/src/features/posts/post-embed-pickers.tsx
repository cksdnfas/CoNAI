import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { FolderTree, Pause, Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal'
import { Select } from '@/components/ui/select'
import { audioPlayer, useAudioPlayer } from '@/features/audio/audio-player'
import { useI18n } from '@/i18n'
import { listAudioCandidates, listAudioGroups, listAudioProjects, type AudioCandidate } from '@/lib/api-audio'
import { getGroupsHierarchyAll } from '@/lib/api-groups'
import { cn } from '@/lib/utils'

/** Pick audio takes: project, then sound (audio group), then its takes. */
export function AudioEmbedPicker({ onPick, onClose }: { onPick: (takes: AudioCandidate[]) => void; onClose: () => void }) {
  const { t } = useI18n()
  const player = useAudioPlayer()
  const projects = useQuery({ queryKey: ['post-picker', 'audio-projects'], queryFn: listAudioProjects })
  const [projectId, setProjectId] = useState<string | null>(null)
  const project = projectId ?? projects.data?.[0]?.id ?? null
  const groups = useQuery({ queryKey: ['post-picker', 'audio-groups', project], queryFn: () => listAudioGroups(project as string), enabled: project !== null })
  const [groupId, setGroupId] = useState<string | null>(null)
  const group = groupId && groups.data?.some((item) => item.id === groupId) ? groupId : groups.data?.[0]?.id ?? null
  const takes = useQuery({ queryKey: ['post-picker', 'audio-takes', group], queryFn: () => listAudioCandidates(group as string, { limit: 200 }), enabled: group !== null })
  const [chosen, setChosen] = useState<AudioCandidate[]>([])
  const toggle = (take: AudioCandidate) => setChosen((current) => current.some((item) => item.id === take.id) ? current.filter((item) => item.id !== take.id) : [...current, take])

  return (
    <Modal open title={t({ ko: '오디오 넣기', en: 'Insert audio' })} onClose={onClose} widthClassName="max-w-xl">
      <ModalBody className="space-y-3">
        <div className="grid gap-2 sm:grid-cols-2">
          <Select variant="settings" aria-label={t({ ko: '프로젝트', en: 'Project' })} value={project ?? ''} onChange={(event) => { setProjectId(event.target.value); setGroupId(null) }}>
            {(projects.data ?? []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </Select>
          <Select variant="settings" aria-label={t({ ko: '효과음', en: 'Sound' })} value={group ?? ''} onChange={(event) => setGroupId(event.target.value)}>
            {(groups.data ?? []).map((item) => <option key={item.id} value={item.id}>{item.is_inbox ? t({ ko: '받은 소리', en: 'Inbox' }) : item.label ?? item.name}</option>)}
          </Select>
        </div>
        <div className="max-h-80 divide-y divide-line overflow-y-auto border-y border-line">
          {(takes.data?.items ?? []).map((take) => {
            const selected = chosen.some((item) => item.id === take.id)
            const playing = player.key === take.id && player.playing
            return (
              <div key={take.id} className={cn('flex items-center gap-2 py-1.5', selected && 'bg-primary/10')}>
                <IconButton size="icon-sm" variant="ghost" label={playing ? t({ ko: '일시정지', en: 'Pause' }) : t({ ko: '재생', en: 'Play' })} onClick={() => audioPlayer.toggle(take.id)}>
                  {playing ? <Pause /> : <Play />}
                </IconButton>
                <Button variant="ghost" size="sm" className="min-w-0 flex-1 justify-start truncate font-normal" onClick={() => toggle(take)}>{take.name}</Button>
                <Checkbox className="mr-2" checked={selected} onCheckedChange={() => toggle(take)} aria-label={take.name} />
              </div>
            )
          })}
          {takes.data && takes.data.items.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">{t({ ko: '테이크가 없어', en: 'No takes' })}</p> : null}
        </div>
      </ModalBody>
      <ModalFooter>
        <span className="flex-1" />
        <Button disabled={chosen.length === 0} onClick={() => onPick(chosen)}>{t({ ko: '{count}개 넣기', en: 'Insert {count}' }, { count: chosen.length })}</Button>
      </ModalFooter>
    </Modal>
  )
}

/** Pick one image group (shown in the post as its gallery). */
export function GroupEmbedPicker({ onPick, onClose }: { onPick: (group: { id: number; name: string }) => void; onClose: () => void }) {
  const { t } = useI18n()
  const [filter, setFilter] = useState('')
  const query = useQuery({ queryKey: ['groups-hierarchy-all', 'post-picker'], queryFn: getGroupsHierarchyAll, staleTime: 30_000 })
  const groups = useMemo(() => {
    const entries = query.data ?? []
    const byId = new Map(entries.map((group) => [group.id, group]))
    return entries.map((group) => {
      const names = [group.name]
      const seen = new Set([group.id])
      let parent = group.parent_id ? byId.get(group.parent_id) : undefined
      while (parent && !seen.has(parent.id)) { names.unshift(parent.name); seen.add(parent.id); parent = parent.parent_id ? byId.get(parent.parent_id) : undefined }
      return { id: group.id, name: group.name, path: names.join(' / '), count: group.total_visible_image_count ?? group.visible_image_count ?? null }
    }).sort((left, right) => left.path.localeCompare(right.path))
  }, [query.data])
  const visible = groups.filter((group) => !filter.trim() || group.path.toLowerCase().includes(filter.trim().toLowerCase()))
  return (
    <Modal open title={t({ ko: '그룹 넣기', en: 'Insert group' })} onClose={onClose} widthClassName="max-w-lg">
      <ModalBody className="space-y-3">
        <Input variant="settings" autoFocus value={filter} onChange={(event) => setFilter(event.target.value)} aria-label={t({ ko: '그룹 찾기', en: 'Find group' })} />
        <div className="max-h-96 overflow-y-auto">
          {visible.map((group) => (
            <Button key={group.id} variant="ghost" className="w-full justify-start" onClick={() => onPick(group)}>
              <FolderTree className="text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate text-left">{group.path}</span>
              {group.count !== null ? <span className="text-xs tabular-nums text-muted-foreground">{group.count}</span> : null}
            </Button>
          ))}
        </div>
      </ModalBody>
    </Modal>
  )
}
