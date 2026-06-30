import { randomUUID } from 'crypto';
import type { LlmPresetRecord } from '../../types/settings';

function normalizeOptionalText(value: unknown) {
  return typeof value === 'string' ? value : '';
}

function normalizeOptionalIsoDate(value: unknown, fallback: string) {
  if (typeof value !== 'string') {
    return fallback;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return fallback;
  }

  const parsed = Date.parse(trimmed);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : fallback;
}

function normalizeStructuredOutputJson(value: unknown) {
  if (typeof value !== 'string') {
    return '';
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }

  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2);
  } catch {
    throw new Error('구조화 출력 JSON 양식은 올바른 JSON이어야 해.');
  }
}

export function normalizeLlmPresetCollectionPayload(
  value: unknown,
  options: { collectionKey: string; label: string; valueType?: 'text' | 'json' },
): LlmPresetRecord[] {
  if (!Array.isArray(value)) {
    throw new Error(`${options.collectionKey} must be an array`);
  }

  const now = new Date().toISOString();
  const normalizedPresets = value.map((entry) => {
    if (!entry || typeof entry !== 'object') {
      throw new Error(`${options.label} 항목은 객체여야 해.`);
    }

    const record = entry as Record<string, unknown>;
    const name = normalizeOptionalText(record.name).trim();
    if (!name) {
      throw new Error(`${options.label}에는 이름이 필요해.`);
    }

    const content = options.valueType === 'json'
      ? normalizeStructuredOutputJson(record.content)
      : normalizeOptionalText(record.content);
    if (!content.trim()) {
      throw new Error(`${options.label} '${name}' 에 저장할 내용이 비어 있어.`);
    }

    return {
      id: normalizeOptionalText(record.id).trim() || randomUUID(),
      name,
      content,
      createdAt: normalizeOptionalIsoDate(record.createdAt, now),
      updatedAt: now,
    } satisfies LlmPresetRecord;
  });

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
