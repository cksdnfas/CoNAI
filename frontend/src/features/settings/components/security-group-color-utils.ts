import type { CSSProperties } from 'react'

export type SecurityGroupColorMap = Record<string, string>

/** Pre-server storage key, read once to migrate colours chosen in this browser. */
const SECURITY_GROUP_COLOR_STORAGE_KEY = 'conai:security:group-colors'

const BUILT_IN_GROUP_COLORS: Record<string, string> = {
  admin: '#ff6b8b',
  guest: '#4aa8ff',
  anonymous: '#b388ff',
}

const CUSTOM_GROUP_COLORS = ['#00b894', '#ffb020', '#8b5cf6', '#14b8a6', '#f97316', '#22c55e', '#ec4899', '#06b6d4']

function isHexColor(value: string): boolean {
  return /^#(?:[0-9a-fA-F]{3}){1,2}$/.test(value.trim())
}

function hashGroupKey(groupKey: string) {
  let hash = 0
  for (let index = 0; index < groupKey.length; index += 1) {
    hash = ((hash << 5) - hash + groupKey.charCodeAt(index)) | 0
  }
  return Math.abs(hash)
}

export function getDefaultSecurityGroupColor(groupKey: string) {
  const normalizedKey = groupKey.trim().toLowerCase()
  if (BUILT_IN_GROUP_COLORS[normalizedKey]) {
    return BUILT_IN_GROUP_COLORS[normalizedKey]
  }

  return CUSTOM_GROUP_COLORS[hashGroupKey(normalizedKey) % CUSTOM_GROUP_COLORS.length]
}

export function getSecurityGroupColor(groupKey: string, colorMap: SecurityGroupColorMap) {
  const override = colorMap[groupKey]
  if (override && isHexColor(override)) {
    return override
  }
  return getDefaultSecurityGroupColor(groupKey)
}

export function getSecurityGroupBadgeStyle(color: string): CSSProperties {
  return {
    backgroundColor: `color-mix(in srgb, ${color} 16%, transparent)`,
    color,
    boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${color} 32%, transparent)`,
  }
}

/** Keep only `groupKey -> hex colour` entries from an untrusted value (server JSON or a legacy browser copy). */
export function normalizeSecurityGroupColorMap(value: unknown): SecurityGroupColorMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).flatMap(([groupKey, color]) => (
      typeof color === 'string' && isHexColor(color)
        ? [[groupKey, color.trim()]]
        : []
    )),
  )
}

/** Colours saved in this browser before they moved to the server; empty when storage is unavailable. */
export function readLegacySecurityGroupColorMap(): SecurityGroupColorMap {
  try {
    const raw = window.localStorage.getItem(SECURITY_GROUP_COLOR_STORAGE_KEY)
    return raw ? normalizeSecurityGroupColorMap(JSON.parse(raw)) : {}
  } catch {
    return {}
  }
}

export function clearLegacySecurityGroupColorMap() {
  try {
    window.localStorage.removeItem(SECURITY_GROUP_COLOR_STORAGE_KEY)
  } catch {
    // Storage can be blocked (private mode, site data off); the server copy is what counts.
  }
}
