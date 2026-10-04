import { useEffect, useState } from 'react'
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy, type RenderTask } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { ChevronLeft, ChevronRight, File } from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'
import { IconButton } from '@/components/ui/icon-button'
import { LoadingState } from '@/components/ui/loading-state'
import { useI18n } from '@/i18n'

GlobalWorkerOptions.workerSrc = workerUrl
const resources = import.meta.glob<string>('@pdfjs/{cmaps,standard_fonts,wasm}/*.{bcmap,pfb,ttf,wasm}', { eager: true, query: '?url', import: 'default' })
const resourceUrls = new Map(Object.entries(resources).map(([path, url]) => [path.split('/').at(-1), url]))
class PdfBinaryDataFactory {
  async fetch({ filename }: { filename: string }) {
    const url = resourceUrls.get(filename)
    if (!url) throw new Error('Missing PDF resource')
    const response = await fetch(url)
    if (!response.ok) throw new Error('Could not load PDF resource')
    return new Uint8Array(await response.arrayBuffer())
  }
}

/** Raster pages in a script-free sandbox also work in webviews without a native PDF plugin. */
export default function FilePdfPreview({ url, name }: { url: string; name: string }) {
  const { t } = useI18n()
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null)
  const [pageNumber, setPageNumber] = useState(1)
  const [rendered, setRendered] = useState<{ page: number; image: string } | null>(null)
  const [error, setError] = useState(false)
  useEffect(() => {
    let disposed = false
    const task = getDocument({ url, withCredentials: true, disableAutoFetch: true, disableStream: true, isEvalSupported: false, enableXfa: false, maxImageSize: 16_000_000, canvasMaxAreaInBytes: 32_000_000, useWorkerFetch: false, BinaryDataFactory: PdfBinaryDataFactory })
    void task.promise.then((pdf) => { if (!disposed) setDocument(pdf) }, () => { if (!disposed) setError(true) })
    return () => { disposed = true; void task.destroy() }
  }, [url])
  useEffect(() => {
    if (!document) return
    let disposed = false
    let render: RenderTask | undefined
    void document.getPage(pageNumber).then(async (page) => {
      if (disposed) return
      const base = page.getViewport({ scale: 1 })
      const scale = Math.min(2, 1600 / base.width, 2400 / base.height)
      const viewport = page.getViewport({ scale })
      const canvas = window.document.createElement('canvas')
      canvas.width = Math.max(1, Math.ceil(viewport.width))
      canvas.height = Math.max(1, Math.ceil(viewport.height))
      render = page.render({ canvas, viewport })
      await render.promise
      if (!disposed) setRendered({ page: pageNumber, image: canvas.toDataURL('image/png') })
      canvas.width = canvas.height = 0
      page.cleanup()
    }).catch(() => { if (!disposed) setError(true) })
    return () => { disposed = true; render?.cancel() }
  }, [document, pageNumber])
  if (error) return <EmptyState icon={File} title={t({ ko: 'PDF를 읽지 못했어', en: 'Could not read this PDF' })} />
  return <div className="space-y-2">
    {rendered?.page === pageNumber ? <iframe title={name} sandbox="allow-same-origin" className="h-[60vh] w-full border-0" srcDoc={`<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"><style>body{margin:0;background:white}img{display:block;max-width:100%;margin:auto}</style><img alt="PDF" src="${rendered.image}">`} /> : <LoadingState />}
    {document ? <div className="flex items-center justify-center gap-2">
      <IconButton size="icon-sm" variant="ghost" label={t({ ko: '이전 페이지', en: 'Previous page' })} disabled={pageNumber <= 1} onClick={() => setPageNumber(pageNumber - 1)}><ChevronLeft /></IconButton>
      <span className="text-xs tabular-nums text-muted-foreground">{pageNumber} / {document.numPages}</span>
      <IconButton size="icon-sm" variant="ghost" label={t({ ko: '다음 페이지', en: 'Next page' })} disabled={pageNumber >= document.numPages} onClick={() => setPageNumber(pageNumber + 1)}><ChevronRight /></IconButton>
    </div> : null}
  </div>
}
