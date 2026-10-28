// Real PDFs with real text, served from localhost, so the download, parse,
// page-finding and subsetting code paths run unchanged in tests.
import { createServer, type Server } from "node:http";
import { PDFDocument, StandardFonts } from "pdf-lib";

export async function makePdf(pages: string[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const text of pages) {
    const page = doc.addPage([595, 842]);
    let y = 800;
    for (const line of text.split("\n")) {
      page.drawText(line.replace(/₹/g, "Rs."), { x: 40, y, size: 9, font });
      y -= 13;
      if (y < 40) break;
    }
  }
  return doc.save();
}

export async function servePdfs(files: Record<string, Uint8Array>): Promise<{ base: string; close: () => Promise<void> }> {
  const server: Server = createServer((req, res) => {
    const name = (req.url ?? "/").slice(1);
    const body = files[name];
    if (!body) { res.statusCode = 404; res.end("not found"); return; }
    res.setHeader("Content-Type", "application/pdf");
    res.end(Buffer.from(body));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  return { base: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(() => r())) };
}
