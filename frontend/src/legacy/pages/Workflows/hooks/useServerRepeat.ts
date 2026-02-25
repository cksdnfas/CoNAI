import { useState, useRef, useEffect } from 'react';
import type { ComfyUIServer } from '../../../services/api/comfyuiServerApi';
import type { RepeatConfig } from '../../ImageGeneration/components/RepeatControls';
import type { ServerRepeatState } from '../types/workflow.types';

interface UseServerRepeatProps {
  servers: ComfyUIServer[];
  repeatConfig: RepeatConfig;
  handleGenerateOnServer: (serverId: number) => Promise<void>;
}

/**
 * 서버별 독립 반복 실행 Hook
 * - 서버별 독립적인 반복 실행 제어
 * - 서버별 진행 상태 관리
 * - 클로저 문제 해결을 위한 상태 관리
 */
export function useServerRepeat({
  servers,
  repeatConfig,
  handleGenerateOnServer
}: UseServerRepeatProps) {
  const [serverRepeatStates, setServerRepeatStates] = useState<Record<number, ServerRepeatState>>({});
  const repeatConfigRef = useRef(repeatConfig);
  const serverRepeatStatesRef = useRef(serverRepeatStates);

  useEffect(() => {
    repeatConfigRef.current = repeatConfig;
  }, [repeatConfig]);

  useEffect(() => {
    serverRepeatStatesRef.current = serverRepeatStates;
  }, [serverRepeatStates]);

  /**
   * 서버별 반복 실행 시작
   */
  const handleStartServerRepeat = (serverId: number) => {
    const server = servers.find(s => s.id === serverId);
    if (!server) return;

    console.log('[Server Repeat] Starting repeat execution for server', {
      serverId,
      serverName: server.name,
      count: repeatConfig.count,
      delaySeconds: repeatConfig.delaySeconds
    });

    // 새로운 상태 객체 생성
    const newState: ServerRepeatState = {
      isRunning: true,
      currentIteration: 0, // 0부터 시작
      totalIterations: repeatConfig.count === -1 ? -1 : repeatConfig.count,
      timeoutId: null
    };

    // React 상태 업데이트 (비동기)
    setServerRepeatStates(prev => ({
      ...prev,
      [serverId]: newState
    }));

    // ref 즉시 업데이트 (동기) - executeServerGenerationCycle에서 즉시 사용 가능
    serverRepeatStatesRef.current = {
      ...serverRepeatStatesRef.current,
      [serverId]: newState
    };

    // 첫 번째 생성 시작 (이제 ref에 상태가 있으므로 정상 동작)
    executeServerGenerationCycle(serverId, 0);
  };

  /**
   * 서버별 생성 사이클 실행 (순차 처리)
   */
  const executeServerGenerationCycle = async (serverId: number, iteration: number) => {
    // 최신 설정 가져오기
    const currentConfig = repeatConfigRef.current;

    // 서버 상태 확인 (ref로 최신 상태 참조)
    const currentState = serverRepeatStatesRef.current[serverId];
    if (!currentState || !currentState.isRunning) {
      console.log('[Server Repeat] Stopped (state not found or not running)', { serverId });
      return;
    }

    // 무한반복 방지: 최대 100회
    const MAX_SAFE_ITERATIONS = 100;
    if (iteration >= MAX_SAFE_ITERATIONS) {
      console.warn('[Server Repeat] Maximum safe iterations reached (100)', { serverId });
      handleStopServerRepeat(serverId);
      return;
    }

    // 종료 조건 체크
    const totalIterations = currentState.totalIterations;
    if (totalIterations !== -1 && iteration >= totalIterations) {
      console.log('[Server Repeat] All iterations completed', {
        serverId,
        iteration,
        totalIterations
      });
      handleStopServerRepeat(serverId);
      return;
    }

    console.log('[Server Repeat] Starting iteration', {
      serverId,
      current: iteration + 1,
      total: totalIterations === -1 ? 'infinite' : totalIterations,
      isRunning: currentState.isRunning
    });

    // 상태 업데이트: 현재 반복 횟수
    setServerRepeatStates(prev => ({
      ...prev,
      [serverId]: {
        ...prev[serverId],
        currentIteration: iteration
      }
    }));

    try {
      // 이미지 생성 완료까지 대기
      await handleGenerateOnServer(serverId);
      console.log('[Server Repeat] Iteration completed', { serverId, iteration: iteration + 1 });

      // 최신 상태 다시 확인 (ref로 최신 상태 참조)
      const latestState = serverRepeatStatesRef.current[serverId];
      if (!latestState || !latestState.isRunning) {
        console.log('[Server Repeat] Stopped during execution', { serverId });
        return;
      }

      const nextIteration = iteration + 1;
      const shouldContinue = totalIterations === -1 || nextIteration < totalIterations;

      if (shouldContinue) {
        console.log('[Server Repeat] Scheduling next iteration after delay', {
          serverId,
          delaySeconds: currentConfig.delaySeconds,
          nextIteration
        });

        // 딜레이 후 다음 반복 실행
        const timeoutId = window.setTimeout(() => {
          executeServerGenerationCycle(serverId, nextIteration);
        }, currentConfig.delaySeconds * 1000);

        setServerRepeatStates(prev => ({
          ...prev,
          [serverId]: {
            ...prev[serverId],
            timeoutId
          }
        }));
      } else {
        console.log('[Server Repeat] Finished all iterations', { serverId });
        handleStopServerRepeat(serverId);
      }
    } catch (error) {
      console.error('[Server Repeat] Error during iteration', { serverId, iteration, error });
      handleStopServerRepeat(serverId);
    }
  };

  /**
   * 서버별 반복 실행 중지
   */
  const handleStopServerRepeat = (serverId: number) => {
    setServerRepeatStates(prev => {
      const state = prev[serverId];
      if (state?.timeoutId) {
        clearTimeout(state.timeoutId);
      }

      console.log('[Server Repeat] Stopping repeat execution', { serverId });

      const newStates = { ...prev };
      delete newStates[serverId];
      return newStates;
    });
  };

  return {
    serverRepeatStates,
    handleStartServerRepeat,
    handleStopServerRepeat
  };
}
