export interface NormalizedCustomDropdownPayload {
  name: string
  description?: string
  items: string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function toNormalizedString(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
  }

  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value)
  }

  return null
}

function dedupe(items: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []

  for (const item of items) {
    if (seen.has(item)) {
      continue
    }

    seen.add(item)
    result.push(item)
  }

  return result
}

export function parseCustomDropdownItemsText(itemsText: unknown): string[] {
  if (typeof itemsText !== 'string') {
    return []
  }

  return dedupe(
    itemsText
      .split(/\r?\n/g)
      .map((item) => item.trim())
      .filter((item) => item.length > 0),
  )
}

export function normalizeCustomDropdownItems(input: unknown): string[] {
  try {
    if (Array.isArray(input)) {
      return dedupe(
        input
          .map((item) => toNormalizedString(item))
          .filter((item): item is string => item !== null),
      )
    }

    if (typeof input === 'string') {
      return parseCustomDropdownItemsText(input)
    }

    if (isRecord(input)) {
      if (Object.prototype.hasOwnProperty.call(input, 'items')) {
        return normalizeCustomDropdownItems(input.items)
      }

      if (Object.prototype.hasOwnProperty.call(input, 'itemsText')) {
        return parseCustomDropdownItemsText(input.itemsText)
      }
    }

    return []
  } catch {
    return []
  }
}

export function normalizeCustomDropdownPayload(input: unknown): NormalizedCustomDropdownPayload {
  if (!isRecord(input)) {
    return {
      name: '',
      items: [],
    }
  }

  const name = typeof input.name === 'string' ? input.name.trim() : ''

  const description =
    typeof input.description === 'string' && input.description.trim().length > 0
      ? input.description.trim()
      : undefined

  return {
    name,
    description,
    items: normalizeCustomDropdownItems(input.items ?? input.itemsText),
  }
}
