import type { BuiltinSystemModuleDefinition } from './userSettingsBuiltinModuleDefinitions';

/** Built-in nodes that read the app's own running state, for automations that act only when there is room to. */
export const BUILTIN_RUNTIME_NODE_DEFINITIONS: BuiltinSystemModuleDefinition[] = [
  {
    name: '서버 상태',
    description: 'ComfyUI 서버가 노는지, 생성 대기열이 얼마나 찼는지 읽어.',
    category: 'get',
    exposedInputs: [
      { key: 'server_tag', label: '서버 태그', direction: 'input', data_type: 'text', required: false, multiple: false },
    ],
    outputPorts: [
      { key: 'has_idle', label: '노는 서버 있음', direction: 'output', data_type: 'boolean', required: false, multiple: false },
      { key: 'idle_count', label: '노는 서버 수', direction: 'output', data_type: 'number', required: false, multiple: false },
      { key: 'queue_waiting', label: '대기 중 작업', direction: 'output', data_type: 'number', required: false, multiple: false },
      { key: 'idle_server_ids', label: '노는 서버', direction: 'output', data_type: 'json', required: false, multiple: false },
      { key: 'servers', label: '서버 목록', direction: 'output', data_type: 'json', required: false, multiple: false },
    ],
    internalFixedValues: { operation_key: 'system.read_runtime_status' },
    uiSchema: [
      { key: 'server_tag', label: '서버 태그', data_type: 'text' },
    ],
    color: '#78909c',
  },
];
