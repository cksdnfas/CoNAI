const MAX_PROMPT_GROUP_PICK_COUNT = 50;

interface PromptGroupPickRange {
  min: number;
  max: number;
}

interface PromptGroupUsageFilter {
  min?: number;
  max?: number;
}

export interface PromptGroupSyntax {
  groupName: string;
  pickRange: PromptGroupPickRange;
  usageFilter: PromptGroupUsageFilter;
}

function parseCompactCount(value: string): number | null {
  const match = value.trim().toLowerCase().match(/^([+-]?)(\d+(?:\.\d+)?)([km]?)$/);
  if (!match) {
    return null;
  }

  const [, sign, numericValue, suffix] = match;
  const multiplier = suffix === 'm' ? 1_000_000 : suffix === 'k' ? 1_000 : 1;
  const parsed = Number(numericValue);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  const magnitude = Math.trunc(parsed * multiplier);
  return sign === '-' ? -magnitude : magnitude;
}

export function parsePromptGroupSyntax(rawValue: string): PromptGroupSyntax | null {
  let remaining = rawValue.trim();
  if (!remaining) {
    return null;
  }

  const usageFilter: PromptGroupUsageFilter = {};
  const usageMatch = remaining.match(/<\s*([+-]?\d+(?:\.\d+)?[kKmM]?)\s*>/);
  if (usageMatch) {
    const parsedUsage = parseCompactCount(usageMatch[1]);
    if (parsedUsage === null) {
      return null;
    }
    if (parsedUsage < 0) {
      usageFilter.max = Math.abs(parsedUsage);
    } else {
      usageFilter.min = parsedUsage;
    }
    remaining = remaining.replace(usageMatch[0], '').trim();
  }

  let pickRange: PromptGroupPickRange = { min: 1, max: 1 };
  const pickMatch = remaining.match(/\[\s*(\d+)(?:\s*~\s*(\d+))?\s*\]/);
  if (pickMatch) {
    const first = Math.trunc(Number(pickMatch[1]));
    const second = pickMatch[2] !== undefined ? Math.trunc(Number(pickMatch[2])) : first;
    if (!Number.isFinite(first) || !Number.isFinite(second)) {
      return null;
    }
    const lower = Math.max(0, Math.min(first, second));
    const upper = Math.max(0, Math.max(first, second));
    pickRange = {
      min: Math.min(MAX_PROMPT_GROUP_PICK_COUNT, lower),
      max: Math.min(MAX_PROMPT_GROUP_PICK_COUNT, upper),
    };
    remaining = remaining.replace(pickMatch[0], '').trim();
  }

  const groupName = remaining.trim();
  if (!groupName) {
    return null;
  }

  return { groupName, pickRange, usageFilter };
}

export function resolvePromptGroupPickCount(range: PromptGroupPickRange): number {
  if (range.max <= range.min) {
    return range.min;
  }
  return range.min + Math.floor(Math.random() * (range.max - range.min + 1));
}
