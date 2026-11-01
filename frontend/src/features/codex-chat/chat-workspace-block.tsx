import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { ExternalLink, FolderKanban, Link2, Unlink } from 'lucide-react'
import { IconButton } from '@/components/ui/icon-button'
import { SwitchLine } from '@/components/ui/switch-line'
import { useAuthStatusQuery } from '@/features/auth/use-auth-status-query'
import { WorkspaceProjectPicker } from '@/features/files/workspace-projects'
import { useI18n } from '@/i18n'
import { getChatWorkspace, setChatWorkspace } from '@/lib/api-workspaces'
import { getErrorMessage } from '@/lib/error-message'

/**
 * The project this chat works in: one line (change it, open it) and whether the chat may write there. It starts from
 * the profile's default workspace; picking another project here is this chat's own choice, and clearing it goes back
 * to the profile's. A group chat's choice is shared by every member; without one each member works in its own
 * profile's default.
 */
export function ChatWorkspaceBlock({ threadId, group = false }: { threadId: number; group?: boolean }) {
  const { t } = useI18n()
  const auth = useAuthStatusQuery()
  const canRead = auth.data?.permissionKeys?.includes('files.view') === true
  const canWrite = auth.data?.permissionKeys?.includes('files.edit') === true
  const account = auth.data?.accountId ?? 'bootstrap'
  const [picking, setPicking] = useState(false)
  const client = useQueryClient()
  const navigate = useNavigate()
  const key = ['workspace-binding', account, threadId]
  const binding = useQuery({ queryKey: key, queryFn: () => getChatWorkspace(threadId), enabled: canRead })
  const mutation = useMutation({ mutationFn: ({ projectId, write }: { projectId: string | null; write: boolean }) => setChatWorkspace(threadId, projectId, write), onSuccess: () => client.invalidateQueries({ queryKey: key }) })
  if (!canRead) return null
  const selected = binding.data
  const busy = mutation.isPending || binding.isPending
  return <div className="flex flex-col gap-0.5 border-b border-line pb-2.5">
    <div className="flex min-h-8 items-center justify-between gap-2">
      <span className="flex min-w-0 items-center gap-2 text-sm">
        <FolderKanban className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="shrink-0">{t({ ko: '작업 공간', en: 'Workspace' })}</span>
        <span className="truncate text-muted-foreground">{selected ? selected.project.name : group ? t({ ko: '고르지 않음 · 멤버별 프로필 기본', en: 'None · each member’s profile default' }) : t({ ko: '연결 안 함', en: 'Not connected' })}</span>
        {selected?.source === 'profile' ? <span className="shrink-0 text-2xs font-bold tracking-wide text-muted-foreground">{t({ ko: '프로필', en: 'Profile' })}</span> : null}
      </span>
      <div className="flex items-center gap-0.5">
        {selected?.source === 'chat' ? <IconButton variant="ghost" size="icon-sm" disabled={busy} onClick={() => mutation.mutate({ projectId: null, write: false })} label={group ? t({ ko: '이 방의 선택 지우기 (멤버별 프로필 기본으로)', en: 'Clear this room’s choice (back to each member’s profile)' }) : t({ ko: '이 채팅의 선택 지우기 (프로필 기본으로)', en: 'Clear this chat’s choice (back to the profile’s)' })}><Unlink /></IconButton> : null}
        <IconButton variant="ghost" size="icon-sm" disabled={busy} onClick={() => setPicking(true)} label={t({ ko: '프로젝트 바꾸기', en: 'Change project' })}><Link2 /></IconButton>
        <IconButton variant="ghost" size="icon-sm" onClick={() => navigate(selected ? `/files?view=workspaces&workspace=${selected.project.id}` : '/files?view=workspaces')} label={t({ ko: '작업 공간 열기', en: 'Open workspace' })}><ExternalLink /></IconButton>
      </div>
    </div>
    {selected ? <SwitchLine label={t({ ko: '쓰기 허용', en: 'Allow writing' })} muted checked={selected.write} disabled={!canWrite || busy} onCheckedChange={(write) => mutation.mutate({ projectId: selected.project.id, write })} /> : null}
    {mutation.error || binding.error ? <p role="alert" className="text-sm text-destructive">{getErrorMessage(mutation.error ?? binding.error, t({ ko: '프로젝트 연결 실패', en: 'Project connection failed' }))}</p> : null}
    <WorkspaceProjectPicker
      open={picking}
      onClose={() => setPicking(false)}
      projectId={selected?.project.id ?? null}
      noneLabel={group ? t({ ko: '이 방은 고르지 않음 (멤버별 프로필 기본)', en: 'No choice for this room (each member’s profile default)' }) : t({ ko: '이 채팅은 고르지 않음 (프로필 기본)', en: 'No choice for this chat (profile default)' })}
      write={selected?.write ?? false}
      writeLabel={canWrite ? t({ ko: '쓰기 허용', en: 'Allow writing' }) : null}
      busy={mutation.isPending}
      onConnect={(projectId, write) => mutation.mutate({ projectId, write }, { onSettled: () => setPicking(false) })}
    />
  </div>
}
