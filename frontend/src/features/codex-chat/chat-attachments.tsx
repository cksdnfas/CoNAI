import { useImagePermissions } from '@/features/auth/use-image-permissions'
import { useRef, useState } from 'react'
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
import { formatFileSize, storedFileDownloadUrl } from '@/lib/api-files'
import type { CodexChatApi } from './codex-chat-context'
import { ChatMediaAttachments, ChatMediaPicker } from './chat-media-picker'

/** Paperclip in the composer: upload, private stored files, or references to app media. */
export function ChatAttachButton({ chat, disabled }: { chat: CodexChatApi; disabled: boolean }) {
  const { t } = useI18n()
  const auth = useAuthStatusQuery()
  const input = useRef<HTMLInputElement>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [mediaPickerOpen, setMediaPickerOpen] = useState(false)
  const permissions = auth.data?.permissionKeys ?? []
  const canPickFiles = permissions.includes('files.view')
  const canPickMedia = useImagePermissions().canViewImages
  if (!canPickFiles && !canPickMedia) return null
  const canUpload = canPickFiles && permissions.includes('files.edit')
  const label = t({ ko: '파일 첨부', en: 'Attach files' })
  const isDisabled = disabled || chat.attachmentsUploading

  return (
    <>
      <input ref={input} type="file" multiple className="hidden" onChange={(event) => { void chat.uploadAttachments(Array.from(event.target.files ?? [])); event.target.value = '' }} />
      <DropdownMenu>
        <Tip content={label}>
          <DropdownMenuTrigger asChild>
            <IconButton variant="ghost" size="icon-sm" className="rounded-full" disabled={isDisabled} label={label} tooltip={false}>
              <Paperclip />
            </IconButton>
          </DropdownMenuTrigger>
        </Tip>
        <DropdownMenuContent align="start" side="top">
          {canUpload ? <DropdownMenuItem onSelect={() => input.current?.click()}>
            <Upload />
            {t({ ko: '새 파일 올리기', en: 'Upload new files' })}
          </DropdownMenuItem> : null}
          {canPickFiles ? <DropdownMenuItem onSelect={() => setPickerOpen(true)}>
            <FolderOpen />
            {t({ ko: '보관함에서 고르기', en: 'Choose from files' })}
          </DropdownMenuItem> : null}
          {canPickMedia ? <DropdownMenuItem onSelect={() => setMediaPickerOpen(true)}>
            <Images />
            {t({ ko: '앱 미디어에서 고르기', en: 'Choose app media' })}
          </DropdownMenuItem> : null}
        </DropdownMenuContent>
      </DropdownMenu>
      {pickerOpen ? <FilePicker onClose={() => setPickerOpen(false)} onPick={(entries) => { chat.addAttachments(entries); setPickerOpen(false) }} /> : null}
      {mediaPickerOpen ? <ChatMediaPicker initial={chat.draftMediaAttachments} maxCount={20 - chat.draftAttachments.length} onClose={() => setMediaPickerOpen(false)} onPick={(items) => { if (chat.setMediaAttachments(items)) setMediaPickerOpen(false) }} /> : null}
    </>
  )
}

/** Files attached to the message being written; shown only while there are some (or an upload runs). */
/** Files the server reads as UTF-8 text (fileStoreService TEXT_EXTENSIONS). */
const TEXT_FILE_PATTERN = /\.(txt|md|markdown|json|jsonl|csv|tsv|ya?ml|xml|html?|svg|css|m?js|cjs|jsx|tsx?|py|sh|sql|log|ini|toml|srt|vtt)$/i

/** `inlinesText`: a chat that gets text files' contents when it cannot read them itself (direct chats; rooms do not). */
export function ChatDraftAttachments({ chat, disabled, canReadText, inlinesText = true }: { chat: CodexChatApi; disabled: boolean; canReadText: boolean; inlinesText?: boolean }) {
  const { t } = useI18n()
  if (chat.draftAttachments.length === 0 && chat.draftMediaAttachments.length === 0 && !chat.attachmentsUploading) return null
  const unreadableLabel = inlinesText
    ? t({ ko: '이 프로필은 텍스트가 아닌 첨부 파일을 읽지 못해', en: 'This profile cannot read attached files other than text' })
    : t({ ko: '이 프로필은 첨부 파일 내용을 읽지 못해', en: 'This profile cannot read attached files' })

  return (
    <>
      <ChatMediaAttachments items={chat.draftMediaAttachments} onRemove={chat.removeMediaAttachment} disabled={disabled} />
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        {chat.draftAttachments.map((file) => (
          <span key={file.id} className="inline-flex h-7 max-w-full items-center gap-1.5 rounded-sm bg-surface-high pl-2 text-xs">
            <File className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="max-w-48 truncate" title={file.name}>{file.name}</span>
            <IconButton variant="ghost" size="icon-xs" disabled={disabled} label={t({ ko: '첨부 빼기', en: 'Remove' })} onClick={() => chat.removeAttachment(file.id)}>
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
        <Button key={file.id} asChild variant="subtle" size="sm">
          <a href={storedFileDownloadUrl(file.id)} download title={t({ ko: '{name} 다운로드', en: 'Download {name}' }, { name: file.name })}>
            <File className="size-3.5 shrink-0" />
            <span className="max-w-56 truncate">{file.name}</span>
            <span className="text-2xs text-muted-foreground">{formatFileSize(file.size)}</span>
          </a>
        </Button>
      ))}
    </div>
  )
}
