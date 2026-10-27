import { useEffect, useRef, useState, type RefObject } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Check, Folder, Image, Link, Upload } from 'lucide-react'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
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
 * Compact input controls shared by reference images, avatars and backgrounds. Imports land with the `target` (a
 * profile's character name, or a library setting, resolved when the import starts so a new one can be saved first);
 * without a target only the library pick is offered.
 */
export function ChatProfileAssetInput({ target, libraryGroupId = null, onChange, onBusyChange, extraInputs = true, uploadRef, busy = false }: {
  target: ChatAssetUploadTarget | (() => Promise<ChatAssetUploadTarget>) | null
  /** The group the library pick opens at (a library setting's candidates); otherwise a profile's own folder. */
  libraryGroupId?: number | null
  onChange: (hash: string) => void
  onBusyChange: (busy: boolean) => void
  extraInputs?: boolean
  busy?: boolean
  uploadRef?: RefObject<HTMLInputElement | null>
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
    <div className="flex items-center gap-1">
      <IconButton size="icon-sm" variant="ghost" disabled={disabled} label={t({ ko: '라이브러리에서 고르기', en: 'Choose from library' })} onClick={() => setPicker('library')}><Image /></IconButton>
      {target ? <IconButton size="icon-sm" variant="ghost" disabled={disabled} label={t({ ko: '업로드', en: 'Upload' })} onClick={() => fileRef.current?.click()}><Upload /></IconButton> : null}
      {target && extraInputs ? <>
        <Popover open={urlOpen} onOpenChange={setUrlOpen}>
          <PopoverTrigger asChild><IconButton size="icon-sm" variant="ghost" disabled={disabled} label={t({ ko: 'URL로 가져오기', en: 'Import from URL' })}><Link /></IconButton></PopoverTrigger>
          <PopoverContent align="start" padding="sm">
            <form className="flex items-center gap-1" onSubmit={(event) => {
              event.preventDefault()
              if (!url.trim() || disabled) return
              const link = url.trim()
              mutation.mutate(async () => downloadChatProfileAsset(link, await resolve()), { onSuccess: () => { setUrlOpen(false); setUrl('') } })
            }}>
              <Input type="url" value={url} onChange={(event) => setUrl(event.target.value)} aria-label={t({ ko: '이미지 URL', en: 'Image URL' })} placeholder="https://" autoFocus disabled={disabled} />
              <IconButton type="submit" size="icon-sm" disabled={disabled || !url.trim()} label={t({ ko: '가져오기', en: 'Import' })}><Check /></IconButton>
            </form>
          </PopoverContent>
        </Popover>
        <IconButton size="icon-sm" variant="ghost" disabled={disabled} label={t({ ko: '파일 보관함에서 고르기', en: 'Choose from files' })} onClick={() => setPicker('files')}><Folder /></IconButton>
      </> : null}
    </div>
    <input ref={fileRef} type="file" accept={PROFILE_IMAGE_ACCEPT} className="hidden" disabled={disabled} onChange={(event) => {
      const file = event.target.files?.[0]
      event.target.value = ''
      if (file && !disabled) mutation.mutate(async () => uploadChatProfileAsset(file, await resolve()))
    }} />
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
