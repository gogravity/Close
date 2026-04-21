import { NextResponse } from "next/server";
import { ConnectWiseError, closeCwInvoice } from "@/lib/connectwise";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const b = body as Record<string, unknown>;

  if (b.action === "close") {
    const ids = b.invoiceIds;
    if (!Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json(
        { ok: false, error: "invoiceIds must be a non-empty array" },
        { status: 400 }
      );
    }

    const results: { id: number; ok: boolean; error?: string }[] = [];

    for (const id of ids) {
      if (typeof id !== "number") {
        results.push({ id: id as number, ok: false, error: "Invalid id type" });
        continue;
      }
      try {
        await closeCwInvoice(id);
        results.push({ id, ok: true });
      } catch (err) {
        const msg =
          err instanceof ConnectWiseError
            ? `CW ${err.status}: ${err.message}`
            : (err as Error).message;
        results.push({ id, ok: false, error: msg });
      }
    }

    const allOk = results.every((r) => r.ok);
    return NextResponse.json({ ok: allOk, results });
  }

  return NextResponse.json({ ok: false, error: `Unknown action: ${b.action}` }, { status: 400 });
}
