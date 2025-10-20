import { Router, Request, Response } from 'express';
import axios from 'axios';
import { generateAccessKey, setToken } from '../../utils/nai/auth';

const router = Router();

interface LoginRequest {
  username: string;
  password: string;
}

/**
 * POST /api/nai/auth/login
 * Body: { username: string, password: string }
 * Response: { accessToken: string, expiresAt: Date }
 */
router.post('/login', async (req: Request<{}, {}, LoginRequest>, res: Response): Promise<void> => {
  try {
    const { username, password } = req.body;

    // 입력 검증
    if (!username || !password) {
      res.status(400).json({
        error: 'Username and password are required'
      });
      return;
    }

    // Access Key 생성
    const accessKey = await generateAccessKey(username, password);

    // NovelAI 로그인 요청
    const response = await axios.post(
      'https://api.novelai.net/user/login',
      { key: accessKey },
      {
        headers: {
          'Content-Type': 'application/json',
          'Origin': 'https://novelai.net',
          'Referer': 'https://novelai.net',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      }
    );

    // Access Token 저장 및 반환 (30일 유효)
    const accessToken = response.data.accessToken;
    setToken(accessToken);

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

    res.json({
      accessToken,
      expiresAt: expiresAt.toISOString()
    });
    return;
  } catch (error: any) {
    console.error('NAI login error:', error.response?.data || error.message);

    if (error.response?.status === 401) {
      res.status(401).json({
        error: 'Invalid credentials'
      });
      return;
    }

    res.status(500).json({
      error: 'Authentication failed',
      details: error.response?.data?.message || error.message
    });
    return;
  }
});

export default router;
