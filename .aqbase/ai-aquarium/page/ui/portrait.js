/** A resident's round face: the profile picture when loaded, its initial on the resident colour until then. */
export function createPortrait(name, portrait, color) {
  const face = document.createElement('span')
  face.className = 'profile-face'
  face.style.setProperty('--resident-color', /^#[0-9a-f]{6}$/i.test(color || '') ? color : '#668578')
  const initial = document.createElement('span')
  initial.className = 'profile-initial'; initial.textContent = Array.from(name.trim())[0] || '?'
  face.append(initial)
  if (portrait?.url?.startsWith('blob:')) {
    const image = document.createElement('img'); image.alt = ''; image.src = portrait.url; image.draggable = false
    const crop = portrait.crop
    if (crop && [crop.x, crop.y, crop.scale].every(Number.isFinite) && crop.scale > 0) {
      const position = `${crop.x}% ${crop.y}%`
      image.style.objectPosition = position; image.style.transformOrigin = position; image.style.transform = `scale(${crop.scale})`
    }
    image.addEventListener('load', () => { initial.hidden = true })
    // The crop scales the image past its box; its own clip keeps it round even where the face lets a status dot overflow.
    const clip = document.createElement('span'); clip.className = 'profile-clip'; clip.append(image)
    image.addEventListener('error', () => clip.remove(), { once: true })
    face.append(clip)
  }
  return face
}
