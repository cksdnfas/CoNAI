import { useLayoutEffect, useRef, useState, type SetStateAction } from 'react'
import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useI18n } from '@/i18n'
import { isChatRevisionConflict } from '@/lib/api-codex-chat-core'
import { getErrorMessage } from '@/lib/error-message'
import { chatDraftEqual as same } from '@/features/codex-chat/chat-draft-equal'
import { refetchActiveChatQuery } from '@/features/codex-chat/chat-query-refresh'

/** One mounted editor owns one draft. A list refresh is not a new open or permission to replace its base. */
export function useChatResourceEditor<R extends { id: number; revision: number }, D extends object>(options: {
  initial: R | null
  draftOf: (record: R | null) => D
  write: (record: R | null, draft: D) => Promise<R>
  refresh: QueryKey[]
  onSaved?: (record: R, created: boolean) => void
  onClose: () => void
}) {
  const { t } = useI18n()
  const confirm = useConfirm()
  const { showSnackbar } = useSnackbar()
  const client = useQueryClient()
  const [base, setBase] = useState(options.initial)
  const stored = useRef(base)
  const [baseline, setBaseline] = useState(() => options.draftOf(options.initial))
  const [draft, showDraft] = useState(baseline)
  const [reload, setReload] = useState(0)
  const current = useRef(draft)
  const saving = useRef(false)
  const mounted = useRef(false)
  useLayoutEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  const setDraft = (update: SetStateAction<D>) => {
    current.current = typeof update === 'function' ? (update as (before: D) => D)(current.current) : update
    showDraft(current.current)
  }
  const mutation = useMutation({
    mutationFn: async (submitted: D) => {
      if (saving.current) throw new Error(t({ ko: '저장이 끝난 뒤 다시 저장해줘.', en: 'Wait for the current save to finish.' }))
      saving.current = true
      const before = stored.current
      try {
        const saved = await options.write(before, submitted)
        const normalized = options.draftOf(saved)
        stored.current = saved
        if (mounted.current) {
          const next = { ...normalized }
          // The server can normalize fields; keep only edits that arrived after submission on top.
          for (const key of Object.keys(current.current) as Array<keyof D>) {
            if (!same(current.current[key], submitted[key])) next[key] = current.current[key]
          }
          setBase(saved)
          setBaseline(normalized)
          setDraft(next)
        }
        options.onSaved?.(saved, before === null)
        await Promise.all(options.refresh.map(queryKey => refetchActiveChatQuery(client, queryKey)))
        if (mounted.current && same(current.current, normalized)) options.onClose()
        return saved
      } finally {
        saving.current = false
      }
    },
    onError: async error => {
      if (!mounted.current) return
      if (isChatRevisionConflict(error) && error.current && (error.current as R).id === stored.current?.id) {
        const latest = error.current as R
        const before = current.current
        const load = await confirm({
          title: t({ ko: '다른 곳에서 바뀌었어', en: 'Changed elsewhere' }),
          description: t({ ko: '내 초안을 버리고 최신 내용을 불러올까?', en: 'Discard this draft and load the latest saved version?' }),
          confirmLabel: t({ ko: '최신 불러오기', en: 'Load latest' }), cancelLabel: t({ ko: '계속 편집', en: 'Keep editing' }),
        })
        if (load && mounted.current && before === current.current) {
          const next = options.draftOf(latest)
          stored.current = latest
          setBase(latest)
          setBaseline(next)
          setDraft(next)
          setReload(n => n + 1)
        }
        return
      }
      showSnackbar({ message: getErrorMessage(error, t({ ko: '저장하지 못했어.', en: 'Could not save.' })), tone: 'error' })
    },
  })
  const saveMutation = {
    isPending: mutation.isPending,
    mutate: () => mutation.mutate(current.current),
    mutateAsync: () => mutation.mutateAsync(current.current),
  }
  return { base, draft, setDraft, dirty: !same(baseline, draft), saveMutation, reload }
}
