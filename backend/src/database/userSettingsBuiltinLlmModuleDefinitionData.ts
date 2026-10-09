import type { BuiltinSystemModuleDefinition } from './userSettingsBuiltinModuleDefinitions';

const TRANSLATION_LANGUAGE_OPTIONS = ['한국어', 'English', '日本語', '简体中文'];

/** Built-in LLM nodes added with the LLM/chat-profile node work (translation, judge, character reply, appearance tags). */
export const BUILTIN_LLM_NODE_DEFINITIONS: BuiltinSystemModuleDefinition[] = [
  {
    name: '번역',
    description: '텍스트를 고른 언어로 번역해.',
    category: 'llm',
    exposedInputs: [
      { key: 'model_slot_id', label: '모델', direction: 'input', data_type: 'number', required: false, multiple: false },
      { key: 'profile_id', label: '프로필', direction: 'input', data_type: 'number', required: false, multiple: false },
      { key: 'text', label: '텍스트', direction: 'input', data_type: 'prompt', required: true, multiple: false },
      { key: 'target_language', label: '언어', direction: 'input', data_type: 'text', required: false, multiple: false, default_value: '한국어' },
      { key: 'instructions', label: '지침', direction: 'input', data_type: 'text', required: false, multiple: false },
    ],
    outputPorts: [
      { key: 'text', label: '텍스트', direction: 'output', data_type: 'text', required: true, multiple: false },
    ],
    internalFixedValues: { operation_key: 'system.translate_text' },
    uiSchema: [
      { key: 'model_slot_id', label: '모델', data_type: 'number', options_source: 'llm_model_rows' },
      { key: 'profile_id', label: '프로필', data_type: 'number', options_source: 'chat_profiles' },
      { key: 'target_language', label: '언어', data_type: 'select', default_value: '한국어', options: [...TRANSLATION_LANGUAGE_OPTIONS] },
      { key: 'text', label: '텍스트', data_type: 'prompt', placeholder: '번역할 텍스트' },
      { key: 'instructions', label: '지침', data_type: 'text', placeholder: '선택: 말투/용어' },
    ],
    color: '#7e57c2',
  },
  {
    name: '판단',
    description: '텍스트를 읽고 질문에 예/아니오나 선택지로 답해.',
    category: 'logic',
    exposedInputs: [
      { key: 'model_slot_id', label: '모델', direction: 'input', data_type: 'number', required: false, multiple: false },
      { key: 'text', label: '텍스트', direction: 'input', data_type: 'prompt', required: true, multiple: false },
      { key: 'question', label: '질문', direction: 'input', data_type: 'text', required: true, multiple: false },
      { key: 'mode', label: '방식', direction: 'input', data_type: 'text', required: false, multiple: false, default_value: 'yes_no' },
      { key: 'choices', label: '선택지', direction: 'input', data_type: 'text', required: false, multiple: false },
      { key: 'threshold', label: '기준', direction: 'input', data_type: 'number', required: false, multiple: false, default_value: 0.5 },
    ],
    outputPorts: [
      { key: 'yes', label: '예', direction: 'output', data_type: 'boolean', required: true, multiple: false },
      { key: 'choice', label: '선택', direction: 'output', data_type: 'text', required: false, multiple: false },
      { key: 'probability', label: '확률', direction: 'output', data_type: 'number', required: false, multiple: false },
      { key: 'json', label: 'JSON', direction: 'output', data_type: 'json', required: false, multiple: false },
    ],
    internalFixedValues: { operation_key: 'system.judge_text' },
    uiSchema: [
      { key: 'model_slot_id', label: '모델', data_type: 'number', options_source: 'judge_model_rows' },
      {
        key: 'mode',
        label: '방식',
        data_type: 'select',
        default_value: 'yes_no',
        options: [
          { value: 'yes_no', label: '예/아니오' },
          { value: 'choice', label: '선택지' },
        ],
      },
      { key: 'text', label: '텍스트', data_type: 'prompt', placeholder: '판단할 텍스트' },
      { key: 'question', label: '질문', data_type: 'text', placeholder: '예: 사용자가 화났어?' },
      { key: 'choices', label: '선택지', data_type: 'text', placeholder: '한 줄에 하나씩' },
      { key: 'threshold', label: '기준', data_type: 'number', default_value: 0.5, min: 0, max: 1 },
    ],
    color: '#26a69a',
  },
  {
    name: '캐릭터로 답하기',
    description: '채팅 프로필의 캐릭터로 메시지에 한 번 답해.',
    category: 'llm',
    exposedInputs: [
      { key: 'profile_id', label: '프로필', direction: 'input', data_type: 'number', required: true, multiple: false },
      { key: 'model_slot_id', label: '모델', direction: 'input', data_type: 'number', required: false, multiple: false },
      { key: 'message', label: '메시지', direction: 'input', data_type: 'prompt', required: true, multiple: false },
      { key: 'history', label: '앞 대화', direction: 'input', data_type: 'text', required: false, multiple: false },
      { key: 'user_name', label: '상대 이름', direction: 'input', data_type: 'text', required: false, multiple: false },
      { key: 'use_lorebooks', label: '로어북', direction: 'input', data_type: 'boolean', required: false, multiple: false, default_value: true },
    ],
    outputPorts: [
      { key: 'text', label: '텍스트', direction: 'output', data_type: 'text', required: true, multiple: false },
      { key: 'metadata', label: '메타데이터', direction: 'output', data_type: 'json', required: false, multiple: false },
    ],
    internalFixedValues: { operation_key: 'system.chat_profile_reply' },
    uiSchema: [
      { key: 'profile_id', label: '프로필', data_type: 'number', options_source: 'chat_profiles' },
      { key: 'model_slot_id', label: '모델', data_type: 'number', options_source: 'llm_model_rows' },
      { key: 'message', label: '메시지', data_type: 'prompt', placeholder: '캐릭터에게 보낼 메시지' },
      { key: 'history', label: '앞 대화', data_type: 'text', placeholder: '사용자: …\n{{char}}: …' },
      { key: 'user_name', label: '상대 이름', data_type: 'text' },
      { key: 'use_lorebooks', label: '로어북', data_type: 'boolean', default_value: true },
    ],
    color: '#7e57c2',
  },
  {
    name: '외형 태그',
    description: '이미지나 설명에서 캐릭터 외형 태그를 뽑아.',
    category: 'llm',
    exposedInputs: [
      { key: 'profile_id', label: '프로필', direction: 'input', data_type: 'number', required: false, multiple: false },
      { key: 'model_slot_id', label: '모델', direction: 'input', data_type: 'number', required: false, multiple: false },
      { key: 'image', label: '이미지', direction: 'input', data_type: 'image', required: false, multiple: false },
      { key: 'description', label: '설명', direction: 'input', data_type: 'text', required: false, multiple: false },
    ],
    outputPorts: [
      { key: 'tags', label: '태그', direction: 'output', data_type: 'prompt', required: true, multiple: false },
    ],
    internalFixedValues: { operation_key: 'system.draft_appearance_tags' },
    uiSchema: [
      { key: 'profile_id', label: '프로필', data_type: 'number', options_source: 'chat_profiles' },
      { key: 'model_slot_id', label: '모델', data_type: 'number', options_source: 'llm_model_rows' },
      { key: 'image', label: '이미지', data_type: 'image' },
      { key: 'description', label: '설명', data_type: 'text', placeholder: '선택: 캐릭터 설명' },
    ],
    color: '#7e57c2',
  },
];
