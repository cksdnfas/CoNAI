import { useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { StoredFileEntry } from '@conai/shared'
import { useI18n } from '@/i18n'
import { FILES_QUERY_KEY, MAX_TEXT_DOCUMENT_BYTES, createStoredTextFile, readStoredFileForEdit, saveStoredFileText } from '@/lib/api-files'
import { TextDocumentEditor, type TextDocumentStore } from './text-document-editor'

/**
 * A file store text document: a new one in `parentId` (`entry` null) or an existing text file. `onClose` gets the
 * file as last saved, or null when nothing was.
 */
export function FileTextEditor({ entry, parentId, onClose, chatPage = false }: {
  entry: StoredFileEntry | null
  parentId: string | null
  onClose: (saved: StoredFileEntry | null) => void
  chatPage?: boolean
}) {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const store = useMemo((): TextDocumentStore<StoredFileEntry> => ({
    key: 'files',
    load: (file) => readStoredFileForEdit(file.id),
    save: async (file, text, revision, fileName) => {
      const result = await (file ? saveStoredFileText(file.id, text, revision) : createStoredTextFile(parentId, fileName, text))
      return { document: result, revision: result.revision ?? null }
    },
    refresh: () => queryClient.invalidateQueries({ queryKey: FILES_QUERY_KEY }),
    tooLarge: (file) => file.size > MAX_TEXT_DOCUMENT_BYTES,
    tooLargeTitle: t({ ko: '2MB가 넘는 파일은 여기서 편집할 수 없어', en: 'Files over 2 MB cannot be edited here' }),
  }), [parentId, queryClient, t])
  return <TextDocumentEditor entry={entry} store={store} onClose={onClose} chatPage={chatPage} />
}
