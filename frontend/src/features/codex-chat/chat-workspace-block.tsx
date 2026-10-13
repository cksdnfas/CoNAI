import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { useAuthStatusQuery } from '@/features/auth/use-auth-status-query'
import { useI18n } from '@/i18n'
import { getChatWorkspace, listWorkspaces, setChatWorkspace } from '@/lib/api-workspaces'
import { getErrorMessage } from '@/lib/error-message'

export function ChatWorkspaceBlock({ threadId }: { threadId: number }) {
  const { t } = useI18n()
  const auth = useAuthStatusQuery()
  const canRead = auth.data?.permissionKeys?.includes('files.view') === true
  const canWrite = auth.data?.permissionKeys?.includes('files.edit') === true
  const account = auth.data?.accountId ?? 'bootstrap'
  const [offset, setOffset] = useState(0)
  const client = useQueryClient()
  const navigate = useNavigate()
  const key = ['workspace-binding', account, threadId]
  const binding = useQuery({ queryKey: key, queryFn: () => getChatWorkspace(threadId), enabled: canRead })
  const projects = useQuery({ queryKey: ['workspaces', 'list', account, offset], queryFn: () => listWorkspaces(offset), enabled: canRead })
  const mutation = useMutation({ mutationFn: ({ projectId, write }: { projectId: string | null; write: boolean }) => setChatWorkspace(threadId, projectId, write), onSuccess: () => client.invalidateQueries({ queryKey: key }) })
  if (!canRead) return null
  const selected = binding.data
  return <div className="flex flex-col gap-2 border-b border-line py-3">
    <div className="flex items-center justify-between gap-2"><span className="text-sm">{t({ ko: '작업 공간', en: 'Project workspace' })}</span><Button variant="ghost" size="sm" onClick={() => navigate(selected ? `/files?view=workspaces&workspace=${selected.project.id}` : '/files?view=workspaces')}>{t({ ko: '열기', en: 'Open' })}</Button></div>
    <Select aria-label={t({ ko: '연결할 프로젝트', en: 'Connected project' })} value={selected?.project.id ?? ''} disabled={mutation.isPending || binding.isPending} onChange={event => mutation.mutate({ projectId: event.target.value || null, write: false })}>
      <option value="">{t({ ko: '연결 안 함', en: 'No project' })}</option>
      {selected && !projects.data?.some(project => project.id === selected.project.id) ? <option value={selected.project.id}>{selected.project.name}</option> : null}
      {projects.data?.slice(0, 50).map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
    </Select>
    {(offset > 0 || (projects.data?.length ?? 0) > 50) ? <div className="flex gap-2"><Button variant="ghost" size="sm" disabled={!offset} onClick={() => setOffset(Math.max(0, offset - 50))}>{t({ ko: '이전', en: 'Previous' })}</Button><Button variant="ghost" size="sm" disabled={(projects.data?.length ?? 0) <= 50} onClick={() => setOffset(offset + 50)}>{t({ ko: '다음', en: 'Next' })}</Button></div> : null}
    {selected ? <Button variant={selected.write ? 'secondary' : 'ghost'} size="sm" disabled={!canWrite || mutation.isPending} onClick={() => mutation.mutate({ projectId: selected.project.id, write: !selected.write })}>{selected.write ? t({ ko: '읽기·쓰기 허용됨 · 읽기만으로 변경', en: 'Read/write enabled · switch to read-only' }) : t({ ko: '읽기 전용 · 쓰기 허용', en: 'Read-only · allow writing' })}</Button> : null}
    <p className="text-xs text-muted-foreground">{t({ ko: '선택한 프로젝트의 지침과 파일을 이 채팅에서 사용해. 셸은 실행하지 않아.', en: 'Use this project’s guidelines and files in this chat. Shell execution is unavailable.' })}</p>
    {mutation.error || binding.error || projects.error ? <p role="alert" className="text-sm text-destructive">{getErrorMessage(mutation.error ?? binding.error ?? projects.error, t({ ko: '프로젝트 연결 실패', en: 'Project connection failed' }))}</p> : null}
  </div>
}
