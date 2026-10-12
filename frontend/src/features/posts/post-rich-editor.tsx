import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react'
import { createPortal } from 'react-dom'
import { blockEdit } from '@milkdown/crepe/feature/block-edit'
import { cursor } from '@milkdown/crepe/feature/cursor'
import { linkTooltip } from '@milkdown/crepe/feature/link-tooltip'
import { listItem } from '@milkdown/crepe/feature/list-item'
import { placeholder } from '@milkdown/crepe/feature/placeholder'
import { table } from '@milkdown/crepe/feature/table'
import { toolbar } from '@milkdown/crepe/feature/toolbar'
import { topBar } from '@milkdown/crepe/feature/top-bar'
import { LoadingState } from '@/components/ui/loading-state'
import { useI18n } from '@/i18n'
import { PostEmbedImage } from './post-markdown'
import { createPostRichEditor, type PostEditorMediaView, type PostRichEditorEngine } from './post-rich-editor-engine'
import './post-rich-editor.css'

export type PostRichEditorHandle = { insertMarkdown: (markdown: string) => boolean }

export function PostRichEditor({ value, onChange, onError, onUnsupportedUpload, ref }: {
  value: string
  onChange: (markdown: string) => void
  onError: (error: unknown) => void
  onUnsupportedUpload: () => void
  ref?: Ref<PostRichEditorHandle>
}) {
  const { t } = useI18n()
  const host = useRef<HTMLDivElement>(null)
  const engine = useRef<PostRichEditorEngine | null>(null)
  const latest = useRef({ value, onChange, onError, onUnsupportedUpload, t })
  latest.current = { value, onChange, onError, onUnsupportedUpload, t }
  const [ready, setReady] = useState(false)
  const [media, setMedia] = useState<PostEditorMediaView[]>([])

  useImperativeHandle(ref, () => ({
    insertMarkdown: (markdown) => engine.current?.insertMarkdown(markdown) ?? false,
  }), [])

  useEffect(() => {
    // Each mount owns its DOM, including during StrictMode's async cleanup.
    const root = document.createElement('div')
    host.current!.append(root)
    let cancelled = false
    const translate = latest.current.t
    const instance = createPostRichEditor({
      root,
      value: latest.current.value,
      label: translate({ ko: '본문', en: 'Body' }),
      onChange: (markdown) => latest.current.onChange(markdown),
      onMediaViewsChange: (views) => { if (!cancelled) setMedia(views) },
      onUnsupportedUpload: () => latest.current.onUnsupportedUpload(),
    })
    instance.crepe
      .addFeature(cursor, { virtual: false })
      .addFeature(listItem)
      .addFeature(linkTooltip, { inputPlaceholder: translate({ ko: '링크 주소', en: 'Link URL' }) })
      .addFeature(placeholder, { text: translate({ ko: '글을 쓰거나 / 를 눌러 서식을 선택해.', en: 'Write, or type / to choose a format.' }), mode: 'doc' })
      .addFeature(table)
      .addFeature(toolbar, {
        boldLabel: translate({ ko: '굵게', en: 'Bold' }),
        italicLabel: translate({ ko: '기울임', en: 'Italic' }),
        codeLabel: translate({ ko: '코드', en: 'Code' }),
        linkLabel: translate({ ko: '링크', en: 'Link' }),
        strikethroughLabel: translate({ ko: '취소선', en: 'Strikethrough' }),
      })
      .addFeature(topBar, {
        headingOptions: [
          { label: translate({ ko: '본문', en: 'Paragraph' }), level: null },
          ...[1, 2, 3, 4, 5, 6].map((level) => ({ label: translate({ ko: '제목 {level}', en: 'Heading {level}' }, { level }), level })),
        ],
      })
      .addFeature(blockEdit, {
        textGroup: {
          label: translate({ ko: '텍스트', en: 'Text' }),
          text: { label: translate({ ko: '본문', en: 'Paragraph' }) },
          h1: { label: translate({ ko: '제목 1', en: 'Heading 1' }) },
          h2: { label: translate({ ko: '제목 2', en: 'Heading 2' }) },
          h3: { label: translate({ ko: '제목 3', en: 'Heading 3' }) },
          h4: { label: translate({ ko: '제목 4', en: 'Heading 4' }) },
          h5: { label: translate({ ko: '제목 5', en: 'Heading 5' }) },
          h6: { label: translate({ ko: '제목 6', en: 'Heading 6' }) },
          quote: { label: translate({ ko: '인용', en: 'Quote' }) },
          divider: { label: translate({ ko: '구분선', en: 'Divider' }) },
        },
        listGroup: {
          label: translate({ ko: '목록', en: 'Lists' }),
          bulletList: { label: translate({ ko: '글머리 목록', en: 'Bullet list' }) },
          orderedList: { label: translate({ ko: '번호 목록', en: 'Ordered list' }) },
          taskList: { label: translate({ ko: '체크 목록', en: 'Task list' }) },
        },
        advancedGroup: {
          label: translate({ ko: '블록', en: 'Blocks' }),
          codeBlock: { label: translate({ ko: '코드 블록', en: 'Code block' }) },
          table: { label: translate({ ko: '표', en: 'Table' }) },
        },
      })

    const created = instance.create().then(() => {
      if (cancelled) return
      instance.setMarkdown(latest.current.value)
      engine.current = instance
      setReady(true)
    }).catch((error: unknown) => { if (!cancelled) latest.current.onError(error) })

    return () => {
      cancelled = true
      engine.current = null
      root.remove()
      void created.then(() => instance.destroy()).catch((error: unknown) => console.error('Post editor cleanup failed', error))
    }
  }, [])

  useEffect(() => {
    try { engine.current?.setMarkdown(value) }
    catch (error) { latest.current.onError(error) }
  }, [value])

  return (
    <div className="post-rich-editor min-h-[22rem]">
      {!ready ? <LoadingState /> : null}
      <div ref={host} />
      {media.map(({ id, dom, src, alt }) => createPortal(<PostEmbedImage src={src} alt={alt} />, dom, String(id)))}
    </div>
  )
}
