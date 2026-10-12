import { lazy, Suspense, useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { File } from 'lucide-react'
import type { StoredFileEntry } from '@conai/shared'
import { FieldTabs } from '@/components/common/field-tabs'
import { SegmentedControl } from '@/components/common/segmented-control'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { Input } from '@/components/ui/input'
import { LoadingState } from '@/components/ui/loading-state'
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useChatPageRegistration } from '@/features/codex-chat/chat-page-context'
import { pageAction, pageArray, pageFreeText, pageNumber, pageObject, pageText } from '@/features/codex-chat/page-action-helpers'
import { useChatDraftTransaction } from '@/features/codex-chat/use-chat-draft-transaction'
import { useI18n } from '@/i18n'
import { FILES_QUERY_KEY, MAX_TEXT_DOCUMENT_BYTES, createStoredTextFile, readWholeStoredFileText, saveStoredFileText, type StoredFileOwnerKey } from '@/lib/api-files'
import { getErrorMessage } from '@/lib/error-message'

const ChatMarkdown = lazy(() => import('@/features/codex-chat/chat-markdown').then((module) => ({ default: module.ChatMarkdown })))
const PlainTextEditor = lazy(() => import('@/components/common/plain-text-editor').then((module) => ({ default: module.PlainTextEditor })))
const PostRichEditor = lazy(() => import('@/features/posts/post-rich-editor').then((module) => ({ default: module.PostRichEditor })))

type DocumentFormat = 'md' | 'txt'
type MarkdownTab = 'write' | 'source' | 'preview'
/**
 * The document text the connected chat sees with every request: a document up to this long is a field, a longer one
 * a chunk of this size (files.doc_at moves it) changed with files.doc_edit.
 */
const DOCUMENT_CHUNK = 2000
type TextEdit = { find: string; replace: string; all?: boolean }

/** Exact-text replacements in order; each `find` must appear once unless `all` is set, or nothing changes. */
function replaceText(text: string, edits: TextEdit[]) {
  let next = text
  for (const edit of edits) {
    const count = edit.find ? next.split(edit.find).length - 1 : 0
    if (count === 0) throw new Error(`문서에 없는 글이야: ${edit.find.slice(0, 40)}`)
    if (count > 1 && !edit.all) throw new Error(`문서에 ${count}번 나와. 앞뒤 글을 더 넣거나 all을 켜줘: ${edit.find.slice(0, 40)}`)
    next = edit.all ? next.split(edit.find).join(edit.replace) : next.replace(edit.find, () => edit.replace)
  }
  return next
}
const isMarkdownName = (name: string) => /\.(md|markdown)$/i.test(name)

/**
 * A plain text / Markdown document: a new one in `parentId` (`entry` null) or an existing text file. Saving keeps the
 * editor open (a new document becomes that file); `onClose` gets the file as last saved, or null when nothing was.
 * `chatPage`: the file store page is connected to a chat, so the open document joins that connection (see below).
 */
export function FileTextEditor({ entry, parentId, owner, onClose, chatPage = false }: {
  entry: StoredFileEntry | null
  parentId: string | null
  owner?: StoredFileOwnerKey
  onClose: (saved: StoredFileEntry | null) => void
  chatPage?: boolean
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
  const [tab, setTab] = useState<MarkdownTab>('write')
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

  // A typed .txt / .md wins over the switch, so "notes.md" never becomes "notes.md.txt".
  const fileName = /\.(txt|md|markdown)$/i.test(name.trim()) ? name.trim() : `${name.trim()}.${format}`
  const markdown = isMarkdownName(file?.name ?? fileName)
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

  // The connected chat reads and drafts the document the person opened here: it is already on their screen, and it
  // leaves the connection when they close it. Connecting the files page alone never hands file contents to a chat
  // (the server withholds the file-reading tools while a page is connected). Saving stays a review card.
  const [chunkOffset, setChunkOffset] = useState(0)
  const commitText = useChatDraftTransaction(text ?? '', setText)
  const textFits = text !== null && text.length <= DOCUMENT_CHUNK
  useChatPageRegistration(chatPage && !save.isPending ? {
    kind: 'files',
    title: file ? file.name : t({ ko: '새 문서', en: 'New document' }),
    resourceId: `document:${file?.id ?? 'new'}`,
    priority: 1,
    dirty: dirty && (file !== null || text !== ''),
    fields: [
      ...(file ? [] : [
        { id: 'documentName', label: t({ ko: '새 문서 이름', en: 'New document name' }), type: 'text' as const, value: name },
        { id: 'documentFormat', label: t({ ko: '형식', en: 'Format' }), type: 'select' as const, value: format, options: ['md', 'txt'] },
      ]),
      ...(textFits ? [{ id: 'content', label: t({ ko: '문서 내용', en: 'Document text' }), type: 'text' as const, value: text, allowEmpty: true }] : []),
    ],
    data: {
      document: {
        name: file ? file.name : fileName, markdown, length: text?.length ?? 0, saved: file !== null && !dirty,
        ...(tooLarge ? { tooLarge: true } : {}),
        ...(text !== null && !textFits ? { offset: chunkOffset, text: pageFreeText(text.slice(chunkOffset, chunkOffset + DOCUMENT_CHUNK)) } : {}),
      },
    },
    actions: text === null ? [] : [
      ...(textFits ? [] : [pageAction('files.doc_at', t({ ko: '문서 이어 읽기', en: 'Read the document from' }), t({ ko: 'data.document.text를 offset부터 보여줘', en: 'data.document.text from offset' }), pageObject({ offset: pageNumber(0, Math.max(0, text.length - 1), true) }, ['offset']))]),
      pageAction('files.doc_edit', t({ ko: '문서 고치기', en: 'Edit the document' }), t({ ko: 'whole은 전체를 바꿔. edits는 find(한 번만 나오는 글)를 replace로 차례로 바꾸고, 하나라도 안 맞으면 그대로야', en: 'whole replaces the text; edits replace each find (appearing once) in order, all or nothing' }), pageObject({ whole: pageText(200000), edits: pageArray(pageObject({ find: pageText(8000), replace: pageText(100000), all: { type: 'boolean' } }, ['find', 'replace']), 50) })),
      pageAction('files.doc_append', t({ ko: '문서 끝에 이어 쓰기', en: 'Append to the document' }), '', pageObject({ text: pageText(100000) }, ['text'])),
      ...(canSave ? [pageAction('files.doc_save', file ? t({ ko: '문서 저장', en: 'Save document' }) : t({ ko: '새 문서 만들기', en: 'Create document' }), '', undefined, 'save')] : []),
    ],
    apply: (patch) => {
      if (typeof patch.documentName === 'string' && !file) setName(patch.documentName)
      if ((patch.documentFormat === 'md' || patch.documentFormat === 'txt') && !file) setFormat(patch.documentFormat)
      if (typeof patch.content === 'string' && text !== null) { setText(patch.content); if (tab === 'preview') setTab('write') }
    },
    applyAction: async (id, args, assertCurrent) => {
      assertCurrent()
      if (text === null) throw new Error('문서를 아직 불러오는 중이야.')
      if (id === 'files.doc_at') { setChunkOffset(Number(args.offset)); return }
      if (id === 'files.doc_edit') return commitText(typeof args.whole === 'string' ? args.whole : replaceText(text, (Array.isArray(args.edits) ? args.edits : []) as TextEdit[]))
      if (id === 'files.doc_append') return commitText(text + String(args.text))
      if (id !== 'files.doc_save') throw new Error('문서 편집기에 없는 작업이야.')
      if (!canSave) throw new Error('저장할 내용이 없어.')
      await save.mutateAsync(text)
    },
  } : null)

  let content
  if (tooLarge) content = <EmptyState icon={File} title={t({ ko: '2MB가 넘는 파일은 여기서 편집할 수 없어', en: 'Files over 2 MB cannot be edited here' })} />
  else if (source.isError) content = <ErrorState title={t({ ko: '파일을 열지 못했어.', en: 'Could not open the file.' })} error={source.error} onRetry={() => void source.refetch()} />
  else if (text === null) content = <LoadingState />
  else if (!markdown) content = <Suspense fallback={<LoadingState />}><PlainTextEditor value={text} onChange={setText} autoFocus={file !== null} fileName={file?.name ?? fileName} /></Suspense>
  else content = (
    // Markdown: the same in-place tabs as the post editor, in one frame. The visual editor keeps the text Markdown.
    <div className="theme-input-surface min-w-0 overflow-hidden rounded-sm border">
      <FieldTabs
        value={tab}
        onChange={setTab}
        ariaLabel={t({ ko: '편집 방식', en: 'Editing mode' })}
        bare
        items={[{ value: 'write', label: t({ ko: '서식 편집', en: 'Visual' }) }, { value: 'source', label: t({ ko: '원문', en: 'Source' }) }, { value: 'preview', label: t({ ko: '미리보기', en: 'Preview' }) }]}
      />
      <div className="border-t border-line">
        <Suspense fallback={<div className="h-[55vh]"><LoadingState /></div>}>
          {tab === 'write' ? (
            <PostRichEditor
              value={text}
              onChange={setText}
              autoFocus={file !== null}
              bodyClassName="h-[55vh] min-h-0 overflow-y-auto"
              onError={(error) => {
                setTab('source')
                showSnackbar({ tone: 'error', message: getErrorMessage(error, t({ ko: '서식 편집기를 열지 못했어. 원문에서 계속 편집할 수 있어.', en: 'Could not open the visual editor. You can continue editing the source.' })) })
              }}
              onUnsupportedUpload={() => showSnackbar({ tone: 'info', message: t({ ko: '여기선 이미지를 붙여 넣을 수 없어. 원문에 링크로 넣어줘.', en: 'Images cannot be pasted here. Add them as links in the source.' }) })}
            />
          ) : tab === 'source' ? (
            <PlainTextEditor value={text} onChange={setText} autoFocus={file !== null} fileName="document.md" bare />
          ) : (
            <div className="h-[55vh] overflow-auto p-4"><ChatMarkdown text={text} /></div>
          )}
        </Suspense>
      </div>
    </div>
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
        {content}
      </ModalBody>
      <ModalFooter>
        <span className="flex-1" />
        <Button disabled={!canSave} onClick={submit}>{t({ ko: '저장', en: 'Save' })}</Button>
      </ModalFooter>
    </Modal>
  )
}
