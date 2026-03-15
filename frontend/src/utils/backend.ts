const resolveDefaultBackendOrigin = (): string => {
  if (import.meta.env.DEV) {
    const configuredPort = (import.meta.env.VITE_BACKEND_PORT as string | undefined)?.trim() || '1666'
    const protocol = typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'https' : 'http'
    const host = typeof window !== 'undefined' && window.location.hostname ? window.location.hostname : 'localhost'

    return `${protocol}://${host}:${configuredPort}`
  }

  return ''
}

const stripTrailingSlash = (value: string): string => value.replace(/\/+$/, '')

const ensureProtocol = (value: string): string => {
  if (/^https?:\/\//i.test(value)) {
    return value
  }
  return `http://${value}`
}

const readEnvOrigin = (): string | undefined => {
  const candidates = [
    import.meta.env.VITE_API_BASE_URL as string | undefined,
    import.meta.env.VITE_BACKEND_ORIGIN as string | undefined,
    import.meta.env.VITE_PUBLIC_BASE_URL as string | undefined,
  ]

  return candidates.find((value) => value && value.trim().length > 0)
}

let cachedBackendOrigin: string | null = null

export const getBackendOrigin = (): string => {
  if (cachedBackendOrigin) {
    return cachedBackendOrigin
  }

  const source = readEnvOrigin()

  if (!source) {
    cachedBackendOrigin = resolveDefaultBackendOrigin()
  } else {
    cachedBackendOrigin = stripTrailingSlash(ensureProtocol(source.trim()))
  }

  return cachedBackendOrigin
}

const isAbsoluteUrl = (value: string): boolean => /^https?:\/\//i.test(value)

const normalizeUploadPath = (value: string): string => {
  const withoutSlashes = value.replace(/^[/\\]+/, '')
  const withoutPrefix = withoutSlashes.replace(/^uploads[/\\]+/i, '')
  return withoutPrefix.replace(/\\/g, '/')
}

export const buildUploadsUrl = (relativePath?: string | null): string | null => {
  if (!relativePath || relativePath.trim().length === 0) {
    return null
  }

  if (isAbsoluteUrl(relativePath)) {
    return relativePath
  }

  const normalized = normalizeUploadPath(relativePath.trim())
  return `${getBackendOrigin()}/${normalized}`
}

export const ensureAbsoluteUrl = (value?: string | null): string => {
  if (!value || value.trim().length === 0) {
    return ''
  }

  if (isAbsoluteUrl(value)) {
    return value
  }

  return buildUploadsUrl(value) || ''
}
