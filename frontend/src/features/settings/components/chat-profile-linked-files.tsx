import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { FileText, Folder, FolderPlus, X } from 'lucide-react'
import { Chip } from '@/components/ui/chip'
import { IconButton } from '@/components/ui/icon-button'
import { Tip } from '@/components/ui/tooltip'
import { FilePicker } from '@/features/files/file-browser'
import { useI18n } from '@/i18n'
import { describeLinkedFiles, type LinkedFileLink } from '@/lib/api-codex-chat'
import { cn } from '@/lib/utils'
import { TEXT_EXTENSIONS } from './chat-profile-lorebook'

const MAX_LINKS = 20

/**
 * A profile's linked files: folders and text files of your file store its characters may open in any chat of yours
 * (chats of other accounts skip them). New links are read-only; the mode on a chip switches writing on and off.
 */
export function ChatProfileLinkedFiles({ value, onChange }: { value: LinkedFileLink[]; onChange: (links: LinkedFileLink[]) => void }) {
  const { t } = useI18n()
  const [picking, setPicking] = useState(false)
  const ids = value.map((link) => link.id).join(',')
  const query = useQuery({ queryKey: ['codex-chat-linked-files-describe', ids], queryFn: () => describeLinkedFiles(value), enabled: value.length > 0 })
  const views = new Map((query.data ?? []).map((view) => [view.id, view]))
  const add = (added: string[]) => {
    setPicking(false)
    const fresh = added.filter((id) => !value.some((link) => link.id === id)).map((id) => ({ id, write: false }))
    if (fresh.length) onChange([...value, ...fresh].slice(0, MAX_LINKS))
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {value.map((link) => {
        const view = views.get(link.id)
        const Icon = view?.kind === 'file' ? FileText : Folder
        return (
          <Chip key={link.id} className={cn('gap-1.5 pr-1', view?.missing && 'opacity-60')}>
            <Icon className={cn('size-3.5', link.write ? 'text-primary' : 'text-muted-foreground')} aria-hidden />
            <Tip content={view?.path ?? undefined}><span className={cn('max-w-48 truncate', view?.missing && 'line-through')}>{view?.name ?? '…'}</span></Tip>
            {/* eslint-disable-next-line no-restricted-syntax -- an inline mode switch inside the chip */}
            <button
              type="button"
              className={cn('rounded px-1 text-2xs font-bold', link.write ? 'bg-success/10 text-success' : 'bg-surface-high text-muted-foreground')}
              onClick={() => onChange(value.map((item) => (item.id === link.id ? { ...item, write: !item.write } : item)))}
              aria-label={link.write ? t({ ko: '읽기 전용으로', en: 'Make read-only' }) : t({ ko: '쓰기 허용', en: 'Allow writing' })}
            >
              {link.write ? t({ ko: '쓰기', en: 'Write' }) : t({ ko: '읽기', en: 'Read' })}
            </button>
            <IconButton variant="ghost" size="icon-xs" className="size-5" onClick={() => onChange(value.filter((item) => item.id !== link.id))} label={t({ ko: '연결 해제', en: 'Unlink' })}><X /></IconButton>
          </Chip>
        )
      })}
      <IconButton variant="ghost" size="icon-sm" disabled={value.length >= MAX_LINKS} onClick={() => setPicking(true)} label={t({ ko: '폴더·파일 연결', en: 'Link a folder or file' })}><FolderPlus /></IconButton>
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
