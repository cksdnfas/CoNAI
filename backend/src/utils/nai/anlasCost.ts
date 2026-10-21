import { isNaiV5Model } from '@conai/shared';

/**
 * Anlas 비용 계산 유틸리티 (SMEA 비활성화 버전)
 *
 * NovelAI 웹 UI 의 calculateCost 를 따른 표시용 추정치다(청구 기준 아님).
 * 웹 실측(2026-08-28, 참고 구현 NAIA2.0): 정사각 해상도 보정은 없고
 * (1024x1024 29스텝 = V4.5 21 / V5 32), V5 계열만 1.5배다(1472x1472 28스텝 = 42 / 63).
 */

interface CostCalculationParams {
  width?: number;
  height?: number;
  steps?: number;
  n_samples?: number;
  uncond_scale?: number;
  strength?: number;
  /** 실제로 요청이 나가는 모델(resolveNaiRequestModel). V5 계열이면 1.5배를 적용한다. */
  model?: string;
}

/**
 * Anlas 비용 계산 함수 (SMEA 배율 제거)
 */
export function calculateAnlasCost(params: CostCalculationParams): number {
  const {
    width = 1024,
    height = 1024,
    steps = 28,
    n_samples = 1,
    uncond_scale = 1.0,
    strength = 1.0,
    model,
  } = params;

  // 해상도 계산 (256x256 미만은 256x256 으로 친다)
  const resolution = Math.max(width * height, 65536);

  // SMEA 비활성화 (배율 1.0 고정). V5 배수는 안쪽 올림 뒤에 곱해야 웹 값과 맞는다.
  const smeaFactor = 1.0;
  const modelFactor = isNaiV5Model(model) ? 1.5 : 1.0;

  // 기본 비용 계산
  let perSample = Math.ceil(
    2.951823174884865e-6 * resolution +
    5.753298233447344e-7 * resolution * steps
  ) * smeaFactor * modelFactor;

  // img2img strength 적용
  perSample = Math.max(Math.ceil(perSample * strength), 2);

  // Undesired Content Strength 보정
  if (uncond_scale !== 1.0) {
    perSample = Math.ceil(perSample * 1.3);
  }

  // 실제 Anlas 비용 계산 (Opus 무료 생성 로직 제거)
  return perSample * n_samples;
}

/** NovelAI subscription tier value for Opus. */
export const NAI_OPUS_TIER = 3;
/** Opus free generation limits: up to 1024x1024 pixels, 28 steps, one image per request. */
const OPUS_FREE_MAX_PIXELS = 1024 * 1024;
const OPUS_FREE_MAX_STEPS = 28;

/**
 * Opus 무료 생성 여부.
 * NovelAI 규칙: Opus 티어 + 픽셀 수 <= 1024x1024 + steps <= 28 + 1장 생성일 때만 무료다.
 * V5 무료 생성은 Opus 사용량 풀에서 깎이고, 그 풀이 0% 면 같은 조건도 Anlas 로 청구된다.
 * 잔여량을 모르면(null) 기존처럼 무료로 본다. V4.5 이하 무료 생성은 사용량 제한이 없다.
 * (바이브/캐릭터 레퍼런스 등 추가 비용 요소는 검증된 규칙이 없어 반영하지 않는다.)
 */
export function isOpusFreeGeneration(
  params: { width: number; height: number; steps: number; n_samples: number; model?: string },
  subscriptionTier: number,
  opusRemainingPercent: number | null = null
): boolean {
  return subscriptionTier === NAI_OPUS_TIER
    && params.width * params.height <= OPUS_FREE_MAX_PIXELS
    && params.steps <= OPUS_FREE_MAX_STEPS
    && params.n_samples === 1
    && !(isNaiV5Model(params.model) && opusRemainingPercent !== null && opusRemainingPercent <= 0);
}

/**
 * 잔액으로 생성 가능한 최대 샘플 수 계산
 */
export function getMaxSamples(
  params: { width: number; height: number; steps: number; strength?: number; model?: string },
  anlasBalance: number,
  subscriptionTier: number,
  opusRemainingPercent: number | null = null
): number {
  const costPerSample = calculateAnlasCost({
    ...params,
    n_samples: 1
  });

  // 잔액으로 생성 가능한 최대 수. Opus 무료 조건이면 잔액과 무관하게 1장은 가능하다.
  const maxByBalance = Math.floor(anlasBalance / costPerSample);
  const freeSamples = isOpusFreeGeneration({ ...params, n_samples: 1 }, subscriptionTier, opusRemainingPercent) ? 1 : 0;

  // 해상도 제한과 비교하여 최소값 반환
  const maxByResolution = getMaxSamplesByResolution(params.width, params.height);

  return Math.min(Math.max(maxByBalance, freeSamples), maxByResolution);
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
