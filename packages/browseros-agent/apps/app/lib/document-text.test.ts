import { describe, expect, it } from 'bun:test'
import { strToU8, zipSync } from 'fflate'
import { stageAttachment } from './attachments'
import {
  DOCX_MEDIA_TYPE,
  documentKindOf,
  extractDocxText,
  extractPdfText,
} from './document-text'

function docx(paragraphs: string[]): Uint8Array<ArrayBuffer> {
  const body = paragraphs
    .map(
      (text) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`,
    )
    .join('')
  return new Uint8Array(
    zipSync({
      '[Content_Types].xml': strToU8('<Types/>'),
      'word/document.xml': strToU8(
        `<?xml version="1.0"?><w:document xmlns:w="w"><w:body>${body}</w:body></w:document>`,
      ),
    }),
  )
}

/** A one-page PDF with one line of text, with a correct cross-reference table. */
function pdf(text: string): Uint8Array {
  const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let out = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((body, index) => {
    offsets.push(out.length)
    out += `${index + 1} 0 obj\n${body}\nendobj\n`
  })
  const xref = out.length
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets) {
    out += `${String(offset).padStart(10, '0')} 00000 n \n`
  }
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
  return new TextEncoder().encode(out)
}

describe('document text (BOS-3)', () => {
  it('knows a PDF or Word file by type or by name', () => {
    expect(documentKindOf({ type: 'application/pdf', name: 'a' })).toBe('pdf')
    expect(documentKindOf({ type: '', name: 'Lease.PDF' })).toBe('pdf')
    expect(documentKindOf({ type: DOCX_MEDIA_TYPE, name: 'a' })).toBe('docx')
    expect(documentKindOf({ type: '', name: 'notes.docx' })).toBe('docx')
    expect(documentKindOf({ type: 'text/plain', name: 'a.txt' })).toBeNull()
  })

  it('reads the paragraphs of a Word file', () => {
    expect(extractDocxText(docx(['Hello &amp; welcome', 'Second line']))).toBe(
      'Hello & welcome\nSecond line',
    )
  })

  it('reads the words of a PDF', async () => {
    const lib = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const text = await extractPdfText(pdf('Check-in is at 4 PM'), lib as never)
    expect(text).toContain('--- Page 1 ---')
    expect(text).toContain('Check-in is at 4 PM')
  })

  it('stages a Word file as text the agent can read', async () => {
    const file = new File([docx(['Unit 5 lease'])], 'lease.docx', {
      type: DOCX_MEDIA_TYPE,
    })
    const result = await stageAttachment(file)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.attachment.mediaType).toBe('text/plain')
    expect(result.attachment.payload).toEqual({
      kind: 'file',
      mediaType: 'text/plain',
      name: 'lease.docx',
      text: 'Attached file: lease.docx\n\nUnit 5 lease',
    })
  })

  it('says plainly when a Word file has no text', async () => {
    const file = new File([docx([])], 'empty.docx', { type: DOCX_MEDIA_TYPE })
    const result = await stageAttachment(file)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.message).toContain('no text')
  })
})
