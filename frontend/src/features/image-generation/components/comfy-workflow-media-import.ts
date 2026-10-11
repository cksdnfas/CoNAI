/**
 * Read a ComfyUI workflow back out of a file ComfyUI produced. PNG keeps `prompt` (API) and `workflow` (UI) in text
 * chunks; WebP keeps them in EXIF, VideoHelperSuite WebM/MP4 in container tags. The API prompt is preferred because it
 * needs no conversion; a UI workflow is returned for the caller to convert.
 */

export type ExtractedComfyWorkflow = { format: 'api' | 'ui'; workflowJson: string }

/** Container tags sit near the start (WebM, PNG, WebP) or the end (MP4 moov); a video's middle is never read. */
const MEDIA_HEAD_BYTES = 24 * 1024 * 1024
const MEDIA_TAIL_BYTES = 8 * 1024 * 1024
const WORKFLOW_MARKERS = ['prompt', 'PROMPT', 'Prompt', 'workflow', 'WORKFLOW', 'Workflow']
const MAX_MARKER_ATTEMPTS = 400

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isApiWorkflow(value: unknown): value is Record<string, { class_type: string; inputs?: unknown; _meta?: unknown }> {
  if (!isRecord(value)) return false
  const nodes = Object.values(value)
  return nodes.length > 0 && nodes.every((node) => isRecord(node) && typeof node.class_type === 'string')
}

function isUiWorkflow(value: unknown) {
  return isRecord(value) && Array.isArray(value.nodes)
}

/** Python's json writes NaN/Infinity, which JSON.parse rejects; turn them into null outside of strings. */
function parseLooseJson(text: string): unknown {
  let out = ''
  let inString = false
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (inString) {
      out += char
      if (char === '\\') {
        out += text[index + 1] ?? ''
        index += 1
      } else if (char === '"') {
        inString = false
      }
      continue
    }
    if (char === '"') {
      inString = true
      out += char
      continue
    }
    const rest = text.slice(index, index + 9)
    const token = rest.startsWith('-Infinity') ? '-Infinity' : rest.startsWith('Infinity') ? 'Infinity' : rest.startsWith('NaN') ? 'NaN' : null
    if (token) {
      out += 'null'
      index += token.length - 1
      continue
    }
    out += char
  }
  return JSON.parse(out)
}

/** End index (exclusive) of the JSON object starting at `start`, or -1 when it never closes. */
function balancedObjectEnd(text: string, start: number) {
  let depth = 0
  let inString = false
  for (let index = start; index < text.length; index += 1) {
    const char = text[index]
    if (inString) {
      if (char === '\\') index += 1
      else if (char === '"') inString = false
    } else if (char === '"') {
      inString = true
    } else if (char === '{') {
      depth += 1
    } else if (char === '}') {
      depth -= 1
      if (depth === 0) return index + 1
    }
  }
  return -1
}

/** Values found in a text blob: a JSON string may itself hold the workflow (`{"prompt": "{...}"}`), so unwrap one level. */
function collectWorkflowObjects(value: unknown, found: unknown[]) {
  if (typeof value === 'string') {
    try {
      collectWorkflowObjects(parseLooseJson(value), found)
    } catch {
      // not JSON
    }
    return
  }
  if (isApiWorkflow(value) || isUiWorkflow(value)) {
    found.push(value)
    return
  }
  if (isRecord(value)) {
    for (const key of ['prompt', 'workflow']) {
      if (key in value) collectWorkflowObjects(value[key], found)
    }
  }
}

/** Find JSON objects right after a prompt/workflow marker anywhere in the text. */
function scanText(text: string, found: unknown[]) {
  for (const marker of WORKFLOW_MARKERS) {
    let from = 0
    let attempts = 0
    while (found.length < 8 && attempts < MAX_MARKER_ATTEMPTS) {
      attempts += 1
      const at = text.indexOf(marker, from)
      if (at < 0) break
      from = at + marker.length
      const start = text.indexOf('{', from)
      // The object has to follow the marker closely (a tag/chunk header, `:` or `":`), not somewhere far later.
      if (start < 0 || start - from > 24) continue
      const end = balancedObjectEnd(text, start)
      if (end < 0) continue
      try {
        collectWorkflowObjects(parseLooseJson(text.slice(start, end)), found)
        from = end
      } catch {
        // marker inside unrelated bytes
      }
    }
  }
}

async function inflate(data: Uint8Array) {
  const stream = new Blob([new Uint8Array(data)]).stream().pipeThrough(new DecompressionStream('deflate'))
  return new TextDecoder().decode(await new Response(stream).arrayBuffer())
}

/** PNG tEXt / zTXt / iTXt chunks as keyword → text. */
async function readPngText(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const latin1 = new TextDecoder('latin1')
  const utf8 = new TextDecoder()
  const texts: Array<[string, string]> = []
  let offset = 8
  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset)
    const type = latin1.decode(bytes.subarray(offset + 4, offset + 8))
    const data = bytes.subarray(offset + 8, offset + 8 + length)
    const nul = data.indexOf(0)
    if (type === 'tEXt' && nul > 0) {
      texts.push([latin1.decode(data.subarray(0, nul)), utf8.decode(data.subarray(nul + 1))])
    } else if (type === 'zTXt' && nul > 0) {
      texts.push([latin1.decode(data.subarray(0, nul)), await inflate(data.subarray(nul + 2))])
    } else if (type === 'iTXt' && nul > 0) {
      const compressed = data[nul + 1] === 1
      const languageEnd = data.indexOf(0, nul + 3)
      const translatedEnd = languageEnd < 0 ? -1 : data.indexOf(0, languageEnd + 1)
      if (translatedEnd > 0) {
        const body = data.subarray(translatedEnd + 1)
        texts.push([latin1.decode(data.subarray(0, nul)), compressed ? await inflate(body) : utf8.decode(body)])
      }
    }
    if (type === 'IEND') break
    offset += 12 + length
  }
  return texts
}

function pickWorkflow(found: unknown[]): ExtractedComfyWorkflow | null {
  const api = found.find(isApiWorkflow)
  if (api) {
    // Keep only what a prompt needs; execution logs add keys such as is_changed.
    const cleaned = Object.fromEntries(Object.entries(api).map(([id, node]) => [id, {
      class_type: node.class_type,
      inputs: isRecord(node.inputs) ? node.inputs : {},
      ...(isRecord(node._meta) ? { _meta: node._meta } : {}),
    }]))
    return { format: 'api', workflowJson: JSON.stringify(cleaned, null, 2) }
  }
  const ui = found.find(isUiWorkflow)
  return ui ? { format: 'ui', workflowJson: JSON.stringify(ui, null, 2) } : null
}

export function isComfyMediaFile(file: File) {
  return /^(image|video)\//.test(file.type) || /\.(png|webp|webm|mp4|mov|mkv)$/i.test(file.name)
}

/** Pull the embedded workflow out of a ComfyUI image or video, or null when the file carries none. */
export async function extractComfyWorkflowFromMedia(file: File): Promise<ExtractedComfyWorkflow | null> {
  const found: unknown[] = []
  const head = new Uint8Array(await file.slice(0, MEDIA_HEAD_BYTES).arrayBuffer())
  const isPng = head.length > 8 && head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47
  if (isPng) {
    for (const [key, text] of await readPngText(head)) {
      if (/^(prompt|workflow)$/i.test(key)) collectWorkflowObjects(text, found)
    }
    // Files from other tools put everything in one "parameters" chunk; scanning the texts covers them too.
    if (found.length === 0) for (const [, text] of await readPngText(head)) scanText(text, found)
  }
  if (found.length === 0) {
    const decoder = new TextDecoder()
    scanText(decoder.decode(head), found)
    if (found.length === 0 && file.size > MEDIA_HEAD_BYTES) {
      const tail = new Uint8Array(await file.slice(Math.max(MEDIA_HEAD_BYTES, file.size - MEDIA_TAIL_BYTES)).arrayBuffer())
      scanText(decoder.decode(tail), found)
    }
  }
  return pickWorkflow(found)
}
