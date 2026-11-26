/**
 * @license
 * Copyright 2025 BrowserOS
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

/**
 * BOS-3: text out of PDF and Word files, in the browser, so a single document
 * can be attached in the chat. The agents only take images and text, so a
 * document travels as its text.
 */

import { unzipSync } from 'fflate'

export const PDF_MEDIA_TYPE = 'application/pdf'
export const DOCX_MEDIA_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

export type DocumentKind = 'pdf' | 'docx'

/** Which document a file is, by its type or, when the type is missing, its name. */
export function documentKindOf(file: {
  type: string
  name: string
}): DocumentKind | null {
  const name = file.name.toLowerCase()
  if (file.type === PDF_MEDIA_TYPE || name.endsWith('.pdf')) return 'pdf'
  if (file.type === DOCX_MEDIA_TYPE || name.endsWith('.docx')) return 'docx'
  return null
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
}

function decodeEntities(text: string): string {
  return text.replace(
    /&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,
    (match, code: string) => {
      if (code[0] === '#') {
        const value =
          code[1] === 'x' || code[1] === 'X'
            ? Number.parseInt(code.slice(2), 16)
            : Number.parseInt(code.slice(1), 10)
        return Number.isFinite(value) ? String.fromCodePoint(value) : match
      }
      return ENTITIES[code.toLowerCase()] ?? match
    },
  )
}

/** The words of a .docx: paragraphs as lines, tabs and breaks kept. */
export function extractDocxText(bytes: Uint8Array): string {
  const files = unzipSync(bytes, {
    filter: (file) => file.name === 'word/document.xml',
  })
  const xml = files['word/document.xml']
  if (!xml) throw new Error('This Word file has no document text.')
  const body = new TextDecoder().decode(xml)
  const text = body
    .replace(/<w:tab\/>/g, '\t')
    .replace(/<w:(br|cr)\b[^>]*\/>/g, '\n')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<[^>]+>/g, '')
  return decodeEntities(text)
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

type PdfJs = typeof import('pdfjs-dist')

let pdfjs: Promise<PdfJs> | null = null

/** pdf.js, loaded on first use so the side panel does not pay for it at startup. */
function loadPdfJs(): Promise<PdfJs> {
  pdfjs ??= (async () => {
    const lib = await import('pdfjs-dist')
    if (typeof window !== 'undefined' && !lib.GlobalWorkerOptions.workerSrc) {
      const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
      lib.GlobalWorkerOptions.workerSrc = worker.default
    }
    return lib
  })()
  return pdfjs
}

/** The words of a PDF, page by page. Scanned pages have no words and come back empty. */
export async function extractPdfText(
  bytes: Uint8Array,
  lib?: PdfJs,
): Promise<string> {
  const pdf = await (lib ?? (await loadPdfJs())).getDocument({
    data: bytes,
    isEvalSupported: false,
  }).promise
  const pages: string[] = []
  for (let number = 1; number <= pdf.numPages; number += 1) {
    const page = await pdf.getPage(number)
    const content = await page.getTextContent()
    let line = ''
    for (const item of content.items) {
      if (!('str' in item)) continue
      line += item.str
      if (item.hasEOL) line += '\n'
      else if (item.str && !line.endsWith(' ')) line += ' '
    }
    pages.push(line.replace(/[ \t]+\n/g, '\n').trim())
  }
  await pdf.destroy()
  return pages
    .map((text, index) => `--- Page ${index + 1} ---\n${text}`)
    .join('\n\n')
    .trim()
}

/** A document's text, labelled with its name so the agent knows what it is reading. */
export async function extractDocumentText(
  file: File,
  kind: DocumentKind,
): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const text =
    kind === 'pdf' ? await extractPdfText(bytes) : extractDocxText(bytes)
  if (!text.replace(/--- Page \d+ ---/g, '').trim()) {
    throw new Error(
      `"${file.name}" has no text that can be read (it may be a scanned image).`,
    )
  }
  return `Attached file: ${file.name}\n\n${text}`
}
