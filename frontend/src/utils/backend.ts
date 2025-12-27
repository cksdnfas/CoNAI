const resolveDefaultBackendOrigin = (): string => {
  // 개발 환경: Vite 프록시가 아닌 직접 연결이 필요한 경우를 위해 명시적 URL 반환
  // 프로덕션: 빈 문자열을 반환하여 Axios가 상대 경로(예: /api/...)를 사용하게 함
  // 이를 통해 앱이 서빙되는 호스트(localhost, 192.168.x.x 등)에 관계없이 올바르게 요청함
  if (import.meta.env.DEV) {
    const protocol = 'http';
    const host = 'localhost';
    const port = '1666';
    return `${protocol}://${host}:${port}`;
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
