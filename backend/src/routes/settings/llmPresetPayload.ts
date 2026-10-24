import type { LlmPresetRecord } from '@conai/shared';
import { normalizeLlmPresetRecord } from '../../services/llmPresetNormalization';

export function normalizeLlmPresetCollectionPayload(
  value: unknown,
  options: { collectionKey: string; label: string; valueType?: 'text' | 'json' },
): LlmPresetRecord[] {
  if (!Array.isArray(value)) {
    throw new Error(`${options.collectionKey} must be an array`);
  }

  const now = new Date().toISOString();
  const normalizedPresets = value.map((entry) => normalizeLlmPresetRecord(entry, { ...options, mode: 'strict-write', now })!);

  const seenIds = new Set<string>();
  const seenNames = new Set<string>();
  for (const preset of normalizedPresets) {
    const normalizedName = preset.name.toLowerCase();
    if (seenIds.has(preset.id)) {
      throw new Error(`${options.label}에 중복된 프리셋 id가 있어: ${preset.id}`);
    }
    if (seenNames.has(normalizedName)) {
      throw new Error(`${options.label} 이름이 중복됐어: ${preset.name}`);
    }

    seenIds.add(preset.id);
    seenNames.add(normalizedName);
  }

  return normalizedPresets;
}
