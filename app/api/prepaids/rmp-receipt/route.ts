import { NextResponse } from "next/server";
import {
  searchTransactionsByAmount,
  fetchReceiptFile,
  RampError,
} from "@/lib/ramp";

export const dynamic = "force-dynamic";

/**
 * Given an amount + posting date, finds the matching Ramp transaction and
 * streams its first attached receipt back as a PDF. Used by the Prepaids
 * candidate table so the user can click a BC "RMP" document number and open
 * the receipt directly.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const amount = parseFloat(url.searchParams.get("amount") ?? "");
  const date = url.searchParams.get("date") ?? "";
  if (!isFinite(amount) || !date) {
    return NextResponse.json(
      { ok: false, error: "Missing amount or date" },
      { status: 400 }
    );
  }
  try {
    const search = await searchTransactionsByAmount(amount, date);
    const withReceipt = search.transactions.find(
      (t) => t.receipts && t.receipts.length > 0
    );
    if (!withReceipt) {
      return htmlMessage(
        "No receipt found",
        search.transactions.length === 0
          ? "No Ramp transaction matched this amount and date window (7-day lookback)."
          : "Found a matching Ramp transaction, but no receipt is attached to it."
      );
    }
    const receiptId = withReceipt.receipts![0];
    const { buf, contentType } = await fetchReceiptFile(receiptId);
    return new Response(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `inline; filename="ramp-receipt-${receiptId}.pdf"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    if (err instanceof RampError) {
      const body = err.body as { error_v2?: { message?: string } } | undefined;
      const msg = body?.error_v2?.message ?? err.message;
      const isScopeError = /scopes? (are )?not allowed|receipts:read/i.test(msg);
      if (isScopeError) {
        return htmlMessage(
          "Ramp receipts:read scope is not enabled",
          "Your Ramp OAuth application needs the 'Receipts: Read' scope enabled. " +
            "In Ramp, go to Developer → Applications → [your app] → Scopes, " +
            "enable Receipts: Read, and save. Then click the link again."
        );
      }
      return htmlMessage(`Ramp ${err.status}`, msg);
    }
    return htmlMessage("Error", (err as Error).message);
  }
}

function htmlMessage(title: string, detail: string) {
  return new Response(
    `<!doctype html><html><body style="font:14px system-ui;padding:40px;max-width:640px;margin:auto">
      <h1 style="color:#b91c1c">${escapeHtml(title)}</h1>
      <p style="color:#334155">${escapeHtml(detail)}</p>
      <p style="color:#64748b;font-size:12px">Close this tab and try a different row, or fix the issue above and retry.</p>
    </body></html>`,
    { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
