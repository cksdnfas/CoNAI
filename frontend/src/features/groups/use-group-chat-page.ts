import { buildGroupAutoCollectFilter, GROUP_AUTO_COLLECT_OPERATORS, GROUP_AUTO_COLLECT_RULE_LIMIT, GROUP_AUTO_COLLECT_SCOPES, readGroupAutoCollectRules, type ChatPageData, type ChatPageField, type ChatPageSchema, type ChatPageValue, type GroupAutoCollectRule } from '@conai/shared'
import { useImagePermissions } from '@/features/auth/use-image-permissions'
import { useChatPageRegistration } from '@/features/codex-chat/chat-page-context'
import { pageAction, pageArray, pageChoice, pageObject, pageText } from '@/features/codex-chat/page-action-helpers'
import { useChatPageDataPermissions } from '@/features/codex-chat/use-chat-page-permissions'
import { useI18n } from '@/i18n'
import type { GroupMutationInput, GroupRecord, GroupWithHierarchy } from '@/types/group'

const pageBoolean: ChatPageSchema = { type: 'boolean' }
const rulesSchema = pageArray(pageObject({
  scope: pageChoice([...GROUP_AUTO_COLLECT_SCOPES]),
  operator: pageChoice([...GROUP_AUTO_COLLECT_OPERATORS]),
  value: pageText(500),
}, ['scope', 'operator', 'value']), GROUP_AUTO_COLLECT_RULE_LIMIT, 1)

interface GroupChatPageInput {
  sourceKey: string
  isCustomSource: boolean
  groups: GroupWithHierarchy[]
  selectedGroupId?: number
  selectedGroup?: GroupRecord | null
  selectedImageIds: string[]
  images: Array<{ composite_hash?: string | null; width?: number | null; height?: number | null }>
  fields: ChatPageField[]
  apply: (patch: Record<string, ChatPageValue>) => void
  openGroup: (groupId: number) => void
  createGroup: (input: GroupMutationInput) => Promise<unknown>
  updateGroup: (groupId: number, input: GroupMutationInput) => Promise<unknown>
  runAutoCollect: (groupId: number) => Promise<unknown>
}

function rulesArgument(value: ChatPageData | undefined) {
  return value === undefined ? undefined : value as unknown as GroupAutoCollectRule[]
}

/** Chat connection for the group page: view controls plus reviewed group create/edit/auto-collect actions. */
export function useGroupChatPage(input: GroupChatPageInput) {
  const { t } = useI18n()
  const { canAssignGroups } = useImagePermissions()
  const canReadImages = useChatPageDataPermissions().canReadImages
  const { isCustomSource, groups, selectedGroup } = input
  const editable = isCustomSource && canAssignGroups
  const selected = isCustomSource && selectedGroup && selectedGroup.id === input.selectedGroupId ? selectedGroup : null
  const selectedRules = selected ? readGroupAutoCollectRules(selected.auto_collect_conditions) : null
  const groupIds = groups.slice(0, 511).map((group) => group.id)
  const ruleHelp = t({
    ko: '자동수집 규칙: scope는 positive/negative(프롬프트에 포함된 글), auto_tag(오토 태그, 예: misty_(pokemon)), model, lora, ai_tool(nai/comfyui/other). operator는 AND(모두 만족), OR(하나 이상), NOT(제외).',
    en: 'Auto-collect rules: scope positive/negative (prompt text), auto_tag (tagger tag, e.g. misty_(pokemon)), model, lora, ai_tool (nai/comfyui/other). operator AND (all), OR (any), NOT (exclude).',
  })

  useChatPageRegistration({
    kind: 'groups', title: t({ ko: '그룹 목록·이미지', en: 'Groups and images' }), resourceId: `${input.sourceKey}:${input.selectedGroupId ?? 'root'}`,
    fields: input.fields,
    actions: isCustomSource ? [
      ...(groupIds.length ? [pageAction('group.select', t({ ko: '그룹 열기', en: 'Open group' }), t({ ko: '목록의 그룹을 열어. 연 화면이 바로 돌아오니 이어서 그 그룹을 다룰 수 있어.', en: 'Open a listed group; the opened screen comes back so you can continue with it.' }), pageObject({ id: pageChoice(groupIds) }, ['id']))] : []),
      ...(editable ? [pageAction('group.create', t({ ko: '그룹 만들기', en: 'Create group' }), t({ ko: '새 그룹을 만들어. parent_id 0은 최상위야. 규칙을 넣으면 자동수집이 켜지고 바로 모으기 시작해. {help}', en: 'Create a group. parent_id 0 means top level. Rules enable auto-collect and start collecting. {help}' }, { help: ruleHelp }), pageObject({
        name: pageText(200), description: pageText(2000), parent_id: pageChoice([0, ...groupIds]), auto_collect_rules: rulesSchema,
      }, ['name']), 'save')] : []),
      ...(editable && selected ? [pageAction('group.update', t({ ko: '선택 그룹 수정', en: 'Edit selected group' }), t({ ko: '선택한 그룹의 이름·설명·자동수집을 바꿔. 준 필드만 바뀌고, auto_collect_rules는 규칙 전체를 교체해. 저장하면 자동수집을 다시 돌려. {help}', en: 'Edit the selected group. Only given fields change; auto_collect_rules replaces every rule. Saving re-runs auto-collect. {help}' }, { help: ruleHelp }), pageObject({
        id: pageChoice([selected.id]), name: pageText(200), description: pageText(2000), auto_collect_enabled: pageBoolean, auto_collect_rules: rulesSchema,
      }, ['id']), 'save')] : []),
      ...(editable && selected?.auto_collect_enabled ? [pageAction('group.auto_collect', t({ ko: '자동수집 다시 실행', en: 'Run auto-collect' }), t({ ko: '선택한 그룹의 자동수집을 한 번 더 돌려.', en: 'Run auto-collect again for the selected group.' }), pageObject({ id: pageChoice([selected.id]) }, ['id']), 'save')] : []),
    ] : [],
    data: {
      groups: groups.slice(0, 512).map((group) => ({ id: group.id, name: group.name, parent_id: group.parent_id ?? 0 })),
      selected: {
        groupId: input.selectedGroupId ?? 0,
        imageIds: input.selectedImageIds,
        ...(selected ? {
          name: selected.name,
          description: selected.description ?? '',
          parent_id: selected.parent_id ?? 0,
          auto_collect_enabled: Boolean(selected.auto_collect_enabled),
          // null: stored conditions the rules cannot express; replacing the rules drops them.
          auto_collect_rules: selectedRules as unknown as ChatPageData,
        } : {}),
      },
      ...(canReadImages ? { images: input.images.slice(0, 100).map((image) => ({ hash: image.composite_hash ?? '', width: image.width ?? 0, height: image.height ?? 0 })) } : {}),
    },
    apply: input.apply,
    applyAction: async (id, args, assertCurrent) => {
      assertCurrent()
      if (id === 'group.select') { input.openGroup(Number(args.id)); return }
      if (id === 'group.create') {
        const rules = rulesArgument(args.auto_collect_rules)
        await input.createGroup({
          name: String(args.name).trim(),
          description: typeof args.description === 'string' && args.description.trim() ? args.description.trim() : null,
          parent_id: Number(args.parent_id) || null,
          auto_collect_enabled: Boolean(rules?.length),
          auto_collect_conditions: rules?.length ? buildGroupAutoCollectFilter(rules) : undefined,
        })
        return
      }
      if (!selected || Number(args.id) !== selected.id) throw new Error('선택한 그룹이 바뀌었어. 다시 요청해줘.')
      if (id === 'group.auto_collect') { void input.runAutoCollect(selected.id).catch(() => {}); return }
      if (id !== 'group.update') throw new Error('등록되지 않은 그룹 작업이야.')
      const rules = rulesArgument(args.auto_collect_rules)
      const enabled = typeof args.auto_collect_enabled === 'boolean' ? args.auto_collect_enabled : rules ? true : Boolean(selected.auto_collect_enabled)
      if (rules && !enabled) throw new Error('규칙을 넣으면서 자동수집을 끌 수는 없어.')
      const stored = selected.auto_collect_conditions?.trim()
      if (enabled && !rules && !stored) throw new Error('이 그룹엔 자동수집 조건이 없어. 규칙을 같이 넣어줘.')
      await input.updateGroup(selected.id, {
        name: typeof args.name === 'string' && args.name.trim() ? args.name.trim() : selected.name,
        description: typeof args.description === 'string' ? args.description.trim() || null : selected.description ?? null,
        color: selected.color ?? null,
        parent_id: selected.parent_id ?? null,
        emoticon_enabled: Boolean(selected.emoticon_enabled),
        auto_collect_enabled: enabled,
        auto_collect_conditions: !enabled ? undefined : rules ? buildGroupAutoCollectFilter(rules) : JSON.parse(stored!),
      })
    },
  })
}
