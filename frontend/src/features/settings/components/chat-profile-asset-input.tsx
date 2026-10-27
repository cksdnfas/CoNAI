import { useEffect, useRef, useState, type RefObject } from 'react'
import { useMutation } from '@tanstack/react-query'
import { ChevronDown, Folder, Image, Link, Trash2, Upload, Wand } from 'lucide-react'
import { NameDialog } from '@/components/common/entry-dialogs'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Spinner } from '@/components/ui/loading-state'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useImagePermissions } from '@/features/auth/use-image-permissions'
import { MediaLibraryPicker } from '@/components/media/media-library-picker'
import { FilePicker } from '@/features/files/file-browser'
import { useI18n } from '@/i18n'
import { downloadChatProfileAsset, importChatProfileAssetFromFileStore, uploadChatProfileAsset, type ChatAssetUploadTarget, type ChatProfileAssetResult } from '@/lib/api-codex-chat'
import { getErrorMessage } from '@/lib/error-message'
import { characterGroupName } from './chat-profile-asset-slots'

export const PROFILE_IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif'
const FILE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.gif']

/** All import paths end in the same library pipeline before changing the draft. */
export function useChatProfileAssetImport(onChange: (hash: string) => void, onBusyChange: (busy: boolean) => void) {
  const { t } = useI18n()
  const { showSnackbar } = useSnackbar()
  const active = useRef(true)
  const busy = useRef(false)
  const reportBusy = useRef(onBusyChange)
  reportBusy.current = onBusyChange
  useEffect(() => {
    active.current = true
    return () => { active.current = false; if (busy.current) { busy.current = false; reportBusy.current(false) } }
  }, [])
  return useMutation({
    mutationFn: (task: () => Promise<ChatProfileAssetResult>) => task(),
    onMutate: () => { busy.current = true; reportBusy.current(true) },
    onSuccess: (result) => { if (active.current) onChange(result.compositeHash) },
    onError: (error) => { if (active.current) showSnackbar({ message: getErrorMessage(error, t({ ko: '이미지를 가져오지 못했어.', en: 'Could not import the image.' })), tone: 'error' }) },
    onSettled: () => { if (busy.current) { busy.current = false; reportBusy.current(false) } },
  })
}

/**
 * The one "이미지 바꾸기 ▾" menu of reference images, avatars, expression slots and backgrounds: pick from the
 * library, upload, import from a URL or the file store, generate (`onGenerate`) or clear (`onClear`). Imports land
 * with the `target` (a profile's character name, or a library setting, resolved when the import starts so a new one
 * can be saved first); without a target only the library pick and the owner's own entries are offered.
 */
export function ChatProfileAssetInput({ target, libraryGroupId = null, onChange, onBusyChange, extraInputs = true, uploadRef, busy = false, label, variant = 'secondary', size = 'sm', onGenerate, generateLabel, generateBlocked = null, onClear, clearLabel }: {
  target: ChatAssetUploadTarget | (() => Promise<ChatAssetUploadTarget>) | null
  /** The group the library pick opens at (a library setting's candidates); otherwise a profile's own folder. */
  libraryGroupId?: number | null
  onChange: (hash: string) => void
  onBusyChange: (busy: boolean) => void
  /** URL and file-store imports besides the library pick and upload. */
  extraInputs?: boolean
  busy?: boolean
  uploadRef?: RefObject<HTMLInputElement | null>
  /** The menu key's words (default 이미지 바꾸기). */
  label?: string
  variant?: 'secondary' | 'ghost' | 'overlay'
  size?: 'sm' | 'compact'
  /** Adds "새로 생성". */
  onGenerate?: () => void
  generateLabel?: string
  /** Why generating cannot start now (the entry shows it, disabled). */
  generateBlocked?: string | null
  /** Adds "이미지 지우기" (there is an image to clear). */
  onClear?: () => void
  clearLabel?: string
}) {
  const { t } = useI18n()
  const { canViewImages } = useImagePermissions()
  const { showSnackbar } = useSnackbar()
  const localRef = useRef<HTMLInputElement>(null)
  const fileRef = uploadRef ?? localRef
  const [picker, setPicker] = useState<'library' | 'files' | null>(null)
  const [urlOpen, setUrlOpen] = useState(false)
  const [url, setUrl] = useState('')
  const mutation = useChatProfileAssetImport(onChange, onBusyChange)
  const disabled = busy || mutation.isPending || !canViewImages
  const resolve = async () => (typeof target === 'function' ? target() : target!)
  // A profile's own images sit in "채팅 캐릭터/<name>" (characterMediaGroupPath on the server).
  const initialGroupPath = target && typeof target !== 'function' && 'characterName' in target ? `채팅 캐릭터/${characterGroupName(target.characterName)}` : undefined
  return <>
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size={size} variant={variant} disabled={busy || mutation.isPending}>
          {label ?? t({ ko: '이미지 바꾸기', en: 'Change image' })}
          {mutation.isPending ? <Spinner className="size-3.5" /> : <ChevronDown />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-52">
        <DropdownMenuItem disabled={disabled} onSelect={() => setPicker('library')}><Image />{t({ ko: '라이브러리에서 고르기', en: 'Choose from library' })}</DropdownMenuItem>
        {target ? <DropdownMenuItem disabled={disabled} onSelect={() => fileRef.current?.click()}><Upload />{t({ ko: '파일 올리기', en: 'Upload a file' })}</DropdownMenuItem> : null}
        {target && extraInputs ? <>
          <DropdownMenuItem disabled={disabled} onSelect={() => setUrlOpen(true)}><Link />{t({ ko: 'URL로 가져오기', en: 'Import from URL' })}</DropdownMenuItem>
          <DropdownMenuItem disabled={disabled} onSelect={() => setPicker('files')}><Folder />{t({ ko: '파일 보관함에서', en: 'From the file store' })}</DropdownMenuItem>
        </> : null}
        {onGenerate ? (
          <DropdownMenuItem disabled={busy || Boolean(generateBlocked)} onSelect={onGenerate}>
            <Wand />
            <span className="flex min-w-0 flex-col">
              <span>{generateLabel ?? t({ ko: '새로 생성', en: 'Generate' })}</span>
              {generateBlocked ? <span className="text-xs text-muted-foreground">{generateBlocked}</span> : null}
            </span>
          </DropdownMenuItem>
        ) : null}
        {onClear ? <>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" disabled={busy} onSelect={onClear}><Trash2 />{clearLabel ?? t({ ko: '이미지 지우기', en: 'Remove image' })}</DropdownMenuItem>
        </> : null}
      </DropdownMenuContent>
    </DropdownMenu>
    <input ref={fileRef} type="file" accept={PROFILE_IMAGE_ACCEPT} className="hidden" disabled={disabled} onChange={(event) => {
      const file = event.target.files?.[0]
      event.target.value = ''
      if (file && !disabled) mutation.mutate(async () => uploadChatProfileAsset(file, await resolve()))
    }} />
    {urlOpen ? (
      <NameDialog
        open
        title={t({ ko: 'URL로 가져오기', en: 'Import from URL' })}
        label={t({ ko: '이미지 URL', en: 'Image URL' })}
        submitLabel={t({ ko: '가져오기', en: 'Import' })}
        value={url}
        busy={mutation.isPending}
        onChange={setUrl}
        onClose={() => { setUrlOpen(false); setUrl('') }}
        onSubmit={() => {
          if (disabled) return
          const link = url.trim()
          mutation.mutate(async () => downloadChatProfileAsset(link, await resolve()), { onSuccess: () => { setUrlOpen(false); setUrl('') } })
        }}
      />
    ) : null}
    {picker === 'library' ? <MediaLibraryPicker initial={[]} maxCount={1} mediaKind="image" initialGroupId={libraryGroupId ?? undefined} initialGroupPath={initialGroupPath} title={t({ ko: '이미지 고르기', en: 'Choose image' })} applyLabel={t({ ko: '선택', en: 'Select' })} onClose={() => setPicker(null)} onPick={(items) => { if (disabled) return; if (items[0]) onChange(items[0].compositeHash); setPicker(null) }} /> : null}
    {picker === 'files' ? <FilePicker accept={FILE_EXTENSIONS} title={t({ ko: '보관함 이미지 고르기', en: 'Choose stored image' })} pickLabel={() => t({ ko: '선택', en: 'Select' })} onClose={() => setPicker(null)} onPick={(items) => {
      if (disabled) return
      if (items.length !== 1) { showSnackbar({ message: t({ ko: '이미지 한 장을 골라줘.', en: 'Choose one image.' }), tone: 'error' }); return }
      setPicker(null)
      const fileId = items[0].id
      mutation.mutate(async () => importChatProfileAssetFromFileStore(fileId, await resolve()))
    }} /> : null}
  </>
}
