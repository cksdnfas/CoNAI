import { useQueryClient } from '@tanstack/react-query'
import { composeCharacterAppearance, type ChatPageData, type ChatPageSchema } from '@conai/shared'
import { useFeaturePermissions } from '@/features/auth/use-feature-permissions'
import { useImagePermissions } from '@/features/auth/use-image-permissions'
import { pageAction, pageArray, pageChoice, pageNumber, pageObject, pageText } from '@/features/codex-chat/page-action-helpers'
import { useI18n } from '@/i18n'
import { characterSettingQueryKey, getCharacterSetting } from '@/lib/api-character-library'
import { characterSettingImages, loadCharacterImageDraft } from '../character-setting-load'
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
      `Copy a character library setting (find settingId with list_character_library) into this form: its appearance tags (sections plus outfit: outfitIndex in its outfits, 0 = default) go into target like a preset row (append adds them on a new line; replace replaces the input), its images optionally too. By default the image is its reference image when it has one; referenceHashes picks images in order from get_character_setting (referenceHash and references[].hash), and needs the form's image argument. A copy: later library edits do not change the form. ${description}`,
      pageObject({ settingId: pageNumber(1, undefined, true), outfitIndex: pageNumber(0, undefined, true), ...targets, ...(canViewImages ? { referenceHashes: pageArray(pageText(200), 128, 1) } : {}), mode: pageChoice(['append', 'replace']) }, ['settingId', ...required]),
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
    /**
     * Read the stored setting now (not a cached copy) and the images that go in: `referenceHashes` in order, else its
     * reference image, as before the gallery. `multiple`: the form takes several; otherwise at most one.
     */
    load: async (args: Record<string, ChatPageData>, reference: ReferenceMode, multiple = false) => {
      if (!canView) throw new Error(t({ ko: '캐릭터 라이브러리 조회 권한이 없어.', en: 'Character library view permission is required.' }))
      const settingId = Number(args.settingId)
      const setting = await queryClient.fetchQuery({ queryKey: characterSettingQueryKey(settingId), queryFn: ({ signal }) => getCharacterSetting(settingId, signal), staleTime: 0 })
      const outfitIndex = args.outfitIndex === undefined ? 0 : Number(args.outfitIndex)
      if (outfitIndex > 0 && outfitIndex >= setting.outfits.length) throw new Error(t({ ko: '이 외형 설정엔 그 의상이 없어. outfits를 다시 확인해줘.', en: 'This setting has no such outfit.' }))
      const appearance = composeCharacterAppearance(setting, outfitIndex).trim()
      const images = canViewImages ? characterSettingImages(setting) : []
      const requested = Array.isArray(args.referenceHashes) ? [...new Set(args.referenceHashes.map(String))] : null
      if (requested) {
        if (reference === 'off') throw new Error(t({ ko: 'referenceHashes를 넣을 곳이 없어. 이 입력이 이미지를 받는지, includeReference를 끄지 않았는지, ComfyUI는 referenceTarget을 함께 줬는지 확인해줘.', en: 'referenceHashes has nowhere to go. Check that this input takes images, includeReference is not false, and ComfyUI also gets referenceTarget.' }))
        const unknown = requested.filter((hash) => !images.some((image) => image.hash === hash))
        if (unknown.length) throw new Error(t({ ko: '이 외형 설정에 없는 이미지야: {hashes}. get_character_setting의 referenceHash·references를 확인해줘.', en: 'Not an image of this setting: {hashes}. Check referenceHash and references in get_character_setting.' }, { hashes: unknown.join(', ') }))
        if (!multiple && requested.length > 1) throw new Error(t({ ko: '이 입력엔 이미지를 한 장만 넣을 수 있어.', en: 'This input takes one image.' }))
      }
      const hashes = reference === 'off' ? [] : requested ?? (images[0]?.isReference ? [images[0].hash] : [])
      if (reference === 'required' && !hashes.length) throw new Error(t({ ko: '이 외형 설정엔 쓸 수 있는 레퍼런스 이미지가 없어.', en: 'This setting has no usable reference image.' }))
      if (!appearance && !hashes.length) throw new Error(t({ ko: '이 외형 설정엔 넣을 외형 태그가 없어.', en: 'This setting has no appearance tags to insert.' }))
      const references = await Promise.all(hashes.map((hash) => loadCharacterImageDraft(setting.name, hash)))
      return { setting, appearance, reference: references[0] ?? null, references }
    },
    /** The input after inserting the tags; unchanged when the setting has none. */
    text: <T extends TextSegmentSpreadsheetValue>(args: Record<string, ChatPageData>, before: T, appearance: string): T => {
      if (!appearance) return before
      return insertChatPageText(args.mode, before, (Array.isArray(before) ? [appearance] : appearance) as T, (current) => appendPromptText(current, appearance), t({ ko: '외형 태그를 넣으면 입력이 너무 길어져.', en: 'Inserting the tags makes the input too long.' }))
    },
  }
}
