import type { GenerationLayoutBlock } from '@conai/shared'
import type { TranslationDictionary } from '@/i18n'

export const GENERATION_LAYOUT_BLOCK_LABELS: Record<GenerationLayoutBlock, TranslationDictionary> = {
  prompt: { ko: '프롬프트', en: 'Prompt' },
  characters: { ko: '캐릭터 프롬프트', en: 'Character prompt' },
  settings: { ko: '설정', en: 'Settings' },
  images: { ko: '이미지', en: 'Images' },
  references: { ko: '레퍼런스', en: 'References' },
  vibes: { ko: '바이브', en: 'Vibes' },
  action: { ko: '생성 버튼', en: 'Generate button' },
  result: { ko: '결과', en: 'Result' },
  recent: { ko: '최근 결과', en: 'Recent results' },
  model: { ko: '실행 모델', en: 'Agent model' },
  output: { ko: '출력', en: 'Output' },
  workflow: { ko: '워크플로 이름', en: 'Workflow name' },
  fields: { ko: '입력 필드', en: 'Input fields' },
  workflows: { ko: '워크플로 목록', en: 'Workflow list' },
  management: { ko: '서버·드롭다운 관리', en: 'Servers and dropdowns' },
  list: { ko: '워크플로 목록', en: 'Workflow list' },
  outputs: { ko: '생성물', en: 'Outputs' },
  runner: { ko: '실행 입력', en: 'Run inputs' },
  results: { ko: '결과·실행 기록', en: 'Results and runs' },
}
