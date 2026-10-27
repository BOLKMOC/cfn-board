// Text out of a document a manager adds to the Coach library on the Staff page: PDF (pdf.js, in the browser), Word .docx (unzipped here),
// or plain text and Markdown. Runs on the manager's device; only the text is sent, and only when they tap Save.

// Pieces of a .docx are deflate-compressed zip entries; the browser's DecompressionStream unpacks them.
async function inflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// One file out of a zip, by name, read from the central directory (sizes there are reliable).
export async function unzipEntry(buf, name) {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let end = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (v.getUint32(i, true) === 0x06054b50) { end = i; break; }
  if (end < 0) throw new Error("not a zip file");
  let p = v.getUint32(end + 16, true);
  const count = v.getUint16(end + 10, true), dec = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (v.getUint32(p, true) !== 0x02014b50) break;
    const method = v.getUint16(p + 10, true), size = v.getUint32(p + 20, true);
    const nameLen = v.getUint16(p + 28, true), extra = v.getUint16(p + 30, true), comment = v.getUint16(p + 32, true), local = v.getUint32(p + 42, true);
    const entry = dec.decode(buf.subarray(p + 46, p + 46 + nameLen));
    if (entry === name) {
      const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true), data = buf.subarray(start, start + size);
      if (method === 0) return data;
      if (method === 8) return await inflate(data);
      throw new Error("unsupported zip compression");
    }
    p += 46 + nameLen + extra + comment;
  }
  return null;
}

const unescape = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, "&");

// Word's document.xml to plain text: one line per paragraph, headings marked with #, list items with "- ", table cells split by " | ".
export function docxXmlToText(xml) {
  const lines = [];
  for (const para of xml.split(/<\/w:p>/)) {
    const style = /<w:pStyle w:val="([^"]+)"/.exec(para)?.[1] ?? "";
    const text = unescape([...para.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\/>|<w:br\/>|<\/w:tc>/g)]
      .map((m) => m[1] ?? (m[0] === "<w:tab/>" ? "\t" : m[0] === "<w:br/>" ? "\n" : " | ")).join("")).replace(/( \| )+$/, "").trim();
    if (!text) { if (lines.length && lines[lines.length - 1] !== "") lines.push(""); continue; }
    const h = /^(?:Heading|Title)(\d?)/i.exec(style);
    lines.push(h ? `${"#".repeat(Math.min(3, Number(h[1] || 1)))} ${text}` : /<w:numPr>/.test(para) ? `- ${text}` : text);
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export async function docxToText(bytes) {
  const xml = await unzipEntry(bytes, "word/document.xml");
  if (!xml) throw new Error("This Word file has no document text.");
  return docxXmlToText(new TextDecoder().decode(xml));
}

// pdf.js text items to lines (same row = same line), pages separated by a blank line.
export function pdfItemsToText(pages) {
  return pages.map((items) => {
    const rows = [];
    for (const it of items) {
      if (!String(it.str ?? "").trim()) continue;
      const y = it.transform?.[5] ?? 0, x = it.transform?.[4] ?? 0;
      let row = rows.find((r) => Math.abs(r.y - y) <= 2);
      if (!row) rows.push(row = { y, parts: [] });
      row.parts.push({ x, s: it.str });
    }
    return rows.sort((a, b) => b.y - a.y).map((r) => r.parts.sort((a, b) => a.x - b.x).map((p) => p.s).join(" ").replace(/\s+/g, " ").trim()).join("\n");
  }).join("\n\n").trim();
}

// The text of a file the manager picked. Throws a plain-English error when it can't be read.
export async function textFromFile(file) {
  const name = file.name.toLowerCase(), bytes = new Uint8Array(await file.arrayBuffer());
  if (name.endsWith(".pdf")) {
    const pdfjs = await import("./vendor/pdf.min.mjs");
    pdfjs.GlobalWorkerOptions.workerSrc = "vendor/pdf.worker.min.mjs";
    const doc = await pdfjs.getDocument({ data: bytes, isEvalSupported: false, disableFontFace: true }).promise;
    const pages = [];
    for (let p = 1; p <= Math.min(doc.numPages, 300); p++) pages.push((await (await doc.getPage(p)).getTextContent()).items);
    await doc.destroy();
    const text = pdfItemsToText(pages);
    if (text.replace(/\s/g, "").length < 50) throw new Error("This PDF has no readable text (it may be a scan). Export it as Word or text instead.");
    return text;
  }
  if (name.endsWith(".docx")) return await docxToText(bytes);
  if (name.endsWith(".doc")) throw new Error("Old .doc files can't be read. Open it in Word and save as .docx or PDF.");
  if (/\.(txt|md|markdown|csv)$/.test(name)) return new TextDecoder().decode(bytes).trim();
  throw new Error("Use a PDF, a Word .docx, or a text file.");
}
