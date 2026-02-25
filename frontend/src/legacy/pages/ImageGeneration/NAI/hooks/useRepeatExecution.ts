import { useState, useRef, useEffect } from 'react';
import type { RepeatConfig, RepeatState } from '../../components/RepeatControls';

interface UseRepeatExecutionOptions {
  onExecute: (iteration: number) => Promise<void>;
  onComplete?: () => void;
}

/**
 * NovelAI 단일 작업 순차 반복 실행 Hook
 *
 * **용도**: 단일 생성 작업의 순차적 반복 실행
 *
 * **특징**:
 * - 내부 상태 관리 (repeatConfig, repeatState)
 * - setTimeout 기반 순차 반복
 * - 무한 반복 지원 (count: -1)
 * - 최대 100회 안전 제한
 *
 * **차이점**: ComfyUI의 useRepeatExecution은 다중 서버 병렬 실행 조율용
 *
 * @see frontend/src/pages/Workflows/hooks/useRepeatExecution.ts - 다중 서버 조율용
 */
export function useRepeatExecution({ onExecute, onComplete }: UseRepeatExecutionOptions) {
  const [repeatConfig, setRepeatConfig] = useState<RepeatConfig>({
    enabled: false,
    count: 3,
    delaySeconds: 5
  });

  const [repeatState, setRepeatState] = useState<RepeatState>({
    isRunning: false,
    currentIteration: 0,
    totalIterations: 0
  });

  const [repeatTimeoutId, setRepeatTimeoutId] = useState<number | null>(null);

  // useRef로 최신 상태 추적 (클로저 문제 해결)
  const repeatStateRef = useRef(repeatState);
  const repeatConfigRef = useRef(repeatConfig);

  useEffect(() => {
    repeatStateRef.current = repeatState;
  }, [repeatState]);

  useEffect(() => {
    repeatConfigRef.current = repeatConfig;
  }, [repeatConfig]);

  const executeRepeatCycle = async (iteration: number) => {
    const currentState = repeatStateRef.current;
    const currentConfig = repeatConfigRef.current;

    // 무한반복 방지: 최대 100회
    const MAX_SAFE_ITERATIONS = 100;
    if (iteration >= MAX_SAFE_ITERATIONS) {
      console.warn('[Repeat] Maximum safe iterations reached (100)');
      stopRepeat();
      return;
    }

    // 종료 조건 체크
    const totalIterations = currentState.totalIterations;
    if (totalIterations !== -1 && iteration >= totalIterations) {
      console.log('[Repeat] All iterations completed', { iteration, totalIterations });
      stopRepeat();
      if (onComplete) onComplete();
      return;
    }

    // 반복 상태가 중지되었는지 확인
    if (!currentState.isRunning) {
      console.log('[Repeat] Stopped by user', { currentState });
      return;
    }

    console.log('[Repeat] Starting iteration', {
      current: iteration + 1,
      total: totalIterations === -1 ? 'infinite' : totalIterations,
      isRunning: currentState.isRunning
    });

    // 상태 업데이트
    setRepeatState(prev => ({
      ...prev,
      currentIteration: iteration
    }));

    try {
      await onExecute(iteration);

      // 다음 반복 전에 최신 상태 다시 확인
      const latestState = repeatStateRef.current;
      const nextIteration = iteration + 1;
      const shouldContinue = totalIterations === -1 || nextIteration < totalIterations;

      if (shouldContinue && latestState.isRunning) {
        console.log('[Repeat] Scheduling next iteration after delay', {
          delaySeconds: currentConfig.delaySeconds,
          nextIteration
        });

        const timeoutId = window.setTimeout(() => {
          executeRepeatCycle(nextIteration);
        }, currentConfig.delaySeconds * 1000);

        setRepeatTimeoutId(timeoutId);
      } else {
        console.log('[Repeat] Finished all iterations', {
          shouldContinue,
          isRunning: latestState.isRunning
        });
        stopRepeat();
        if (onComplete) onComplete();
      }
    } catch (error) {
      console.error('[Repeat] Error during iteration', { iteration, error });
      stopRepeat();
      throw error;
    }
  };

  const startRepeat = () => {
    if (repeatConfig.enabled && !repeatState.isRunning) {
      console.log('[Repeat] Initializing repeat execution', {
        enabled: repeatConfig.enabled,
        isRunning: repeatState.isRunning,
        count: repeatConfig.count
      });

      setRepeatState({
        isRunning: true,
        currentIteration: 0,
        totalIterations: repeatConfig.count === -1 ? -1 : repeatConfig.count
      });

      // 첫 실행 시작 (setTimeout으로 상태 업데이트 반영)
      setTimeout(() => {
        console.log('[Repeat] Executing first cycle');
        executeRepeatCycle(0);
      }, 100);
    }
  };

  const stopRepeat = () => {
    if (repeatTimeoutId) {
      clearTimeout(repeatTimeoutId);
      setRepeatTimeoutId(null);
    }
    setRepeatState({
      isRunning: false,
      currentIteration: 0,
      totalIterations: 0
    });
  };

  return {
    repeatConfig,
    repeatState,
    setRepeatConfig,
    startRepeat,
    stopRepeat,
    isRepeatMode: repeatConfig.enabled
  };
}
