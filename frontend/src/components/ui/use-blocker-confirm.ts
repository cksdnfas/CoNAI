import { useEffect, useRef } from 'react'
import type { Blocker } from 'react-router-dom'
import { useI18n } from '@/i18n'
import { useConfirm } from './confirm-dialog'

/** Ask with the shared confirm dialog whenever a react-router blocker blocks a navigation, then proceed or reset it. */
export function useBlockerConfirm(blocker: Blocker, description: string) {
  const { t } = useI18n()
  const confirm = useConfirm()
  const blockerRef = useRef(blocker)
  const promptingRef = useRef(false)

  useEffect(() => {
    blockerRef.current = blocker
  }, [blocker])

  useEffect(() => {
    if (blocker.state !== 'blocked' || promptingRef.current) {
      return
    }

    promptingRef.current = true
    void confirm({
      title: t({ ko: '저장하지 않은 변경', en: 'Unsaved changes' }),
      description,
      confirmLabel: t({ ko: '나가기', en: 'Leave' }),
      cancelLabel: t({ ko: '머무르기', en: 'Stay' }),
      tone: 'destructive',
    }).then((confirmed) => {
      promptingRef.current = false
      // The dialog is async, so act on the latest blocker and only while it is still waiting for an answer.
      const current = blockerRef.current
      if (current.state !== 'blocked') {
        return
      }

      if (confirmed) {
        current.proceed()
        return
      }

      current.reset()
    })
  }, [blocker, confirm, description, t])
}
