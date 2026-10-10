import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { ToggleChip } from '@/components/ui/chip'
import { EditorGroup } from '@/components/ui/editor-group'
import { Field } from '@/components/ui/field'
import { IconButton } from '@/components/ui/icon-button'
import { NumberStepperInput } from '@/components/ui/number-stepper-input'
import { Select } from '@/components/ui/select'
import { SettingRow } from '@/components/ui/setting-row'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { Textarea } from '@/components/ui/textarea'
import { Tip } from '@/components/ui/tooltip'
import { ChatFilledLabel } from '@/features/codex-chat/chat-page-context'
import { FilePicker } from '@/features/files/file-browser'
import { useI18n } from '@/i18n'
import { CHAT_PRESET_PREVIOUS_IMAGES_MAX, type ChatPresetPrompting, type ChatPresetPromptingInput } from '@/lib/api-codex-chat'
import { createStoredFolder, listStoredFiles, TEXT_FILE_PATTERN, uploadStoredFiles } from '@/lib/api-files'
import { getErrorMessage } from '@/lib/error-message'

/** The file store folder whose text files the guide picker lists first (made on the first upload). */
export const GUIDE_FOLDER = '가이드'
const GUIDE_EXTENSIONS = ['.txt', '.md', '.markdown', '.json', '.yaml', '.yml', '.csv', '.tsv', '.xml', '.html', '.htm']
const PICK_OPTION = '__pick__'
const UPLOAD_OPTION = '__upload__'

export const EMPTY_PROMPTING: ChatPresetPromptingInput = { timing: 'inline', guide: '', guideFileId: null, guideFilePath: null, previousImages: 0 }

/** A saved preset's prompting as the editor keeps it. */
export function promptingInputOf(prompting: ChatPresetPrompting | undefined): ChatPresetPromptingInput {
  if (!prompting) return EMPTY_PROMPTING
  return { timing: prompting.timing, guide: prompting.guide, guideFileId: prompting.guideFile?.fileId ?? null, guideFilePath: prompting.guideFile?.path ?? null, previousImages: prompting.previousImages }
}

const guideFilesQueryKey = ['chat-preset-guide-files'] as const

/** The `가이드/` folder of your own store (null while it has none) and the files directly in it. */
async function listGuideFiles() {
  const top = await listStoredFiles(null)
  const folder = top.entries.find((entry) => entry.kind === 'folder' && entry.name === GUIDE_FOLDER) ?? null
  if (!folder) return { folderId: null, files: [] }
  const listing = await listStoredFiles(folder.id)
  return { folderId: folder.id, files: listing.entries.filter((entry) => entry.kind === 'file') }
}

/** 가이드 문서: a text file of your file store, picked from `가이드/`, found anywhere in the store, or uploaded now. */
function GuideFileSelect({ value, onChange }: { value: Pick<ChatPresetPromptingInput, 'guideFileId' | 'guideFilePath'>; onChange: (file: { id: string; path: string } | null) => void }) {
  const { t } = useI18n()
  const { showSnackbar } = useSnackbar()
  const queryClient = useQueryClient()
  const inputRef = useRef<HTMLInputElement>(null)
  const [picking, setPicking] = useState(false)
  const filesQuery = useQuery({ queryKey: guideFilesQueryKey, queryFn: listGuideFiles, retry: false })
  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const folderId = (await listGuideFiles()).folderId ?? (await createStoredFolder(null, GUIDE_FOLDER)).id
      const [uploaded] = await uploadStoredFiles(folderId, [file])
      return uploaded
    },
    onSuccess: async (uploaded) => {
      await queryClient.invalidateQueries({ queryKey: guideFilesQueryKey })
      if (uploaded) onChange({ id: uploaded.id, path: `${GUIDE_FOLDER}/${uploaded.name}` })
    },
    onError: (error) => showSnackbar({ message: getErrorMessage(error, t({ ko: '올리지 못했어.', en: 'Could not upload.' })), tone: 'error' }),
  })
  const files = (filesQuery.data?.files ?? []).filter((file) => TEXT_FILE_PATTERN.test(file.name))
  const listed = files.some((file) => file.id === value.guideFileId)
  const missing = value.guideFileId !== null && value.guideFilePath === null
  const unavailable = filesQuery.isError ? t({ ko: '파일 보관함을 쓸 수 없는 계정이야', en: 'This account cannot use the file store' }) : null

  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <Tip content={unavailable}>
        <span className="min-w-0">
          <Select
            variant="settings"
            className="w-72 max-w-full px-3 font-mono text-xs"
            value={value.guideFileId ?? ''}
            disabled={unavailable !== null || uploadMutation.isPending}
            aria-invalid={missing}
            aria-label={t({ ko: '가이드 문서', en: 'Guide document' })}
            onChange={(event) => {
              const next = event.target.value
              if (next === PICK_OPTION) setPicking(true)
              else if (next === UPLOAD_OPTION) inputRef.current?.click()
              else if (!next) onChange(null)
              else {
                const file = files.find((entry) => entry.id === next)
                if (file) onChange({ id: file.id, path: `${GUIDE_FOLDER}/${file.name}` })
              }
            }}
          >
            <option value="">{t({ ko: '없음', en: 'None' })}</option>
            {value.guideFileId && !listed ? <option value={value.guideFileId}>{missing ? t({ ko: '찾을 수 없는 파일', en: 'File not found' }) : value.guideFilePath}</option> : null}
            {files.map((file) => <option key={file.id} value={file.id}>{`${GUIDE_FOLDER}/${file.name}`}</option>)}
            <option value={PICK_OPTION}>{t({ ko: '보관함에서 찾기…', en: 'Find in files…' })}</option>
            <option value={UPLOAD_OPTION}>{t({ ko: '새로 올리기…', en: 'Upload new…' })}</option>
          </Select>
        </span>
      </Tip>
      {value.guideFileId ? <IconButton size="icon-sm" variant="ghost" label={t({ ko: '연결 풀기', en: 'Unlink' })} onClick={() => onChange(null)}><X /></IconButton> : null}
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        accept={GUIDE_EXTENSIONS.join(',')}
        aria-label={t({ ko: '올릴 가이드 문서', en: 'Guide document to upload' })}
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file) uploadMutation.mutate(file)
        }}
      />
      {picking ? (
        <FilePicker
          accept={GUIDE_EXTENSIONS}
          title={t({ ko: '가이드 문서 고르기', en: 'Choose a guide document' })}
          pickLabel={() => t({ ko: '선택', en: 'Select' })}
          initialParentId={filesQuery.data?.folderId ?? null}
          onClose={() => setPicking(false)}
          onPick={(entries) => {
            setPicking(false)
            const [file] = entries.filter((entry) => entry.kind === 'file')
            if (file) onChange({ id: file.id, path: file.name })
          }}
        />
      ) : null}
    </div>
  )
}

/**
 * 프롬프트 작성: when the scene prompt is written (with the reply, or from the finished reply), the guide the writer
 * follows (a few lines here, and/or a linked document), and how many of the chat's latest pictures it sees.
 */
export function PresetPromptingFields({ value, onChange }: { value: ChatPresetPromptingInput; onChange: (value: ChatPresetPromptingInput) => void }) {
  const { t } = useI18n()
  const patch = (next: Partial<ChatPresetPromptingInput>) => onChange({ ...value, ...next })
  return (
    <EditorGroup label={t({ ko: '프롬프트 작성', en: 'Prompt writing' })} info={t({ ko: '답변 끝난 뒤: 답변이 끝나면 완성된 본문으로 프롬프트를 따로 써서 생성해. 캐릭터 생김새는 프로필의 외형 설명만 보고 써. 시스템 프롬프트와 섹션은 안 봐.', en: "After the reply: once the reply is done, the prompt is written from the finished text and generated. The character's looks come only from the profile's appearance, not its system prompt or sections." })}>
      <div className="border-t border-line">
        <SettingRow label={<ChatFilledLabel fieldId="timing">{t({ ko: '작성 시점', en: 'When' })}</ChatFilledLabel>}>
          <div className="flex gap-1.5">
            <ToggleChip size="sm" pressed={value.timing === 'inline'} onClick={() => patch({ timing: 'inline' })}>{t({ ko: '답변과 같이', en: 'With the reply' })}</ToggleChip>
            <ToggleChip size="sm" pressed={value.timing === 'after'} onClick={() => patch({ timing: 'after' })}>{t({ ko: '답변 끝난 뒤', en: 'After the reply' })}</ToggleChip>
          </div>
        </SettingRow>
        <SettingRow label={t({ ko: '가이드 문서', en: 'Guide document' })}>
          <GuideFileSelect value={value} onChange={(file) => patch({ guideFileId: file?.id ?? null, guideFilePath: file?.path ?? null })} />
        </SettingRow>
        <SettingRow label={<ChatFilledLabel fieldId="previousImages">{t({ ko: '이전 이미지 참고', en: 'Earlier pictures shown' })}</ChatFilledLabel>} info={t({ ko: '이 채팅에서 최근에 만든 이미지를 이만큼 보여줘. 이미지를 못 보는 모델에는 안 보내.', en: "Shows this many of the chat's latest pictures. Not sent to models that cannot see images." })}>
          <NumberStepperInput
            variant="settings"
            className="w-32"
            step={1}
            min={0}
            max={CHAT_PRESET_PREVIOUS_IMAGES_MAX}
            value={value.previousImages}
            onValueCommit={(raw) => {
              const number = Math.round(Number(raw))
              if (raw.trim() !== '' && Number.isFinite(number)) patch({ previousImages: Math.min(CHAT_PRESET_PREVIOUS_IMAGES_MAX, Math.max(0, number)) })
            }}
            aria-label={t({ ko: '이전 이미지 참고', en: 'Earlier pictures shown' })}
          />
        </SettingRow>
      </div>
      <Field label={<ChatFilledLabel fieldId="guide">{t({ ko: '작성 가이드', en: 'Writing guide' })}</ChatFilledLabel>}>
        <Textarea variant="settings" rows={3} maxLength={4000} value={value.guide} onChange={(event) => patch({ guide: event.target.value })} />
      </Field>
    </EditorGroup>
  )
}
