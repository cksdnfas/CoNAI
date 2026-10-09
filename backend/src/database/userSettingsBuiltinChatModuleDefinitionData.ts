import type { BuiltinSystemModuleDefinition } from './userSettingsBuiltinModuleDefinitions';

/** Built-in nodes that read or write chat data (character profiles, generation presets, lorebooks, chat rooms). */
export const BUILTIN_CHAT_NODE_DEFINITIONS: BuiltinSystemModuleDefinition[] = [
  {
    name: '캐릭터 불러오기',
    description: '채팅 캐릭터의 이름, 외형, 페르소나, 인사말과 이미지를 꺼내와.',
    category: 'get',
    exposedInputs: [
      { key: 'profile_id', label: '캐릭터', direction: 'input', data_type: 'number', required: true, multiple: false },
    ],
    outputPorts: [
      { key: 'name', label: '이름', direction: 'output', data_type: 'text', required: false, multiple: false },
      { key: 'appearance', label: '외형', direction: 'output', data_type: 'prompt', required: false, multiple: false },
      { key: 'persona', label: '페르소나', direction: 'output', data_type: 'text', required: false, multiple: false },
      { key: 'greeting', label: '인사말', direction: 'output', data_type: 'text', required: false, multiple: false },
      { key: 'reference_image', label: '기준 이미지', direction: 'output', data_type: 'image', required: false, multiple: false },
      { key: 'avatar_image', label: '아바타', direction: 'output', data_type: 'image', required: false, multiple: false },
      { key: 'background_image', label: '배경', direction: 'output', data_type: 'image', required: false, multiple: false },
      { key: 'profile', label: '프로필', direction: 'output', data_type: 'json', required: false, multiple: false },
    ],
    internalFixedValues: { operation_key: 'system.load_chat_profile' },
    uiSchema: [
      { key: 'profile_id', label: '캐릭터', data_type: 'number', options_source: 'chat_profiles' },
    ],
    color: '#ec407a',
  },
  {
    name: '생성 프리셋',
    description: '채팅 생성 프리셋으로 이미지를 만들어. 캐릭터를 고르면 외형과 기준 이미지를 같이 써.',
    category: 'generation',
    exposedInputs: [
      { key: 'preset_id', label: '프리셋', direction: 'input', data_type: 'number', required: true, multiple: false },
      { key: 'prompt', label: '프롬프트', direction: 'input', data_type: 'prompt', required: true, multiple: false },
      { key: 'profile_id', label: '캐릭터', direction: 'input', data_type: 'number', required: false, multiple: false },
      { key: 'reference_image', label: '참조 이미지', direction: 'input', data_type: 'image', required: false, multiple: false },
    ],
    outputPorts: [
      { key: 'image', label: '이미지', direction: 'output', data_type: 'image', required: true, multiple: false },
      { key: 'metadata', label: '메타데이터', direction: 'output', data_type: 'json', required: false, multiple: false },
    ],
    internalFixedValues: { operation_key: 'system.generate_with_chat_preset' },
    uiSchema: [
      { key: 'preset_id', label: '프리셋', data_type: 'number', options_source: 'chat_generation_presets' },
      { key: 'prompt', label: '프롬프트', data_type: 'prompt' },
      { key: 'profile_id', label: '캐릭터', data_type: 'number', options_source: 'chat_profiles' },
      { key: 'reference_image', label: '참조 이미지', data_type: 'image' },
    ],
    color: '#ab47bc',
  },
  {
    name: '로어북 검색',
    description: '텍스트에 키워드가 걸리는 로어북 항목을 찾아.',
    category: 'get',
    exposedInputs: [
      { key: 'text', label: '텍스트', direction: 'input', data_type: 'prompt', required: true, multiple: false },
      { key: 'lorebook_id', label: '로어북', direction: 'input', data_type: 'number', required: false, multiple: false },
      { key: 'profile_id', label: '캐릭터', direction: 'input', data_type: 'number', required: false, multiple: false },
      { key: 'max_entries', label: '최대 항목', direction: 'input', data_type: 'number', required: false, multiple: false, default_value: 5 },
    ],
    outputPorts: [
      { key: 'text', label: '텍스트', direction: 'output', data_type: 'text', required: false, multiple: false },
      { key: 'entries', label: '항목', direction: 'output', data_type: 'json', required: false, multiple: false },
    ],
    internalFixedValues: { operation_key: 'system.search_lorebook' },
    uiSchema: [
      { key: 'text', label: '텍스트', data_type: 'prompt' },
      { key: 'lorebook_id', label: '로어북', data_type: 'number', options_source: 'chat_lorebooks' },
      { key: 'profile_id', label: '캐릭터', data_type: 'number', options_source: 'chat_profiles' },
      { key: 'max_entries', label: '최대 항목', data_type: 'number', default_value: 5, min: 1, max: 50 },
    ],
    color: '#8d6e63',
  },
  {
    name: '채팅방에 올리기',
    description: '내 채팅방에 글이나 이미지를 캐릭터 답장이나 메모로 올려.',
    category: 'output',
    exposedInputs: [
      { key: 'room_id', label: '채팅방', direction: 'input', data_type: 'number', required: true, multiple: false },
      { key: 'text', label: '내용', direction: 'input', data_type: 'text', required: false, multiple: false },
      { key: 'image', label: '이미지', direction: 'input', data_type: 'image', required: false, multiple: false },
      { key: 'as', label: '보내는 쪽', direction: 'input', data_type: 'text', required: false, multiple: false, default_value: 'character' },
    ],
    outputPorts: [
      { key: 'message', label: '메시지', direction: 'output', data_type: 'json', required: false, multiple: false },
    ],
    internalFixedValues: { operation_key: 'system.post_to_chat_room' },
    uiSchema: [
      { key: 'room_id', label: '채팅방', data_type: 'number', options_source: 'chat_rooms' },
      { key: 'text', label: '내용', data_type: 'text' },
      { key: 'image', label: '이미지', data_type: 'image' },
      {
        key: 'as',
        label: '보내는 쪽',
        data_type: 'select',
        default_value: 'character',
        options: [
          { value: 'character', label: '캐릭터' },
          { value: 'note', label: '메모' },
        ],
      },
    ],
    color: '#26a69a',
  },
  {
    name: '채팅방 깨우기',
    description: '채팅방에 지시를 보내서 캐릭터가 자기 도구로 일하게 해. 실행한 계정의 방에서, 프로필 권한만큼 움직여.',
    category: 'output',
    exposedInputs: [
      { key: 'target', label: '보낼 곳', direction: 'input', data_type: 'text', required: false, multiple: false, default_value: 'dedicated' },
      { key: 'profile_id', label: '캐릭터', direction: 'input', data_type: 'number', required: false, multiple: false },
      { key: 'room_id', label: '채팅방', direction: 'input', data_type: 'number', required: false, multiple: false },
      { key: 'message', label: '지시', direction: 'input', data_type: 'text', required: true, multiple: false },
      { key: 'wait', label: '답장 기다리기', direction: 'input', data_type: 'boolean', required: false, multiple: false, default_value: true },
      { key: 'chain_limit', label: '이어 부르기', direction: 'input', data_type: 'number', required: false, multiple: false },
    ],
    outputPorts: [
      { key: 'text', label: '답장', direction: 'output', data_type: 'text', required: false, multiple: false },
      { key: 'replies', label: '답장 목록', direction: 'output', data_type: 'json', required: false, multiple: false },
      { key: 'room_id', label: '채팅방', direction: 'output', data_type: 'number', required: false, multiple: false },
    ],
    internalFixedValues: { operation_key: 'system.wake_chat_room' },
    uiSchema: [
      {
        key: 'target',
        label: '보낼 곳',
        data_type: 'select',
        default_value: 'dedicated',
        options: [
          { value: 'dedicated', label: '전용 방' },
          { value: 'room', label: '고른 방' },
        ],
      },
      { key: 'profile_id', label: '캐릭터', data_type: 'number', options_source: 'chat_profiles' },
      { key: 'room_id', label: '채팅방', data_type: 'number', options_source: 'chat_rooms' },
      { key: 'message', label: '지시', data_type: 'text' },
      { key: 'wait', label: '답장 기다리기', data_type: 'boolean', default_value: true },
      { key: 'chain_limit', label: '이어 부르기', data_type: 'number', min: 0, max: 10 },
    ],
    color: '#5c6bc0',
  },
  {
    name: '게시판에 올리기',
    description: '게시판에 글을 올려. 캐릭터를 고르면 그 봇 이름으로, 비우면 실행한 계정 이름으로 올라가.',
    category: 'output',
    exposedInputs: [
      { key: 'title', label: '제목', direction: 'input', data_type: 'text', required: true, multiple: false },
      { key: 'text', label: '본문', direction: 'input', data_type: 'text', required: false, multiple: false },
      { key: 'image', label: '이미지', direction: 'input', data_type: 'image', required: false, multiple: false },
      { key: 'category_id', label: '카테고리', direction: 'input', data_type: 'number', required: false, multiple: false },
      { key: 'tags', label: '태그', direction: 'input', data_type: 'text', required: false, multiple: false },
      { key: 'profile_id', label: '캐릭터', direction: 'input', data_type: 'number', required: false, multiple: false },
      { key: 'status', label: '상태', direction: 'input', data_type: 'text', required: false, multiple: false, default_value: 'published' },
    ],
    outputPorts: [
      { key: 'post', label: '게시물', direction: 'output', data_type: 'json', required: false, multiple: false },
    ],
    internalFixedValues: { operation_key: 'system.post_to_board' },
    uiSchema: [
      { key: 'title', label: '제목', data_type: 'text' },
      { key: 'text', label: '본문', data_type: 'text' },
      { key: 'image', label: '이미지', data_type: 'image' },
      { key: 'category_id', label: '카테고리', data_type: 'number', options_source: 'post_categories' },
      { key: 'tags', label: '태그 (쉼표로 구분)', data_type: 'text' },
      { key: 'profile_id', label: '캐릭터', data_type: 'number', options_source: 'chat_profiles' },
      {
        key: 'status',
        label: '상태',
        data_type: 'select',
        default_value: 'published',
        options: [
          { value: 'published', label: '발행' },
          { value: 'draft', label: '초안' },
        ],
      },
    ],
    color: '#ef6c00',
  },
];
