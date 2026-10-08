import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { runtimePaths } from '../../config/runtimePaths'
import { SpriteError } from './spriteErrors'
import { resolveExtractOptions, type SpriteExtractOptions } from './spriteOptions'

/**
 * Sprite extraction presets, one list for every account (a game's look is shared, not per person). Each preset keeps
 * the full extraction options plus the output choices of the batch bar.
 */

const PRESETS_FILE = path.join(runtimePaths.basePath, 'config', 'sprite-presets.json')
const MAX_PRESETS = 200
const MAX_NAME_LENGTH = 80

export interface SpritePresetOutput {
  /** Library group the sheets go into; null = the default "스프라이트" group. */
  groupPath: string | null
  zip: boolean
}

export interface SpritePreset {
  id: string
  name: string
  options: SpriteExtractOptions
  output: SpritePresetOutput
  updatedAt: string
  updatedByAccountId: number | null
}

export interface SpritePresetInput {
  name?: unknown
  options?: unknown
  output?: unknown
}

function readAll(): SpritePreset[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(PRESETS_FILE, 'utf8')) as { presets?: SpritePreset[] }
    return Array.isArray(parsed.presets) ? parsed.presets : []
  } catch {
    return []
  }
}

function writeAll(presets: SpritePreset[]): void {
  fs.mkdirSync(path.dirname(PRESETS_FILE), { recursive: true })
  const temp = `${PRESETS_FILE}.${process.pid}.tmp`
  fs.writeFileSync(temp, JSON.stringify({ version: 1, presets }, null, 2))
  fs.renameSync(temp, PRESETS_FILE)
}

function cleanName(value: unknown): string {
  const name = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
  if (!name) throw new SpriteError('프리셋 이름을 입력하세요.')
  if (name.length > MAX_NAME_LENGTH) throw new SpriteError(`프리셋 이름은 ${MAX_NAME_LENGTH}자까지입니다.`)
  return name
}

function cleanOutput(value: unknown): SpritePresetOutput {
  const input = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  const groupPath = typeof input.groupPath === 'string' && input.groupPath.trim() ? input.groupPath.trim().slice(0, 1024) : null
  return { groupPath, zip: input.zip === true }
}

function requireUniqueName(presets: SpritePreset[], name: string, exceptId?: string): void {
  const key = name.toLocaleLowerCase()
  if (presets.some((preset) => preset.id !== exceptId && preset.name.toLocaleLowerCase() === key)) {
    throw new SpriteError('같은 이름의 프리셋이 이미 있습니다.', 409)
  }
}

export function listSpritePresets(): SpritePreset[] {
  return readAll().sort((left, right) => left.name.localeCompare(right.name, 'ko'))
}

export function createSpritePreset(input: SpritePresetInput, accountId: number | null): SpritePreset {
  const presets = readAll()
  if (presets.length >= MAX_PRESETS) throw new SpriteError(`프리셋은 ${MAX_PRESETS}개까지 저장할 수 있습니다.`)
  const name = cleanName(input.name)
  requireUniqueName(presets, name)
  const preset: SpritePreset = {
    id: crypto.randomUUID(),
    name,
    options: resolveExtractOptions((input.options ?? {}) as Partial<SpriteExtractOptions>),
    output: cleanOutput(input.output),
    updatedAt: new Date().toISOString(),
    updatedByAccountId: accountId,
  }
  writeAll([...presets, preset])
  return preset
}

/** Given fields replace the stored ones; options are stored whole, never merged. */
export function updateSpritePreset(id: string, input: SpritePresetInput, accountId: number | null): SpritePreset {
  const presets = readAll()
  const index = presets.findIndex((preset) => preset.id === id)
  if (index < 0) throw new SpriteError('프리셋을 찾을 수 없습니다.', 404)
  const current = presets[index]
  const name = input.name === undefined ? current.name : cleanName(input.name)
  requireUniqueName(presets, name, id)
  const next: SpritePreset = {
    ...current,
    name,
    options: input.options === undefined ? current.options : resolveExtractOptions(input.options as Partial<SpriteExtractOptions>),
    output: input.output === undefined ? current.output : cleanOutput(input.output),
    updatedAt: new Date().toISOString(),
    updatedByAccountId: accountId,
  }
  presets[index] = next
  writeAll(presets)
  return next
}

export function deleteSpritePreset(id: string): void {
  const presets = readAll()
  const next = presets.filter((preset) => preset.id !== id)
  if (next.length === presets.length) throw new SpriteError('프리셋을 찾을 수 없습니다.', 404)
  writeAll(next)
}
