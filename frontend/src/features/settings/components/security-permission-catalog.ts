import type { TranslationInput } from '@/i18n'
import type { PageAccessPermissionItem } from '@/lib/api-auth'
import { IMAGE_VIEW_PERMISSION } from '@conai/shared'

interface PermissionCatalogEntry {
  key: string
  /** Page permissions reuse the navigation label key so both screens always name a page the same way. */
  label: TranslationInput
  /** Related features, displayed independently of page access. */
  children?: Array<{ key: string; label: TranslationInput }>
}

interface PermissionCatalogSection {
  id: string
  label: TranslationInput
  entries: PermissionCatalogEntry[]
}

export interface PermissionSectionRow {
  key: string
  label: TranslationInput
  parentKey: string | null
}

export interface PermissionSection {
  id: string
  label: TranslationInput
  rows: PermissionSectionRow[]
  kind: 'page' | 'feature'
}

/** Grouping, order, and names of every permission the group editor can grant. */
const PERMISSION_CATALOG: PermissionCatalogSection[] = [
  {
    id: 'images', label: { ko: '이미지', en: 'Images' }, entries: [
      { key: IMAGE_VIEW_PERMISSION, label: { ko: '이미지·영상·움짤 조회 (목록·썸네일·원본·뷰어)', en: 'View images, videos and animated images (lists, thumbnails, originals, viewer)' } },
      { key: 'images.update', label: { ko: '이미지 편집·처리', en: 'Edit and process images' } },
      { key: 'images.metadata.edit', label: { ko: '이미지 메타데이터 수정', en: 'Edit image metadata' } },
      { key: 'images.delete', label: { ko: '이미지 삭제', en: 'Delete images' } },
      { key: 'groups.create', label: { ko: '그룹 만들기', en: 'Create groups' } },
      { key: 'groups.update', label: { ko: '그룹 수정·이미지 배치', en: 'Edit groups and assign images' } },
      { key: 'groups.delete', label: { ko: '그룹 삭제', en: 'Delete groups' } },
    ],
  },
  {
    id: 'gallery',
    label: { ko: '갤러리', en: 'Gallery' },
    entries: [
      { key: 'page.home.view', label: 'pageAccessCatalog.home' },
      { key: 'page.image-detail.view', label: { ko: '이미지 상세', en: 'Image detail' } },
      { key: 'page.metadata-editor.view', label: { ko: '메타데이터 편집', en: 'Metadata editor' } },
      { key: 'page.groups.view', label: 'pageAccessCatalog.groups' },
      {
        key: 'page.upload.view',
        label: 'pageAccessCatalog.upload',
        children: [{ key: 'upload.create', label: { ko: '파일 업로드', en: 'Upload files' } }],
      },
    ],
  },
  {
    id: 'generation',
    label: { ko: '생성', en: 'Generation' },
    entries: [
      { key: 'prompts.view', label: { ko: '프롬프트·그룹·프리셋 조회', en: 'Read prompts, groups and presets' } },
      { key: 'wildcards.view', label: { ko: '와일드카드 조회·확장', en: 'Read and expand wildcards' } },
      { key: 'generation.execute', label: { ko: '이미지 생성 실행', en: 'Generate images' } },
      { key: 'workflows.view', label: { ko: '워크플로 조회', en: 'View workflows' } },
      {
        key: 'page.generation.view',
        label: 'pageAccessCatalog.generation',
        children: [{ key: 'workflows.update', label: { ko: '워크플로 편집', en: 'Edit workflows' } }],
      },
      {
        key: 'page.prompts.view',
        label: 'pageAccessCatalog.prompts',
        children: [
          { key: 'prompts.create', label: { ko: '프롬프트·그룹·프리셋 추가', en: 'Create prompts, groups and presets' } },
          { key: 'prompts.update', label: { ko: '프롬프트·그룹·프리셋 수정', en: 'Edit prompts, groups and presets' } },
          { key: 'prompts.delete', label: { ko: '프롬프트·그룹·프리셋 삭제', en: 'Delete prompts, groups and presets' } },
        ],
      },
      {
        key: 'page.wildcards.view',
        label: 'pageAccessCatalog.wildcards',
        children: [
          { key: 'wildcards.edit', label: { ko: '와일드카드 추가·수정', en: 'Add and edit wildcards' } },
          { key: 'wildcards.delete', label: { ko: '와일드카드 삭제', en: 'Delete wildcards' } },
          { key: 'wildcards.lora.scan', label: { ko: 'LoRA 폴더 스캔', en: 'Scan LoRA folder' } },
        ],
      },
    ],
  },
  {
    id: 'chat',
    label: { ko: '채팅', en: 'Chat' },
    entries: [
      { key: 'page.chat.view', label: { ko: '채팅 페이지', en: 'Chat page' } },
      { key: 'chat.codex.use', label: { ko: 'Codex 프로필로 채팅 (서버 Codex 사용량 공유)', en: 'Chat with Codex profiles (shares server Codex usage)' } },
      { key: 'chat.llm.use', label: { ko: 'API LLM 프로필로 채팅', en: 'Chat with API LLM profiles' } },
      { key: 'chat.tools.read', label: { ko: '채팅 도구: 조회', en: 'Chat tools: read' } },
      { key: 'chat.tools.generate', label: { ko: '채팅 도구: 생성', en: 'Chat tools: generate' } },
      { key: 'chat.tools.organize', label: { ko: '채팅 도구: 정리', en: 'Chat tools: organize' } },
      { key: 'chat.tools.configure', label: { ko: '채팅 도구: 설정', en: 'Chat tools: setup' } },
    ],
  },
  {
    id: 'wallpaper',
    label: { ko: '월페이퍼', en: 'Wallpaper' },
    entries: [
      { key: 'page.wallpaper.view', label: 'pageAccessCatalog.wallpaper' },
      { key: 'page.wallpaper.runtime.view', label: 'pageAccessCatalog.wallpaperRuntime' },
    ],
  },
  {
    id: 'files',
    label: { ko: '파일 보관함', en: 'Files' },
    entries: [{ key: 'page.files.view', label: { ko: '파일 보관함', en: 'Files' },
      children: [
        { key: 'files.view', label: { ko: '허용된 파일 조회·다운로드', en: 'Browse and download authorized files' } },
        { key: 'files.upload', label: { ko: '업로드 (텍스트·이미지·영상·오디오·문서)', en: 'Upload (text, image, video, audio, documents)' } },
        { key: 'files.upload.any', label: { ko: '실행파일 등 제한 형식 업로드', en: 'Upload restricted types (executables etc.)' } },
        { key: 'files.organize', label: { ko: '폴더 만들기·이름 변경·이동', en: 'Create folders, rename and move' } },
        { key: 'files.delete', label: { ko: '삭제', en: 'Delete' } },
        { key: 'files.browse.all', label: { ko: '모든 계정 파일 탐색·관리', en: 'Browse and manage every account\'s files' } },
      ] }],
  },
  {
    id: 'administration',
    label: { ko: '관리', en: 'Administration' },
    entries: [
      { key: 'auth.guest.create', label: { ko: '게스트 회원가입', en: 'Guest signup' } },
      { key: 'page.settings.view', label: 'pageAccessCatalog.settings' },
    ],
  },
]

/**
 * Lay the server's grantable permissions out in the catalog's sections. Keys the catalog doesn't know yet land in a
 * trailing section under the server label, so a newly added permission still shows up.
 */
export function buildPermissionSections(available: PageAccessPermissionItem[]): PermissionSection[] {
  const availableKeys = new Set(available.map((permission) => permission.permissionKey))
  const knownKeys = new Set<string>()

  const rowsFor = (section: PermissionCatalogSection) => section.entries.flatMap((entry) => [entry, ...(entry.children ?? [])])
    .flatMap((entry) => {
      knownKeys.add(entry.key)
      return availableKeys.has(entry.key) ? [{ key: entry.key, label: entry.label, parentKey: null }] : []
    })
  const allRows = PERMISSION_CATALOG.flatMap(rowsFor)
  const sections: PermissionSection[] = [{
    id: 'pages', label: { ko: '페이지', en: 'Pages' }, kind: 'page' as const,
    rows: allRows.filter((row) => row.key.startsWith('page.')),
  }, ...PERMISSION_CATALOG.map((section) => ({
    id: section.id,
    label: section.label,
    kind: 'feature' as const,
    rows: rowsFor(section).filter((row) => !row.key.startsWith('page.')),
  }))].filter((section) => section.rows.length > 0)

  const unknownRows = available
    .filter((permission) => !knownKeys.has(permission.permissionKey))
    .map((permission) => ({ key: permission.permissionKey, label: permission.label || permission.permissionKey, parentKey: null }))

  return unknownRows.length > 0
    ? [...sections, { id: 'other', label: { ko: '기타', en: 'Other' }, kind: 'feature', rows: unknownRows }]
    : sections
}

/** A page toggle changes only its own explicit grant. */
export function setPermissionGrant(keys: string[], key: string, enabled: boolean) {
  return enabled ? Array.from(new Set([...keys, key])) : keys.filter((current) => current !== key)
}
