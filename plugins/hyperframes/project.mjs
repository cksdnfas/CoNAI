export const FORMAT = 'conai.hyperframes.v1'
export const MAX_DOCUMENT = 64000
// The first entry of each list is what a scene without the field gets, and is not stored.
export const MOTIONS = ['zoom-in', 'zoom-out', 'pan-left', 'pan-right', 'none']
export const CAPTION_POSITIONS = ['center', 'top', 'bottom']
const COLOR = /^#[0-9a-f]{6}$/i
const HASH = /^(?:[a-f0-9]{32}|[a-f0-9]{48})$/
const MIME_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov', 'video/x-matroska': 'mkv', 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/ogg': 'ogg', 'audio/flac': 'flac', 'audio/mp4': 'm4a' }
export function assetPath(id, mime) {
  if (!/^[a-z][a-z0-9_-]{0,39}$/.test(id) || !MIME_EXT[mime]) throw new Error('소재 ID 또는 미디어 형식을 확인해줘.')
  return `assets/${id}.${MIME_EXT[mime]}`
}
export function reference(value) {
  if (!value || typeof value !== 'object') throw new Error('소재 참조가 필요해.')
  if (value.source === 'library' && HASH.test(value.compositeHash)) return { source: 'library', compositeHash: value.compositeHash }
  if (value.source === 'files' && /^[a-f0-9]{32}$/.test(value.fileId)) return { source: 'files', fileId: value.fileId }
  if (value.source === 'audio' && /^[a-f0-9-]{36}$/.test(value.candidateId)) return { source: 'audio', candidateId: value.candidateId }
  throw new Error('내부 라이브러리·파일함·오디오의 실제 ID를 사용해줘.')
}
export function validateProject(raw) {
  const text = typeof raw === 'string' ? raw : JSON.stringify(raw)
  if (new TextEncoder().encode(text).length > MAX_DOCUMENT) throw new Error('프로젝트는 64KB 이하로 나눠줘.')
  const p = typeof raw === 'string' ? JSON.parse(raw) : raw
  if (!p || p.format !== FORMAT || typeof p.title !== 'string' || !p.title.trim() || p.title.length > 100) throw new Error('HyperFrames 프로젝트 형식과 제목을 확인해줘.')
  for (const key of ['width', 'height']) if (!Number.isInteger(p[key]) || p[key] < 64 || p[key] > 1920 || p[key] % 2) throw new Error('해상도는 64~1920 사이 짝수여야 해.')
  if (p.width * p.height > 1920 * 1080 || ![24, 30].includes(p.fps) || !Number.isFinite(p.duration) || p.duration < 1 || p.duration > 120) throw new Error('최대 1080p·30fps·120초까지 지원해.')
  if (typeof p.html !== 'string' || !p.html.includes('data-composition-id') || !p.html.includes('data-duration') || p.html.length > 50000) throw new Error('data-composition-id와 data-duration이 있는 HTML을 작성해줘.')
  if (!Array.isArray(p.assets) || p.assets.length > 24) throw new Error('소재는 24개까지 사용할 수 있어.')
  const stage = p.stage ?? 'draft'
  if (!['draft', 'completed', 'archived'].includes(stage)) throw new Error('프로젝트 상태를 확인해줘.')
  const ids = new Set()
  const assets = p.assets.map(a => {
    if (!a || !/^[a-z][a-z0-9_-]{0,39}$/.test(a.id) || ids.has(a.id)) throw new Error('소재 ID는 중복 없이 영문 소문자로 시작해줘.')
    ids.add(a.id)
    if (a.fingerprint !== undefined && !/^[a-f0-9]{64}$/.test(a.fingerprint)) throw new Error('소재 리비전 형식이 달라.')
    if (a.label !== undefined && (typeof a.label !== 'string' || a.label.length > 40)) throw new Error('소재 이름은 40자까지 쓸 수 있어.')
    return { id: a.id, reference: reference(a.reference), ...(a.label?.trim() ? { label: a.label.trim() } : {}), ...(a.fingerprint ? { fingerprint: a.fingerprint } : {}), ...(a.mimeType ? { mimeType: a.mimeType, path: assetPath(a.id, a.mimeType) } : {}) }
  })
  const scenes = scenesOf(p.scenes, ids), style = styleOf(p.style), controls = controlsOf(p.controls)
  // The html always carries the current control values, whoever saved it.
  const html = applyControls(p.html, controls)
  if (html.length > 50000) throw new Error('HTML은 조정 항목을 포함해 50,000자까지 쓸 수 있어.')
  return { format: FORMAT, title: p.title.trim(), stage, width: p.width, height: p.height, fps: p.fps, duration: p.duration, html, assets, ...(scenes ? { scenes } : {}), ...(style ? { style } : {}), ...(controls ? { controls } : {}) }
}
// Look of a composition built from scenes: caption size (percent of the short side), caption colour, music volume.
function styleOf(raw) {
  if (raw === undefined || raw === null) return undefined
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new Error('영상 스타일 형식을 확인해줘.')
  const style = {}
  if (raw.captionSize !== undefined) {
    if (!Number.isFinite(raw.captionSize) || raw.captionSize < 3 || raw.captionSize > 25) throw new Error('자막 크기는 3~25 사이로 정해줘.')
    style.captionSize = Math.round(raw.captionSize * 10) / 10
  }
  if (raw.accent !== undefined) {
    if (!COLOR.test(raw.accent)) throw new Error('자막 색은 #rrggbb 형식으로 써줘.')
    style.accent = raw.accent.toLowerCase()
  }
  if (raw.musicVolume !== undefined) {
    if (!Number.isFinite(raw.musicVolume) || raw.musicVolume < 0 || raw.musicVolume > 1) throw new Error('음악 볼륨은 0~1 사이로 정해줘.')
    style.musicVolume = Math.round(raw.musicVolume * 100) / 100
  }
  return Object.keys(style).length ? style : undefined
}
// Values the author of the html exposes for adjusting without rewriting it. Each is the CSS custom property --<id>.
function controlsOf(raw) {
  if (raw === undefined || raw === null) return undefined
  if (!Array.isArray(raw) || raw.length > 12) throw new Error('조정 항목은 12개까지 등록할 수 있어.')
  const ids = new Set()
  const controls = raw.map(c => {
    if (!c || !/^[a-z][a-z0-9-]{0,29}$/.test(c.id) || ids.has(c.id)) throw new Error('조정 항목 ID는 중복 없이 영문 소문자로 시작해줘.')
    ids.add(c.id)
    if (typeof c.label !== 'string' || !c.label.trim() || c.label.length > 40) throw new Error('조정 항목 이름은 40자까지 써줘.')
    const base = { id: c.id, label: c.label.trim() }
    if (c.type === 'toggle' && typeof c.value === 'boolean') return { ...base, type: 'toggle', value: c.value }
    if (c.type === 'color' && COLOR.test(c.value)) return { ...base, type: 'color', value: c.value.toLowerCase() }
    if (c.type === 'range' && [c.min, c.max, c.step, c.value].every(Number.isFinite) && c.min < c.max && c.step > 0 && c.value >= c.min && c.value <= c.max
      && (c.unit === undefined || (typeof c.unit === 'string' && c.unit.length <= 8))) return { ...base, type: 'range', min: c.min, max: c.max, step: c.step, value: c.value, ...(c.unit ? { unit: c.unit } : {}) }
    throw new Error(`조정 항목 ${c.id}의 종류와 값을 확인해줘.`)
  })
  return controls.length ? controls : undefined
}
/** Writes the control values into the html as custom properties on :root (a toggle is 1 or 0), replacing the previous block. */
export function applyControls(html, controls = []) {
  const block = controls.length ? `<style id="hf-controls">:root{${controls.map(c => `--${c.id}:${c.type === 'toggle' ? (c.value ? 1 : 0) : c.value}`).join(';')}}</style>` : ''
  const existing = /<style id="hf-controls">[^<]*<\/style>/
  if (existing.test(html)) return html.replace(existing, () => block)
  if (!block) return html
  const head = html.indexOf('</head>'), at = head >= 0 ? head : Math.max(0, html.search(/<[a-z][^>]*data-composition-id/i))
  return html.slice(0, at) + block + html.slice(at)
}
// The editor's storyboard: which source each scene shows, for how long, with which caption, motion, cross-fade from
// the scene before and caption position. The html is built from it only on request, so hand edits survive; scenes
// whose source was removed are dropped.
function scenesOf(raw, ids) {
  if (raw === undefined || raw === null) return undefined
  if (!Array.isArray(raw) || raw.length > 24) throw new Error('장면은 24개까지 만들 수 있어.')
  return raw.filter(scene => scene && (scene.asset === null || ids.has(scene.asset))).map(scene => {
    if (!Number.isFinite(scene.seconds) || scene.seconds < 0.5 || scene.seconds > 60) throw new Error('장면 길이는 0.5~60초로 정해줘.')
    if (typeof (scene.caption ?? '') !== 'string' || (scene.caption ?? '').length > 200) throw new Error('자막은 200자까지 쓸 수 있어.')
    if (scene.motion !== undefined && !MOTIONS.includes(scene.motion)) throw new Error('장면 움직임을 확인해줘.')
    if (scene.transition !== undefined && (!Number.isFinite(scene.transition) || scene.transition < 0 || scene.transition > 2)) throw new Error('전환은 0~2초로 정해줘.')
    if (scene.captionPosition !== undefined && !CAPTION_POSITIONS.includes(scene.captionPosition)) throw new Error('자막 위치를 확인해줘.')
    return {
      asset: scene.asset, seconds: Math.round(scene.seconds * 10) / 10, caption: scene.caption ?? '',
      ...(scene.motion && scene.motion !== MOTIONS[0] ? { motion: scene.motion } : {}),
      ...(scene.transition ? { transition: Math.round(scene.transition * 10) / 10 } : {}),
      ...(scene.captionPosition && scene.captionPosition !== CAPTION_POSITIONS[0] ? { captionPosition: scene.captionPosition } : {}),
    }
  })
}
const visual = asset => /^(image|video)\//.test(asset?.mimeType ?? '')
export function defaultScenes(title, assets) {
  const scenes = assets.filter(visual).map((asset, i) => ({ asset: asset.id, seconds: 4, caption: i === 0 ? title : '' }))
  return scenes.length ? scenes : [{ asset: null, seconds: 4, caption: title }]
}
export const scenesDuration = scenes => Math.round(scenes.reduce((sum, scene) => sum + scene.seconds, 0) * 10) / 10
const escape = text => String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
// from → to of the tween on a still, per motion.
const STILL_MOTION = {
  'zoom-in': ['{scale:1}', '{scale:1.06'], 'zoom-out': ['{scale:1.06}', '{scale:1'],
  'pan-left': ['{scale:1.08,xPercent:3}', '{scale:1.08,xPercent:-3'], 'pan-right': ['{scale:1.08,xPercent:-3}', '{scale:1.08,xPercent:3'],
}
const CAPTION_ALIGN = { top: 'flex-start', bottom: 'flex-end' }
/**
 * A GSAP composition: scenes in order on their own tracks, a slow move on stills, captions rising in, audio sources under
 * everything. A scene with a transition fades in over the one before, which stays on screen that much longer. Scenes and a
 * style without the optional fields produce exactly the html earlier versions did: the editor recognises a composition it
 * built by comparing with this output.
 */
export function composeHtml({ width, height, assets, style = {} }, scenes) {
  const byId = new Map(assets.map(asset => [asset.id, asset]))
  const duration = scenesDuration(scenes), sections = [], motion = []
  const fadeOf = (scene, i) => i > 0 && scene ? Math.min(scene.transition ?? 0, scene.seconds) : 0
  let start = 0
  scenes.forEach((scene, i) => {
    const asset = byId.get(scene.asset), seconds = scene.seconds, fade = fadeOf(scene, i), hold = fadeOf(scenes[i + 1], i + 1)
    const shown = hold ? Math.round((seconds + hold) * 10) / 10 : seconds
    const media = asset?.mimeType?.startsWith('video/') ? `<video src="${asset.path}" data-start="${start}" data-duration="${shown}" data-track-index="${i}" muted playsinline></video>`
      : asset?.mimeType?.startsWith('image/') ? `<img src="${asset.path}" alt="">` : ''
    const move = STILL_MOTION[scene.motion ?? MOTIONS[0]]
    if (move && asset?.mimeType?.startsWith('image/')) motion.push(`tl.fromTo('#scene-${i} img',${move[0]},${move[1]},duration:${seconds},ease:'none'},${start});`)
    if (fade) motion.push(`tl.fromTo('#scene-${i}',{opacity:0},{opacity:1,duration:${fade},ease:'none'},${start});`)
    if (scene.caption) motion.push(`tl.fromTo('#scene-${i} h1',{opacity:0,y:40},{opacity:1,y:0,duration:0.7},${start});`)
    const align = CAPTION_ALIGN[scene.captionPosition]
    sections.push(`<section id="scene-${i}" class="clip scene" data-start="${start}" data-duration="${shown}" data-track-index="${i}">${media}${scene.caption ? `<h1${align ? ` style="align-self:${align}"` : ''}>${escape(scene.caption)}</h1>` : ''}</section>`)
    start = Math.round((start + seconds) * 10) / 10
  })
  const audio = assets.filter(asset => asset.mimeType?.startsWith('audio/')).map((asset, i) => `<audio id="audio-${i}" src="${asset.path}" data-start="0" data-duration="${duration}" data-track-index="${scenes.length + i}" data-volume="${style.musicVolume ?? 0.8}"></audio>`)
  const captionSize = Math.round(Math.min(width, height) * (style.captionSize ?? 10) / 100)
  return `<!doctype html><html lang="ko"><head><meta charset="UTF-8"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#131313;color:#fff;font-family:"Noto Sans CJK KR",sans-serif}.scene{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;overflow:hidden}.scene img,.scene video{position:absolute;width:100%;height:100%;object-fit:cover}h1{position:relative;font-size:${captionSize}px;text-shadow:0 3px 20px #000;padding:40px;text-align:center${style.accent ? `;color:${style.accent}` : ''}}</style></head><body><div id="root" data-composition-id="main" data-start="0" data-duration="${duration}" data-width="${width}" data-height="${height}">${sections.join('\n')}${audio.join('')}</div><script src="vendor/gsap.min.js"></script><script>const tl=gsap.timeline({paused:true});${motion.join('')}window.__timelines={main:tl};</script></body></html>`
}
export function starter(title = '새 영상', assets = []) {
  const scenes = defaultScenes(title, assets), size = { width: 1280, height: 720, assets }
  return { format: FORMAT, title, width: 1280, height: 720, fps: 30, duration: scenesDuration(scenes), assets, scenes, html: composeHtml(size, scenes) }
}
