import { useState } from 'react'
import { FileText, FolderTree, Music, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Modal, ModalFooter } from '@/components/ui/modal'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tip } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import { buildApiUrl } from '@/lib/api-url'
import { storedFileThumbnailUrl } from '@/lib/api-files'
import { cn } from '@/lib/utils'
import { AttachAudioTab } from './post-attach-audio-tab'
import { AttachFilesTab } from './post-attach-files-tab'
import { AttachMediaTab } from './post-attach-media-tab'
import { AttachPostsTab, coverSrc } from './post-attach-posts-tab'
import { ExtensionTile, attachMarkdown, type AttachItem, type AttachTab, type PostInsertStyle } from './post-attach-shared'
import { usePostPermissions } from './use-post-permissions'

export type { AttachTab } from './post-attach-shared'

const TAB_TRIGGER = 'relative flex-none rounded-none bg-transparent px-0 pb-2 pt-1 text-base font-semibold text-muted-foreground shadow-none hover:bg-transparent hover:text-foreground data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:bg-primary after:opacity-0 data-[state=active]:after:opacity-100'

/** One small square in the tray: what was picked, in order; a click takes it back out. */
function TrayThumb({ item, position, onRemove }: { item: AttachItem; position: number; onRemove: () => void }) {
  const { t } = useI18n()
  const [failed, setFailed] = useState(false)
  const label = item.kind === 'media' ? t({ ko: '미디어', en: 'Media' }) : item.kind === 'post' ? item.title : item.name
  let body
  if (item.kind === 'media' && !failed) {
    body = item.mimeType?.startsWith('video/')
      ? <video src={buildApiUrl(`/api/images/${item.hash}/file`)} preload="metadata" muted playsInline className="size-full object-cover" />
      : <img src={buildApiUrl(`/api/images/${item.hash}/thumbnail`)} alt="" onError={() => setFailed(true)} className="size-full object-cover" />
  } else if (item.kind === 'group') body = failed ? <FolderTree className="size-4" /> : <img src={buildApiUrl(`/api/groups/${item.id}/thumbnail`)} alt="" onError={() => setFailed(true)} className="size-full object-cover" />
  else if (item.kind === 'post') body = item.cover && !failed ? <img src={coverSrc(item.cover)} alt="" onError={() => setFailed(true)} className="size-full object-cover" /> : <FileText className="size-4" />
  else if (item.kind === 'file') body = item.mimeType?.startsWith('image/') && !failed ? <img src={storedFileThumbnailUrl(item.id)} alt="" onError={() => setFailed(true)} className="size-full object-cover" /> : <ExtensionTile name={item.name} className="size-full" />
  else if (item.kind === 'audio') body = <Music className="size-4" />
  else body = <FileText className="size-4" />
  return (
    <Tip content={t({ ko: '{name} 빼기', en: 'Remove {name}' }, { name: label })}>
      <Button variant="ghost" onClick={onRemove} aria-label={t({ ko: '{name} 빼기', en: 'Remove {name}' }, { name: label })}
        className="relative size-10 shrink-0 rounded-sm bg-surface-high p-0 text-muted-foreground has-[>svg]:px-0">
        <span className="flex size-full items-center justify-center overflow-hidden rounded-sm">{body}</span>
        <span className="absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full bg-primary text-2xs font-bold leading-none text-primary-foreground tabular-nums">{position}</span>
        {item.kind === 'group' && !failed ? <FolderTree className="absolute bottom-0.5 left-0.5 size-3 text-white drop-shadow" /> : null}
      </Button>
    </Tip>
  )
}

/**
 * Everything the app can put into a post, in one dialog: library media (or whole groups), audio takes, other posts
 * (as a card or a link) and store files. Picks from every tab go in together, in the order they were picked.
 */
export function PostAttachPicker({ initialTab, onClose, onInsert }: { initialTab: AttachTab; onClose: () => void; onInsert: (lines: string[]) => void }) {
  const { t } = useI18n()
  const { canViewImages, canViewAudio, canUseFiles } = usePostPermissions()
  const tabs = ([
    canViewImages ? { value: 'media', label: t({ ko: '미디어', en: 'Media' }) } : null,
    canViewAudio ? { value: 'audio', label: t({ ko: '오디오', en: 'Audio' }) } : null,
    { value: 'post', label: t({ ko: '게시물', en: 'Posts' }) },
    canUseFiles ? { value: 'file', label: t({ ko: '파일', en: 'Files' }) } : null,
  ] as const).filter((item): item is NonNullable<typeof item> => item !== null)
  const [tab, setTab] = useState<AttachTab>(tabs.some((item) => item.value === initialTab) ? initialTab : 'post')
  const [selected, setSelected] = useState<AttachItem[]>([])
  const [postStyle, setPostStyle] = useState<PostInsertStyle>('card')

  return (
    <Modal
      open
      onClose={onClose}
      widthClassName="max-w-5xl"
      height="tall"
      title={<span className="sr-only">{t({ ko: '앱 자료 넣기', en: 'Insert from the app' })}</span>}
      headerActions={(
        <Tabs value={tab} onValueChange={(value) => setTab(value as AttachTab)} className="order-first min-w-0 flex-1 gap-0">
          <TabsList aria-label={t({ ko: '넣을 자료', en: 'What to insert' })} className="h-auto gap-5 rounded-none bg-transparent p-0">
            {tabs.map((item) => <TabsTrigger key={item.value} value={item.value} className={TAB_TRIGGER}>{item.label}</TabsTrigger>)}
          </TabsList>
        </Tabs>
      )}
    >
      {tab === 'media' ? <AttachMediaTab selected={selected} setSelected={setSelected} />
        : tab === 'audio' ? <AttachAudioTab selected={selected} setSelected={setSelected} />
        : tab === 'file' ? <AttachFilesTab selected={selected} setSelected={setSelected} />
        : <AttachPostsTab selected={selected} setSelected={setSelected} postStyle={postStyle} onPostStyleChange={setPostStyle} />}
      <ModalFooter className="flex-nowrap justify-start gap-3 pt-3">
        <div className={cn('flex min-w-0 flex-1 items-center gap-2.5 overflow-x-auto py-1 pr-1', !selected.length && 'hidden')}>
          {selected.map((item, index) => <TrayThumb key={item.key} item={item} position={index + 1} onRemove={() => setSelected((current) => current.filter((entry) => entry.key !== item.key))} />)}
        </div>
        <span className={cn('shrink-0 text-sm tabular-nums text-muted-foreground', !selected.length && 'mr-auto')}>{t({ ko: '{count}개', en: '{count} picked' }, { count: selected.length })}</span>
        <IconButton variant="ghost" disabled={!selected.length} label={t({ ko: '선택 해제', en: 'Clear selection' })} onClick={() => setSelected([])}><X /></IconButton>
        <Button disabled={!selected.length} onClick={() => onInsert(selected.map((item) => attachMarkdown(item, postStyle)))}>{t({ ko: '넣기', en: 'Insert' })}</Button>
      </ModalFooter>
    </Modal>
  )
}
