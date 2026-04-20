import { NextResponse } from "next/server";
import { ConnectWiseError } from "@/lib/connectwise";
import { computePayroll, type PayPeriodHalf } from "@/lib/payroll";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }
  const b = body as Record<string, unknown>;
  const year = typeof b?.year === "number" ? b.year : NaN;
  const month = typeof b?.month === "number" ? b.month : NaN;
  const half = b?.half === "first" || b?.half === "second" ? (b.half as PayPeriodHalf) : null;
  if (
    !Number.isInteger(year) ||
    year < 2000 ||
    year > 2100 ||
    !Number.isInteger(month) ||
    month < 1 ||
    month > 12 ||
    !half
  ) {
    return NextResponse.json(
      {
        ok: false,
        error: "year (int), month (1-12), half ('first'|'second') required",
      },
      { status: 400 }
    );
  }

  // Excluded companies: plain string array.
  const excludeCompanies = Array.isArray(b?.excludeCompanies)
    ? (b.excludeCompanies as unknown[]).filter(
        (x): x is string => typeof x === "string" && x.trim().length > 0
      )
    : [];

  try {
    const result = await computePayroll(
      { year, month, half },
      { excludeCompanies }
    );
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof ConnectWiseError) {
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
