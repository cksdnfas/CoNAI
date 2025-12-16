import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { enqueueSnackbar } from 'notistack';
import { workflowApi, type Workflow, type MarkedField } from '../../../services/api/workflowApi';
import { generationHistoryApi } from '../../../services/api';
import type { ComfyUIServer } from '../../../services/api/comfyuiServerApi';
import type { ServerGenerationStatus } from '../types/workflow.types';
import { isPromptEmpty } from '../../../utils/promptCleaner';

interface UseImageGenerationProps {
  workflowId: string | undefined;
  workflow: Workflow | null;
  formData: Record<string, any>;
  getPromptData: () => Record<string, any>;
  selectedGroupId: number | null;
  servers: ComfyUIServer[];
  setGenerationStatus: React.Dispatch<React.SetStateAction<Record<number, ServerGenerationStatus>>>;
  setError: (error: string | null) => void;
}

/**
 * 이미지 생성 Hook
 * - 단일 서버 생성
 * - 생성 상태 폴링
 * - 업로드 완료 대기
 */
export function useImageGeneration({
  workflowId,
  workflow,
  formData,
  getPromptData,
  selectedGroupId,
  servers,
  setGenerationStatus,
  setError
}: UseImageGenerationProps) {
  const { t } = useTranslation(['workflows']);
  const [historyRefreshKey, setHistoryRefreshKey] = useState<number>(0);
  const queryClient = useQueryClient();

  /**
   * 단일 서버에서 이미지 생성
   * Promise를 반환하여 생성 완료 시점을 알 수 있음
   */
  const handleGenerateOnServer = async (serverId: number): Promise<void> => {
    const server = servers.find(s => s.id === serverId);
    if (!server) return;

    // 필수 필드 검증
    if (workflow?.marked_fields) {
      const missingFields = workflow.marked_fields.filter(
        (field: MarkedField) => field.required && !formData[field.id]
      );

      if (missingFields.length > 0) {
        setError(t('workflows:generate.missingFields', { fields: missingFields.map(f => f.label).join(', ') }));
        return;
      }
    }

    try {
      // 상태 업데이트
      setGenerationStatus(prev => ({
        ...prev,
        [serverId]: { status: 'generating', progress: 0 }
      }));
      setError(null);

      const parseResult = await getPromptData();

      // 빈 와일드카드 경고
      if (parseResult.emptyWildcards && parseResult.emptyWildcards.length > 0) {
        const uniqueEmpty = Array.from(new Set(parseResult.emptyWildcards));
        enqueueSnackbar(
          `다음 와일드카드에 ComfyUI 항목이 없습니다: ${uniqueEmpty.join(', ')}`,
          { variant: 'warning', autoHideDuration: 5000 }
        );
      }

      // 프롬프트 데이터의 모든 텍스트 필드 검증
      const { hasEmptyPrompts } = await import('../utils/promptBuilder');
      if (hasEmptyPrompts(parseResult.data)) {
        const errorMsg = t('workflows:generate.emptyPrompt');
        setError(errorMsg);
        enqueueSnackbar(errorMsg, { variant: 'error', autoHideDuration: 5000 });
        setGenerationStatus(prev => ({
          ...prev,
          [serverId]: { status: 'failed', error: errorMsg }
        }));
        return;
      }

      const response = await workflowApi.generateImageOnServer(
        parseInt(workflowId!),
        serverId,
        parseResult.data,
        selectedGroupId || undefined
      );

      // history_id 저장하고 폴링 시작
      const apiHistoryId = response.data.history_id;
      if (!apiHistoryId) {
        console.error('No history_id in response');
        setError('Failed to start image generation');
        return;
      }

      setGenerationStatus(prev => ({
        ...prev,
        [serverId]: {
          status: 'generating',
          historyId: apiHistoryId
        }
      }));

      // 폴링 완료 대기 (Promise 반환)
      await pollGenerationStatus(serverId, apiHistoryId);
    } catch (err: any) {
      setGenerationStatus(prev => ({
        ...prev,
        [serverId]: {
          status: 'failed',
          error: err.response?.data?.error || err.message
        }
      }));
      throw err; // 에러를 상위로 전파
    }
  };

  /**
   * 생성 상태 폴링
   * Promise를 반환하여 완료/실패 시점을 알 수 있음
   */
  const pollGenerationStatus = async (serverId: number, apiHistoryId: number): Promise<void> => {
    const maxAttempts = 150; // 5분 최대 대기 (2초 * 150)
    let attempts = 0;
    let timeoutId: NodeJS.Timeout | null = null;

    return new Promise((resolve, reject) => {
      const checkStatus = async () => {
        attempts++;

        try {
          // 캐시 무효화를 위한 타임스탬프 추가
          const response = await generationHistoryApi.getById(apiHistoryId, true);
          const data = response.record;

          console.log(`[ComfyUI] Polling attempt ${attempts}/${maxAttempts} for history ${apiHistoryId}: status="${data.generation_status}"`);

          if (data.generation_status === 'completed' || data.generation_status === 'failed') {
            console.log(`[ComfyUI] ✅ Generation ${apiHistoryId} finished with status: ${data.generation_status}`);

            // 타이머 정리
            if (timeoutId) {
              clearTimeout(timeoutId);
              timeoutId = null;
            }

            // 상태 업데이트를 먼저 수행
            setGenerationStatus(prev => ({
              ...prev,
              [serverId]: {
                status: data.generation_status as 'completed' | 'failed',
                historyId: apiHistoryId,
                error: data.error_message
              }
            }));

            if (data.generation_status === 'completed') {
              console.log(`[ComfyUI] 🔄 Triggering history refresh (refreshKey increment)`);

              // refreshKey 업데이트 후 resolve
              setHistoryRefreshKey(prev => {
                const newKey = prev + 1;
                console.log(`[ComfyUI] historyRefreshKey: ${prev} → ${newKey}`);

                // 갤러리 갱신을 위해 캐시 무효화
                queryClient.invalidateQueries({ queryKey: ['images'] });

                // setState는 비동기이므로 다음 틱에 resolve
                setTimeout(() => resolve(), 0);

                return newKey;
              });
            } else {
              console.error(`[ComfyUI] ❌ Generation failed:`, data.error_message);
              reject(new Error(data.error_message || 'Generation failed'));
            }
            return;
          }

          // Timeout check
          if (attempts >= maxAttempts) {
            console.error(`[ComfyUI] Generation ${apiHistoryId} timeout after ${attempts} attempts`);
            if (timeoutId) clearTimeout(timeoutId);
            reject(new Error('Generation timeout (5 minutes)'));
            return;
          }

          // Continue polling
          timeoutId = setTimeout(checkStatus, 2000);
        } catch (err) {
          console.error(`[ComfyUI] Failed to check status (attempt ${attempts}/${maxAttempts}):`, err);

          // Timeout even on errors
          if (attempts >= maxAttempts) {
            if (timeoutId) clearTimeout(timeoutId);
            reject(new Error('Status check failed after timeout'));
            return;
          }

          // Retry
          timeoutId = setTimeout(checkStatus, 2000);
        }
      };

      checkStatus();
    });
  };

  return {
    historyRefreshKey,
    handleGenerateOnServer
  };
}
