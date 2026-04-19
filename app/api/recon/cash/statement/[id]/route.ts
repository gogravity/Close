import { NextResponse } from "next/server";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const UPLOADS_DIR = path.join(process.cwd(), ".data", "statements");

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!/^[a-f0-9]+$/i.test(id)) {
    return NextResponse.json({ error: "bad id" }, { status: 400 });
  }
  try {
    const files = await readdir(UPLOADS_DIR);
    const match = files.find((f) => f.includes(id) && f.endsWith(".pdf"));
    if (!match) return NextResponse.json({ error: "not found" }, { status: 404 });
    const buf = await readFile(path.join(UPLOADS_DIR, match));
    return new Response(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${match}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
}
