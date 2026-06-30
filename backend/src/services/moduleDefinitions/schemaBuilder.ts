import type { ModulePortDataType, ModulePortDefinition, ModuleUiFieldDefinition } from '../../types/moduleGraph';
import { inferPortLabel } from './labels';

function isPowerLoraLoaderEntryValue(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const record = value as Record<string, unknown>;
  return typeof record.lora === 'string'
    && typeof record.on === 'boolean'
    && typeof record.strength === 'number';
}

function hasPowerLoraLoaderEntries(value: unknown) {
  return typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    && Object.values(value).some(isPowerLoraLoaderEntryValue);
}

function isPowerLoraLoaderField(field: any) {
  return field?.node_editor === 'power_lora_loader_rgthree' || hasPowerLoraLoaderEntries(field?.default_value);
}

export function getConfigOnlyFieldKeys(uiSchema: any[], exposedInputs: any[]) {
  return new Set([
    ...uiSchema.filter(isPowerLoraLoaderField).map((field) => field.key),
    ...exposedInputs.filter((port) => hasPowerLoraLoaderEntries(port.default_value)).map((port) => port.key),
  ]);
}

function inferPortDataType(key: string, fallbackValue?: unknown): ModulePortDataType {
  if (key === 'image') return 'image';
  if (key === 'mask') return 'mask';
  if (key.includes('prompt')) return 'prompt';
  if (typeof fallbackValue === 'number') return 'number';
  if (typeof fallbackValue === 'boolean') return 'boolean';
  if (typeof fallbackValue === 'object' && fallbackValue !== null) return 'json';
  return 'text';
}

function mapComfyFieldTypeToPortType(type: unknown): ModulePortDataType {
  if (type === 'image') return 'image';
  if (type === 'number') return 'number';
  if (type === 'textarea') return 'prompt';
  if (type === 'node') return 'json';
  return 'text';
}

function mapComfyFieldTypeToUiType(type: unknown): ModuleUiFieldDefinition['data_type'] {
  if (type === 'select') return 'select';
  return mapComfyFieldTypeToPortType(type);
}

export function createDefaultOutputPorts(engineType: 'nai' | 'codex' | 'comfyui' | 'system'): ModulePortDefinition[] {
  if (engineType === 'system') {
    return [
      {
        key: 'text',
        label: 'System Text',
        direction: 'output',
        data_type: 'text',
        required: true,
        multiple: false,
      },
      {
        key: 'metadata',
        label: 'Metadata',
        direction: 'output',
        data_type: 'json',
        required: false,
        multiple: false,
      },
    ];
  }

  return [
    {
      key: 'image',
      label: engineType === 'comfyui' ? 'Workflow Image' : 'Generated Image',
      direction: 'output',
      data_type: 'image',
      required: true,
      multiple: false,
    },
    {
      key: 'metadata',
      label: 'Metadata',
      direction: 'output',
      data_type: 'json',
      required: false,
      multiple: false,
    },
  ];
}

export function buildUiSchemaFromPorts(ports: ModulePortDefinition[]): ModuleUiFieldDefinition[] {
  return ports.map((port) => ({
    key: port.key,
    label: port.label,
    data_type: port.data_type,
    description: port.description,
    default_value: port.default_value,
    ui_hint: port.ui_hint,
  })) as ModuleUiFieldDefinition[];
}

export function splitFixedValues(snapshot: Record<string, unknown>, exposedPorts: ModulePortDefinition[]) {
  const exposedKeys = new Set(exposedPorts.map((port) => port.key));
  return Object.fromEntries(Object.entries(snapshot).filter(([key]) => !exposedKeys.has(key)));
}

export function normalizeNaiExposedFields(fields: any[] | undefined, snapshot: Record<string, unknown>): ModulePortDefinition[] {
  if (!fields || fields.length === 0) {
    return [];
  }

  return fields.map((field): ModulePortDefinition => {
    if (typeof field === 'string') {
      return {
        key: field,
        label: inferPortLabel(field),
        direction: 'input' as const,
        data_type: inferPortDataType(field, snapshot[field]),
        required: field === 'prompt',
        multiple: false,
        default_value: snapshot[field],
        source_path: field,
      };
    }

    const key = field.key as string;
    return {
      key,
      label: field.label || inferPortLabel(key),
      direction: 'input' as const,
      data_type: (field.data_type as ModulePortDataType | undefined) || inferPortDataType(key, snapshot[key]),
      description: field.description,
      required: field.required ?? key === 'prompt',
      multiple: field.multiple ?? false,
      default_value: field.default_value ?? snapshot[key],
      ui_hint: field.ui_hint,
      source_path: field.source_path || key,
    };
  });
}

export function convertMarkedFieldsToPorts(markedFields: any[], exposedFieldIds?: string[]): ModulePortDefinition[] {
  const allowedIds = exposedFieldIds && exposedFieldIds.length > 0 ? new Set(exposedFieldIds) : null;

  return markedFields
    .filter((field) => (!allowedIds || allowedIds.has(field.id)) && !isPowerLoraLoaderField(field))
    .map((field): ModulePortDefinition => ({
      key: field.id,
      label: field.label || inferPortLabel(field.id),
      direction: 'input' as const,
      data_type: mapComfyFieldTypeToPortType(field.type),
      description: field.description,
      required: field.required ?? false,
      multiple: false,
      default_value: field.default_value ?? null,
      ui_hint: field.dropdown_list_name || field.placeholder,
      source_path: field.jsonPath || field.id,
    }));
}

/** Preserve ComfyUI select fields in module UI schema so graph nodes can render dropdowns. */
export function buildUiSchemaFromMarkedFields(markedFields: any[], exposedFieldIds?: string[]): ModuleUiFieldDefinition[] {
  const allowedIds = exposedFieldIds && exposedFieldIds.length > 0 ? new Set(exposedFieldIds) : null;

  return markedFields
    .filter((field) => !allowedIds || allowedIds.has(field.id))
    .map((field): ModuleUiFieldDefinition => ({
      key: field.id,
      label: field.label || inferPortLabel(field.id),
      data_type: mapComfyFieldTypeToUiType(field.type),
      description: field.description,
      default_value: field.default_value ?? null,
      options: Array.isArray(field.options) ? field.options : undefined,
      dropdown_list_name: field.dropdown_list_name,
      min: typeof field.min === 'number' ? field.min : undefined,
      max: typeof field.max === 'number' ? field.max : undefined,
      placeholder: field.placeholder,
      ui_hint: field.dropdown_list_name,
      node_editor: field.node_editor,
      node_items: Array.isArray(field.node_items) ? field.node_items : undefined,
    }));
}
