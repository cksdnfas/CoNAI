import fs from 'fs'
import path from 'path'
import { Worker } from 'worker_threads'

export const DOCUMENT_EXTENSIONS = new Set(['.pdf', '.xlsx'])
export const MAX_EXTRACTED_CHARS = 8_000_000
export type DocumentSection = { start: number; end: number; textStart: number; textEnd: number; label: string }
export type ExtractedDocument = { body: string; state: 'ready' | 'partial' | 'empty' | 'unsupported' | 'error'; note: string | null; sections: DocumentSection[]; retryable?: boolean }

// Parsing untrusted documents must not block the API thread. One bounded worker at a time, no macros,
// formula evaluation, external links, or OCR. Errors are deliberately generic (no server paths).
const WORKER = String.raw`
const { parentPort, workerData: w } = require('node:worker_threads');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
(async () => {
  let body = '', partial = false, emptyPages = 0, textPosition = 0;
  const sections = [];
  function add(label, text) {
    if (!text.trim()) return;
    const value = '[' + label + ']\n' + text + '\n\n';
    const start = body.length;
    const remaining = w.maxChars - start;
    if (value.length > remaining) partial = true;
    const added = value.slice(0, Math.max(0, remaining));
    const textStart = textPosition;
    for (const char of added) textPosition++;
    body += added;
    sections.push({ start, end: body.length, textStart, textEnd: textPosition, label });
  }
  if (w.ext === '.pdf') {
    const pdfjs = await import(pathToFileURL(w.pdf).href);
    const task = pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(w.file)),
      useSystemFonts: false, disableFontFace: true, cMapUrl: w.pdfRoot + '/cmaps/', cMapPacked: true,
      standardFontDataUrl: w.pdfRoot + '/standard_fonts/', verbosity: 0 });
    try {
      const doc = await task.promise;
      for (let n = 1; n <= doc.numPages; n++) {
        if (body.length >= w.maxChars) { partial = true; break; }
        const page = await doc.getPage(n);
        const text = (await page.getTextContent()).items.map(i => typeof i.str === 'string' ? i.str + (i.hasEOL ? '\n' : ' ') : '').join('').trim();
        if (!text) emptyPages++;
        add('Page ' + n, text);
        page.cleanup();
      }
    } finally { await task.destroy(); }
  } else {
    const readExcel = require(w.excel);
    const sheets = await readExcel(w.file, { trim: false });
    function column(n) {
      let label = '';
      for (n++; n > 0; n = Math.floor((n - 1) / 26)) label = String.fromCharCode(65 + (n - 1) % 26) + label;
      return label;
    }
    outer: for (const sheet of sheets) {
      // Retain exact upper-cell references, not guessed column semantics. This keeps labels/units
      // next to later cell values even when a long sheet is split into embedding windows.
      const top = sheet.data.map((row, index) => ({ row, index })).filter(x => x.row.some(v => v != null && String(v).trim())).slice(0, 3);
      for (const [index, row] of sheet.data.entries()) {
        if (body.length >= w.maxChars) { partial = true; break outer; }
        const cells = row.flatMap((value, col) => {
          if (value == null) return [];
          const refs = top.filter(x => x.index < index && typeof x.row[col] === 'string' && x.row[col].trim())
            .map(x => column(col) + (x.index + 1) + '=' + x.row[col].trim().slice(0, 120));
          const context = refs.length ? ' (top cells: ' + refs.join('; ') + ')' : '';
          return [column(col) + (index + 1) + ': ' + (value instanceof Date ? value.toISOString() : String(value)) + context];
        });
        add('Sheet ' + sheet.sheet + ' / Row ' + (index + 1), cells.join('\t'));
      }
    }
  }
  parentPort.postMessage({ body, sections, state: partial || (body && emptyPages) ? 'partial' : body ? 'ready' : 'empty',
    note: partial ? 'Text extraction reached the 8,000,000-character limit.' : emptyPages ? 'Some PDF pages have no extractable text; OCR is not enabled.' : !body ? 'No extractable text (a scanned PDF may need OCR).' : w.ext === '.xlsx' ? 'Stored cell values only; formulas are not recalculated and missing cached results are omitted.' : null });
})().catch(() => parentPort.postMessage({ body: '', sections: [], state: 'error', retryable: false, note: 'Document extraction failed: the file may be encrypted, damaged, or unsupported.' }));
`

let queue: Promise<unknown> = Promise.resolve()
export function extractDocument(file: string, name: string): Promise<ExtractedDocument> {
  const run = queue.then(async (): Promise<ExtractedDocument> => {
    if ((await fs.promises.stat(file)).size > 64 * 1024 * 1024) return { body: '', sections: [], state: 'error', retryable: false, note: 'Document exceeds the 64 MB extraction limit.' }
    return new Promise((resolve) => {
      const worker = new Worker(WORKER, { eval: true, resourceLimits: { maxOldGenerationSizeMb: 512 }, workerData: {
        file, ext: path.extname(name).toLowerCase(), maxChars: MAX_EXTRACTED_CHARS,
        pdf: require.resolve('pdfjs-dist/legacy/build/pdf.mjs'), pdfRoot: path.dirname(require.resolve('pdfjs-dist/package.json')),
        excel: require.resolve('read-excel-file/node'),
      } })
      let settled = false
      const finish = (result: ExtractedDocument) => { if (settled) return; settled = true; clearTimeout(timer); resolve(result); void worker.terminate() }
      const failure = () => finish({ body: '', sections: [], state: 'error', retryable: true, note: 'Document extraction exceeded its time or memory budget, or could not read the file.' })
      const timer = setTimeout(failure, 60_000)
      worker.once('message', finish)
      worker.once('error', failure)
      worker.once('exit', (code) => { if (code !== 0) failure() })
    })
  }).catch((): ExtractedDocument => ({ body: '', sections: [], state: 'error', retryable: true, note: 'Document could not be read.' }))
  queue = run.catch(() => undefined)
  return run
}
