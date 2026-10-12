import { CrepeBuilder } from '@milkdown/crepe/builder'
import { editorViewCtx, editorViewOptionsCtx, serializerCtx } from '@milkdown/kit/core'
import { uploadConfig } from '@milkdown/kit/plugin/upload'
import { Plugin } from '@milkdown/kit/prose/state'
import type { NodeView } from '@milkdown/kit/prose/view'
import { $prose, insert, replaceAll } from '@milkdown/kit/utils'

export type PostEditorMediaView = { id: number; dom: HTMLElement; src: string; alt: string }

/** Keep the persisted body as Markdown; node views only change how its images are displayed. */
export function createPostRichEditor(options: {
  root: HTMLElement
  value: string
  label: string
  onChange: (markdown: string) => void
  onMediaViewsChange: (views: PostEditorMediaView[]) => void
  onUnsupportedUpload: () => void
}) {
  let markdown = options.value
  let ready = false
  let replacing = false
  let disposed = false
  let nextId = 0
  let pendingMediaUpdate = false
  const mediaViews = new Map<number, PostEditorMediaView>()
  const notifyMedia = () => {
    if (pendingMediaUpdate || disposed) return
    pendingMediaUpdate = true
    queueMicrotask(() => {
      pendingMediaUpdate = false
      if (!disposed) options.onMediaViewsChange([...mediaViews.values()])
    })
  }

  const crepe = new CrepeBuilder({ root: options.root, defaultValue: markdown })
  crepe.editor.config((ctx) => {
    ctx.update(editorViewOptionsCtx, (previous) => ({
      ...previous,
      attributes: { role: 'textbox', 'aria-multiline': 'true', 'aria-label': options.label },
    }))
    // Files must enter through the existing, permission-aware attachment pickers.
    // Crepe's default uploader creates blob: URLs, which cannot survive a saved post.
    ctx.update(uploadConfig.key, (previous) => ({
      ...previous,
      uploader: async () => { options.onUnsupportedUpload(); return [] },
    }))
  }).use($prose((ctx) => new Plugin({
    props: {
      nodeViews: {
        image: (node): NodeView => {
          const id = nextId++
          const dom = document.createElement('span')
          dom.className = 'post-editor-media'
          dom.contentEditable = 'false'
          const render = (src: string, alt: string) => {
            mediaViews.set(id, { id, dom, src, alt })
            notifyMedia()
          }
          render(String(node.attrs.src), String(node.attrs.alt ?? ''))
          return {
            dom,
            update: (next) => {
              if (next.type !== node.type) return false
              const current = mediaViews.get(id)
              if (current?.src !== next.attrs.src || current?.alt !== next.attrs.alt) {
                render(String(next.attrs.src), String(next.attrs.alt ?? ''))
              }
              return true
            },
            // Let the existing media controls receive clicks, but leave selection,
            // deletion and dragging of the image node to ProseMirror.
            stopEvent: (event) => event.target instanceof Element && Boolean(event.target.closest('a, button, input, video, audio, img')),
            ignoreMutation: (mutation) => mutation.type !== 'selection',
            destroy: () => { mediaViews.delete(id); notifyMedia() },
          }
        },
      },
    },
    view: () => ({
      update: (view, previous) => {
        if (!ready || replacing || disposed || view.state.doc.eq(previous.doc)) return
        // Milkdown's standard listener is debounced. Publish synchronously so
        // saving or switching to source immediately after typing loses nothing.
        const next = ctx.get(serializerCtx)(view.state.doc)
        if (next !== markdown) {
          markdown = next
          options.onChange(next)
        }
      },
    }),
  })))

  return {
    crepe,
    async create() {
      await crepe.create()
      ready = !disposed
    },
    getMarkdown: () => markdown,
    setMarkdown(value: string) {
      if (!ready || markdown === value) return
      replacing = true
      try {
        crepe.editor.action(replaceAll(value))
        markdown = value
      } finally {
        replacing = false
      }
    },
    insertMarkdown(value: string) {
      if (!ready) return false
      crepe.editor.action(insert(value))
      crepe.editor.action((ctx) => ctx.get(editorViewCtx).focus())
      return true
    },
    async destroy() {
      disposed = true
      ready = false
      await crepe.destroy()
      mediaViews.clear()
    },
  }
}

export type PostRichEditorEngine = ReturnType<typeof createPostRichEditor>
