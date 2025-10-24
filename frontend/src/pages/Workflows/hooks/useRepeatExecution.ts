import { useTranslation } from 'react-i18next';
import type { ComfyUIServer } from '../../../services/api/comfyuiServerApi';
import type { RepeatConfig } from '../../ImageGeneration/components/RepeatControls';

interface UseRepeatExecutionProps {
  servers: ComfyUIServer[];
  serverStatus: Record<number, { connected: boolean }>;
  repeatConfig: RepeatConfig;
  handleGenerateOnServer: (serverId: number) => Promise<void>;
  handleStartServerRepeat: (serverId: number) => void;
  setError: (error: string | null) => void;
}

/**
 * 반복 실행 Hook (동시 생성 조율)
 * - 각 서버에 독립적인 반복 명령 전달
 * - 단일 실행 시 모든 서버 동시 실행
 */
export function useRepeatExecution({
  servers,
  serverStatus,
  repeatConfig,
  handleGenerateOnServer,
  handleStartServerRepeat,
  setError
}: UseRepeatExecutionProps) {
  const { t } = useTranslation(['workflows']);

  /**
   * 모든 서버에 생성 요청 (반복 시 각 서버 독립 실행)
   */
  const handleGenerateOnAllServers = async () => {
    console.log('[ComfyUI Generate] Button clicked', {
      repeatConfig,
      repeatEnabled: repeatConfig.enabled
    });

    const connectedServers = servers.filter(s => serverStatus[s.id]?.connected);

    if (connectedServers.length === 0) {
      setError(t('workflows:generate.noConnectedServers'));
      return;
    }

    // 반복 실행 모드: 각 서버에 독립적인 반복 명령 전달
    if (repeatConfig.enabled) {
      console.log('[ComfyUI Repeat] Starting independent repeat execution on all servers', {
        count: repeatConfig.count,
        delaySeconds: repeatConfig.delaySeconds,
        servers: connectedServers.map(s => s.name)
      });

      // 각 서버에 독립적으로 반복 실행 시작
      connectedServers.forEach(server => {
        handleStartServerRepeat(server.id);
      });

      return;
    }

    // 단일 실행 (반복 없음): 모든 서버 동시 실행
    console.log('[ComfyUI Generate] Single execution mode', {
      connectedServers: connectedServers.length
    });
    const generationPromises = connectedServers.map(server =>
      handleGenerateOnServer(server.id)
    );
    await Promise.all(generationPromises);
  };


  return {
    handleGenerateOnAllServers
  };
}
