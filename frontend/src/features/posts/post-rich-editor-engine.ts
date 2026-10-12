import { CrepeBuilder } from '@milkdown/crepe/builder'
import { toggleLinkCommand } from '@milkdown/kit/component/link-tooltip'
import { commandsCtx, editorViewCtx, editorViewOptionsCtx, remarkStringifyOptionsCtx, serializerCtx } from '@milkdown/kit/core'
import type { Ctx } from '@milkdown/kit/ctx'
import { redoCommand, undoCommand } from '@milkdown/kit/plugin/history'
import { uploadConfig } from '@milkdown/kit/plugin/upload'
import {
  addBlockTypeCommand, blockquoteSchema, bulletListSchema, codeBlockSchema, emphasisSchema, headingSchema, hrSchema,
  inlineCodeSchema, isMarkSelectedCommand, liftListItemCommand, linkSchema, listItemSchema, orderedListSchema,
  paragraphSchema, selectTextNearPosCommand, setBlockTypeCommand, strongSchema, toggleEmphasisCommand,
  toggleInlineCodeCommand, toggleStrongCommand, wrapInBlockTypeCommand,
} from '@milkdown/kit/preset/commonmark'
import { createTable, strikethroughSchema, toggleStrikethroughCommand } from '@milkdown/kit/preset/gfm'
import { redoDepth, undoDepth } from '@milkdown/kit/prose/history'
import type { MarkType, Node as ProseNode } from '@milkdown/kit/prose/model'
import { Plugin, TextSelection, type EditorState } from '@milkdown/kit/prose/state'
import { liftTarget } from '@milkdown/kit/prose/transform'
import type { NodeView } from '@milkdown/kit/prose/view'
import { $prose, insert, replaceAll } from '@milkdown/kit/utils'

export type PostEditorMediaView = { id: number; dom: HTMLElement; src: string; alt: string }

type ListKind = 'bulletList' | 'orderedList' | 'taskList'

/** What the formatting bar shows as pressed at the caret. `heading` is null for a paragraph, `list` the innermost list. */
export type RichFormatState = {
  heading: number | null; bold: boolean; italic: boolean; strike: boolean; code: boolean; link: boolean
  list: ListKind | null; quote: boolean; codeBlock: boolean; canUndo: boolean; canRedo: boolean
}
export type RichFormatAction =
  | 'bold' | 'italic' | 'strike' | 'code' | 'link' | ListKind
  | 'table' | 'codeBlock' | 'quote' | 'divider' | 'undo' | 'redo' | { heading: number | null }

export const EMPTY_FORMAT_STATE: RichFormatState = {
  heading: null, bold: false, italic: false, strike: false, code: false, link: false, list: null, quote: false, codeBlock: false, canUndo: false, canRedo: false,
}

// Same mark checks and insert commands as Crepe's own top bar; block buttons additionally toggle off (and lists switch
// kind) where Crepe would only wrap again.
function isMarkActive(ctx: Ctx, markType: MarkType) {
  if (ctx.get(commandsCtx).call(isMarkSelectedCommand.key, markType)) return true
  const { state } = ctx.get(editorViewCtx)
  if (state.storedMarks) return state.storedMarks.some((mark) => mark.type === markType)
  const cursor = state.selection instanceof TextSelection ? state.selection.$cursor : null
  return cursor ? cursor.marks().some((mark) => mark.type === markType) : false
}

/** The innermost list around the caret, and which button it belongs to (a list with any checkbox item is a task list). */
function currentList(ctx: Ctx, state: EditorState) {
  const { $from } = state.selection
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth)
    if (node.type !== bulletListSchema.type(ctx) && node.type !== orderedListSchema.type(ctx)) continue
    let task = false
    node.forEach((item) => { if (item.attrs.checked != null) task = true })
    const kind: ListKind = node.type === orderedListSchema.type(ctx) ? 'orderedList' : task ? 'taskList' : 'bulletList'
    return { node, pos: $from.before(depth), kind }
  }
  return null
}

function insideQuote(ctx: Ctx, state: EditorState) {
  const { $from } = state.selection
  for (let depth = $from.depth; depth > 0; depth--) if ($from.node(depth).type === blockquoteSchema.type(ctx)) return true
  return false
}

function readFormatState(ctx: Ctx): RichFormatState {
  const { state } = ctx.get(editorViewCtx)
  const parent = state.selection.$from.parent
  return {
    heading: parent.type === headingSchema.type(ctx) ? Number(parent.attrs.level) : null,
    bold: isMarkActive(ctx, strongSchema.type(ctx)),
    italic: isMarkActive(ctx, emphasisSchema.type(ctx)),
    strike: isMarkActive(ctx, strikethroughSchema.type(ctx)),
    code: isMarkActive(ctx, inlineCodeSchema.type(ctx)),
    link: isMarkActive(ctx, linkSchema.type(ctx)),
    list: currentList(ctx, state)?.kind ?? null,
    quote: insideQuote(ctx, state),
    codeBlock: parent.type === codeBlockSchema.type(ctx),
    canUndo: undoDepth(state) > 0,
    canRedo: redoDepth(state) > 0,
  }
}

function toggleList(ctx: Ctx, kind: ListKind) {
  const commands = ctx.get(commandsCtx)
  const view = ctx.get(editorViewCtx)
  const list = currentList(ctx, view.state)
  if (!list) {
    if (kind === 'taskList') commands.call(wrapInBlockTypeCommand.key, { nodeType: listItemSchema.type(ctx), attrs: { checked: false } })
    else commands.call(wrapInBlockTypeCommand.key, { nodeType: (kind === 'orderedList' ? orderedListSchema : bulletListSchema).type(ctx) })
    return
  }
  // The same button again takes the selected items out of the list.
  if (list.kind === kind) { commands.call(liftListItemCommand.key); return }
  // Another list button switches the whole list. Items carry their list type too (Milkdown's order sync would turn
  // the list back to match them otherwise); it renumbers ordered labels itself.
  const { tr } = view.state
  const ordered = kind === 'orderedList'
  const listType = (ordered ? orderedListSchema : bulletListSchema).type(ctx)
  if (list.node.type !== listType) tr.setNodeMarkup(list.pos, listType, ordered ? { order: 1, spread: list.node.attrs.spread } : { spread: list.node.attrs.spread })
  let offset = list.pos + 1
  list.node.forEach((item: ProseNode, _offset, index) => {
    if (item.type === listItemSchema.type(ctx)) {
      tr.setNodeMarkup(offset, undefined, {
        ...item.attrs,
        listType: ordered ? 'ordered' : 'bullet',
        label: ordered ? `${index + 1}.` : '•',
        checked: kind === 'taskList' ? (item.attrs.checked ?? false) : null,
      })
    }
    offset += item.nodeSize
  })
  view.dispatch(tr.scrollIntoView())
}

function toggleQuote(ctx: Ctx) {
  const view = ctx.get(editorViewCtx)
  const { $from, $to } = view.state.selection
  const quoteType = blockquoteSchema.type(ctx)
  const range = $from.blockRange($to, (node) => node.type === quoteType)
  const target = range && liftTarget(range)
  if (range && target != null) view.dispatch(view.state.tr.lift(range, target).scrollIntoView())
  else ctx.get(commandsCtx).call(wrapInBlockTypeCommand.key, { nodeType: quoteType })
}

function runFormat(ctx: Ctx, action: RichFormatAction) {
  const commands = ctx.get(commandsCtx)
  const view = ctx.get(editorViewCtx)
  if (typeof action === 'object') {
    if (action.heading === null) commands.call(setBlockTypeCommand.key, { nodeType: paragraphSchema.type(ctx) })
    else commands.call(setBlockTypeCommand.key, { nodeType: headingSchema.type(ctx), attrs: { level: action.heading } })
    return
  }
  switch (action) {
    case 'bold': commands.call(toggleStrongCommand.key); return
    case 'italic': commands.call(toggleEmphasisCommand.key); return
    case 'strike': commands.call(toggleStrikethroughCommand.key); return
    case 'code': {
      const markType = inlineCodeSchema.type(ctx)
      if (!view.state.selection.empty) { commands.call(toggleInlineCodeCommand.key); return }
      view.dispatch(isMarkActive(ctx, markType) ? view.state.tr.removeStoredMark(markType) : view.state.tr.addStoredMark(markType.create()))
      return
    }
    case 'link': {
      const markType = linkSchema.type(ctx)
      if (view.state.selection.empty && isMarkActive(ctx, markType)) { view.dispatch(view.state.tr.removeStoredMark(markType)); return }
      commands.call(toggleLinkCommand.key)
      return
    }
    case 'bulletList': case 'orderedList': case 'taskList': toggleList(ctx, action); return
    case 'table': {
      const { from } = view.state.selection
      commands.call(addBlockTypeCommand.key, { nodeType: createTable(ctx, 3, 3) })
      commands.call(selectTextNearPosCommand.key, { pos: from })
      return
    }
    case 'codeBlock': {
      const inCode = view.state.selection.$from.parent.type === codeBlockSchema.type(ctx)
      commands.call(setBlockTypeCommand.key, { nodeType: (inCode ? paragraphSchema : codeBlockSchema).type(ctx) })
      return
    }
    case 'quote': toggleQuote(ctx); return
    case 'divider': commands.call(addBlockTypeCommand.key, { nodeType: hrSchema.type(ctx) }); return
    case 'undo': commands.call(undoCommand.key); return
    case 'redo': commands.call(redoCommand.key); return
  }
}

const sameFormat = (a: RichFormatState, b: RichFormatState) =>
  (Object.keys(a) as Array<keyof RichFormatState>).every((key) => a[key] === b[key])

/** Keep the persisted body as Markdown; node views only change how its images are displayed. */
export function createPostRichEditor(options: {
  root: HTMLElement
  value: string
  label: string
  onChange: (markdown: string) => void
  onMediaViewsChange: (views: PostEditorMediaView[]) => void
  onFormatChange: (state: RichFormatState) => void
  onUnsupportedUpload: () => void
}) {
  let markdown = options.value
  let format = EMPTY_FORMAT_STATE
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
    // "- item" is what most Markdown files (and people) write; remark's default would turn every list into "* item".
    ctx.update(remarkStringifyOptionsCtx, (previous) => ({ ...previous, bullet: '-' as const }))
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
        if (!ready || disposed) return
        if (!view.state.selection.eq(previous.selection) || view.state.storedMarks !== previous.storedMarks || !view.state.doc.eq(previous.doc)) {
          const next = readFormatState(ctx)
          if (!sameFormat(next, format)) {
            format = next
            options.onFormatChange(next)
          }
        }
        if (replacing || view.state.doc.eq(previous.doc)) return
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
    focus() {
      if (ready) crepe.editor.action((ctx) => ctx.get(editorViewCtx).focus())
    },
    format(action: RichFormatAction) {
      if (!ready) return
      crepe.editor.action((ctx) => {
        runFormat(ctx, action)
        ctx.get(editorViewCtx).focus()
      })
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
