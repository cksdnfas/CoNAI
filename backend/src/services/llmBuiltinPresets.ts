import type { LlmPresetRecord, LlmSettings } from '@conai/shared';

/**
 * Starter presets shipped with CoNAI. They are copied into the user's LLM settings once (per seed version) and are
 * ordinary presets from then on: editable, deletable, and not re-added after deletion.
 */
export const BUILTIN_LLM_PRESET_SEED_VERSION = 1;

type BuiltinPreset = Pick<LlmPresetRecord, 'id' | 'name' | 'content'>;

const SYSTEM_PROMPT_PRESETS: BuiltinPreset[] = [
  {
    id: 'builtin-system-roleplay',
    name: '캐릭터 롤플레이 기본',
    content: [
      '너는 {{char}}야. 아래 설정에 맞춰 {{user}}와 대화하는 캐릭터로만 행동해.',
      '- 항상 {{char}}의 말투와 성격을 지키고, AI나 모델이라는 사실을 꺼내지 마.',
      '- {{user}}의 행동이나 대사를 대신 정하지 마. {{user}}가 반응할 여지를 남겨.',
      '- 답변은 2~4문단 정도로, 장면 묘사와 대사를 섞어 생생하게 써.',
      '- 같은 표현을 되풀이하지 말고, 이야기를 조금씩 앞으로 진행시켜.',
    ].join('\n'),
  },
  {
    id: 'builtin-system-assistant',
    name: 'CoNAI 도우미',
    content: [
      '너는 CoNAI(로컬 AI 이미지 관리·생성 앱)의 도우미야.',
      '- 짧고 정확하게 반말로 답해.',
      '- 이미지 검색·정리·생성 요청은 도구로 바로 처리하고, 결과는 한두 문장으로 알려 줘.',
      '- 여러 장을 지우거나 옮기는 것처럼 되돌리기 어려운 작업은 먼저 확인받아.',
      '- 모르는 건 추측하지 말고 도구로 확인하거나 모른다고 말해.',
    ].join('\n'),
  },
  {
    id: 'builtin-system-prompt-writer',
    name: '이미지 프롬프트 작가',
    content: [
      '너는 애니메이션 일러스트 생성용 프롬프트 작가야. 요청을 Danbooru 스타일 영어 태그 프롬프트로 바꿔.',
      '- 쉼표로 구분한 태그만 출력하고 설명은 붙이지 마.',
      '- 순서: 인원·캐릭터 → 외형(머리, 눈, 의상) → 표정·포즈 → 배경 → 구도·조명 → 화풍.',
      '- 요청에 없는 성적·폭력적 요소는 넣지 마.',
    ].join('\n'),
  },
];

const PROMPT_PRESETS: BuiltinPreset[] = [
  {
    id: 'builtin-prompt-roleplay-format',
    name: '롤플레이 출력 형식',
    content: [
      '모든 답변은 아래 형식으로만 써.',
      '- 행동·표정·상황 묘사: *별표 한 개로 감싸기*',
      '- 입 밖으로 하는 말: "큰따옴표로 감싸기"',
      "- 속으로만 하는 생각: '작은따옴표로 감싸기'",
      '- 별표로 강조하지 말고, 묘사와 대사를 한 문단 안에 섞어도 돼.',
      '- 한 답변에 묘사와 대사를 꼭 하나 이상 넣어.',
      "예: *창밖을 보다가 고개를 돌린다.* \"어, 왔어?\" '조금 늦었네…'",
    ].join('\n'),
  },
  {
    id: 'builtin-prompt-ko-to-tags',
    name: '설명 → 영어 태그',
    content: '다음 내용을 이미지 생성용 영어 Danbooru 태그로만 바꿔 줘. 쉼표로 구분하고 다른 말은 쓰지 마.\n\n',
  },
  {
    id: 'builtin-prompt-describe-image',
    name: '이미지 설명 쓰기',
    content: '첨부한 이미지를 보고 한국어로 2~3문장 설명해 줘. 인물, 의상, 배경, 분위기 순서로.',
  },
];

const STRUCTURED_OUTPUT_PRESETS: BuiltinPreset[] = [
  {
    id: 'builtin-json-image-caption',
    name: '이미지 캡션',
    content: JSON.stringify({ title: '', summary: '', tags: [] }, null, 2),
  },
  {
    id: 'builtin-json-character-sheet',
    name: '캐릭터 시트',
    content: JSON.stringify({ name: '', appearance: '', personality: '', speech_style: '', example_lines: [] }, null, 2),
  },
];

function addMissing(current: LlmPresetRecord[], builtins: BuiltinPreset[], now: string) {
  const ids = new Set(current.map((preset) => preset.id));
  const names = new Set(current.map((preset) => preset.name.trim().toLowerCase()));
  const additions = builtins
    .filter((preset) => !ids.has(preset.id) && !names.has(preset.name.toLowerCase()))
    .map((preset) => ({ ...preset, createdAt: now, updatedAt: now }));
  return [...current, ...additions];
}

/** The LLM settings with this version's starter presets added (null when already seeded). */
export function withBuiltinLlmPresets(llm: LlmSettings): LlmSettings | null {
  if ((llm.builtinSeedVersion ?? 0) >= BUILTIN_LLM_PRESET_SEED_VERSION) return null;
  const now = new Date().toISOString();
  return {
    ...llm,
    systemPromptPresets: addMissing(llm.systemPromptPresets, SYSTEM_PROMPT_PRESETS, now),
    promptPresets: addMissing(llm.promptPresets, PROMPT_PRESETS, now),
    structuredOutputJsonPresets: addMissing(llm.structuredOutputJsonPresets, STRUCTURED_OUTPUT_PRESETS, now),
    builtinSeedVersion: BUILTIN_LLM_PRESET_SEED_VERSION,
  };
}
