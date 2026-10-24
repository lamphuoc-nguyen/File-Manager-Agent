import { openSync, readSync, closeSync, readFileSync, statSync } from 'fs';
import { extname } from 'path';
import { inflateRawSync } from 'zlib';
import { findSecret, sensitivePathReason } from './sensitive.js';

// Plain-text formats read directly.
const TEXT_EXTS = new Set([
  'txt', 'md', 'markdown', 'csv', 'tsv', 'log', 'json', 'xml', 'yaml', 'yml', 'ini', 'cfg', 'conf', 'toml', 'html', 'htm', 'rtf', 'tex', 'srt', 'vtt',
  'js', 'ts', 'tsx', 'jsx', 'py', 'java', 'c', 'cpp', 'h', 'cs', 'go', 'rs', 'rb', 'php', 'css', 'scss', 'sql', 'sh', 'ps1', 'bat', 'ipynb',
]);
// Office Open XML / OpenDocument files are zip archives of XML.
const ZIP_DOC_EXTS = new Set(['docx', 'pptx', 'xlsx', 'odt', 'odp', 'ods']);
const MAX_BINARY_DOC_BYTES = 50 * 1024 * 1024;

export const canExtract = (path: string) => {
  const ext = extname(path).slice(1).toLowerCase();
  return TEXT_EXTS.has(ext) || ZIP_DOC_EXTS.has(ext) || ext === 'pdf';
};

const tidy = (text: string, maxChars: number) => text.replace(/[ \t\f\v ]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim().slice(0, maxChars);

/**
 * Returns readable text from a document (first `maxChars` characters), or null for
 * unsupported, binary, encrypted, or unreadable files. Never throws.
 */
export async function extractText(path: string, maxChars = 1500): Promise<string | null> {
  const ext = extname(path).slice(1).toLowerCase();
  try {
    if (TEXT_EXTS.has(ext)) return readTextHead(path, maxChars);
    if (statSync(path).size > MAX_BINARY_DOC_BYTES) return null;
    if (ZIP_DOC_EXTS.has(ext)) return extractZipDoc(path, ext, maxChars);
    if (ext === 'pdf') return await extractPdf(path, maxChars);
  } catch { }
  return null;
}

/**
 * The only way file text may be read for the AI model: refuses sensitive files by name/location,
 * and refuses text that contains anything secret-looking (keys, passwords, tokens).
 */
export async function extractTextForAi(path: string, maxChars: number): Promise<{ text: string | null; blocked?: string }> {
  const byPath = sensitivePathReason(path);
  if (byPath) return { text: null, blocked: byPath };
  const text = await extractText(path, maxChars);
  const secret = text ? findSecret(text) : null;
  if (secret) return { text: null, blocked: `Contains what looks like a ${secret}` };
  return { text };
}

function readTextHead(path: string, maxChars: number): string | null {
  const fd = openSync(path, 'r');
  try {
    const buf = Buffer.alloc(Math.min(maxChars * 4, 256 * 1024));
    const n = readSync(fd, buf, 0, buf.length, 0);
    const head = buf.subarray(0, n);
    if (head.includes(0)) return null; // binary
    let text = head.toString('utf-8');
    if (path.toLowerCase().endsWith('.rtf')) text = text.replace(/\\[a-z]+-?\d* ?|[{}]/gi, ' ');
    if (/\.html?$/i.test(path)) text = text.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ');
    return tidy(text, maxChars) || null;
  } finally {
    closeSync(fd);
  }
}

// ===== Office documents =====
function extractZipDoc(path: string, ext: string, maxChars: number): string | null {
  const want: (name: string) => boolean = {
    docx: (n: string) => n === 'word/document.xml',
    pptx: (n: string) => /^ppt\/slides\/slide\d+\.xml$/.test(n),
    xlsx: (n: string) => n === 'xl/sharedStrings.xml',
  }[ext] ?? ((n: string) => n === 'content.xml'); // OpenDocument
  const entries = readZipEntries(readFileSync(path), want)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const text = entries.map(e => xmlToText(e.data.toString('utf-8'))).join('\n');
  return tidy(text, maxChars) || null;
}

function xmlToText(xml: string): string {
  return xml
    .replace(/<\/(w:p|a:p|text:p|text:h|si)>/g, '\n')
    .replace(/<(w:tab|text:tab)\/>/g, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, '&');
}

/** Minimal zip reader: walks the central directory and inflates the entries we want. */
function readZipEntries(buf: Buffer, want: (name: string) => boolean): { name: string; data: Buffer }[] {
  // End of central directory record is in the last 64 KB + 22 bytes.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return [];
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out: { name: string; data: Buffer }[] = [];
  for (let i = 0; i < count && p + 46 <= buf.length && buf.readUInt32LE(p) === 0x02014b50; i++) {
    const method = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf-8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (!want(name) || buf.readUInt32LE(localOffset) !== 0x04034b50) continue;
    const dataStart = localOffset + 30 + buf.readUInt16LE(localOffset + 26) + buf.readUInt16LE(localOffset + 28);
    const raw = buf.subarray(dataStart, dataStart + compressedSize);
    if (method === 0) out.push({ name, data: raw });
    else if (method === 8) out.push({ name, data: inflateRawSync(raw) });
  }
  return out;
}

// ===== PDF =====
const PDF_MAX_PAGES = 3;

async function extractPdf(path: string, maxChars: number): Promise<string | null> {
  const { getDocumentProxy } = await import('unpdf');
  // isEvalSupported: false — never compile font code from the PDF (CVE-2024-4367 class of issues).
  const pdf = await getDocumentProxy(new Uint8Array(readFileSync(path)), { isEvalSupported: false });
  try {
    const pages: string[] = [];
    for (let i = 1; i <= Math.min(pdf.numPages, PDF_MAX_PAGES); i++) {
      const content = await (await pdf.getPage(i)).getTextContent();
      pages.push(content.items.map((item: any) => ('str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : '')).join(''));
      if (pages.join('').length >= maxChars) break;
    }
    return tidy(pages.join('\n'), maxChars) || null;
  } finally {
    await pdf.destroy();
  }
}
