/** Presentation families only. Saved module IDs, operation keys and executor contracts stay unchanged. */
export type BuiltinNodeModule = {
  engine_type: string
  authoring_source?: string
  external_key?: string | null
  internal_fixed_values?: Record<string, unknown> | null
  template_defaults?: Record<string, unknown> | null
}
export type BuiltinNodeVariant = {
  id: string
  familyId: string
  label: { ko: string; en: string }
  operationKey: string
  inputValues: Record<string, string | number | boolean>
  aliases: string[]
  legacy?: boolean
}
export type BuiltinNodeFamily = {
  id: string
  label: { ko: string; en: string }
  group: string
  variants: BuiltinNodeVariant[]
}

/** Keep the editor's established display names consistent in both native and chat edits. */
export function getWorkflowModuleBaseDisplayName(module: BuiltinNodeModule & { name?: string }): string {
  const operation = module.internal_fixed_values?.operation_key ?? module.template_defaults?.operation_key
  const names: Record<string, string> = {
    'system.constant_text': '텍스트', 'system.constant_prompt': '텍스트',
    'system.constant_json': 'JSON', 'system.constant_image': '이미지',
    'system.constant_number': '숫자', 'system.constant_boolean': '불리언',
    'system.merge_text': '텍스트 합치기', 'system.random_text_choice': '랜덤 항목 출력',
  }
  return typeof operation === 'string' && Object.prototype.hasOwnProperty.call(names, operation) ? names[operation] : module.name ?? ''
}
type VariantSpec = [id: string, operation: string, ko: string, en: string, inputValues?: BuiltinNodeVariant['inputValues'], legacy?: boolean]
function family(id: string, ko: string, en: string, group: string, specs: VariantSpec[]): BuiltinNodeFamily {
  return { id, label: { ko, en }, group, variants: specs.map(([variantId, operation, koLabel, enLabel, inputValues = {}, legacy]) => ({
    id: `${id}.${variantId}`, familyId: id, label: { ko: koLabel, en: enLabel }, operationKey: `system.${operation}`,
    inputValues, aliases: [koLabel, enLabel, operation], ...(legacy ? { legacy: true } : {}),
  })) }
}
export const BUILTIN_NODE_FAMILIES: BuiltinNodeFamily[] = [
  family('value', '값', 'Value', 'input', [
    ['text', 'constant_text', '텍스트', 'Text'], ['number', 'constant_number', '숫자', 'Number'],
    ['boolean', 'constant_boolean', '불리언', 'Boolean'], ['json', 'constant_json', 'JSON', 'JSON'],
    ['image', 'constant_image', '이미지', 'Image'], ['prompt', 'constant_prompt', '상수 프롬프트', 'Legacy prompt', {}, true],
  ]),
  family('text', '텍스트 처리', 'Text processing', 'utility', [
    ['merge', 'merge_text', '합치기', 'Merge'], ['extract', 'regex_text_transform', '정규식 추출', 'Regex extract', { mode: 'extract' }],
    ['replace', 'regex_text_transform', '치환', 'Replace', { mode: 'replace' }], ['wildcard', 'apply_wildcards', '와일드카드 적용', 'Apply wildcards'],
  ]),
  family('random', '랜덤 선택', 'Random choice', 'input', [
    ['choice', 'random_text_choice', '직접 입력 목록', 'Input list'], ['prompt', 'random_prompt_from_group', '프롬프트 그룹', 'Prompt group'],
    ['image', 'random_image_from_library', '라이브러리 이미지', 'Library image'], ['video', 'random_video_from_library', '라이브러리 영상', 'Library video'],
  ]),
  family('reference', '참조 불러오기', 'Load reference', 'get', [
    ['image', 'load_image_from_reference', '이미지', 'Image'], ['prompt', 'load_prompt_from_reference', '프롬프트', 'Prompt'],
  ]),
  family('image-tags', '이미지 태그 분석', 'Image tag analysis', 'utility', [
    ['tags', 'extract_tags_from_image', '일반 태그', 'General tags'], ['artist', 'extract_artist_from_image', '작가·스타일', 'Artist and style'],
  ]),
  family('logic', '논리 연산', 'Logic operation', 'logic', [
    ['and', 'logic_and', 'AND', 'AND'], ['or', 'logic_or', 'OR', 'OR'], ['not', 'logic_not', 'NOT', 'NOT'],
  ]),
  family('condition', '조건 검사', 'Condition check', 'logic', [
    ['compare', 'logic_compare', '값 비교', 'Compare values'], ['text', 'logic_text_match', '텍스트 매치', 'Text match'], ['presence', 'logic_value_presence', '값 존재 여부', 'Value presence'],
  ]),
  family('base64', 'Base64 변환', 'Base64 conversion', 'utility', [
    ['encode', 'base64_encode', '인코딩', 'Encode'], ['decode', 'base64_decode', '디코딩', 'Decode'],
  ]),
  family('llm', 'LLM 처리', 'LLM processing', 'llm', [
    ['call', 'call_llm', '일반 호출', 'General call'], ['codex', 'call_codex_message', 'Codex 메시지', 'Codex message'],
    ['translate', 'translate_text', '번역', 'Translate'], ['character', 'chat_profile_reply', '캐릭터 답변', 'Character reply'], ['appearance', 'draft_appearance_tags', '외형 태그', 'Appearance tags'],
  ]),
  family('generate', '이미지 생성', 'Image generation', 'generation', [
    ['nai', 'generate_image_nai', 'NovelAI', 'NovelAI'], ['codex', 'generate_image_codex', 'Codex', 'Codex'], ['preset', 'generate_with_chat_preset', '저장된 생성 프리셋', 'Saved generation preset'],
  ]),
  family('publish', '메시지 게시', 'Publish message', 'output', [
    ['chat', 'post_to_chat_room', '채팅방', 'Chat room'], ['board', 'post_to_board', '게시판', 'Board'],
  ]),
]

/** Explicit allowlist keeps user modules and Director/MiniMax nodes outside consolidation. */
export function getBuiltinNodeFamily(module: BuiltinNodeModule): BuiltinNodeFamily | null {
  if (module.engine_type !== 'system' || module.authoring_source && module.authoring_source !== 'manual') return null
  const operation = module.internal_fixed_values?.operation_key ?? module.template_defaults?.operation_key
  if ('external_key' in module && module.external_key !== operation) return null
  return BUILTIN_NODE_FAMILIES.find((entry) => entry.variants.some((variant) => variant.operationKey === operation)) ?? null
}

export function getBuiltinNodeVariant(module: BuiltinNodeModule, inputValues: Record<string, unknown> = {}): BuiltinNodeVariant | null {
  const family = getBuiltinNodeFamily(module)
  const operation = module.internal_fixed_values?.operation_key ?? module.template_defaults?.operation_key
  const variants = family?.variants.filter((variant) => variant.operationKey === operation) ?? []
  const values = { ...module.template_defaults, ...inputValues, ...module.internal_fixed_values }
  return variants.find((variant) => Object.entries(variant.inputValues).every(([key, value]) => values[key] === value)) ?? variants[0] ?? null
}

/** The first available entry is the family default; every entry still carries the live module schema. */
export function listBuiltinNodeVariants<T extends BuiltinNodeModule>(modules: readonly T[], familyId: string): Array<{ module: T; variant: BuiltinNodeVariant }> {
  const family = BUILTIN_NODE_FAMILIES.find((entry) => entry.id === familyId)
  return (family?.variants ?? []).filter((variant) => !variant.legacy).flatMap((variant) => {
    const module = modules.find((entry) => getBuiltinNodeFamily(entry)?.id === familyId
      && (entry.internal_fixed_values?.operation_key ?? entry.template_defaults?.operation_key) === variant.operationKey)
    return module ? [{ module, variant }] : []
  })
}
