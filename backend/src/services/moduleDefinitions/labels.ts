const LABEL_OVERRIDES_BY_KEY: Record<string, string> = {
  prompt: '프롬프트',
  negative_prompt: '네거티브 프롬프트',
  model: '모델',
  action: '동작',
  sampler: '샘플러',
  noise_schedule: '스케줄러',
  width: '너비',
  height: '높이',
  steps: '스텝',
  scale: 'CFG 스케일',
  n_samples: '샘플 수',
  seed: '시드',
  variety_plus: '버라이어티+',
  characters: '캐릭터 프롬프트',
  vibes: '바이브 전송',
  character_refs: '캐릭터 레퍼런스',
  image: '이미지',
  video: '비디오',
  mask: '마스크 이미지',
  strength: '강도',
  noise: '노이즈',
  add_original_image: '원본 이미지 추가',
  metadata: '메타데이터',
  text: '텍스트',
  json: 'JSON',
  system_prompt: '시스템 프롬프트',
  context: '컨텍스트',
  provider_name: '연결 이름',
  response_mode: '응답 형식',
  temperature: '온도',
  max_tokens: '최대 토큰',
  group_name: '그룹 이름',
  group_id: '그룹 ID',
  type: '컬렉션 타입',
  entry_json: '엔트리 JSON',
  limit: '개수 제한',
  threshold: '임계값',
  include_prompt: '프롬프트 포함',
  matches: '매치 결과',
  reference: '참조',
  composite_hash: '컴포지트 해시',
  index: '인덱스',
  image_ref: '이미지 참조',
  video_ref: '비디오 참조',
  aspect_ratio: '비율',
  resolution: '해상도',
  operation: '동작',
  quality: '품질',
  background: '배경',
  output_format: '출력 포맷',
  tags_text: '태그 텍스트',
  tags_prompt: '태그 프롬프트',
  tags_json: '태그 JSON',
  artist_text: '작가 텍스트',
  artist_prompt: '작가 프롬프트',
  artist_json: '작가 JSON',
}

const LABEL_OVERRIDES_BY_TEXT: Record<string, string> = {
  'Prompt': '프롬프트',
  'Negative Prompt': '네거티브 프롬프트',
  'Model': '모델',
  'Action': '동작',
  'Sampler': '샘플러',
  'Scheduler': '스케줄러',
  'Width': '너비',
  'Height': '높이',
  'Steps': '스텝',
  'CFG Scale': 'CFG 스케일',
  'Samples': '샘플 수',
  'Seed': '시드',
  'Variety+': '버라이어티+',
  'Character Prompts': '캐릭터 프롬프트',
  'Vibe Transfer': '바이브 전송',
  'Character References': '캐릭터 레퍼런스',
  'Source Image': '원본 이미지',
  'Mask Image': '마스크 이미지',
  'Add Original Image': '원본 이미지 추가',
  'System Text': '시스템 텍스트',
  'Metadata': '메타데이터',
  'JSON': 'JSON',
  'System Prompt': '시스템 프롬프트',
  'Context': '컨텍스트',
  'Provider Name': '연결 이름',
  'Response Mode': '응답 형식',
  'Temperature': '온도',
  'Max Tokens': '최대 토큰',
  'Generated Image': '생성 이미지',
  'Workflow Image': '워크플로 이미지',
  'Group Name': '그룹 이름',
  'Group ID': '그룹 ID',
  'Collection Type': '컬렉션 타입',
  'Text': '텍스트',
  'Entry JSON': '엔트리 JSON',
  'Image': '이미지',
  'Video': '비디오',
  'Limit': '개수 제한',
  'Threshold': '임계값',
  'Include Prompt': '프롬프트 포함',
  'Matches': '매치 결과',
  'Reference': '참조',
  'Composite Hash': '컴포지트 해시',
  'Index': '인덱스',
  'Image Reference': '이미지 참조',
  'Video Reference': '비디오 참조',
  'Aspect Ratio': '비율',
  'Resolution': '해상도',
  'Operation': '동작',
  'Quality': '품질',
  'Background': '배경',
  'Output Format': '출력 포맷',
  'Tags Text': '태그 텍스트',
  'Tags Prompt': '태그 프롬프트',
  'Tags JSON': '태그 JSON',
  'Artist Text': '작가 텍스트',
  'Artist Prompt': '작가 프롬프트',
  'Artist JSON': '작가 JSON',
}

const MODULE_NAME_OVERRIDES: Record<string, string> = {
  'Random Prompt From Group': '그룹 랜덤 프롬프트',
  'Find Similar Images': '유사 이미지 찾기',
  'Load Prompt From Reference': '참조에서 프롬프트 불러오기',
  'Load Image From Reference': '참조에서 이미지 불러오기',
  'Extract Tags From Image': '이미지에서 태그 추출',
  'Extract Artist From Image': '이미지에서 작가 추출',
  'Random Image From Library': '라이브러리 랜덤 이미지',
}

export function humanizeModuleDefinitionKey(key: string): string {
  return key
    .split(/[_\-.]/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

export function localizeDisplayLabel(key: string, label?: string | null): string {
  const trimmedLabel = typeof label === 'string' ? label.trim() : ''
  const defaultLabel = LABEL_OVERRIDES_BY_KEY[key] ?? humanizeModuleDefinitionKey(key)

  if (!trimmedLabel) {
    return defaultLabel
  }

  if (LABEL_OVERRIDES_BY_TEXT[trimmedLabel]) {
    return LABEL_OVERRIDES_BY_TEXT[trimmedLabel]
  }

  if (trimmedLabel === key || trimmedLabel === humanizeModuleDefinitionKey(key)) {
    return defaultLabel
  }

  return trimmedLabel
}

export function localizeModuleName(name: string, authoringSource?: string | null): string {
  const trimmedName = typeof name === 'string' ? name.trim() : ''
  if (!trimmedName) {
    return trimmedName
  }

  if (MODULE_NAME_OVERRIDES[trimmedName]) {
    return MODULE_NAME_OVERRIDES[trimmedName]
  }

  if (authoringSource === 'comfyui_workflow_wrap' && trimmedName.endsWith(' Module')) {
    return `${trimmedName.slice(0, -' Module'.length)} 모듈`
  }

  return trimmedName
}

export function inferPortLabel(key: string): string {
  return LABEL_OVERRIDES_BY_KEY[key] ?? humanizeModuleDefinitionKey(key)
}
