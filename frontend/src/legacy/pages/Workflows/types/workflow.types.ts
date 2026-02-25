/**
 * WorkflowGeneratePage 관련 타입 정의
 */

/**
 * 서버별 이미지 생성 상태
 */
export interface ServerGenerationStatus {
  status: 'idle' | 'generating' | 'completed' | 'failed';
  historyId?: number;
  progress?: number;
  imageId?: number;
  generatedImage?: any;
  error?: string;
  executionTime?: number;
}

/**
 * 서버별 반복 실행 상태
 */
export interface ServerRepeatState {
  isRunning: boolean;
  currentIteration: number;
  totalIterations: number;
  timeoutId: number | null;
}

/**
 * 서버 연결 상태
 */
export interface ServerConnectionStatus {
  connected: boolean;
  responseTime?: number;
  error?: string;
}
