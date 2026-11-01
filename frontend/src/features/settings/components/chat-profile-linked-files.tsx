import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { FileText, Folder, FolderPlus } from 'lucide-react'
import { IconButton } from '@/components/ui/icon-button'
import { Chip, ChipAction } from '@/components/ui/chip'
import { EditorGroup } from '@/components/ui/editor-group'
import { Tip } from '@/components/ui/tooltip'
import { FilePicker } from '@/features/files/file-browser'
import { useI18n } from '@/i18n'
import { describeLinkedFiles, type LinkedFileLink } from '@/lib/api-codex-chat'
import { cn } from '@/lib/utils'
import { LINKABLE_IMAGE_EXTENSIONS, LOREBOOK_ROOT_FOLDER, type StoredFileEntry } from '@conai/shared'
import { TEXT_EXTENSIONS } from './chat-profile-lorebook'

const MAX_LINKS = 20
/** What a link can name besides folders (the server refuses the rest): text, PDF, XLSX and images. */
const LINKABLE_EXTENSIONS = [...TEXT_EXTENSIONS, '.pdf', '.xlsx', ...LINKABLE_IMAGE_EXTENSIONS]

/** The lorebook folder at the top of the store: the server refuses links into it (writing there would skip the lore flow). */
const isLorebookRoot = (entry: StoredFileEntry) => entry.kind === 'folder' && entry.parentId === null && entry.name === LOREBOOK_ROOT_FOLDER

/** The file store picker for links: folders and the files a link can name are ticked together; other files are dimmed. */
export function LinkFilePicker({ onPick, onClose }: { onPick: (ids: string[]) => void; onClose: () => void }) {
  const { t } = useI18n()
  return (
    <FilePicker
      title={t({ ko: '폴더·파일 연결', en: 'Link folders and files' })}
      accept={LINKABLE_EXTENSIONS}
      refuse={isLorebookRoot}
      refuseReason={t({ ko: '로어북 폴더는 연결할 수 없어', en: 'The lorebook folder cannot be linked' })}
      pickFolders
      pickLabel={(count) => (count > 0 ? t({ ko: '{count}개 연결', en: 'Link {count}' }, { count }) : t({ ko: '연결', en: 'Link' }))}
      onPick={(entries) => onPick(entries.map((entry) => entry.id))}
      onClose={onClose}
    />
  )
}

/**
 * A profile's linked files: folders and text, image, PDF and XLSX files of your file store its characters may open in any chat of yours
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
    <EditorGroup
      label={t({ ko: '연결 파일', en: 'Linked files' })}
      info={t({ ko: '폴더, 텍스트·이미지·PDF·XLSX 파일. 캐릭터가 필요할 때 찾아 열어 봐.', en: 'Folders, or text, image, PDF and XLSX files the character opens when it needs them.' })}
      actions={<IconButton variant="subtle" size="icon-sm" label={t({ ko: '폴더·파일 연결', en: 'Link folders and files' })} disabled={value.length >= MAX_LINKS} onClick={() => setPicking(true)}><FolderPlus /></IconButton>}
    >
      {value.length ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {value.map((link) => {
            const view = views.get(link.id)
            const Icon = view?.kind === 'file' ? FileText : Folder
            return (
              <Chip key={link.id} tone={view?.missing ? 'muted' : 'default'} removeLabel={t({ ko: '연결 해제', en: 'Unlink' })} onRemove={() => onChange(value.filter((item) => item.id !== link.id))}>
                <Icon className={cn('size-3.5', link.write ? 'text-primary-text' : 'text-muted-foreground')} aria-hidden />
                <Tip content={view?.path ?? undefined}><span className={cn('max-w-48 truncate', view?.missing && 'line-through')}>{view?.name ?? '…'}</span></Tip>
                <ChipAction
                  onClick={() => onChange(value.map((item) => (item.id === link.id ? { ...item, write: !item.write } : item)))}
                  aria-label={link.write ? t({ ko: '읽기 전용으로', en: 'Make read-only' }) : t({ ko: '쓰기 허용', en: 'Allow writing' })}
                  aria-pressed={link.write}
                >
                  {link.write ? t({ ko: '쓰기', en: 'Write' }) : t({ ko: '읽기', en: 'Read' })}
                </ChipAction>
              </Chip>
            )
          })}
        </div>
      ) : null}
      {picking ? <LinkFilePicker onPick={add} onClose={() => setPicking(false)} /> : null}
    </EditorGroup>
  )
}
