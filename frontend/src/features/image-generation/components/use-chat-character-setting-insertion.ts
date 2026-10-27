import { useQueryClient } from '@tanstack/react-query'
import type { ChatPageData, ChatPageSchema } from '@conai/shared'
import { useFeaturePermissions } from '@/features/auth/use-feature-permissions'
import { useImagePermissions } from '@/features/auth/use-image-permissions'
import { pageAction, pageChoice, pageNumber, pageObject } from '@/features/codex-chat/page-action-helpers'
import { useI18n } from '@/i18n'
import { characterSettingQueryKey, getCharacterSetting } from '@/lib/api-character-library'
import { loadCharacterReferenceDraft } from '../character-setting-load'
import { appendPromptText, type TextSegmentSpreadsheetValue } from './prompt-text-segment-helpers'
import { insertChatPageText } from './use-chat-preset-insertion'

/** `auto`: the reference goes in when the setting has one; `required`: it must; `off`: tags only. */
type ReferenceMode = 'auto' | 'required' | 'off'

/**
 * Page action `character_setting.insert` for the generation forms: copy a character library setting's appearance
 * tags (and reference image) into the form at that moment, with the form's own insertion rules. Each form adds its
 * target arguments; the change is a draft with undo through the form's draft transaction.
 */
export function useChatCharacterSettingInsertion() {
  const queryClient = useQueryClient()
  const { t } = useI18n()
  const canView = useFeaturePermissions().has('characters.view')
  const { canViewImages } = useImagePermissions()

  return {
    /** Whether the form can take a reference image from the setting (`images.view`). */
    canReference: canViewImages,
    actions: (targets: Record<string, ChatPageSchema>, required: string[], description: string) => canView ? [pageAction(
      'character_setting.insert',
      t({ ko: '캐릭터 외형 불러오기', en: 'Load character appearance' }),
      `Copy a character library setting (find settingId with list_character_library) into this form: its appearance tags go into target like a preset row (append adds them on a new line; replace replaces the input), its reference image optionally too. A copy: later library edits do not change the form. ${description}`,
      pageObject({ settingId: pageNumber(1, undefined, true), ...targets, mode: pageChoice(['append', 'replace']) }, ['settingId', ...required]),
    )] : [],
    /** Map an `includeReference` argument onto what the form can take. */
    referenceMode: (include: ChatPageData | undefined, available: boolean): ReferenceMode => {
      if (include === false) return 'off'
      if (!available) {
        if (include === true) throw new Error(t({ ko: '이 입력엔 레퍼런스 이미지를 넣을 수 없어.', en: 'This input cannot take a reference image.' }))
        return 'off'
      }
      return include === true ? 'required' : 'auto'
    },
    /** Read the stored setting now (not a cached copy) and its reference image when it goes in. */
    load: async (args: Record<string, ChatPageData>, reference: ReferenceMode) => {
      if (!canView) throw new Error(t({ ko: '캐릭터 라이브러리 조회 권한이 없어.', en: 'Character library view permission is required.' }))
      const settingId = Number(args.settingId)
      const setting = await queryClient.fetchQuery({ queryKey: characterSettingQueryKey(settingId), queryFn: ({ signal }) => getCharacterSetting(settingId, signal), staleTime: 0 })
      const appearance = setting.appearance.trim()
      const withReference = reference !== 'off' && canViewImages && !!setting.referenceHash
      if (reference === 'required' && !withReference) throw new Error(t({ ko: '이 외형 설정엔 쓸 수 있는 레퍼런스 이미지가 없어.', en: 'This setting has no usable reference image.' }))
      if (!appearance && !withReference) throw new Error(t({ ko: '이 외형 설정엔 넣을 외형 태그가 없어.', en: 'This setting has no appearance tags to insert.' }))
      return { setting, appearance, reference: withReference ? await loadCharacterReferenceDraft(setting) : null }
    },
    /** The input after inserting the tags; unchanged when the setting has none. */
    text: <T extends TextSegmentSpreadsheetValue>(args: Record<string, ChatPageData>, before: T, appearance: string): T => {
      if (!appearance) return before
      return insertChatPageText(args.mode, before, (Array.isArray(before) ? [appearance] : appearance) as T, (current) => appendPromptText(current, appearance), t({ ko: '외형 태그를 넣으면 입력이 너무 길어져.', en: 'Inserting the tags makes the input too long.' }))
    },
  }
}
