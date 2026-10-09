import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Folder, FolderInput, FolderOpen } from 'lucide-react'
import { HierarchyPicker } from '@/components/common/hierarchy-picker'
import { Button } from '@/components/ui/button'
import { FieldInfo } from '@/components/ui/field'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal'
import { normalizeGroupPathInput, useGenerationTargetGroupPath } from '@/features/groups/generation-target-group-store'
import { getGroupsHierarchyAll } from '@/lib/api-groups'
import { cn } from '@/lib/utils'
import type { GroupWithHierarchy } from '@/types/group'
import { useI18n } from '@/i18n'

const GROUP_PATH_MAX_DEPTH = 5

/** 그룹 id → 루트부터의 전체 경로. */
function buildGroupPathMap(groups: GroupWithHierarchy[]) {
  const byId = new Map(groups.map((group) => [group.id, group]))
  const paths = new Map<number, string>()

  const resolvePath = (group: GroupWithHierarchy, guard = 0): string => {
    const cached = paths.get(group.id)
    if (cached !== undefined) return cached
    const parent = group.parent_id != null ? byId.get(group.parent_id) : undefined
    const path = parent && guard < GROUP_PATH_MAX_DEPTH * 2 ? `${resolvePath(parent, guard + 1)}/${group.name}` : group.name
    paths.set(group.id, path)
    return path
  }

  for (const group of groups) {
    resolvePath(group)
  }
  return paths
}

/** 입력 경로 중 아직 없는 단계 수(서버와 같은 대소문자 무시 비교). */
function countMissingSegments(path: string, existingPaths: Set<string>) {
  const segments = path.split('/').filter(Boolean)
  let missing = 0
  for (let index = 1; index <= segments.length; index += 1) {
    if (!existingPaths.has(segments.slice(0, index).join('/').toLowerCase())) {
      missing += 1
    }
  }
  return missing
}

interface GenerationTargetGroupControlProps {
  /** localStorage 키(생성 화면 공용, 워크플로우별 등) */
  storageKey: string
  disabled?: boolean
  className?: string
}

/** 생성 결과를 넣을 그룹 경로를 고르는 아이콘 버튼. 지정되면 강조색, 경로는 툴팁으로. 그룹 권한이 없으면 렌더링하지 않는다. */
export function GenerationTargetGroupControl({
  storageKey,
  disabled = false,
  className,
}: GenerationTargetGroupControlProps) {
  const { t } = useI18n()
  const { canAssignGroup, path, setPath } = useGenerationTargetGroupPath(storageKey)
  const [open, setOpen] = useState(false)

  if (!canAssignGroup) {
    return null
  }

  const label = path
    ? t({ ko: `결과 그룹: 생성 후 '${path}' 그룹에 넣어`, en: `Result group: results go into '${path}'` })
    : t({ ko: '결과 그룹: 생성 후 넣을 그룹 지정 (지금은 없음)', en: 'Result group: pick a group for new results (none now)' })

  return (
    <>
      <IconButton
        variant="ghost"
        onClick={() => setOpen(true)}
        disabled={disabled}
        label={label}
        className={cn(path ? 'text-primary' : undefined, className)}
      >
        {path ? <FolderInput /> : <Folder />}
      </IconButton>

      {open ? (
        <GenerationTargetGroupModal
          initialPath={path}
          onClose={() => setOpen(false)}
          onApply={(nextPath) => {
            setPath(nextPath)
            setOpen(false)
          }}
        />
      ) : null}
    </>
  )
}

function GenerationTargetGroupModal({
  initialPath,
  onClose,
  onApply,
}: {
  initialPath: string
  onClose: () => void
  onApply: (path: string) => void
}) {
  const { t } = useI18n()
  const [draft, setDraft] = useState(initialPath)
  const groupsQuery = useQuery({
    queryKey: ['groups-hierarchy-all', 'custom'],
    queryFn: getGroupsHierarchyAll,
  })
  const groups = useMemo(() => groupsQuery.data ?? [], [groupsQuery.data])
  const pathById = useMemo(() => buildGroupPathMap(groups), [groups])
  const existingPaths = useMemo(() => new Set(Array.from(pathById.values(), (value) => value.toLowerCase())), [pathById])
  const sortedPaths = useMemo(() => Array.from(pathById.values()).sort((left, right) => left.localeCompare(right)), [pathById])

  const normalizedDraft = normalizeGroupPathInput(draft)
  const depth = normalizedDraft ? normalizedDraft.split('/').length : 0
  const tooDeep = depth > GROUP_PATH_MAX_DEPTH
  const missingCount = normalizedDraft && groupsQuery.isSuccess ? countMissingSegments(normalizedDraft, existingPaths) : 0
  const selectedGroupId = useMemo(() => {
    if (!normalizedDraft) return null
    const lowered = normalizedDraft.toLowerCase()
    for (const [id, groupPath] of pathById) {
      if (groupPath.toLowerCase() === lowered) return id
    }
    return null
  }, [normalizedDraft, pathById])

  const handleSubmit = (event: { preventDefault: () => void }) => {
    event.preventDefault()
    if (tooDeep) return
    onApply(normalizedDraft)
  }

  return (
    <Modal open onClose={onClose} title={t({ ko: '결과 그룹 지정', en: 'Set result group' })} widthClassName="max-w-xl">
      <form onSubmit={handleSubmit}>
        <ModalBody className="space-y-4">
          <div className="space-y-2">
            <span className="flex items-center gap-1">
              <label className="text-sm font-medium text-foreground" htmlFor="generation-target-group-path">
                {t({ ko: '그룹 경로', en: 'Group path' })}
              </label>
              <FieldInfo>
                {t({
                  ko: '슬래시(/)로 하위 그룹을 적어. 없는 그룹은 생성할 때 자동으로 만들어지고, 같은 위치의 이름은 대소문자를 구분하지 않아.',
                  en: 'Use a slash (/) for sub-groups. Missing groups are created on generation; names at the same level are case-insensitive.',
                })}
              </FieldInfo>
            </span>
            <Input
              id="generation-target-group-path"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={t({ ko: '프로젝트/이펙트', en: 'Project/Effects' })}
              list="generation-target-group-path-options"
              autoComplete="off"
              autoFocus
            />
            <datalist id="generation-target-group-path-options">
              {sortedPaths.map((groupPath) => <option key={groupPath} value={groupPath} />)}
            </datalist>
            {tooDeep ? (
              <p className="text-xs text-destructive">{t({ ko: `그룹은 최대 ${GROUP_PATH_MAX_DEPTH}단계까지야.`, en: `Groups can be at most ${GROUP_PATH_MAX_DEPTH} levels deep.` })}</p>
            ) : normalizedDraft && missingCount > 0 ? (
              <p className="text-xs text-primary">{t({ ko: `새 그룹 ${missingCount}개가 만들어져.`, en: `${missingCount} new group(s) will be created.` })}</p>
            ) : null}
          </div>

          {groups.length > 0 ? (
            <div className="space-y-2">
              <p className="text-sm font-medium text-foreground">{t({ ko: '기존 그룹에서 고르기', en: 'Pick an existing group' })}</p>
              <HierarchyPicker
                items={groups}
                selectedId={selectedGroupId}
                onSelect={(group) => setDraft(pathById.get(group.id) ?? group.name)}
                getId={(group) => group.id}
                getParentId={(group) => group.parent_id}
                getLabel={(group) => <span className="truncate">{group.name}</span>}
                sortItems={(left, right) => left.name.localeCompare(right.name)}
                renderIcon={(_, state) => (state.hasChildren ? <FolderOpen className="h-4 w-4 shrink-0" /> : <Folder className="h-4 w-4 shrink-0" />)}
                showRootOption={false}
              />
            </div>
          ) : null}

          <ModalFooter>
            <Button type="button" variant="ghost" onClick={() => onApply('')}>
              {t({ ko: '지정 해제', en: 'Clear' })}
            </Button>
            <Button type="button" variant="secondary" onClick={onClose}>
              {t({ ko: '취소', en: 'Cancel' })}
            </Button>
            <Button type="submit" disabled={tooDeep}>
              {t({ ko: '적용', en: 'Apply' })}
            </Button>
          </ModalFooter>
        </ModalBody>
      </form>
    </Modal>
  )
}
