import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { buildApiUrl } from '@/lib/api-client'
import { requestJson } from '@/lib/api-request'
import { useI18n } from '@/i18n'

type Entry = { id: number; source: 'audio' | 'workspace' | 'files'; label: string; available: boolean; candidateId?: string; projectId?: string; target?: string; fileId?: string }
export function GroupLinkedResources({ groupId }: { groupId: number }) {
  const { t } = useI18n()
  const navigate = useNavigate()
  const [offset, setOffset] = useState(0)
  const [playing, setPlaying] = useState<number | null>(null)
  const query = useQuery({ queryKey: ['group-linked-resources', groupId, offset], queryFn: async () => (await requestJson<{ data: { entries: Entry[]; nextOffset: number | null } }>(`/api/groups/${groupId}/resources?offset=${offset}`)).data })
  if (query.isPending) return null
  if (query.isError) return <p role="status">{t({ ko: '연결 자료를 불러오지 못했어.', en: 'Could not load linked resources.' })} <Button variant="ghost" onClick={() => void query.refetch()}>{t({ ko: '다시 시도', en: 'Retry' })}</Button></p>
  if (!query.data.entries.length && offset === 0 && query.data.nextOffset === null) return null
  return <section className="space-y-2 py-3" aria-label={t({ ko: '연결 자료', en: 'Linked resources' })}>
    <h3 className="text-sm font-medium">{t({ ko: '오디오 · 작업 문서', en: 'Audio · Work documents' })}</h3>
    {query.data.entries.map(entry => <div key={entry.id} className="flex flex-wrap items-center gap-3 border-b border-line py-2">
      <span className="min-w-0 flex-1 truncate">{entry.label}</span>
      {!entry.available ? <span className="text-sm text-muted-foreground">{t({ ko: '원본 없음 · 접근 불가', en: 'Missing or unavailable' })}</span> : entry.source === 'audio' ? <>
        <Button variant="ghost" onClick={() => setPlaying(playing === entry.id ? null : entry.id)}>{t({ ko: playing === entry.id ? '닫기' : '재생', en: playing === entry.id ? 'Close' : 'Play' })}</Button>
        {playing === entry.id && <audio controls autoPlay preload="metadata" src={buildApiUrl(`/api/audio/candidates/${entry.candidateId}/file`)} />}
      </> : <Button variant="ghost" onClick={() => navigate(entry.source === 'workspace' ? `/files?view=workspaces&workspace=${entry.projectId}&dir=${encodeURIComponent(entry.target?.split('/').slice(0, -1).join('/') ?? '')}` : '/files')}>{t({ ko: '파일함에서 열기', en: 'Open in files' })}</Button>}
    </div>)}
    <div className="flex gap-2"><Button variant="ghost" disabled={offset === 0} onClick={() => { setPlaying(null); setOffset(Math.max(0, offset - 30)) }}>{t({ ko: '이전', en: 'Previous' })}</Button><Button variant="ghost" disabled={query.data.nextOffset === null} onClick={() => { setPlaying(null); setOffset(query.data.nextOffset ?? 0) }}>{t({ ko: '다음', en: 'Next' })}</Button></div>
  </section>
}
