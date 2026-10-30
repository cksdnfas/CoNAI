import { useQueryClient } from '@tanstack/react-query'
import type { ChatPageData, NativeChatPageActionId } from '@conai/shared'
import { pageAction, pageFreeText, pageNumber, pageObject } from '@/features/codex-chat/page-action-helpers'
import { useI18n } from '@/i18n'
import { getGenerationHistoryRequest } from '@/lib/api-image-generation-history'
import type { GenerationHistoryRecord, GenerationServiceType } from '@/lib/api-image-generation-types'
import { resolveHistoryDisplayStatus } from '../generation-history-status'

export type GenerationSubmitResult = boolean | { queued: number; requested: number }

export function useGenerationChatRuns(id: NativeChatPageActionId, serviceType: GenerationServiceType, records: GenerationHistoryRecord[], generate: () => Promise<GenerationSubmitResult>, workflowId?: number) {
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const finished = records.filter((record) => ['completed', 'failed'].includes(resolveHistoryDisplayStatus(record)))
  const generating = records.some((record) => ['pending', 'processing'].includes(resolveHistoryDisplayStatus(record)))
  const recentRuns = finished.slice(0, 5).map((record) => ({
    id: record.id,
    hash: record.actual_composite_hash ?? record.composite_hash ?? '',
    error: pageFreeText((record.error_message ?? '').slice(0, 200)),
  }))
  const actions = [
    pageAction(id, t({ ko: '생성 실행', en: 'Run generation' }), t({ ko: '현재 입력으로 생성 큐에 등록해. 비용이 발생할 수 있어.', en: 'Queue generation with the current inputs; charges may apply.' }), undefined, 'save', {}),
    pageAction('generation.history_load', t({ ko: '생성 기록 설정 불러오기', en: 'Load generation history settings' }), t({ ko: '생성 기록 ID의 요청 설정을 화면에 불러와. 이미지 입력(원본·마스크·바이브·레퍼런스)은 복원되지 않으니 필요하면 다시 넣거나 사용자에게 알려줘.', en: 'Load the request settings of a generation history ID into the form. Image inputs (source, mask, vibes, references) are not restored; attach them again or tell the user.' }), pageObject({ historyId: pageNumber(1, undefined, true) }, ['historyId'])),
  ]
  const apply = async (actionId: string, args: Record<string, ChatPageData>, assertCurrent: () => void) => {
    if (actionId === id) {
      assertCurrent()
      const result = await generate()
      if (result === false) throw new Error(t({ ko: '생성을 큐에 등록하지 못했어. 화면의 오류를 확인해줘.', en: 'Generation was not queued. Check the error on the page.' }))
      if (typeof result === 'object') throw new Error(t({ ko: '{requested}건 중 {queued}건이 이미 큐에 등록됐어. 중복 실행을 피하려면 재시도 전에 결과를 확인해줘.', en: '{queued} of {requested} jobs were already queued. Check results before retrying to avoid duplicates.' }, result))
      return true
    }
    return false
  }
  const loadHistory = async (args: Record<string, ChatPageData>, assertCurrent: () => void) => {
    const historyId = Number(args.historyId)
    const snapshot = await queryClient.fetchQuery({ queryKey: ['generation-history-request', historyId], queryFn: () => getGenerationHistoryRequest(historyId), staleTime: 60_000 })
    assertCurrent()
    if (snapshot.service_type !== serviceType || snapshot.payload_status !== 'available' || !snapshot.request_payload) throw new Error(t({ ko: '이 기록의 설정을 현재 생성 화면에 불러올 수 없어.', en: 'This history record cannot be loaded into this generation screen.' }))
    if (serviceType === 'comfyui' && (!workflowId || snapshot.workflow_id !== workflowId)) throw new Error(t({ ko: '이 기록의 워크플로우를 먼저 선택해서 열어줘.', en: 'Select and open this record’s workflow first.' }))
    return serviceType === 'codex' && snapshot.result_prompt
      ? { ...snapshot.request_payload, prompt: snapshot.result_prompt, negative_prompt: snapshot.result_negative_prompt ?? '' }
      : snapshot.request_payload
  }
  return { actions, recentRuns, generating, apply, loadHistory }
}
