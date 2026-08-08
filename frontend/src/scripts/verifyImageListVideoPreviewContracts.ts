import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { resolveImageFeedSafety } from '../features/images/components/image-list/image-rating-safety'
import type { RatingTierRecord } from '../features/search/search-types'
import type { ImageRecord } from '../types/image'

function source(relativePath: string) {
  return readFileSync(join(process.cwd(), 'src', relativePath), 'utf8')
}

const videoPreviewSource = source('features/images/components/image-list/image-list-video-preview.tsx')
const imageListItemSource = source('features/images/components/image-list/image-list-item.tsx')
const feedSafetySource = source('features/images/components/image-list/use-image-feed-safety.tsx')

/* ------------------------------------------------------------------ *
 * VID-1: 갤러리 비디오는 포스터 우선 + 뷰포트 게이트다.
 * 원본 영상(멀티 MB)은 뷰포트 안 카드만 스트리밍해야 한다 — 화면 밖 카드까지
 * 3-슬롯 큐로 전부 내려받던 종전 구조로의 회귀를 막는다.
 * ------------------------------------------------------------------ */

assert.ok(
  videoPreviewSource.includes('new IntersectionObserver('),
  'video previews must gate streaming on viewport intersection',
)
assert.match(
  videoPreviewSource,
  /const shouldMountVideo = Boolean\(previewUrl\) && isInViewport && !suspendPlayback/,
  'the <video> element must mount only for visible, unblurred cards',
)
assert.match(
  videoPreviewSource,
  /poster=\{posterUrl \?\? undefined\}/,
  'mounted videos must declare the webp poster for instant first paint',
)
assert.ok(
  !videoPreviewSource.includes('startedVideoPreviewSources'),
  'the FIFO started-source set is gone; viewport mounting replaces the 3-slot stagger queue',
)
assert.match(
  videoPreviewSource,
  /preload="metadata"/,
  'mounted videos must keep metadata preload; full preload belongs to explicit playback surfaces',
)

/* ------------------------------------------------------------------ *
 * VID-2/4: 블러 카드는 스트리밍하지 않고, 미디어 identity 로 서브트리를 교체한다.
 * ------------------------------------------------------------------ */

assert.match(
  imageListItemSource,
  /<ImageListVideoPreview[\s\S]*?key=\{imageId\}/,
  'list cells must key the video subtree by media identity so recycled cells can never show another item\'s frame',
)
assert.match(
  imageListItemSource,
  /suspendPlayback=\{blurPreview\}/,
  'blurred cards must suspend playback: blur applies to the poster, not a streaming original',
)

/* ------------------------------------------------------------------ *
 * VID-3: 티어 정책 도착 전에는 fail-closed(블러)로 시작한다.
 * ------------------------------------------------------------------ */

const restrictedImage = { id: 1, rating_score: 5 } as ImageRecord
const loadedTiers: RatingTierRecord[] = [
  {
    id: 1,
    tier_name: 'Restricted',
    min_score: 4,
    max_score: null,
    tier_order: 1,
    feed_visibility: 'blur',
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
  },
]

assert.equal(
  resolveImageFeedSafety(restrictedImage, undefined).visibility,
  'blur',
  'unknown tier policy must fail closed: never paint restricted content unblurred before the tiers arrive',
)
assert.equal(
  resolveImageFeedSafety(restrictedImage, loadedTiers).visibility,
  'blur',
  'a matching tier must apply its configured feed visibility',
)
assert.equal(
  resolveImageFeedSafety({ id: 2, rating_score: 1 } as ImageRecord, loadedTiers).visibility,
  'show',
  'unrated/unmatched media must stay visible once the policy is loaded',
)

assert.match(
  feedSafetySource,
  /placeholderData: readStoredRatingTiers/,
  'the tiers query must warm-start from the stored policy so revisits render correct blur state on first paint',
)

console.log('Image list video preview contracts verified.')
