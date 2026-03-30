import argon2 from 'argon2';
import { createHash } from 'node:crypto';
import { ExternalApiProvider } from '../../models/ExternalApiProvider';

const NAI_PROVIDER_NAME = 'novelai';
const NAI_PROVIDER_DISPLAY_NAME = 'NovelAI';
const NAI_PROVIDER_BASE_URL = 'https://api.novelai.net';

// 세션 토큰 메모리 캐시 + 영속 저장 병행
let currentToken: string | null = null;

function persistToken(token: string): void {
  if (!token.trim()) {
    return;
  }

  if (ExternalApiProvider.exists(NAI_PROVIDER_NAME)) {
    ExternalApiProvider.update(NAI_PROVIDER_NAME, {
      display_name: NAI_PROVIDER_DISPLAY_NAME,
      provider_type: 'general',
      api_key: token,
      base_url: NAI_PROVIDER_BASE_URL,
      is_enabled: true,
    });
    return;
  }

  ExternalApiProvider.create({
    provider_name: NAI_PROVIDER_NAME,
    display_name: NAI_PROVIDER_DISPLAY_NAME,
    provider_type: 'general',
    api_key: token,
    base_url: NAI_PROVIDER_BASE_URL,
    is_enabled: true,
  });
}

/**
 * 현재 NovelAI 인증 토큰 저장
 */
export function setToken(token: string): void {
  currentToken = token;
  persistToken(token);
}

/**
 * 현재 NovelAI 인증 토큰 반환
 */
export function getToken(): string | null {
  if (currentToken) {
    return currentToken;
  }

  const persistedToken = ExternalApiProvider.getDecryptedKey(NAI_PROVIDER_NAME);
  if (persistedToken) {
    currentToken = persistedToken;
    return persistedToken;
  }

  return null;
}

/**
 * NovelAI Access Key 생성
 * Python 구현과 동일한 BLAKE2b + Argon2 알고리즘 사용
 */
export async function generateAccessKey(username: string, password: string): Promise<string> {
  try {
    // 1단계: Pre-salt 생성
    const preSalt = `${password.substring(0, 6)}${username}novelai_data_access_key`;
    console.log('Pre-salt:', preSalt);

    // 2단계: BLAKE2b로 Salt 생성 (16바이트)
    // Node 내장 crypto의 blake2b512 + outputLength로 Python blake2b(digest_size=16)와 맞춘다
    const blake2Hash = createHash('blake2b512', { outputLength: 16 });
    blake2Hash.update(preSalt, 'utf8');
    const salt = blake2Hash.digest();
    console.log('Salt (hex):', salt.toString('hex'));

    // 3단계: Argon2 해싱
    const hash = await argon2.hash(password, {
      type: argon2.argon2id,        // Type.ID
      timeCost: 2,                  // 반복 횟수
      memoryCost: Math.floor(2000000 / 1024),  // 1953 KiB (Python과 동일)
      parallelism: 1,
      hashLength: 64,
      salt: salt,
      raw: true                     // Buffer 반환
    });

    console.log('Argon2 hash (hex):', hash.toString('hex'));

    // 4단계: Base64 URL-safe 인코딩 후 64자 추출
    // Python의 urlsafe_b64encode와 동일하게 패딩 포함
    const base64 = hash.toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');

    const accessKey = base64.substring(0, 64);
    console.log('Access key:', accessKey);

    return accessKey;

  } catch (error) {
    throw new Error(`Access key generation failed: ${(error as Error).message}`);
  }
}
