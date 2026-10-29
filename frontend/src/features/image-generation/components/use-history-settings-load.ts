import { useEffect, useRef } from 'react'
import type { GenerationServiceType } from '@/lib/api-image-generation-types'
import { consumeHistorySettingsLoad, usePendingHistorySettingsLoad, type HistorySettingsLoadRequest } from '../history-settings-load-store'

/** Consume one matching history request once; return false while its target form is still loading. */
export function useHistorySettingsLoad(serviceType: GenerationServiceType, apply: (request: HistorySettingsLoadRequest) => boolean | void) {
  const pending = usePendingHistorySettingsLoad()
  const handled = useRef(0)
  useEffect(() => {
    if (!pending || pending.serviceType !== serviceType || handled.current === pending.nonce) return
    if (apply(pending) === false) return
    handled.current = pending.nonce
    consumeHistorySettingsLoad(pending.nonce)
  })
}
