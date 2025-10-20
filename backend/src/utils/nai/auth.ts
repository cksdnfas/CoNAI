import argon2 from 'argon2';
// @ts-ignore - no types available
import { createHash } from 'blake2';

// 세션 토큰 저장 (메모리)
let currentToken: string | null = null;

/**
 * 현재 NovelAI 인증 토큰 저장
 */
export function setToken(token: string): void {
  currentToken = token;
}

/**
 * 현재 NovelAI 인증 토큰 반환
 */
export function getToken(): string | null {
  return currentToken;
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
    // Python의 blake2b(digest_size=16)와 정확히 동일
    const blake2Hash = createHash('blake2b', { digestLength: 16 });
    blake2Hash.update(Buffer.from(preSalt));
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
