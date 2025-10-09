const resolveDefaultBackendOrigin = (): string => {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin;
  }
  return 'http://localhost:1566';
};

const DEFAULT_BACKEND_ORIGIN = resolveDefaultBackendOrigin();

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

export const getBackendOrigin = (): string => {
  const source = readElectronOrigin() || readEnvOrigin();

  if (!source) {
    return DEFAULT_BACKEND_ORIGIN;
  }

  return stripTrailingSlash(ensureProtocol(source.trim()));
};

const isAbsoluteUrl = (value: string): boolean => /^https?:\/\//i.test(value);

const normalizeUploadPath = (value: string): string => {
  const withoutSlashes = value.replace(/^[/\\]+/, '');
  const withoutPrefix = withoutSlashes.replace(/^uploads[/\\]+/i, '');
  return withoutPrefix.replace(/\\/g, '/');
};

export const buildUploadsUrl = (relativePath?: string | null): string => {
  if (!relativePath || relativePath.trim().length === 0) {
    return '';
  }

  if (isAbsoluteUrl(relativePath)) {
    return relativePath;
  }

  const normalized = normalizeUploadPath(relativePath.trim());
  return `${getBackendOrigin()}/uploads/${normalized}`;
};

export const ensureAbsoluteUrl = (value?: string | null): string => {
  if (!value || value.trim().length === 0) {
    return '';
  }

  if (isAbsoluteUrl(value)) {
    return value;
  }

  return buildUploadsUrl(value);
};
