// Library and file thumbnails through the native routes, as blob URLs. The host bridge allows four requests in flight,
// so at most two thumbnails load at once, only once they scroll into view, and each key is fetched once.
export function thumbnails(api) {
  const cache = new Map(), queue = []
  let active = 0
  const supported = typeof api.supports === 'function' && api.supports('app.fetch')
  const path = key => {
    const [source, id] = key.split(':')
    return source === 'library' ? `/api/images/${id}/thumbnail` : source === 'files' ? `/api/files/${id}/thumbnail` : null
  }
  function pump() {
    while (active < 2 && queue.length) {
      const { key, resolve } = queue.shift()
      active++
      api.app.fetch(path(key))
        .then(async response => response.ok ? URL.createObjectURL(await response.blob()) : null)
        .catch(() => null)
        .then(url => { active--; resolve(url); pump() })
    }
  }
  function load(key) {
    if (!supported || !path(key)) return Promise.resolve(null)
    if (!cache.has(key)) cache.set(key, new Promise(resolve => { queue.push({ key, resolve }); pump() }))
    return cache.get(key)
  }
  const observer = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue
      observer.unobserve(entry.target)
      const image = entry.target
      void load(image.dataset.key).then(url => { if (url && image.isConnected) { image.onload = () => image.classList.add('loaded'); image.src = url } })
    }
  }, { rootMargin: '200px' }) : null
  return {
    /** Put a lazily loaded thumbnail of `key` ('library:<hash>' or 'files:<id>') into `container`. */
    into(container, key) {
      const image = document.createElement('img')
      image.alt = ''; image.dataset.key = key; image.decoding = 'async'
      container.prepend(image)
      if (observer) observer.observe(image)
      else void load(key).then(url => { if (url) { image.onload = () => image.classList.add('loaded'); image.src = url } })
      return image
    },
  }
}
