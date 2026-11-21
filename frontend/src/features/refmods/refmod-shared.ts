import { MINIMAX_H3_REFMOD_CONCEPT_TYPES, refModNameProblem, type MiniMaxH3RefModKind, type MiniMaxH3RefModRecordMember } from '@conai/shared'
import type { useI18n } from '@/i18n'
import { buildApiUrl } from '@/lib/api-url'
import {
  refModEntryFileUrl,
  refModEntryThumbnailUrl,
  type RefModEntryMember,
  type RefModEntrySummary,
  type RefModPresence,
  type RefModWorkflowIssue,
  type RefModWorkflowIssueCode,
} from '@/lib/api-refmod-entries'
import type { ImageRecord } from '@/types/image'

type Translate = ReturnType<typeof useI18n>['t']

export const REFMOD_CONCEPTS = MINIMAX_H3_REFMOD_CONCEPT_TYPES
/** The 서버 filter: every row, entries saved on the default server, entries not saved there, unregistered rows only. */
export type RefModServerFilter = 'all' | 'on' | 'off' | 'unregistered'
export const REFMOD_SERVER_FILTERS: readonly RefModServerFilter[] = ['all', 'on', 'off', 'unregistered']

export function refModConceptLabel(t: Translate, concept: string) {
  switch (concept) {
    case 'generic': return t({ ko: '일반', en: 'Generic' })
    case 'identity': return t({ ko: '인물', en: 'Identity' })
    case 'style': return t({ ko: '스타일', en: 'Style' })
    case 'motion': return t({ ko: '동작', en: 'Motion' })
    case 'audio': return t({ ko: '소리', en: 'Audio' })
    default: return concept
  }
}

/** "이미지 3 · 영상 1" for the members' kinds. */
export function refModMemberCounts(t: Translate, kinds: readonly MiniMaxH3RefModKind[]) {
  if (!kinds.length) return t({ ko: '원본 없음', en: 'No sources' })
  const count = (kind: MiniMaxH3RefModKind) => kinds.filter((entry) => entry === kind).length
  return [
    count('image') ? t({ ko: '이미지 {count}', en: '{count} images' }, { count: count('image') }) : '',
    count('video') ? t({ ko: '영상 {count}', en: '{count} videos' }, { count: count('video') }) : '',
    count('audio') ? t({ ko: '소리 {count}', en: '{count} sounds' }, { count: count('audio') }) : '',
  ].filter(Boolean).join(' · ')
}

/** Matches entry names to the default server's library: the exact name, else the only case-insensitive one. */
export function makeRefModNameLookup(names: readonly string[]) {
  const exact = new Set(names)
  const lower = new Map<string, string>()
  for (const name of names) {
    const key = name.toLowerCase()
    if (!lower.has(key)) lower.set(key, name)
  }
  return (name: string): string | null => (exact.has(name) ? name : lower.get(name.toLowerCase()) ?? null)
}

/** One member square of a row (see MediaThumbnailButton). */
export type RefModRowThumb = {
  key: string
  kind: MiniMaxH3RefModKind
  label: string
  thumbnailUrl: string | null
  fileUrl: string | null
  audioKey?: string
}

const memberLabel = (t: Translate, kind: MiniMaxH3RefModKind, index: number, description: string | null, fileName: string | null) => (
  description?.trim() || fileName || `${kind === 'image' ? t({ ko: '이미지', en: 'Image' }) : kind === 'video' ? t({ ko: '영상', en: 'Video' }) : t({ ko: '소리', en: 'Sound' })} ${index + 1}`
)

/** An entry's members: its own copies (thumbnail route for image and video) when they can be shown, else kind icons. */
export function refModEntryThumbs(t: Translate, entryId: number, members: readonly RefModEntryMember[], canViewImages: boolean): RefModRowThumb[] {
  return members.map((member) => {
    const fileId = canViewImages ? member.fileId : null
    return {
      key: `${member.index}:${member.fileId ?? ''}`,
      kind: member.kind,
      label: memberLabel(t, member.kind, member.index, member.description, member.fileName),
      thumbnailUrl: fileId && member.kind !== 'audio' ? refModEntryThumbnailUrl(entryId, fileId) : null,
      fileUrl: fileId ? refModEntryFileUrl(entryId, fileId) : null,
      audioKey: fileId && member.kind === 'audio' ? `refmod-entry:${entryId}:${fileId}` : undefined,
    }
  })
}

/** A run record's retained sources (/api/refmods/<recordId>/media/<index>; images double as their own thumbnail). */
export function refModRecordThumbs(t: Translate, recordId: number, members: readonly MiniMaxH3RefModRecordMember[], canViewImages: boolean): RefModRowThumb[] {
  return members.map((member) => {
    const url = canViewImages ? buildApiUrl(`/api/refmods/${recordId}/media/${member.index}`) : null
    return {
      key: String(member.index),
      kind: member.kind,
      label: memberLabel(t, member.kind, member.index, member.description, member.file_name),
      thumbnailUrl: url && member.kind === 'image' ? url : null,
      fileUrl: url,
      audioKey: url && member.kind === 'audio' ? `refmod-record:${recordId}:${member.index}` : undefined,
    }
  })
}

/** The row's images and videos as the media viewer takes them (no library hash: download and details stay off). */
export function refModLightboxItems(thumbs: readonly RefModRowThumb[]): Array<{ thumb: RefModRowThumb; record: ImageRecord }> {
  return thumbs.flatMap((thumb) => thumb.kind === 'audio' || !thumb.fileUrl ? [] : [{
    thumb,
    record: {
      id: `refmod:${thumb.fileUrl}`,
      composite_hash: null,
      thumbnail_url: thumb.thumbnailUrl ?? (thumb.kind === 'image' ? thumb.fileUrl : null),
      image_url: thumb.fileUrl,
      mime_type: thumb.kind === 'video' ? 'video/mp4' : 'image/png',
    } satisfies ImageRecord,
  }])
}

/** Issues the entry's saved values raise (its name, its inputs): an unsaved window is checked again when it saves. */
const ENTRY_LEVEL_ISSUES: ReadonlySet<RefModWorkflowIssueCode> = new Set(['name-not-plain', 'required-input-empty'])

export function refModIssueReason(t: Translate, issue: Pick<RefModWorkflowIssue, 'code' | 'fields'>) {
  switch (issue.code) {
    case 'required-input-empty': return issue.fields?.length
      ? t({ ko: '{inputs} 입력을 채워줘', en: 'Fill in {inputs}' }, { inputs: issue.fields.map((field) => `‘${field.label}’`).join(', ') })
      : t({ ko: '필수 입력을 채워줘', en: 'Fill in the required inputs' })
    case 'name-not-plain': return t({ ko: '이름이 파일 이름 하나가 아니야. 이름을 바꿔줘', en: 'The name is not one plain file name; rename it' })
    case 'no-export-node': return t({ ko: '워크플로를 연결해줘', en: 'Link a creation workflow' })
    case 'multiple-export-nodes': return t({ ko: '내보내기 노드가 여러 개인 워크플로야', en: 'The workflow has several export nodes' })
    case 'director-not-exposed': return t({ ko: '워크플로에 Director 입력이 없어', en: 'The workflow does not expose the Director' })
    case 'name-not-exposed': return t({ ko: '워크플로에 이름 입력이 없어', en: 'The workflow does not expose the name' })
    case 'description-not-exposed': return t({ ko: '워크플로의 고정 설명을 써', en: 'The workflow uses its fixed description' })
    case 'concept-not-exposed': return t({ ko: '워크플로의 고정 종류를 써', en: 'The workflow uses its fixed concept' })
  }
}

/**
 * Why an entry cannot be built right now (the build key's tooltip), or null when it can. `unsavedSources`: an edited
 * window saves before it builds, so its stored members say nothing yet.
 */
/**
 * Why an entry cannot be built now, or null. `entry.name` is the name it would be built under (an open window passes its
 * draft name); `unsavedSources`: the open window has unsaved changes, saved before the build, so what the saved values
 * raise (sources, inputs, the name rule) is left to the server's check after that save.
 */
export function refModBuildBlockReason(t: Translate, entry: Pick<RefModEntrySummary, 'name' | 'workflowId' | 'buildable' | 'issues' | 'members' | 'pending'>, presence: RefModPresence | undefined, unsavedSources = false) {
  if (entry.pending) return t({ ko: '만드는 중이야', en: 'Being built' })
  if (entry.workflowId === null) return t({ ko: '워크플로를 연결해줘', en: 'Link a creation workflow' })
  const blocking = entry.issues.find((issue) => issue.severity === 'blocking' && !(unsavedSources && ENTRY_LEVEL_ISSUES.has(issue.code)))
  if (blocking) return refModIssueReason(t, blocking)
  if (refModNameProblem(entry.name)) return refModIssueReason(t, { code: 'name-not-plain' })
  if (!entry.buildable && !unsavedSources) return t({ ko: '아직 만들 수 없어', en: 'Cannot be built yet' })
  if (!unsavedSources && !entry.members.length) return t({ ko: '원본을 하나 이상 넣어줘', en: 'Add at least one source' })
  if (!unsavedSources && entry.members.some((member) => !member.fileId)) return t({ ko: '원본 파일이 없는 항목이 있어', en: 'A member has no source file' })
  if (presence?.status === 'no-server') return t({ ko: '대표 ComfyUI 서버를 정해줘', en: 'Choose a default ComfyUI server' })
  // ComfyUI never overwrites a bundle: the server refuses this too (exists_on_server).
  if (presence?.status === 'ok' && makeRefModNameLookup(presence.entries.map((item) => item.name))(entry.name) !== null) {
    return t({ ko: '대표 서버에 같은 이름의 RefMod가 이미 있어. 이름을 바꾸거나 서버에서 지운 다음 만들어줘', en: 'The default server already has a RefMod with this name; rename it or delete it on the server first' })
  }
  return null
}

export type RefModServerStatus = { label: string; tone: 'success' | 'secondary' | 'warning' | 'info'; title?: string }

/** 만드는 중 / 있음 / 없음 against a library already in hand (the Director's picker). */
export function refModLibraryStatus(t: Translate, pending: boolean, onServer: boolean): RefModServerStatus {
  if (pending) return { label: t({ ko: '만드는 중', en: 'Building' }), tone: 'info' }
  return onServer ? { label: t({ ko: '있음', en: 'On server' }), tone: 'success' } : { label: t({ ko: '없음', en: 'Not on server' }), tone: 'secondary' }
}

/** 만드는 중 / 있음 / 없음 / 확인 불가 (null while the server is still being asked). */
export function refModServerStatus(t: Translate, pending: boolean, presence: RefModPresence | undefined, presenceFailed: boolean, onServer: boolean): RefModServerStatus | null {
  if (pending) return { label: t({ ko: '만드는 중', en: 'Building' }), tone: 'info' }
  if (presenceFailed) return { label: t({ ko: '확인 불가', en: 'Unknown' }), tone: 'warning' }
  if (!presence) return null
  if (presence.status !== 'ok') return { label: t({ ko: '확인 불가', en: 'Unknown' }), tone: 'warning', title: presence.message }
  return onServer ? { label: t({ ko: '있음', en: 'On server' }), tone: 'success' } : { label: t({ ko: '없음', en: 'Not on server' }), tone: 'secondary' }
}
