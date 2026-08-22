import { ExternalApiProvider } from '../../models/ExternalApiProvider';

const NAI_PROVIDER_NAME = 'novelai';
const NAI_PROVIDER_DISPLAY_NAME = 'NovelAI';
const NAI_PROVIDER_BASE_URL = 'https://image.novelai.net';

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
