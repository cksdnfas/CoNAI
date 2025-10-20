/**
 * Anlas 비용 계산 유틸리티
 * Python 참조 구현과 동일한 알고리즘
 */

interface CostCalculationParams {
  width?: number;
  height?: number;
  steps?: number;
  n_samples?: number;
  uncond_scale?: number;
  sm?: boolean;
  sm_dyn?: boolean;
  strength?: number;
  is_opus?: boolean;
}

/**
 * Anlas 비용 계산 함수
 */
export function calculateAnlasCost(params: CostCalculationParams): number {
  const {
    width = 1024,
    height = 1024,
    steps = 28,
    n_samples = 1,
    uncond_scale = 1.0,
    sm = true,
    sm_dyn = false,
    strength = 1.0,
    is_opus = false
  } = params;

  // 해상도 계산
  let resolution = Math.max(width * height, 65536);

  // 일반 해상도 정규화 (832x1216 = 1,011,712)
  const NORMAL_PORTRAIT = 832 * 1216;
  const NORMAL_SQUARE = 1024 * 1024;

  if (resolution > NORMAL_PORTRAIT && resolution <= NORMAL_SQUARE) {
    resolution = NORMAL_PORTRAIT;
  }

  // SMEA 배율
  let smeaFactor = 1.0;
  if (sm_dyn) smeaFactor = 1.4;
  else if (sm) smeaFactor = 1.2;

  // 기본 비용 계산
  let perSample = Math.ceil(
    2.951823174884865e-21 * resolution +
    5.753298233447344e-7 * resolution * steps
  ) * smeaFactor;

  // img2img strength 적용
  perSample = Math.max(Math.ceil(perSample * strength), 2);

  // Undesired Content Strength 보정
  if (uncond_scale !== 1.0) {
    perSample = Math.ceil(perSample * 1.3);
  }

  // Opus 무료 생성 (조건: steps≤28, 일반 해상도 이하)
  const opusDiscount =
    is_opus &&
    steps <= 28 &&
    resolution <= NORMAL_SQUARE ? 1 : 0;

  return perSample * (n_samples - opusDiscount);
}

/**
 * 잔액으로 생성 가능한 최대 샘플 수 계산
 */
export function getMaxSamples(
  params: { width: number; height: number; steps: number; sm: boolean; sm_dyn: boolean },
  anlasBalance: number,
  subscriptionTier: number
): number {
  const isOpus = subscriptionTier === 3;

  // 샘플당 비용 계산
  const costPerSample = calculateAnlasCost({
    ...params,
    n_samples: 1,
    is_opus: isOpus
  });

  if (costPerSample === 0) {
    // Opus 무료 생성 가능한 경우
    return getMaxSamplesByResolution(params.width, params.height);
  }

  // 잔액으로 생성 가능한 최대 수
  const maxByBalance = Math.floor(anlasBalance / costPerSample);

  // 해상도 제한과 비교하여 최소값 반환
  const maxByResolution = getMaxSamplesByResolution(params.width, params.height);

  return Math.min(maxByBalance, maxByResolution);
}

/**
 * 해상도별 최대 샘플 수 계산 (시스템 제한)
 */
function getMaxSamplesByResolution(width: number, height: number): number {
  const pixels = width * height;

  if (pixels <= 512 * 704) return 8;      // 360,448
  if (pixels <= 640 * 640) return 6;      // 409,600
  if (pixels <= 1024 * 1280) return 4;    // 1,310,720
  if (pixels <= 1024 * 1536) return 2;    // 1,572,864

  return 1; // 최대 해상도
}
