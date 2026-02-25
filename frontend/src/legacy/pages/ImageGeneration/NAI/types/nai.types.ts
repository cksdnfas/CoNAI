export interface CustomResolution {
  id: string;
  name: string;
  width: number;
  height: number;
}

export interface ResolutionConfig {
  mode: 'fixed' | 'random';
  fixed: string;  // 고정 모드: 선택된 해상도 키
  random: string[];  // 랜덤 모드: 선택된 해상도 키 배열
  customResolutions: CustomResolution[];  // 커스텀 해상도 목록
  swapDimensions: boolean;  // 가로세로 전환 옵션
}

export interface NAIParams {
  model: string;
  prompt: string;
  negative_prompt: string;
  resolution: string;  // 하위 호환성을 위해 유지
  resolutionConfig: ResolutionConfig;  // 새로운 해상도 설정
  steps: number;
  scale: number;
  sampler: string;
  n_samples: number;
  variety_plus: boolean;
  cfg_rescale: number;
  noise_schedule: string;
  uncond_scale: number;
}

export interface NAIUserData {
  subscription: {
    tier: number;
    active: boolean;
    tierName: string;
  };
  anlasBalance: number;
}

export interface NAIGenerationResponse {
  historyIds: number[];
  count: number;
  metadata: Record<string, unknown>;
}

export interface NAIGenerationRequest extends NAIParams {
  width: number;
  height: number;
  groupId?: number;
}
