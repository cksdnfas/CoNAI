import { useQuery } from '@tanstack/react-query'
import { useChatPage } from './chat-page-context'
import { pageAction, pageChoice, pageObject, pageText } from './page-action-helpers'
import { useAuthStatusQuery } from '@/features/auth/use-auth-status-query'
import { getImages } from '@/lib/api-images'
import { listStoredFiles, storedFileViewUrl } from '@/lib/api-files'
import { buildApiUrl } from '@/lib/api-client'
import { buildSelectedImageDraftFromUrl } from '@/features/image-generation/image-generation-drafts'
import { useI18n } from '@/i18n'
import type { ChatPageData } from '@conai/shared'

/** Only opt-in, account-scoped media candidates are read; bytes remain outside chat context. */
export function useChatPageMedia(targets: string[]) {
  const page = useChatPage()
  const auth = useAuthStatusQuery().data
  const { t } = useI18n()
  const accountKey = auth?.accountId ?? 'bootstrap'
  const canReadImages = !!auth?.permissionKeys.includes('images.view')
  const canReadFiles = !!auth?.permissionKeys.includes('files.view')
  const images = useQuery({ queryKey: ['chat-page-images', accountKey], queryFn: () => getImages({ limit: 30 }), enabled: !!page?.enabled && canReadImages, staleTime: 30000 })
  const files = useQuery({ queryKey: ['chat-page-files', accountKey], queryFn: () => listStoredFiles(null), enabled: !!page?.enabled && canReadFiles && canReadImages, staleTime: 30000 })
  const candidates: ChatPageData[] = [
    ...(canReadImages ? images.data?.images ?? [] : []).filter((item) => item.composite_hash && item.mime_type?.startsWith('image/')).map((item) => ({ source: 'library', id: String(item.composite_hash), name: String(item.composite_hash), mimeType: item.mime_type ?? '', width: item.width ?? 0, height: item.height ?? 0 })),
    ...(canReadImages && canReadFiles ? files.data?.entries ?? [] : []).filter((item) => item.kind === 'file' && /^(image|video|audio)\//.test(item.mimeType ?? '')).map((item) => ({ source: 'file', id: item.id, name: item.name, mimeType: item.mimeType ?? '', bytes: item.size })),
  ]
  const actions = targets.length ? [
    pageAction('media.attach', t({ ko: '이미지·미디어 입력', en: 'Attach image or media' }), t({ ko: '권한이 있는 라이브러리 이미지나 내 보관함 파일을 입력에 등록해. H3 입력은 slot과 start·duration으로 타임라인 위치를 지정할 수 있어.', en: 'Attach an authorized library image or an owned stored file. H3 accepts slot, start and duration for timeline placement.' }), pageObject({ fieldId: pageChoice(targets), source: pageChoice(['library', 'file']), id: pageText(100), slot: { type: 'number', minimum: 0, maximum: 8, integer: true }, start: { type: 'number', minimum: 0, maximum: 60 }, duration: { type: 'number', minimum: 0.1, maximum: 60 } }, ['fieldId', 'source', 'id'])),
    pageAction('media.clear', t({ ko: '이미지·미디어 입력 비우기', en: 'Clear image or media input' }), t({ ko: '선택한 입력에서 미디어를 해제해. H3의 itemId를 지정하면 그 항목만 해제해. 보관함 원본은 유지해.', en: 'Clear a media input, or one H3 item by itemId, while retaining the original stored file.' }), pageObject({ fieldId: pageChoice(targets), itemId: pageText(100) }, ['fieldId'])),
  ] : []
  const load = async (args: Record<string, ChatPageData>) => {
    if (!canReadImages || (args.source === 'file' && !canReadFiles)) throw new Error(t({ ko: '미디어를 읽을 권한이 없어.', en: 'Media access is not authorized.' }))
    const id = String(args.id)
    if (!/^[\w.-]{8,100}$/.test(id)) throw new Error(t({ ko: '미디어 ID가 올바르지 않아.', en: 'Invalid media ID.' }))
    const candidate = candidates.find((item) => typeof item === 'object' && item && !Array.isArray(item) && item.source === args.source && item.id === id) as Record<string, ChatPageData> | undefined
    // Explicit user-supplied IDs are resolved by the ordinary owned-file / image API too.
    const uri = args.source === 'file' ? storedFileViewUrl(id) : buildApiUrl(`/api/images/${encodeURIComponent(id)}/file`)
    const response = await fetch(uri, { credentials: 'include' })
    if (!response.ok) throw new Error(t({ ko: '미디어를 읽을 권한이 없거나 파일이 없어.', en: 'Media is unavailable or not authorized.' }))
    const blob = await response.blob()
    if (!/^(image|video|audio)\//.test(blob.type) || blob.size > 100 * 1024 * 1024) throw new Error(t({ ko: '지원하는 미디어와 크기를 확인해줘.', en: 'Check the supported media type and size.' }))
    const fileName = candidate ? String(candidate.name) : `media-${id}.${blob.type.split('/')[1].split(';')[0]}`
    return { blob, fileName, toImage: async () => {
      if (!blob.type.startsWith('image/')) throw new Error(t({ ko: '이 입력은 이미지만 지원해.', en: 'This input supports images only.' }))
      // Reuse native draft construction with an internal object URL, then revoke it.
      const objectUrl = URL.createObjectURL(blob)
      try { return await buildSelectedImageDraftFromUrl(objectUrl, fileName) } finally { URL.revokeObjectURL(objectUrl) }
    } }
  }
  return { actions, candidates, load }
}
