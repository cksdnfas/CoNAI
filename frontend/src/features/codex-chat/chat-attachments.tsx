import { useImagePermissions } from '@/features/auth/use-image-permissions'
import { useRef, useState, type ClipboardEvent, type DragEvent, type ReactElement, type RefObject } from 'react'
import { EyeOff, File, FolderOpen, Images, Paperclip, Upload, X } from 'lucide-react'
import type { StoredFileEntry } from '@conai/shared'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { IconButton } from '@/components/ui/icon-button'
import { Spinner } from '@/components/ui/loading-state'
import { Tip } from '@/components/ui/tooltip'
import { FilePicker } from '@/features/files/file-browser'
import { useAuthStatusQuery } from '@/features/auth/use-auth-status-query'
import { useI18n } from '@/i18n'
import { storedFileDownloadUrl } from '@/lib/api-files'
import { buildApiUrl } from '@/lib/api-url'
import { formatFileSize } from '@/lib/format-size'
import { isFromOwnDom } from '@/lib/portal-events'
import type { CodexChatApi } from './codex-chat-context'
import { ChatMediaAttachments, ChatMediaPicker } from './chat-media-picker'
import { ChatPostRefChip } from './chat-post-cards'

/** What 첨부 offers this account in this chat (upload, private stored files, references to app media) and the pickers it opens. */
export function useChatAttach(allowPrivateUploads: boolean) {
  const auth = useAuthStatusQuery()
  const input = useRef<HTMLInputElement>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [mediaPickerOpen, setMediaPickerOpen] = useState(false)
  const permissions = auth.data?.permissionKeys ?? []
  const canPickFiles = permissions.includes('files.view')
  const canPickMedia = useImagePermissions().canViewImages
  const canUpload = allowPrivateUploads && (permissions.includes('chat.use') || permissions.includes('chat.agent.use'))
  return { input, pickerOpen, setPickerOpen, mediaPickerOpen, setMediaPickerOpen, canUpload, canPickFiles, canPickMedia, available: canUpload || canPickFiles || canPickMedia }
}
export type ChatAttach = ReturnType<typeof useChatAttach>

/** The upload input and the two pickers. Mounted for as long as 첨부 is on offer, whichever key (or chip) opens its menu. */
export function ChatAttachDialogs({ chat, attach }: { chat: CodexChatApi; attach: ChatAttach }) {
  return (
    <>
      <input ref={attach.input} type="file" multiple className="hidden" onChange={(event) => { void chat.uploadAttachments(Array.from(event.target.files ?? [])); event.target.value = '' }} />
      {attach.pickerOpen ? <FilePicker onClose={() => attach.setPickerOpen(false)} onPick={(entries) => { chat.addAttachments(entries); attach.setPickerOpen(false) }} /> : null}
      {attach.mediaPickerOpen ? <ChatMediaPicker initial={chat.draftMediaAttachments} maxCount={20 - chat.draftAttachments.length} onClose={() => attach.setMediaPickerOpen(false)} onPick={(items) => { if (chat.setMediaAttachments(items)) attach.setMediaPickerOpen(false) }} /> : null}
    </>
  )
}

/**
 * The 첨부 menu under its trigger (the key, or the row of the + stack). `onPick` runs once an entry is chosen.
 * `returnFocusRef` is where focus goes when the menu closes, for a trigger that goes away with it (the stack's row).
 */
export function ChatAttachMenu({ attach, side = 'top', onPick, returnFocusRef, children }: { attach: ChatAttach; side?: 'top' | 'right'; onPick?: () => void; returnFocusRef?: RefObject<HTMLElement | null>; children: ReactElement }) {
  const { t } = useI18n()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent align="start" side={side} onCloseAutoFocus={returnFocusRef ? (event) => { event.preventDefault(); returnFocusRef.current?.focus() } : undefined}>
        {attach.canUpload ? <DropdownMenuItem onSelect={() => { attach.input.current?.click(); onPick?.() }}>
          <Upload />
          {t({ ko: '새 파일 올리기', en: 'Upload new files' })}
        </DropdownMenuItem> : null}
        {attach.canPickFiles ? <DropdownMenuItem onSelect={() => { attach.setPickerOpen(true); onPick?.() }}>
          <FolderOpen />
          {t({ ko: '보관함에서 고르기', en: 'Choose from files' })}
        </DropdownMenuItem> : null}
        {attach.canPickMedia ? <DropdownMenuItem onSelect={() => { attach.setMediaPickerOpen(true); onPick?.() }}>
          <Images />
          {t({ ko: '앱 미디어에서 고르기', en: 'Choose app media' })}
        </DropdownMenuItem> : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** The composer's 첨부 key. */
export function ChatAttachButton({ attach, disabled, buttonRef }: { attach: ChatAttach; disabled: boolean; buttonRef?: RefObject<HTMLButtonElement | null> }) {
  const { t } = useI18n()
  return (
    <ChatAttachMenu attach={attach}>
      <IconButton ref={buttonRef} variant="ghost" size="icon-sm" disabled={disabled} label={t({ ko: '첨부', en: 'Attach' })}><Paperclip /></IconButton>
    </ChatAttachMenu>
  )
}

/** Screenshots paste as a bare "image.png"; stamp them with the time so several in one message stay apart. */
function nameCapture(file: File, index: number, count: number) {
  if (!/^image\.\w+$/i.test(file.name)) return file
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  return new globalThis.File([file], `capture-${stamp}${count > 1 ? `-${index + 1}` : ''}.${file.name.split('.').pop()}`, { type: file.type, lastModified: file.lastModified })
}

/**
 * Ctrl+V and drag-and-drop into the composer: files take the same upload as "새 파일 올리기".
 * Text on the clipboard wins (a spreadsheet copy carries a picture of the cells too), and a file dropped while
 * uploads are closed is swallowed so the browser does not open it in place of the app.
 */
export function useChatFileDrop(chat: CodexChatApi, disabled: boolean) {
  const auth = useAuthStatusQuery()
  const permissions = auth.data?.permissionKeys ?? []
  const enabled = !disabled && !chat.attachmentsUploading && (permissions.includes('chat.use') || permissions.includes('chat.agent.use'))
  const [dragging, setDragging] = useState(false)
  const depth = useRef(0)
  const upload = (files: File[]) => { void chat.uploadAttachments(files.map((file, index) => nameCapture(file, index, files.length))) }
  const carriesFiles = (event: DragEvent) => event.dataTransfer.types.includes('Files')
  const reset = () => { depth.current = 0; setDragging(false) }

  return {
    dragging: enabled && dragging,
    onPaste: (event: ClipboardEvent<HTMLTextAreaElement>) => {
      const files = Array.from(event.clipboardData.files)
      if (!enabled || !files.length || event.clipboardData.getData('text/plain').trim()) return
      event.preventDefault()
      upload(files)
    },
    // A file picker opened from the composer sits in a body portal, yet its drag events bubble here through React:
    // those are swallowed (so the browser does not open the file) but never attached.
    dropHandlers: {
      onDragEnter: (event: DragEvent) => { if (carriesFiles(event) && isFromOwnDom(event)) { depth.current += 1; setDragging(true) } },
      onDragLeave: (event: DragEvent) => { if (carriesFiles(event) && isFromOwnDom(event) && --depth.current <= 0) reset() },
      onDragOver: (event: DragEvent) => {
        if (!carriesFiles(event)) return
        event.preventDefault()
        event.dataTransfer.dropEffect = enabled && isFromOwnDom(event) ? 'copy' : 'none'
      },
      onDrop: (event: DragEvent) => {
        if (!carriesFiles(event)) return
        event.preventDefault()
        if (!isFromOwnDom(event)) return
        reset()
        if (enabled && event.dataTransfer.files.length) upload(Array.from(event.dataTransfer.files))
      },
    },
  }
}

/** Files attached to the message being written; shown only while there are some (or an upload runs). */
/** Files the server reads as UTF-8 text (fileStoreService TEXT_EXTENSIONS). */
const TEXT_FILE_PATTERN = /\.(txt|md|markdown|json|jsonl|csv|tsv|ya?ml|xml|html?|svg|css|m?js|cjs|jsx|tsx?|py|sh|sql|log|ini|toml|srt|vtt)$/i

/**
 * `inlinesText`: a chat that gets text files' contents when it cannot read them itself (direct chats; rooms do not).
 * Removal stays available while a reply runs: the draft belongs to the next message (and "참조" edits it then too).
 */
export function ChatDraftAttachments({ chat, canReadText, inlinesText = true }: { chat: CodexChatApi; canReadText: boolean; inlinesText?: boolean }) {
  const { t } = useI18n()
  if (chat.draftAttachments.length === 0 && chat.draftMediaAttachments.length === 0 && chat.draftPostRefs.length === 0 && !chat.attachmentsUploading) return null
  const unreadableLabel = inlinesText
    ? t({ ko: '이 프로필은 텍스트가 아닌 첨부 파일을 읽지 못해', en: 'This profile cannot read attached files other than text' })
    : t({ ko: '이 프로필은 첨부 파일 내용을 읽지 못해', en: 'This profile cannot read attached files' })

  return (
    <>
      <ChatMediaAttachments items={chat.draftMediaAttachments} onRemove={chat.removeMediaAttachment} />
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        {chat.draftPostRefs.map((item) => <ChatPostRefChip key={`${item.postId}-${item.commentId ?? 0}`} item={item} onRemove={() => chat.togglePostReference(item)} />)}
        {chat.draftAttachments.map((file) => (
          <span key={file.id} className="inline-flex h-7 max-w-full items-center gap-1.5 rounded-sm bg-surface-high pl-2 text-xs">
            <File className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="max-w-48 truncate" title={file.name}>{file.name}</span>
            <IconButton variant="ghost" size="icon-xs" label={t({ ko: '첨부 빼기', en: 'Remove' })} onClick={() => chat.removeAttachment(file.id)}>
              <X />
            </IconButton>
          </span>
        ))}
        {chat.attachmentsUploading ? <Spinner size="sm" label={t({ ko: '업로드 중', en: 'Uploading' })} /> : null}
        {/* Without the file tool the chat still gets the start of text files; anything else it cannot open. */}
        {!canReadText && chat.draftAttachments.some((file) => !inlinesText || !TEXT_FILE_PATTERN.test(file.name)) ? (
          <Tip content={unreadableLabel}>
            <span className="inline-flex size-7 items-center justify-center text-muted-foreground" aria-label={unreadableLabel}>
              <EyeOff className="size-3.5" />
            </span>
          </Tip>
        ) : null}
      </div>
    </>
  )
}

export function ChatFileLinks({ files = [] }: { files?: StoredFileEntry[] }) {
  const { t } = useI18n()
  if (!files.length) return null
  return (
    <div className="mt-1 flex flex-wrap justify-end gap-1">
      {files.map((file) => (
        <Tip key={file.id} content={t({ ko: '{name} 다운로드', en: 'Download {name}' }, { name: file.name })}>
          <Button asChild variant="subtle" size="sm">
            <a href={file.chatAttachment ? buildApiUrl(`/api/codex-chat/attachments/${file.id}/download`) : storedFileDownloadUrl(file.id)} download>
              <File className="size-3.5 shrink-0" />
              <span className="max-w-56 truncate">{file.name}</span>
              <span className="text-2xs text-muted-foreground">{formatFileSize(file.size)}</span>
            </a>
          </Button>
        </Tip>
      ))}
    </div>
  )
}
