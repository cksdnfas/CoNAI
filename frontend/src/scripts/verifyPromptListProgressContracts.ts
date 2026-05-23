import { deepEqual, doesNotMatch, match } from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { resolvePromptListProgress } from '../features/prompts/prompt-list-progress'
import { canDeletePromptItem, isDanbooruPromptGroup, isLockedPromptItem } from '../features/prompts/prompt-page-utils'

const root = resolve(process.cwd(), 'src')

function source(relativePath: string) {
  return readFileSync(resolve(root, relativePath), 'utf8')
}

const firstPage = resolvePromptListProgress({ page: 1, pageSize: 40, visibleCount: 40, totalCount: 125 })
deepEqual(firstPage, {
  start: 1,
  end: 40,
  visibleCount: 40,
  totalCount: 125,
  hiddenCount: 85,
})

const lastPage = resolvePromptListProgress({ page: 3, pageSize: 40, visibleCount: 30, totalCount: 110 })
deepEqual(lastPage, {
  start: 81,
  end: 110,
  visibleCount: 30,
  totalCount: 110,
  hiddenCount: 0,
})

const empty = resolvePromptListProgress({ page: 1, pageSize: 40, visibleCount: 0, totalCount: 0 })
deepEqual(empty, {
  start: 0,
  end: 0,
  visibleCount: 0,
  totalCount: 0,
  hiddenCount: 0,
})

const clamped = resolvePromptListProgress({ page: 99, pageSize: 40, visibleCount: 5, totalCount: 45 })
deepEqual(clamped, {
  start: 41,
  end: 45,
  visibleCount: 5,
  totalCount: 45,
  hiddenCount: 0,
})

const promptPageSource = source('features/prompts/prompt-page.tsx')
const promptListPanelSource = source('features/prompts/components/prompt-list-panel.tsx')
const promptTreeSource = source('features/prompts/components/prompt-tree.tsx')
const promptPageUtilsSource = source('features/prompts/prompt-page-utils.ts')

match(
  promptPageSource,
  /const selectedPromptIdSet = useMemo\(\(\) => new Set\(selectedPromptIds\), \[selectedPromptIds\]\)/,
  'PromptPage should build one memoized selected-prompt Set per selectedIds snapshot',
)
match(
  promptPageSource,
  /items\.filter\(\(item\) => selectedPromptIdSet\.has\(item\.id\)\)/,
  'selected prompt item derivation should reuse Set.has instead of scanning selectedPromptIds per item',
)
match(
  promptPageSource,
  /<PromptListPanel[\s\S]*?selectedPromptIdSet=\{selectedPromptIdSet\}/,
  'PromptPage should pass the memoized selected-prompt Set into the list panel',
)
doesNotMatch(
  promptPageSource,
  /items\.filter\(\(item\) => selectedPromptIds\.includes\(item\.id\)\)/,
  'PromptPage selected item derivation must not scan selectedPromptIds for every visible prompt',
)
match(
  promptPageSource,
  /const promptGroupById = useMemo\(\(\) => new Map\(promptGroups\.map\(\(group\) => \[group\.id, group\] as const\)\), \[promptGroups\]\)/,
  'PromptPage should build one prompt-group lookup Map per group snapshot',
)
match(
  promptPageSource,
  /const selectedLockedPromptCount = useMemo\([\s\S]*?selectedPromptItems\.filter\(\(item\) => isLockedPromptItem\(item, promptGroupById\)\)\.length[\s\S]*?\[promptGroupById, selectedPromptItems\],[\s\S]*?\)/,
  'PromptPage should memoize selected locked prompt checks for bulk action gating',
)
match(
  promptPageSource,
  /const editablePromptGroups = useMemo\([\s\S]*?promptGroups\.filter\(\(group\) => group\.id !== 0 && !isLockedPromptGroup\(group, promptGroupById\)\)[\s\S]*?\[promptGroupById, promptGroups\],[\s\S]*?\)/,
  'PromptPage should compute editable prompt groups once per group snapshot',
)
match(
  promptPageSource,
  /const assignableGroups = editablePromptGroups[\s\S]*?const editableParentGroups = editablePromptGroups/,
  'PromptPage should share the editable group snapshot between assign and parent selectors',
)
match(
  promptPageSource,
  /isLockedPromptItem=\{\(item\) => isLockedPromptItem\(item, promptGroupById\)\}/,
  'PromptListPanel lock checks should reuse the prompt-group lookup Map',
)
match(
  promptPageSource,
  /canDeletePromptItem=\{\(item\) => canDeletePromptItem\(item, promptGroupById\)\}/,
  'PromptListPanel delete checks should reuse the prompt-group lookup Map',
)
doesNotMatch(
  promptPageSource,
  /isLockedPromptItem\(item, promptGroups\)|canDeletePromptItem\(item, promptGroups\)|isLockedPromptGroup\(group, promptGroups\)/,
  'PromptPage lock/delete checks must not rebuild group ancestry lookups per prompt or group row',
)

match(
  promptListPanelSource,
  /selectedPromptIdSet: ReadonlySet<number>/,
  'PromptListPanel contract should accept a readonly selected-prompt Set',
)
match(
  promptListPanelSource,
  /selected=\{selectedPromptIdSet\.has\(item\.id\)\}/,
  'PromptListPanel rows should use Set.has for rendered selected state',
)
doesNotMatch(
  promptListPanelSource,
  /selectedPromptIds\.includes\(item\.id\)/,
  'PromptListPanel rendering must not scan the selectedPromptIds array per row',
)

match(
  promptTreeSource,
  /const groupById = new Map\(treeGroups\.map\(\(group\) => \[group\.id, group\] as const\)\)/,
  'PromptTree should build one group lookup Map per visible tree snapshot',
)
match(
  promptTreeSource,
  /const group = groupById\.get\(groupId\)/,
  'PromptTree descendant totals should use the prebuilt group lookup Map',
)
doesNotMatch(
  promptTreeSource,
  /treeGroups\.find\(\(item\) => item\.id === groupId\)/,
  'PromptTree descendant totals must not rescan the visible group list for every group',
)

match(
  promptPageUtilsSource,
  /Array\.isArray\(groups\)[\s\S]*?groups\.find\(\(item\) => item\.id === groupId\)[\s\S]*?: groups\.get\(groupId\)/,
  'prompt group utilities should accept a prebuilt Map while preserving array fallback behavior',
)

const rootDanbooruGroup = { id: 10, group_name: 'Danbooru', parent_id: null } as any
const childDanbooruGroup = { id: 11, group_name: 'artist', parent_id: 10 } as any
const regularGroup = { id: 12, group_name: 'custom', parent_id: null } as any
const promptGroups = [rootDanbooruGroup, childDanbooruGroup, regularGroup]
const promptGroupById = new Map(promptGroups.map((group) => [group.id, group] as const))

deepEqual(isDanbooruPromptGroup(childDanbooruGroup, promptGroups), true)
deepEqual(isDanbooruPromptGroup(childDanbooruGroup, promptGroupById), true)
deepEqual(isDanbooruPromptGroup(regularGroup, promptGroupById), false)
deepEqual(isLockedPromptItem({ group_info: childDanbooruGroup } as any, promptGroupById), true)
deepEqual(canDeletePromptItem({ group_info: regularGroup, usage_count: 0 } as any, promptGroupById), true)
deepEqual(canDeletePromptItem({ group_info: childDanbooruGroup, usage_count: 0 } as any, promptGroupById), false)

console.log('Prompt list progress and selection contracts verified')
