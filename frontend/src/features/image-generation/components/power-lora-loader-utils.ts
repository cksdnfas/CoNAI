import type { CustomDropdownList } from '@/lib/api-image-generation-types'

export const POWER_LORA_AUTO_COLLECTED_LIST_NAME = 'loras (통합)'

export type PowerLoraLoaderEntryValue = {
  on?: boolean
  lora?: string
  strength?: number
}

export type PowerLoraLoaderNodeItem = {
  key: string
  label: string
  lora?: string
}

export function isPowerLoraLoaderEntryValue(value: unknown): value is PowerLoraLoaderEntryValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }

  const record = value as Record<string, unknown>
  return typeof record.lora === 'string'
    && typeof record.on === 'boolean'
    && typeof record.strength === 'number'
}

export function isPowerLoraLoaderNodeValue(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function hasPowerLoraLoaderEntries(value: unknown) {
  return isPowerLoraLoaderNodeValue(value) && Object.values(value).some(isPowerLoraLoaderEntryValue)
}

export function getPowerLoraEntryLabel(loraPath: string) {
  return loraPath.split(/[/\\]/).pop() || loraPath
}

function comparePowerLoraNodeKeys([leftKey]: [string, unknown], [rightKey]: [string, unknown]) {
  return leftKey.localeCompare(rightKey, undefined, { numeric: true })
}

export function buildFallbackPowerLoraNodeItems(nodeValue: Record<string, unknown>): PowerLoraLoaderNodeItem[] {
  return Object.entries(nodeValue)
    .filter((entry): entry is [string, PowerLoraLoaderEntryValue] => isPowerLoraLoaderEntryValue(entry[1]))
    .sort(comparePowerLoraNodeKeys)
    .map(([key, entry]) => ({
      key,
      label: entry.lora ? getPowerLoraEntryLabel(entry.lora) : key,
      lora: entry.lora,
    }))
}

export function buildPowerLoraNodeItemsFromInputs(inputs: Record<string, unknown>): PowerLoraLoaderNodeItem[] {
  return Object.entries(inputs)
    .filter(([inputKey, inputValue]) => /^lora_/i.test(inputKey) && isPowerLoraLoaderEntryValue(inputValue))
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey, undefined, { numeric: true }))
    .map(([inputKey, inputValue]) => {
      const loraInput = inputValue as PowerLoraLoaderEntryValue & { lora: string }
      return {
        key: inputKey,
        label: getPowerLoraEntryLabel(loraInput.lora),
        lora: loraInput.lora,
      }
    })
}

export function findAutoCollectedPowerLoraOptions(dropdownLists: CustomDropdownList[]) {
  return dropdownLists.find((list) => list.is_auto_collected && list.name === POWER_LORA_AUTO_COLLECTED_LIST_NAME)?.items ?? []
}

export function buildNextPowerLoraKey(nodeValue: Record<string, unknown>) {
  const maxIndex = Object.keys(nodeValue).reduce((currentMax, key) => {
    const match = /^lora_(\d+)$/i.exec(key)
    if (!match) {
      return currentMax
    }

    const index = Number(match[1])
    return Number.isFinite(index) ? Math.max(currentMax, index) : currentMax
  }, 0)

  return `lora_${maxIndex + 1}`
}

export function normalizePowerLoraOptionPath(loraPath: string) {
  return loraPath.trim()
}

export function buildAddedPowerLoraNodeValue(nodeValue: Record<string, unknown>, loraPath: string) {
  const normalizedLoraPath = normalizePowerLoraOptionPath(loraPath)
  if (!normalizedLoraPath || normalizedLoraPath === '__random__') {
    return nodeValue
  }

  return {
    ...nodeValue,
    [buildNextPowerLoraKey(nodeValue)]: {
      on: true,
      lora: normalizedLoraPath,
      strength: 1,
    },
  }
}
