import { CHAT_PROFILE_TEXT_LIMITS } from '../constants/chatLimits'

/**
 * Art styles (그림 스타일, `/characters?view=styles`, REST `/api/art-styles`): reusable looks of a picture — reference
 * images, a positive and a negative prompt, a title, a one-line description, badges and search keywords. A style owns
 * copies of its images in the shared file store (folder `그림 스타일/<title>/`), whether they came from the media library
 * or an upload, so changing the library never touches a style; deleting the style deletes its copies. Images are
 * served by `GET /:id/files/:fileId` (and `/thumbnail`). Nothing applies a style automatically: generation forms copy
 * its values when a person (or the chat) asks.
 */

/** Text and list limits shared by the screen, the REST API and the chat tools. */
export const ART_STYLE_LIMITS = {
  title: 80,
  description: 200,
  /** Characters per badge, then badges per style. */
  badge: 24,
  badges: 12,
  /** Characters per search keyword, then keywords per style. */
  keyword: 40,
  keywords: 40,
  /** Each of the positive and negative prompts. */
  prompt: CHAT_PROFILE_TEXT_LIMITS.text,
  images: 24,
} as const

export type ArtStyleSort = 'name' | 'updated' | 'created' | 'created_asc'

export type ArtStyleSummary = {
  id: number
  /** Unique (case-insensitive). */
  title: string
  /** One line. */
  description: string
  badges: string[]
  /** The first image's file id; null without images or when the viewer lacks `images.view`. */
  coverImageId: string | null
  imageCount: number
  favorite: boolean
  /** Bumped by every change; saves send it back. */
  revision: number
  updatedAt: string
}

export type ArtStyle = ArtStyleSummary & {
  keywords: string[]
  positive: string
  negative: string
  /** The style's own images in order, the first is the cover; empty when the viewer lacks `images.view`. */
  images: ArtStyleImage[]
  createdAt: string
}

/** One image a style holds: a file-store copy only this style uses (a file deleted on the Files page is left out). */
export type ArtStyleImage = {
  /** The file-store file id; `GET /api/art-styles/:styleId/files/:id` serves it. */
  id: string
  /** The name of the file it was copied from. */
  name: string
  mimeType: string
  width: number | null
  height: number | null
}

/** A staged upload (`POST /api/workflow-input-assets`); a save copies it into the style and consumes it. */
export type ArtStyleUploadedImage = { __ref: 'workflow-input-asset'; id: string; fileName: string; mimeType?: string; bytes: number }

/**
 * One entry of a write's `images` (always a tagged object; ids and hashes are never told apart by their form):
 * `{ id }` an image the style already holds, `{ composite_hash }` a library still image (copied at save), a staged
 * upload (copied, then consumed), or `{ file_id }` a file-store image the person may read (copied).
 */
export type ArtStyleImageInput = { id: string } | { composite_hash: string } | ArtStyleUploadedImage | { file_id: string }

/** One page of styles; `hasMore` asks for the next `offset`. */
export type ArtStylePage = { items: ArtStyleSummary[]; total: number; hasMore: boolean }

/**
 * `GET /`: `query` — every whitespace-separated term must match the title, the description, a badge or a keyword
 * (case-insensitive, part of the text is enough); `badges` — every one must be on the style (sent as a JSON array).
 */
export type ArtStyleListQuery = {
  query?: string
  badges?: string[]
  favorite?: boolean
  sort?: ArtStyleSort
  limit?: number
  offset?: number
}

/** `GET /badges` (same scope minus `badges`): the badges on the listed styles, most used first. */
export type ArtStyleBadgeCount = { badge: string; count: number }

/**
 * Titles are unique (case-insensitive). Badges and keywords are trimmed and kept once (case-insensitive). `images`
 * replaces the whole ordered list (each image once, the first is the cover) and needs `images.view`; images left out are
 * deleted with their copies. `duplicateOf` (create only, without `images`) copies another style's images.
 */
export type ArtStyleCreateInput = {
  title: string
  description?: string
  badges?: string[]
  keywords?: string[]
  positive?: string
  negative?: string
  images?: ArtStyleImageInput[]
  favorite?: boolean
  duplicateOf?: number
}

/** Only the given fields change. `revision` must equal the stored one, otherwise 409 `revision_conflict`. */
export type ArtStylePatch = Partial<Omit<ArtStyleCreateInput, 'duplicateOf'>> & { revision: number }

/** Several listed styles at once (by id, without revisions). Deleting a style deletes its images too. */
export type ArtStyleBulkInput = { ids: number[] } & ({ action: 'favorite'; favorite: boolean } | { action: 'delete' })
export type ArtStyleBulkResult = { changed: number }

/**
 * One style of a portable bundle (`POST /export` answers a ZIP: `art-styles.json` holding `ArtStyleExport`, and each
 * image as the file `images` names). `images` is empty for viewers without `images.view`.
 */
export type ArtStyleExportEntry = {
  title: string
  description: string
  badges: string[]
  keywords: string[]
  positive: string
  negative: string
  favorite: boolean
  /** In order: the image's ZIP entry (`images/<style>/<n>.<ext>`), its original name and MIME. */
  images: ArtStyleExportImage[]
}
export type ArtStyleExportImage = { bundleFile: string; name: string; mimeType: string }
export type ArtStyleExport = { format: 'conai.art-styles'; version: 1; styles: ArtStyleExportEntry[] }
/** `ids`, or `{}` for every style. */
export type ArtStyleExportInput = { ids: number[] } | Record<string, never>
/**
 * `POST /import` (multipart `file`): taken titles get ` (2)`, ` (3)`…, bundled images become the new style's own
 * file-store copies (needs `images.view`), and an image that is missing, damaged or not a still image is dropped.
 */
export type ArtStyleImportResult = { created: number; renamed: number; importedImages: number; droppedImages: number }

/**
 * An art style change proposed from a chat (`propose_art_style`). The server validates `input` with the same rules as
 * `POST /` / `PATCH /:id` (title free, each image held by the style or a library still image) before attaching it; a
 * person applies it from the card through the REST API with their own session, and `savedId` / `saved` are written
 * back like other proposals. Its images are only `{ id }` or `{ composite_hash }`.
 */
/** What a proposal may change: a style's fields, with images as `{ id }` (held) or `{ composite_hash }` (library). */
export type ChatArtStyleProposalInput = Partial<Omit<ArtStyleCreateInput, 'images' | 'duplicateOf'>> & { images?: Array<{ id: string } | { composite_hash: string }> }

export type ChatArtStyleProposal = { kind: 'art_style'; savedId?: number | null; saved?: boolean } & (
  /** `styleId` null creates the style (`input.title` is set); otherwise only `input`'s fields change, against `revision`. */
  | { action: 'save_style'; styleId: number | null; revision: number | null; title: string; input: ChatArtStyleProposalInput }
  | { action: 'delete_style'; styleId: number; title: string; revision: number }
)
