import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { ChevronDown, ChevronRight, Ellipsis, FileText, Folder, FolderOpen, FolderPlus } from 'lucide-react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { IconButton } from '@/components/ui/icon-button'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { Tip } from '@/components/ui/tooltip'
import { FilePicker } from '@/features/files/file-browser'
import { TEXT_EXTENSIONS } from '@/features/settings/components/chat-profile-lorebook'
import { useI18n } from '@/i18n'
import { getThreadLinkedFiles, threadLinkedFilesQueryKey, updateCodexChatThreadContext, type LinkedFileLink, type LinkedFileView } from '@/lib/api-codex-chat'
import { formatFileSize, listStoredFiles } from '@/lib/api-files'
import { getErrorMessage } from '@/lib/error-message'
import { cn } from '@/lib/utils'

const MAX_LINKS = 20

/**
 * The context tab's linked files: folders and text files of the file store the chat's characters may open (and write
 * where a link allows it), then those the profile (a room: the members) brings. Requests carry only their names; the
 * characters open them with their own tools. New links start read-only; ⋯ allows writing.
 */
export function LinkedFilesBlock({ threadId }: { threadId: number }) {
  const { t } = useI18n()
  const { showSnackbar } = useSnackbar()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [picking, setPicking] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const query = useQuery({ queryKey: threadLinkedFilesQueryKey(threadId), queryFn: () => getThreadLinkedFiles(threadId) })
  const views = query.data ?? []
  const own = views.filter((view) => view.via === 'thread')
  const links: LinkedFileLink[] = own.map(({ id, write }) => ({ id, write }))

  const mutation = useMutation({
    mutationFn: (linkedFiles: LinkedFileLink[]) => updateCodexChatThreadContext(threadId, { linkedFiles }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: threadLinkedFilesQueryKey(threadId) }),
    onError: (error) => showSnackbar({ message: getErrorMessage(error, t({ ko: '연결하지 못했어.', en: 'Could not link.' })), tone: 'error' }),
  })
  const add = (ids: string[]) => {
    setPicking(false)
    const fresh = ids.filter((id) => !views.some((view) => view.id === id)).map((id) => ({ id, write: false }))
    if (fresh.length) mutation.mutate([...links, ...fresh].slice(0, MAX_LINKS))
  }
  const toggle = (id: string) => setExpanded((current) => {
    const next = new Set(current)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })
  const openInStore = (view: LinkedFileView) => {
    const folder = view.kind === 'folder' ? view.id : view.parentId
    navigate(folder ? `/files?folder=${encodeURIComponent(folder)}` : '/files')
  }

  return (
    <div className="flex flex-col gap-1.5 border-b border-line py-2.5">
      <div className="flex min-h-8 items-center justify-between gap-2">
        <span className="text-sm">{t({ ko: '연결 파일', en: 'Linked files' })}</span>
        <div className="flex items-center gap-0.5">
          <IconButton variant="ghost" size="icon-sm" disabled={mutation.isPending || own.length >= MAX_LINKS} onClick={() => setPicking(true)} label={t({ ko: '폴더·파일 연결', en: 'Link a folder or file' })}><FolderPlus /></IconButton>
          <IconButton variant="ghost" size="icon-sm" onClick={() => navigate('/files')} label={t({ ko: '파일 보관함 열기', en: 'Open the file store' })}><FolderOpen /></IconButton>
        </div>
      </div>
      {views.length > 0 ? (
        <div className="flex flex-col">
          {views.map((view) => (
            <div key={view.id} className="contents">
              <LinkRow
                view={view}
                open={expanded.has(view.id)}
                onToggle={() => toggle(view.id)}
                actions={view.via === 'thread' ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <IconButton variant="ghost" size="icon-xs" label={t({ ko: '더 보기', en: 'More' })}><Ellipsis /></IconButton>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {view.missing ? null : (
                        <DropdownMenuItem disabled={mutation.isPending} onSelect={() => mutation.mutate(links.map((link) => (link.id === view.id ? { ...link, write: !link.write } : link)))}>
                          {view.write ? t({ ko: '읽기 전용으로', en: 'Make read-only' }) : t({ ko: '쓰기 허용', en: 'Allow writing' })}
                        </DropdownMenuItem>
                      )}
                      {view.missing ? null : <DropdownMenuItem onSelect={() => openInStore(view)}>{t({ ko: '보관함에서 열기', en: 'Open in the file store' })}</DropdownMenuItem>}
                      {view.missing ? null : <DropdownMenuSeparator />}
                      <DropdownMenuItem disabled={mutation.isPending} onSelect={() => mutation.mutate(links.filter((link) => link.id !== view.id))}>{t({ ko: '연결 해제', en: 'Unlink' })}</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : undefined}
              />
              {view.kind === 'folder' && expanded.has(view.id) ? <FolderPeek folderId={view.id} /> : null}
            </div>
          ))}
        </div>
      ) : null}
      {picking ? (
        <FilePicker
          title={t({ ko: '파일 연결', en: 'Link files' })}
          accept={TEXT_EXTENSIONS}
          pickLabel={(count) => (count > 0 ? t({ ko: '{count}개 연결', en: 'Link {count}' }, { count }) : t({ ko: '파일 연결', en: 'Link files' }))}
          onPick={(entries) => add(entries.map((entry) => entry.id))}
          pickFolderLabel={t({ ko: '이 폴더 연결', en: 'Link this folder' })}
          onPickFolder={(folderId) => add([folderId])}
          onClose={() => setPicking(false)}
        />
      ) : null}
    </div>
  )
}

function LinkRow({ view, open, onToggle, actions }: { view: LinkedFileView; open: boolean; onToggle: () => void; actions?: React.ReactNode }) {
  const { t } = useI18n()
  const folder = view.kind === 'folder'
  const Chevron = open ? ChevronDown : ChevronRight
  const Icon = folder ? Folder : FileText
  const detail = folder ? String(view.count ?? 0) : view.size !== null ? formatFileSize(view.size) : ''
  return (
    <div className="flex min-h-9 items-center gap-1 border-t border-line first:border-t-0">
      {/* eslint-disable-next-line no-restricted-syntax -- a full-width disclosure row; Button would pad and centre it */}
      <button type="button" onClick={folder ? onToggle : undefined} aria-expanded={folder ? open : undefined} disabled={!folder} className="flex min-h-9 min-w-0 flex-1 items-center gap-2 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-default">
        <Chevron className={cn('size-3 shrink-0 text-muted-foreground', !folder && 'invisible')} aria-hidden />
        <Icon className={cn('size-3.5 shrink-0', view.write ? 'text-primary' : 'text-muted-foreground')} aria-hidden />
        <span className={cn('min-w-0 truncate font-semibold', view.missing && 'text-muted-foreground line-through')}>{view.name}</span>
        {view.path ? <span className="min-w-0 truncate text-xs text-muted-foreground/70">{view.path}</span> : null}
        <span className="flex-1" />
        {view.missing ? (
          <span className="shrink-0 text-2xs font-bold text-muted-foreground">{t({ ko: '없음', en: 'Missing' })}</span>
        ) : (
          <span className={cn('shrink-0 rounded px-1.5 text-2xs font-bold', view.write ? 'bg-success/10 text-success' : 'bg-surface-low text-muted-foreground')}>
            {view.write ? t({ ko: '쓰기', en: 'Write' }) : t({ ko: '읽기', en: 'Read' })}
          </span>
        )}
        {view.via === 'profile' ? (
          <Tip content={view.profiles.map((profile) => profile.name).join(', ') || undefined}>
            <span className="shrink-0 text-2xs font-bold tracking-wide text-muted-foreground">{t({ ko: '프로필', en: 'Profile' })}</span>
          </Tip>
        ) : null}
        <span className="shrink-0 font-mono text-xs text-muted-foreground">{detail}</span>
      </button>
      {actions}
    </div>
  )
}

/** A linked folder's first items, as the characters see them listed. */
function FolderPeek({ folderId }: { folderId: string }) {
  const { t } = useI18n()
  const query = useQuery({ queryKey: ['codex-chat-linked-folder', folderId], queryFn: () => listStoredFiles(folderId) })
  const entries = query.data?.entries ?? []
  const shown = entries.slice(0, 5)
  const more = (query.data?.total ?? 0) - shown.length
  return (
    <div className="flex flex-col pb-1">
      {shown.map((entry) => (
        <div key={entry.id} className="flex min-h-7 items-center gap-2 pl-[1.625rem] text-sm text-muted-foreground">
          {entry.kind === 'folder' ? <Folder className="size-3 shrink-0" aria-hidden /> : <FileText className="size-3 shrink-0" aria-hidden />}
          <span className="min-w-0 truncate text-foreground">{entry.name}{entry.kind === 'folder' ? '/' : ''}</span>
          <span className="ml-auto shrink-0 font-mono text-2xs">{entry.kind === 'file' ? formatFileSize(entry.size) : ''}</span>
        </div>
      ))}
      {more > 0 ? <div className="pl-[1.625rem] text-xs text-muted-foreground">{t({ ko: '외 {count}개', en: '{count} more' }, { count: more })}</div> : null}
      {query.isSuccess && entries.length === 0 ? <div className="pl-[1.625rem] text-xs text-muted-foreground">{t({ ko: '비어 있음', en: 'Empty' })}</div> : null}
    </div>
  )
}
