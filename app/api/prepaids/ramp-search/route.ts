import { NextResponse } from "next/server";
import { searchTransactionsByAmount, RampError } from "@/lib/ramp";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const amount = parseFloat(url.searchParams.get("amount") ?? "");
  const postingDate = url.searchParams.get("date") ?? "";
  if (!isFinite(amount) || !postingDate) {
    return NextResponse.json(
      { ok: false, error: "Missing amount or date" },
      { status: 400 }
    );
  }
  try {
    const result = await searchTransactionsByAmount(amount, postingDate);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof RampError) {
      return NextResponse.json(
        { ok: false, error: err.message, status: err.status, body: err.body },
        { status: 200 }
      );
    }
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 200 }
    );
  }
}
