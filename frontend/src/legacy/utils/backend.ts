const resolveDefaultBackendOrigin = (): string => {
  // 개발 환경: 현재 접속한 호스트(IP/도메인)를 기준으로 백엔드 주소를 계산
  // 프로덕션: 빈 문자열을 반환하여 Axios가 상대 경로(예: /api/...)를 사용하게 함
  if (import.meta.env.DEV) {
    const configuredPort = (import.meta.env.VITE_BACKEND_PORT as string | undefined)?.trim() || '1666';
    const protocol = typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'https' : 'http';
    const host =
      typeof window !== 'undefined' && window.location.hostname
        ? window.location.hostname
        : 'localhost';

    return `${protocol}://${host}:${configuredPort}`;
  }

  return '';
};

const stripTrailingSlash = (value: string): string => value.replace(/\/+$/, '');

const ensureProtocol = (value: string): string => {
  if (/^https?:\/\//i.test(value)) {
    return value;
  }
  return `http://${value}`;
};

const readElectronOrigin = (): string | undefined => {
  if (typeof window === 'undefined') {
    return undefined;
  }
  const api = (window as (Window & { electronAPI?: { backendOrigin?: string; publicBaseUrl?: string } }))?.electronAPI;
  return api?.backendOrigin || api?.publicBaseUrl;
};

const readEnvOrigin = (): string | undefined => {
  const candidates = [
    import.meta.env.VITE_API_BASE_URL as string | undefined,
    import.meta.env.VITE_BACKEND_ORIGIN as string | undefined,
    import.meta.env.VITE_PUBLIC_BASE_URL as string | undefined
  ];

  return candidates.find((value) => value && value.trim().length > 0);
};

// 캐시 변수 (런타임에만 초기화됨)
let cachedBackendOrigin: string | null = null;

export const getBackendOrigin = (): string => {
  // 이미 계산된 값이 있으면 재사용
  if (cachedBackendOrigin) {
    return cachedBackendOrigin;
  }

  const source = readElectronOrigin() || readEnvOrigin();

  if (!source) {
    cachedBackendOrigin = resolveDefaultBackendOrigin(); // 런타임에 동적 평가
  } else {
    cachedBackendOrigin = stripTrailingSlash(ensureProtocol(source.trim()));
  }

  return cachedBackendOrigin;
};

const isAbsoluteUrl = (value: string): boolean => /^https?:\/\//i.test(value);

const normalizeUploadPath = (value: string): string => {
  const withoutSlashes = value.replace(/^[/\\]+/, '');
  const withoutPrefix = withoutSlashes.replace(/^uploads[/\\]+/i, '');
  return withoutPrefix.replace(/\\/g, '/');
};

export const buildUploadsUrl = (relativePath?: string | null): string | null => {
  if (!relativePath || relativePath.trim().length === 0) {
    return null;
  }

  if (isAbsoluteUrl(relativePath)) {
    return relativePath;
  }

  const normalized = normalizeUploadPath(relativePath.trim());
  return `${getBackendOrigin()}/${normalized}`;
};

export const ensureAbsoluteUrl = (value?: string | null): string => {
  if (!value || value.trim().length === 0) {
    return '';
  }

  if (isAbsoluteUrl(value)) {
    return value;
  }

  return buildUploadsUrl(value) || '';
};
