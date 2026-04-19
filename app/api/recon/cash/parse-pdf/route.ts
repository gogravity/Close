import { NextResponse } from "next/server";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { PDFParse } from "pdf-parse";
import { extractStatementFromText, AnthropicConfigError } from "@/lib/anthropic";
import { scrubBankStatement } from "@/lib/scrubber";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const UPLOADS_DIR = path.join(process.cwd(), ".data", "statements");

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    const bcAccountNumber = String(form.get("bcAccountNumber") ?? "");
    if (!(file instanceof File)) {
      return NextResponse.json({ ok: false, error: "Missing PDF file" }, { status: 400 });
    }
    if (!file.type || !file.type.includes("pdf")) {
      return NextResponse.json(
        { ok: false, error: `Expected a PDF, got '${file.type}'` },
        { status: 400 }
      );
    }
    const buf = Buffer.from(await file.arrayBuffer());

    // Persist the raw upload locally for the user's own review (never sent anywhere).
    await mkdir(UPLOADS_DIR, { recursive: true });
    const id = randomBytes(8).toString("hex");
    const savedName = `${bcAccountNumber || "unknown"}-${id}.pdf`;
    await writeFile(path.join(UPLOADS_DIR, savedName), buf, { mode: 0o600 });

    // Local text extraction — PDF bytes never leave this host.
    // pdfjs (inside pdf-parse) wants a worker source; Turbopack can't resolve
    // the bundled one from the server chunk, so point it at the file on disk.
    const workerSrc = path.join(
      process.cwd(),
      "node_modules/pdf-parse/dist/pdf-parse/esm/pdf.worker.mjs"
    );
    PDFParse.setWorker(workerSrc);

    const parser = new PDFParse({ data: new Uint8Array(buf) });
    let rawText = "";
    let pageCount = 0;
    try {
      const textResult = await parser.getText();
      rawText = textResult.text ?? "";
      pageCount = textResult.pages?.length ?? 0;
    } finally {
      await parser.destroy();
    }

    // Scrub PII locally before anything goes to Claude.
    const { scrubbed, redactions, preservedAccountLast4 } = scrubBankStatement(rawText);

    // Send only the scrubbed text to Anthropic.
    const extraction = await extractStatementFromText(scrubbed);

    return NextResponse.json({
      ok: true,
      extraction,
      scrubReport: {
        redactions,
        preservedAccountLast4,
        pagesExtracted: pageCount,
        charactersSent: scrubbed.length,
      },
      fileId: id,
      filename: savedName,
      pdfUrl: `/api/recon/cash/statement/${id}`,
    });
  } catch (err) {
    if (err instanceof AnthropicConfigError) {
      return NextResponse.json(
        { ok: false, error: err.message, needsConfig: "anthropic" },
        { status: 200 }
      );
    }
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 }
    );
  }
}
