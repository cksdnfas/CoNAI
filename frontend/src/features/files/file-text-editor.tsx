import { lazy, Suspense, useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { File } from 'lucide-react'
import type { StoredFileEntry } from '@conai/shared'
import { SegmentedControl } from '@/components/common/segmented-control'
import { TextTabs } from '@/components/common/text-tabs'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { Input } from '@/components/ui/input'
import { LoadingState } from '@/components/ui/loading-state'
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { Textarea } from '@/components/ui/textarea'
import { useI18n } from '@/i18n'
import { FILES_QUERY_KEY, MAX_TEXT_DOCUMENT_BYTES, createStoredTextFile, readWholeStoredFileText, saveStoredFileText, type StoredFileOwnerKey } from '@/lib/api-files'
import { getErrorMessage } from '@/lib/error-message'

const ChatMarkdown = lazy(() => import('@/features/codex-chat/chat-markdown').then((module) => ({ default: module.ChatMarkdown })))

type DocumentFormat = 'md' | 'txt'
const isMarkdownName = (name: string) => /\.(md|markdown)$/i.test(name)

/**
 * A plain text / Markdown document: a new one in `parentId` (`entry` null) or an existing text file. Saving keeps the
 * editor open (a new document becomes that file); `onClose` gets the file as last saved, or null when nothing was.
 */
export function FileTextEditor({ entry, parentId, owner, onClose }: {
  entry: StoredFileEntry | null
  parentId: string | null
  owner?: StoredFileOwnerKey
  onClose: (saved: StoredFileEntry | null) => void
}) {
  const { t } = useI18n()
  const { showSnackbar } = useSnackbar()
  const queryClient = useQueryClient()
  const [file, setFile] = useState(entry)
  const [saved, setSaved] = useState<StoredFileEntry | null>(null)
  const [name, setName] = useState(() => t({ ko: '새 문서', en: 'New document' }))
  const [format, setFormat] = useState<DocumentFormat>('md')
  const [text, setText] = useState(entry ? null as string | null : '')
  const [baseline, setBaseline] = useState(entry ? null as string | null : '')
  const [tab, setTab] = useState<'edit' | 'preview'>('edit')
  const tooLarge = entry !== null && entry.size > MAX_TEXT_DOCUMENT_BYTES
  const source = useQuery({
    queryKey: ['file-text-editor', owner ?? null, entry?.id],
    queryFn: () => readWholeStoredFileText(entry!.id, owner),
    enabled: entry !== null && !tooLarge,
    gcTime: 0,
    staleTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
  })
  useEffect(() => {
    if (source.data !== undefined && text === null) {
      setText(source.data)
      setBaseline(source.data)
    }
  }, [source.data, text])

  const markdown = file ? isMarkdownName(file.name) : format === 'md'
  // A typed .txt / .md wins over the switch, so "notes.md" never becomes "notes.md.txt".
  const fileName = /\.(txt|md|markdown)$/i.test(name.trim()) ? name.trim() : `${name.trim()}.${format}`
  const dirty = file ? text !== null && text !== baseline : true
  const save = useMutation({
    mutationFn: (value: string) => (file ? saveStoredFileText(file.id, value, owner) : createStoredTextFile(parentId, fileName, value, owner)),
    onSuccess: async (result, value) => {
      setFile(result)
      setSaved(result)
      setBaseline(value)
      await queryClient.invalidateQueries({ queryKey: FILES_QUERY_KEY })
    },
    onError: (error) => showSnackbar({ tone: 'error', message: getErrorMessage(error, t({ ko: '문서를 저장하지 못했어.', en: 'Could not save the document.' })) }),
  })
  const canSave = text !== null && !save.isPending && (file ? dirty : name.trim() !== '')
  const submit = () => { if (canSave && text !== null) save.mutate(text) }

  let content
  if (tooLarge) content = <EmptyState icon={File} title={t({ ko: '2MB가 넘는 파일은 여기서 편집할 수 없어', en: 'Files over 2 MB cannot be edited here' })} />
  else if (source.isError) content = <ErrorState title={t({ ko: '파일을 열지 못했어.', en: 'Could not open the file.' })} error={source.error} onRetry={() => void source.refetch()} />
  else if (text === null) content = <LoadingState />
  else if (markdown && tab === 'preview') content = <div className="h-[55vh] overflow-auto"><Suspense fallback={<LoadingState />}><ChatMarkdown text={text} /></Suspense></div>
  else content = (
    <Textarea
      autoFocus={file !== null}
      spellCheck={false}
      aria-label={t({ ko: '내용', en: 'Content' })}
      className="h-[55vh] resize-none font-mono leading-relaxed"
      value={text}
      onChange={(event) => setText(event.target.value)}
    />
  )

  return (
    <Modal open title={file ? file.name : t({ ko: '새 문서', en: 'New document' })} onClose={() => onClose(saved)} widthClassName="max-w-5xl" dirty={dirty && (file !== null || text !== '')} onSave={canSave ? submit : undefined}>
      <ModalBody className="space-y-3">
        {file ? null : (
          <div className="flex items-center gap-2">
            <Input variant="settings" autoFocus className="min-w-0 flex-1" aria-label={t({ ko: '파일 이름', en: 'File name' })} value={name} onChange={(event) => setName(event.target.value)} />
            <SegmentedControl
              size="sm"
              value={format}
              onChange={(value) => setFormat(value === 'txt' ? 'txt' : 'md')}
              ariaLabel={t({ ko: '형식', en: 'Format' })}
              items={[{ value: 'md', label: 'MD', ariaLabel: 'Markdown' }, { value: 'txt', label: 'TXT', ariaLabel: t({ ko: '텍스트', en: 'Plain text' }) }]}
            />
          </div>
        )}
        {markdown && text !== null ? (
          <TextTabs value={tab} onChange={setTab} items={[{ value: 'edit', label: t({ ko: '편집', en: 'Edit' }) }, { value: 'preview', label: t({ ko: '미리보기', en: 'Preview' }) }]} />
        ) : null}
        {content}
      </ModalBody>
      <ModalFooter>
        <span className="flex-1" />
        <Button disabled={!canSave} onClick={submit}>{t({ ko: '저장', en: 'Save' })}</Button>
      </ModalFooter>
    </Modal>
  )
}
