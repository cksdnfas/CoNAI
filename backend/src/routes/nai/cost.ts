import { Router, Request, Response } from 'express';
import { calculateAnlasCost, getMaxSamples } from '../../utils/nai/anlasCost';

const router = Router();

interface CostCalculationRequest {
  width: number;
  height: number;
  steps: number;
  n_samples: number;
  subscriptionTier: number;
  anlasBalance?: number;
}

/**
 * POST /api/nai/cost/calculate
 * NovelAI 이미지 생성 비용 계산 (SMEA 비활성화 버전)
 */
router.post('/calculate', async (req: Request, res: Response) => {
  try {
    const {
      width,
      height,
      steps,
      n_samples,
      subscriptionTier,
      anlasBalance = 0,
    } = req.body as CostCalculationRequest;

    // 입력 검증
    if (!width || !height || !steps || !n_samples) {
      res.status(400).json({
        error: '필수 파라미터 누락: width, height, steps, n_samples',
      });
      return;
    }

    if (width <= 0 || height <= 0 || steps <= 0 || n_samples <= 0) {
      res.status(400).json({
        error: '모든 파라미터는 0보다 커야 합니다',
      });
      return;
    }

    // 비용 계산 (SMEA 비활성화)
    const estimatedCost = calculateAnlasCost({
      width,
      height,
      steps,
      n_samples,
    });

    // 최대 샘플 수 계산
    const maxSamples = getMaxSamples(
      { width, height, steps },
      anlasBalance,
      subscriptionTier
    );

    // Opus 티어는 무료 생성 가능
    const isOpusFree = subscriptionTier === 3;

    // 잔액이 충분한지 확인
    const canAfford = isOpusFree || anlasBalance >= estimatedCost;

    res.json({
      estimatedCost,
      maxSamples,
      canAfford,
      isOpusFree,
      breakdown: {
        baseCost: Math.ceil((width * height * steps) / (1024 * 1024 * 28)),
        smeaMultiplier: 1.0, // SMEA 비활성화 (고정값)
        samplesMultiplier: n_samples,
      },
    });
    return;
  } catch (err) {
    console.error('[NAI] Cost calculation error:', err);
    res.status(500).json({ error: 'Internal server error' });
    return;
  }
});

export default router;
