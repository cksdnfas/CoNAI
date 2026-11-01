import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { FolderKanban, Plus, RotateCcw, Unlink, X } from 'lucide-react'
import { MAX_WORKSPACE_LINKS, type WorkspaceBinding, type WorkspaceChatMode } from '@conai/shared'
import { IconButton } from '@/components/ui/icon-button'
import { Switch } from '@/components/ui/switch'
import { useAuthStatusQuery } from '@/features/auth/use-auth-status-query'
import { WorkspaceProjectPicker } from '@/features/files/workspace-projects'
import { useI18n } from '@/i18n'
import { getChatWorkspaces, setChatWorkspace } from '@/lib/api-workspaces'
import { getErrorMessage } from '@/lib/error-message'
import { cn } from '@/lib/utils'

/**
 * The projects this chat works in. Its profile brings its own (tagged 프로필); this chat can add more, change the access
 * to one, turn a profile's off, or take its own change back. A group chat's projects are shared by every member, and
 * each member also works in its own profile's.
 */
export function ChatWorkspaceBlock({ threadId, group = false }: { threadId: number; group?: boolean }) {
  const { t } = useI18n()
  const auth = useAuthStatusQuery()
  const canRead = auth.data?.permissionKeys?.includes('files.view') === true
  const canWrite = auth.data?.permissionKeys?.includes('files.edit') === true
  const account = auth.data?.accountId ?? 'bootstrap'
  const [picking, setPicking] = useState(false)
  const client = useQueryClient()
  const key = ['workspace-binding', account, threadId]
  const bindings = useQuery({ queryKey: key, queryFn: () => getChatWorkspaces(threadId), enabled: canRead })
  const mutation = useMutation({ mutationFn: ({ projectId, mode }: { projectId: string; mode: WorkspaceChatMode | null }) => setChatWorkspace(threadId, projectId, mode), onSuccess: (next) => client.setQueryData(key, next) })
  if (!canRead) return null
  const items = bindings.data ?? []
  const busy = mutation.isPending || bindings.isPending
  const chosen = items.filter((item) => item.source === 'chat' && !item.off).length
  const row = (item: WorkspaceBinding) => (
    <div key={item.project.id} className={cn('flex min-h-8 items-center gap-2 text-sm', item.off && 'opacity-60')}>
      <FolderKanban className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <Link to={`/files?view=workspaces&workspace=${item.project.id}`} className={cn('min-w-0 flex-1 truncate hover:underline', item.off && 'line-through')} title={t({ ko: '작업 공간 열기', en: 'Open workspace' })}>{item.project.name}</Link>
      {item.source === 'profile' ? <span className="shrink-0 text-2xs font-bold tracking-wide text-muted-foreground">{t({ ko: '프로필', en: 'Profile' })}</span> : null}
      {item.off ? (
        <IconButton variant="ghost" size="icon-sm" disabled={busy} onClick={() => mutation.mutate({ projectId: item.project.id, mode: null })} label={t({ ko: '다시 켜기 (프로필 기본으로)', en: 'Turn back on (the profile’s)' })}><RotateCcw /></IconButton>
      ) : (
        <>
          <Switch size="sm" checked={item.write} disabled={!canWrite || busy} onCheckedChange={(write) => mutation.mutate({ projectId: item.project.id, mode: write ? 'write' : 'read' })} aria-label={t({ ko: '{name} 쓰기 허용', en: 'Allow writing in {name}' }, { name: item.project.name })} />
          {item.source === 'profile'
            ? <IconButton variant="ghost" size="icon-sm" disabled={busy} onClick={() => mutation.mutate({ projectId: item.project.id, mode: 'off' })} label={t({ ko: '이 채팅에서 끄기', en: 'Turn off in this chat' })}><X /></IconButton>
            : <IconButton variant="ghost" size="icon-sm" disabled={busy} onClick={() => mutation.mutate({ projectId: item.project.id, mode: null })} label={t({ ko: '이 채팅의 연결 지우기', en: 'Remove this chat’s link' })}><Unlink /></IconButton>}
        </>
      )}
    </div>
  )
  return <div className="flex flex-col gap-0.5 border-b border-line pb-2.5">
    <div className="flex min-h-8 items-center justify-between gap-2">
      <span className="flex min-w-0 items-center gap-2 text-sm">
        <span className="shrink-0">{t({ ko: '작업 공간', en: 'Workspaces' })}</span>
        {items.length === 0 && !bindings.isPending ? <span className="truncate text-muted-foreground">{group ? t({ ko: '연결 안 함 · 멤버별 프로필 기본', en: 'None · each member’s profile default' }) : t({ ko: '연결 안 함', en: 'Not connected' })}</span> : null}
      </span>
      <IconButton variant="ghost" size="icon-sm" disabled={busy || chosen >= MAX_WORKSPACE_LINKS} onClick={() => setPicking(true)} label={t({ ko: '작업 공간 추가', en: 'Add a workspace' })}><Plus /></IconButton>
    </div>
    {items.map(row)}
    {mutation.error || bindings.error ? <p role="alert" className="text-sm text-destructive">{getErrorMessage(mutation.error ?? bindings.error, t({ ko: '프로젝트 연결 실패', en: 'Project connection failed' }))}</p> : null}
    <WorkspaceProjectPicker
      open={picking}
      onClose={() => setPicking(false)}
      title={t({ ko: '작업 공간 추가', en: 'Add a workspace' })}
      projectId={null}
      noneLabel={null}
      exclude={new Set(items.map((item) => item.project.id))}
      write={false}
      writeLabel={canWrite ? t({ ko: '쓰기 허용', en: 'Allow writing' }) : null}
      busy={mutation.isPending}
      onConnect={(projectId, write) => { if (projectId) mutation.mutate({ projectId, mode: write ? 'write' : 'read' }, { onSettled: () => setPicking(false) }) }}
    />
  </div>
}
