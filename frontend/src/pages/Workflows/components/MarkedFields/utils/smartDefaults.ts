import type { MarkedField } from '../../../../../services/api/workflowApi';

// Smart defaults for common field parameters
export const SMART_DEFAULTS: Record<
  string,
  Partial<MarkedField> & { keywords: string[] }
> = {
  steps: {
    type: 'number',
    min: 1,
    max: 150,
    default_value: '20',
    keywords: ['step', 'steps'],
  },
  cfg: {
    type: 'number',
    min: 1,
    max: 30,
    default_value: '7',
    keywords: ['cfg', 'scale', 'guidance'],
  },
  seed: {
    type: 'number',
    min: 0,
    max: 999999999,
    default_value: '-1',
    keywords: ['seed', 'random'],
  },
  denoise: {
    type: 'number',
    min: 0,
    max: 1,
    default_value: '1',
    keywords: ['denoise', 'strength'],
  },
  sampler: {
    type: 'select',
    options: ['euler', 'euler_ancestral', 'heun', 'dpm_2', 'dpm_2_ancestral', 'lms', 'dpm_fast', 'dpm_adaptive', 'dpmpp_2s_ancestral', 'dpmpp_sde', 'dpmpp_2m', 'ddim', 'uni_pc'],
    default_value: 'euler',
    keywords: ['sampler', 'sampling'],
  },
  scheduler: {
    type: 'select',
    options: ['normal', 'karras', 'exponential', 'simple'],
    default_value: 'normal',
    keywords: ['scheduler', 'schedule'],
  },
};

/**
 * Generate a valid field ID from a label
 * Converts to lowercase, replaces spaces with underscores, removes special characters
 */
export function generateFieldId(label: string): string {
  return label
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
    .replace(/^_+|_+$/g, '');
}

/**
 * Detect field type from JSON path or label
 */
export function detectFieldType(jsonPath: string, label: string): MarkedField['type'] {
  const pathLower = jsonPath.toLowerCase();
  const labelLower = label.toLowerCase();
  const combined = `${pathLower} ${labelLower}`;

  // Check for text/textarea indicators
  if (
    combined.includes('text') ||
    combined.includes('prompt') ||
    combined.includes('description')
  ) {
    // Long text fields
    if (combined.includes('prompt') || combined.includes('description')) {
      return 'textarea';
    }
    return 'text';
  }

  // Check for number indicators
  if (
    combined.includes('seed') ||
    combined.includes('steps') ||
    combined.includes('cfg') ||
    combined.includes('denoise') ||
    combined.includes('scale') ||
    combined.includes('width') ||
    combined.includes('height') ||
    combined.includes('strength')
  ) {
    return 'number';
  }

  // Check for select indicators
  if (
    combined.includes('sampler') ||
    combined.includes('scheduler') ||
    combined.includes('mode') ||
    combined.includes('method')
  ) {
    return 'select';
  }

  // Default to text
  return 'text';
}

/**
 * Apply smart defaults based on label or JSON path
 */
export function applySmartDefaults(
  field: Partial<MarkedField>
): Partial<MarkedField> {
  const label = field.label?.toLowerCase() || '';
  const jsonPath = field.jsonPath?.toLowerCase() || '';
  const combined = `${label} ${jsonPath}`;

  // Find matching smart default
  for (const [key, defaults] of Object.entries(SMART_DEFAULTS)) {
    if (defaults.keywords.some((keyword) => combined.includes(keyword))) {
      return {
        ...field,
        type: field.type || defaults.type,
        min: field.min ?? defaults.min,
        max: field.max ?? defaults.max,
        default_value: field.default_value || defaults.default_value,
        options: field.options || defaults.options,
      };
    }
  }

  // Auto-detect type if not set
  if (!field.type && field.label && field.jsonPath) {
    const detectedType = detectFieldType(field.jsonPath, field.label);
    return {
      ...field,
      type: detectedType,
    };
  }

  return field;
}

/**
 * Extract node number from JSON path
 */
export function extractNodeNumber(jsonPath: string): string | null {
  const match = jsonPath.match(/^(\d+)\./);
  return match ? match[1] : null;
}

/**
 * Suggest JSON path based on node number and field label
 */
export function suggestJsonPath(nodeNumber: string, label: string): string {
  const labelLower = label.toLowerCase();

  // Common path mappings
  const pathMappings: Record<string, string> = {
    prompt: 'text',
    'negative prompt': 'text',
    seed: 'seed',
    steps: 'steps',
    cfg: 'cfg',
    'cfg scale': 'cfg',
    denoise: 'denoise',
    sampler: 'sampler_name',
    'sampler name': 'sampler_name',
    scheduler: 'scheduler',
    width: 'width',
    height: 'height',
    'model': 'ckpt_name',
    'checkpoint': 'ckpt_name',
  };

  // Find matching mapping
  for (const [key, value] of Object.entries(pathMappings)) {
    if (labelLower.includes(key)) {
      return `${nodeNumber}.inputs.${value}`;
    }
  }

  // Default: use sanitized label
  const sanitized = label
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '');
  return `${nodeNumber}.inputs.${sanitized}`;
}
