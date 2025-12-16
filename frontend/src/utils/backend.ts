const resolveDefaultBackendOrigin = (): string => {
  // 백엔드 기본 포트 반환 (프론트엔드와 백엔드 포트가 다를 수 있음)
  // 문자열 분리로 빌드 타임 평가 완전 방지
  const protocol = 'http';
  const host = 'localhost';
  const port = '1666';
  return `${protocol}://${host}:${port}`;
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
