// Masonry by columns: each tile goes under the shortest column, so appending a page never moves earlier tiles.
// Heights are tracked as height/width ratios (every column has the same width).
export function masonry(container, { columnWidth = 130, gap = 6 } = {}) {
  let columns = [], heights = [], items = []
  const count = () => Math.max(2, Math.floor((container.clientWidth + gap) / (columnWidth + gap)))
  function place(item) {
    const index = heights.indexOf(Math.min(...heights))
    columns[index].append(item.node); heights[index] += item.ratio
  }
  function layout() {
    const wanted = count()
    if (wanted === columns.length && container.contains(columns[0] ?? null)) return
    columns = Array.from({ length: wanted }, () => { const column = document.createElement('div'); column.className = 'masonry-col'; return column })
    heights = columns.map(() => 0)
    container.replaceChildren(...columns)
    for (const item of items) place(item)
  }
  if (typeof ResizeObserver === 'function') new ResizeObserver(() => { if (items.length && container.clientWidth) layout() }).observe(container)
  return {
    /** ratio = height / width of the tile. */
    add(node, ratio) { const item = { node, ratio: (Number.isFinite(ratio) && ratio > 0 ? ratio : 1) + gap / columnWidth }; items.push(item); layout(); place(item) },
    clear() { items = []; columns = []; heights = []; container.replaceChildren() },
    note(node) { items = []; columns = []; heights = []; container.replaceChildren(node) },
    get size() { return items.length },
  }
}
