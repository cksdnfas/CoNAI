import { Router, Request, Response } from 'express';
import { getToken } from '../../utils/nai/auth';

const router = Router();

/**
 * GET /api/nai/user/data
 * NovelAI 사용자 정보 조회 (Anlas 잔액, 구독 정보)
 */
router.get('/data', async (req: Request, res: Response) => {
  try {
    // Authorization 헤더에서 토큰 추출 (프론트엔드에서 전송)
    const authHeader = req.headers.authorization;
    const token = authHeader?.replace('Bearer ', '') || getToken();

    if (!token) {
      res.json(createDisconnectedUserData('missing_token'));
      return;
    }

    try {
      const response = await fetch('https://api.novelai.net/user/data', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[NAI] User data fetch failed:', response.status, errorText);

        if (response.status === 401 || response.status === 403) {
          res.json(createDisconnectedUserData('invalid_token'));
          return;
        }

        res.status(response.status).json({
          error: `NovelAI API 오류: ${response.status} - ${errorText}`,
        });
        return;
      }

      const userData: any = await response.json();

      // NovelAI API 응답 형식:
      // {
      //   "subscription": {
      //     "tier": 3,           // 0=Free, 1=Tablet, 2=Scroll, 3=Opus
      //     "active": true,
      //     "expiresAt": 1234567890000
      //   },
      //   "trainingStepsLeft": {
      //     "fixedTrainingStepsLeft": 0,
      //     "purchasedTrainingSteps": 0
      //   },
      //   "accountSettings": {...},
      //   ...
      // }

      // Anlas는 별도 API로 조회
      const anlasResponse = await fetch('https://api.novelai.net/user/subscription', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      let anlasBalance = 0;
      if (anlasResponse.ok) {
        const subscriptionData: any = await anlasResponse.json();
        // Anlas 잔액 추출 (trainingStepsLeft는 학습 스텝이며, Anlas와 다를 수 있음)
        // NovelAI API는 trainingStepsLeft.fixedTrainingStepsLeft를 Anlas로 사용
        anlasBalance = subscriptionData.trainingStepsLeft?.fixedTrainingStepsLeft || 0;
      }

      // 구독 정보 추출
      const subscription = userData.subscription || {};
      const tierValue = subscription.tier ?? 0;

      res.json({
        connected: true,
        subscription: {
          tier: tierValue,
          active: subscription.active ?? false,
          tierName: getTierName(tierValue),
        },
        anlasBalance,
      });

    } catch (error) {
      console.error('[NAI] User data error:', error);
      res.status(500).json({
        error: `사용자 정보 조회 실패: ${(error as Error).message}`,
      });
      return;
    }
  } catch (err) {
    console.error('[NAI] Unexpected error:', err);
    res.status(500).json({ error: 'Internal server error' });
    return;
  }
});

function createDisconnectedUserData(reason: 'missing_token' | 'invalid_token') {
  return {
    connected: false,
    reason,
    subscription: {
      tier: 0,
      active: false,
      tierName: getTierName(0),
    },
    anlasBalance: 0,
  };
}

/**
 * 구독 티어 이름 반환
 */
function getTierName(tier: number): string {
  switch (tier) {
    case 0:
      return 'Free';
    case 1:
      return 'Tablet';
    case 2:
      return 'Scroll';
    case 3:
      return 'Opus';
    default:
      return 'Unknown';
  }
}

export default router;
