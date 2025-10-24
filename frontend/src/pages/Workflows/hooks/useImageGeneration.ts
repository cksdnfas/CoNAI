import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { workflowApi, type Workflow, type MarkedField } from '../../../services/api/workflowApi';
import { generationHistoryApi } from '../../../services/api';
import type { ComfyUIServer } from '../../../services/api/comfyuiServerApi';
import type { ServerGenerationStatus } from '../types/workflow.types';

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

      const promptData = getPromptData();
      const response = await workflowApi.generateImageOnServer(
        parseInt(workflowId!),
        serverId,
        promptData,
        selectedGroupId || undefined
      );

      // api_history_id 저장하고 폴링 시작
      const apiHistoryId = response.data.api_history_id;
      if (!apiHistoryId) {
        console.error('No api_history_id in response');
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
    return new Promise((resolve, reject) => {
      const checkStatus = async () => {
        try {
          const response = await generationHistoryApi.getById(apiHistoryId);
          const data = response.record;

          if (data.generation_status === 'completed' || data.generation_status === 'failed') {
            setGenerationStatus(prev => ({
              ...prev,
              [serverId]: {
                status: data.generation_status as 'completed' | 'failed',
                historyId: apiHistoryId,
                error: data.error_message
              }
            }));

            // 생성 완료 시 업로드 완료 대기 후 히스토리 목록 새로고침
            if (data.generation_status === 'completed') {
              await waitForUploadCompletion(apiHistoryId);
              resolve(); // 성공 완료
            } else {
              reject(new Error(data.error_message || 'Generation failed'));
            }
          } else {
            // 계속 폴링
            setTimeout(checkStatus, 2000);
          }
        } catch (err) {
          console.error('Failed to check status:', err);
          setTimeout(checkStatus, 2000); // 에러가 나도 계속 시도
        }
      };

      checkStatus();
    });
  };

  /**
   * 업로드 완료 대기 후 히스토리 새로고침
   */
  const waitForUploadCompletion = async (historyId: number) => {
    const maxAttempts = 30; // 최대 30초 대기
    const pollInterval = 1000; // 1초마다 체크
    let attempts = 0;

    const checkCompletion = async (): Promise<boolean> => {
      try {
        const response = await generationHistoryApi.getById(historyId);
        return response.record.generation_status === 'completed';
      } catch {
        return false;
      }
    };

    const poll = async () => {
      attempts++;
      const isCompleted = await checkCompletion();

      if (isCompleted) {
        // 업로드 완료 - 히스토리 새로고침
        setHistoryRefreshKey(prev => prev + 1);
      } else if (attempts < maxAttempts) {
        // 아직 완료 안됨 - 계속 폴링
        setTimeout(poll, pollInterval);
      } else {
        // 타임아웃 - 그냥 새로고침
        setHistoryRefreshKey(prev => prev + 1);
      }
    };

    // 폴링 시작
    poll();
  };

  return {
    historyRefreshKey,
    handleGenerateOnServer
  };
}
