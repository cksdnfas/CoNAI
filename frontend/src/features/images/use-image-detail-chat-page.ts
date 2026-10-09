import { useChatPageRegistration } from '@/features/codex-chat/chat-page-context'
import { useI18n } from '@/i18n'
import { useNavigate } from 'react-router-dom'
import { useAuthStatusQuery } from '@/features/auth/use-auth-status-query'
import { pageAction, pageChoice, pageObject } from '@/features/codex-chat/page-action-helpers'
import type { ImageRecord } from '@/types/image'

export function useImageDetailChatPage(image: ImageRecord | undefined, presentation: 'page' | 'modal', tab: 'current' | 'similar', setTab: (value: 'current' | 'similar') => void) {
  const { t } = useI18n()
  const navigate = useNavigate()
  const auth = useAuthStatusQuery().data
  const metadataPath = `/images/${image?.composite_hash ?? ''}/metadata`
  useChatPageRegistration(image?.composite_hash ? {
    kind: 'image_detail', title: t({ ko: '이미지 상세', en: 'Image details' }), resourceId: image.composite_hash, priority: presentation === 'modal' ? 100 : 0,
    fields: [
      { id: 'tab', label: t({ ko: '이미지 표시', en: 'Image view' }), type: 'select', value: tab, options: ['current', 'similar'] },
      { id: 'prompt', label: t({ ko: '현재 이미지 프롬프트', en: 'Current image prompt' }), type: 'text', value: (image.ai_metadata?.prompts?.prompt ?? '').slice(0, 8000), editable: false },
      { id: 'negativePrompt', label: t({ ko: '현재 이미지 부정 프롬프트', en: 'Current image negative prompt' }), type: 'text', value: (image.ai_metadata?.prompts?.negative_prompt ?? '').slice(0, 8000), editable: false },
    ],
    data: { selected: { hash: image.composite_hash, width: image.width ?? 0, height: image.height ?? 0, mimeType: image.mime_type ?? '', model: image.ai_metadata?.model_name ?? '', tool: image.ai_metadata?.ai_tool ?? '' } },
    actions: auth?.permissionKeys.includes('page.metadata-editor.view') ? [pageAction('page.navigate', t({ ko: '이미지 프롬프트·메타데이터 편집 열기', en: 'Open image metadata editor' }), t({ ko: '현재 이미지의 메타데이터 편집 페이지를 열어.', en: 'Open the current image metadata editor.' }), pageObject({ to: pageChoice([metadataPath]) }, ['to']))] : [],
    apply: (patch) => { if (patch.tab !== undefined) setTab(patch.tab as 'current' | 'similar') },
    applyAction: (_id, args, assertCurrent) => { assertCurrent(); void navigate(String(args.to)) },
  } : null)
}
