import type { useI18n } from '@/i18n'
import type { ChatScope } from '@/lib/api-codex-chat'

type TranslateFn = ReturnType<typeof useI18n>['t']

/** Label and tooltip of one MCP scope a chat profile can grant. */
export function getChatScopeCopy(scope: ChatScope, t: TranslateFn) {
  switch (scope) {
    case 'read':
      return { label: t({ ko: '조회', en: 'Read' }), description: t({ ko: '이미지·프롬프트·워크플로·생성 기록을 검색하고 읽어.', en: 'Search and read images, prompts, workflows and generation history.' }) }
    case 'generate':
      return { label: t({ ko: '생성', en: 'Generate' }), description: t({ ko: 'NAI·ComfyUI·Codex 생성과 워크플로 실행을 시작하거나 취소해.', en: 'Start or cancel NAI/ComfyUI/Codex generations and workflow runs.' }) }
    case 'organize':
      return { label: t({ ko: '정리', en: 'Organize' }), description: t({ ko: '그룹을 만들고 이미지·프롬프트를 그룹에 넣거나 옮겨.', en: 'Create groups and add or move images and prompts into them.' }) }
  }
}
