import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ClipboardCopy, Loader2, SlidersHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useImageViewModal } from '@/features/images/components/detail/image-view-modal-context'
import { useI18n } from '@/i18n'
import { getGenerationHistoryRequest } from '@/lib/api-image-generation-history'
import { copyTextToClipboard } from '@/lib/clipboard'
import { getErrorMessage } from '@/lib/error-message'
import { requestHistorySettingsLoad } from '../history-settings-load-store'

type GenerationHistoryReuseActionsProps = {
  historyId: number
}

function readPayloadText(payload: Record<string, unknown> | null, key: string) {
  const value = payload?.[key]
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

/** Copy the prompt of, or reload the settings from, one generation history record (image modal header). */
export function GenerationHistoryReuseActions({ historyId }: GenerationHistoryReuseActionsProps) {
  const { t } = useI18n()
  const { showSnackbar } = useSnackbar()
  const queryClient = useQueryClient()
  const imageViewModal = useImageViewModal()
  const [busyAction, setBusyAction] = useState<'copy' | 'load' | null>(null)

  const loadSnapshot = () => queryClient.fetchQuery({
    queryKey: ['generation-history-request', historyId],
    queryFn: () => getGenerationHistoryRequest(historyId),
    staleTime: 60_000,
  })

  const handleCopyPrompt = async () => {
    if (busyAction) {
      return
    }

    try {
      setBusyAction('copy')
      const snapshot = await loadSnapshot()
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
      setBusyAction(null)
    }
  }

  const handleLoadSettings = async () => {
    if (busyAction) {
      return
    }

    try {
      setBusyAction('load')
      const snapshot = await loadSnapshot()
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
        historyId,
        serviceType: snapshot.service_type,
        workflowId: snapshot.workflow_id,
        payload: snapshot.request_payload,
      })
      imageViewModal?.closeImageView()
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, t({ ko: '기록 설정을 불러오지 못했어.', en: 'Failed to load the record settings.' })), tone: 'error' })
    } finally {
      setBusyAction(null)
    }
  }

  const copyLabel = t({ ko: '프롬프트 복사', en: 'Copy prompt' })
  const loadLabel = t({ ko: '이 설정 불러오기', en: 'Load these settings' })

  return (
    <>
      <Button size="icon-sm" variant="secondary" onClick={() => void handleCopyPrompt()} disabled={busyAction !== null} aria-label={copyLabel} title={copyLabel}>
        {busyAction === 'copy' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ClipboardCopy className="h-4 w-4" />}
      </Button>
      <Button size="icon-sm" variant="secondary" onClick={() => void handleLoadSettings()} disabled={busyAction !== null} aria-label={loadLabel} title={loadLabel}>
        {busyAction === 'load' ? <Loader2 className="h-4 w-4 animate-spin" /> : <SlidersHorizontal className="h-4 w-4" />}
      </Button>
    </>
  )
}
