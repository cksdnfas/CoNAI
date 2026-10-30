/* Profile images: one cache for party, map and menu cards, refetched only when the profile's asset version changes. */
export function createFaces({ app, faces, onLoad }) {
  let imageQueue = Promise.resolve()
  function loadFace(profile) {
    if (!app.api || !profile?.assets?.avatar || typeof app.api.llm?.asset !== 'function') return
    const key = profile.assetVersion || String(profile.id)
    if (faces.get(profile.id)?.key === key) return
    faces.set(profile.id, { key, url: null, crop: null })
    imageQueue = imageQueue.then(async () => {
      try {
        const asset = await app.api.llm.asset({ profileId: profile.id, kind: 'avatar', maxSize: 160 })
        if (asset.state !== 'ready' || faces.get(profile.id)?.key !== key) return
        const bytes = Uint8Array.from(atob(asset.data), c => c.charCodeAt(0))
        faces.set(profile.id, { key, url: URL.createObjectURL(new Blob([bytes], { type: asset.mimeType })), crop: asset.crop })
        onLoad()
      } catch { faces.delete(profile.id) }
    })
  }
  function pruneFaces() {
    for (const [id, face] of faces) if (!app.profiles.some(p => p.id === id && (p.assetVersion || String(p.id)) === face.key)) { if (face.url) URL.revokeObjectURL(face.url); faces.delete(id) }
  }

  return { load: loadFace, prune: pruneFaces }
}
