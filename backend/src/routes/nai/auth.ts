import { Router, Request, Response } from 'express';
import axios from 'axios';
import { generateAccessKey, setToken } from '../../utils/nai/auth';

const router = Router();

interface LoginRequest {
  username: string;
  password: string;
}

interface TokenLoginRequest {
  token: string;
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
    expiresAt.setDate(expiresAt.getDate() + 365);

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

/**
 * POST /api/nai/auth/login-with-token
 * Body: { token: string }
 * Response: { accessToken: string, expiresAt: string }
 */
router.post('/login-with-token', async (req: Request<{}, {}, TokenLoginRequest>, res: Response): Promise<void> => {
  try {
    let { token } = req.body;

    // 입력 검증 및 정리
    if (!token) {
      res.status(400).json({
        error: 'Access token is required'
      });
      return;
    }

    // 토큰 trim 처리 (복사-붙여넣기 시 공백 제거)
    token = token.trim();

    // 토큰 유효성 검증 - NovelAI API로 사용자 정보 조회
    try {
      console.log('[NAI] Validating token...');
      console.log('[NAI] Token length:', token.length);
      console.log('[NAI] Token preview:', token.substring(0, 10) + '...');

      const response = await axios.get(
        'https://api.novelai.net/user/subscription',
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            'Origin': 'https://novelai.net',
            'Referer': 'https://novelai.net',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          },
          timeout: 10000 // 10초 타임아웃 추가
        }
      );

      console.log('[NAI] Token validation successful');
      console.log('[NAI] Subscription info:', response.data);

      // 토큰이 유효하면 저장 및 반환 (30일 유효)
      setToken(token);

      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 365);

      res.json({
        accessToken: token,
        expiresAt: expiresAt.toISOString()
      });
      return;
    } catch (validationError: any) {
      console.error('[NAI] Token validation error:', {
        status: validationError.response?.status,
        statusText: validationError.response?.statusText,
        data: validationError.response?.data,
        message: validationError.message
      });

      if (validationError.response?.status === 401) {
        res.status(401).json({
          error: 'Invalid or expired token'
        });
        return;
      }

      throw validationError;
    }
  } catch (error: any) {
    console.error('NAI token login error:', error.response?.data || error.message);

    res.status(500).json({
      error: 'Token authentication failed',
      details: error.response?.data?.message || error.message
    });
    return;
  }
});

export default router;
