import { Router, Request, Response } from 'express';

const router = Router();

/**
 * GET /api/nai/user/data
 * NovelAI 사용자 정보 조회 (Anlas 잔액, 구독 정보)
 */
router.get('/data', async (req: Request, res: Response) => {
  try {
    // Authorization 헤더에서 토큰 추출 (프론트엔드에서 전송)
    const authHeader = req.headers.authorization;
    const token = authHeader?.replace('Bearer ', '');

    if (!token) {
      res.status(401).json({ error: 'NovelAI 인증이 필요합니다. 먼저 로그인하세요.' });
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
        anlasBalance = subscriptionData.trainingStepsLeft?.fixedTrainingStepsLeft || 0;
      }

      res.json({
        subscription: {
          tier: userData.subscription?.tier || 0,
          active: userData.subscription?.active || false,
          tierName: getTierName(userData.subscription?.tier || 0),
        },
        anlasBalance,
      });
      return;
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
