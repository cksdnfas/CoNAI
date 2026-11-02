import { useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ClipboardCopy, Loader2, SlidersHorizontal } from 'lucide-react'
import type { ActionMenuAction } from '@/components/ui/action-menu'
import { IconButton } from '@/components/ui/icon-button'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useImageViewModal } from '@/features/images/components/detail/image-view-modal-context'
import { useI18n } from '@/i18n'
import { getGenerationHistoryRequest } from '@/lib/api-image-generation-history'
import { copyTextToClipboard } from '@/lib/clipboard'
import { getErrorMessage } from '@/lib/error-message'
import { requestHistorySettingsLoad } from '../history-settings-load-store'

type GenerationHistoryReuseActionsProps = {
  historyId: number | null
  between?: ReactNode
}

function readPayloadText(payload: Record<string, unknown> | null, key: string) {
  const value = payload?.[key]
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

/** Copy the prompt of, or reload the settings from, one generation history record (generation result stage). */
export function GenerationHistoryReuseActions({ historyId, between }: GenerationHistoryReuseActionsProps) {
  const { busyAction, copy, load } = useGenerationHistoryReuseMenuActions(historyId)
  if (!copy || !load) return between ?? null

  return (
    <>
      <IconButton size="icon-sm" variant="secondary" onClick={load.onSelect} disabled={load.disabled} label={load.label}>
        {busyAction === 'load' ? <Loader2 className="animate-spin" /> : <SlidersHorizontal />}
      </IconButton>
      {between}
      <IconButton size="icon-sm" variant="secondary" onClick={copy.onSelect} disabled={copy.disabled} label={copy.label}>
        {busyAction === 'copy' ? <Loader2 className="animate-spin" /> : <ClipboardCopy />}
      </IconButton>
    </>
  )
}

/** Hover actions on a history list card. Touch has no hover: the card's ⋯ menu carries the same two actions there. */
export function GenerationHistoryCardReuseActions({ historyId, reuse }: { historyId: number; reuse: GenerationHistoryReuse }) {
  const { copy, load } = reuse.getMenuActions(historyId)
  const busyAction = reuse.busy?.historyId === historyId ? reuse.busy.action : null

  return (
    <div className="contents pointer-coarse:hidden">
      <IconButton size="icon-sm" variant="overlay" onClick={load.onSelect} disabled={load.disabled} label={load.label}>
        {busyAction === 'load' ? <Loader2 className="animate-spin" /> : <SlidersHorizontal />}
      </IconButton>
      <IconButton size="icon-sm" variant="overlay" onClick={copy.onSelect} disabled={copy.disabled} label={copy.label}>
        {busyAction === 'copy' ? <Loader2 className="animate-spin" /> : <ClipboardCopy />}
      </IconButton>
    </div>
  )
}

/** The same two actions as ⋯ menu entries (image modal header); both null without a history record. */
export function useGenerationHistoryReuseMenuActions(historyId: number | null) {
  const { busy, getMenuActions } = useGenerationHistoryReuse()
  const busyAction = busy?.action ?? null
  if (historyId === null) {
    return { busyAction, copy: null, load: null }
  }
  return { busyAction, ...getMenuActions(historyId) }
}

export type GenerationHistoryReuse = ReturnType<typeof useGenerationHistoryReuse>

/** Copy-prompt / load-settings for any history record of a list; one action runs at a time. */
export function useGenerationHistoryReuse() {
  const { t } = useI18n()
  const { showSnackbar } = useSnackbar()
  const queryClient = useQueryClient()
  const imageViewModal = useImageViewModal()
  const [busy, setBusy] = useState<{ action: 'copy' | 'load'; historyId: number } | null>(null)

  const loadSnapshot = (id: number) => queryClient.fetchQuery({
    queryKey: ['generation-history-request', id],
    queryFn: () => getGenerationHistoryRequest(id),
    staleTime: 60_000,
  })

  const handleCopyPrompt = async (id: number) => {
    if (busy) {
      return
    }

    try {
      setBusy({ action: 'copy', historyId: id })
      const snapshot = await loadSnapshot(id)
      // 실제로 생성에 쓰인(와일드카드가 풀린) 결과 메타데이터 프롬프트를 우선하고, 없으면 제출한 요청 프롬프트를 쓴다.
      const prompt = snapshot.result_prompt ?? readPayloadText(snapshot.request_payload, 'prompt')
      if (!prompt) {
        showSnackbar({ message: t({ ko: '이 기록에는 복사할 프롬프트가 없어.', en: 'This record has no prompt to copy.' }), tone: 'error' })
        return
      }

      const negativePrompt = snapshot.result_prompt
        ? snapshot.result_negative_prompt
        : readPayloadText(snapshot.request_payload, 'negative_prompt')
      await copyTextToClipboard(negativePrompt ? `${prompt}\n\nNegative prompt: ${negativePrompt}` : prompt)
      showSnackbar({
        message: negativePrompt
          ? t({ ko: '프롬프트와 네거티브 프롬프트를 복사했어.', en: 'Copied the prompt and negative prompt.' })
          : t({ ko: '프롬프트를 복사했어.', en: 'Copied the prompt.' }),
        tone: 'info',
      })
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, t({ ko: '프롬프트를 복사하지 못했어.', en: 'Failed to copy the prompt.' })), tone: 'error' })
    } finally {
      setBusy(null)
    }
  }

  const handleLoadSettings = async (id: number) => {
    if (busy) {
      return
    }

    try {
      setBusy({ action: 'load', historyId: id })
      const snapshot = await loadSnapshot(id)
      if (snapshot.payload_status !== 'available' || !snapshot.request_payload) {
        showSnackbar({
          message: snapshot.payload_status === 'pruned'
            ? t({ ko: '오래된 기록이라 요청 설정이 이미 정리됐어. 프롬프트 복사는 아직 쓸 수 있어.', en: 'The request settings of this older record were already cleaned up. Copy prompt may still work.' })
            : t({ ko: '이 기록에는 불러올 요청 설정이 남아 있지 않아.', en: 'This record has no stored request settings to load.' }),
          tone: 'error',
        })
        return
      }

      if (snapshot.service_type === 'comfyui' && !snapshot.workflow_id) {
        showSnackbar({ message: t({ ko: '이 기록의 ComfyUI 워크플로우를 알 수 없어.', en: 'The ComfyUI workflow of this record is unknown.' }), tone: 'error' })
        return
      }

      requestHistorySettingsLoad({
        historyId: id,
        serviceType: snapshot.service_type,
        workflowId: snapshot.workflow_id,
        payload: snapshot.service_type === 'codex' && snapshot.result_prompt
          ? { ...snapshot.request_payload, prompt: snapshot.result_prompt, negative_prompt: snapshot.result_negative_prompt ?? '' }
          : snapshot.request_payload,
      })
      imageViewModal?.closeImageView()
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, t({ ko: '기록 설정을 불러오지 못했어.', en: 'Failed to load the record settings.' })), tone: 'error' })
    } finally {
      setBusy(null)
    }
  }

  const getMenuActions = (historyId: number) => {
    const copy: ActionMenuAction & { label: string } = {
      key: 'copy-prompt',
      icon: ClipboardCopy,
      label: t({ ko: '프롬프트 복사', en: 'Copy prompt' }),
      disabled: busy !== null,
      onSelect: () => void handleCopyPrompt(historyId),
    }
    const load: ActionMenuAction & { label: string } = {
      key: 'load-settings',
      icon: SlidersHorizontal,
      label: t({ ko: '이 설정 불러오기', en: 'Load these settings' }),
      disabled: busy !== null,
      onSelect: () => void handleLoadSettings(historyId),
    }
    return { copy, load }
  }

  return { busy, getMenuActions }
}
