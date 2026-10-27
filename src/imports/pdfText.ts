import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

GlobalWorkerOptions.workerSrc = workerUrl

const MAX_PAGES = 20
const SAME_LINE_PT = 3

/** Reads a PDF's text as visual lines (top to bottom, left to right) so table rows stay together. */
export async function pdfLines(data: ArrayBuffer): Promise<string[]> {
  const task = getDocument({ data: new Uint8Array(data), enableXfa: false })
  const doc = await task.promise
  try {
    const lines: string[] = []
    for (let p = 1; p <= Math.min(doc.numPages, MAX_PAGES); p++) {
      const page = await doc.getPage(p)
      const { items } = await page.getTextContent()
      const pieces = items
        .flatMap((item) => ('str' in item && item.str.trim() ? [{ x: item.transform[4] as number, y: item.transform[5] as number, str: item.str }] : []))
        .sort((a, b) => b.y - a.y || a.x - b.x)

      let row: typeof pieces = []
      const flush = () => {
        if (row.length) lines.push(row.sort((a, b) => a.x - b.x).map((r) => r.str.trim()).join(' '))
        row = []
      }
      for (const piece of pieces) {
        if (row.length && Math.abs(row[0].y - piece.y) > SAME_LINE_PT) flush()
        row.push(piece)
      }
      flush()
      page.cleanup()
    }
    return lines
  } finally {
    await task.destroy()
  }
}
