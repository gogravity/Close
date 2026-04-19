import { NextResponse } from "next/server";
import { BusinessCentralError } from "@/lib/businessCentral";
import { computePlComparison } from "@/lib/plComparison";

export const dynamic = "force-dynamic";

function validMonth(val: unknown): string | null {
  if (typeof val !== "string") return null;
  const m = /^(\d{4})-(\d{2})$/.exec(val.trim());
  if (!m) return null;
  const mm = Number(m[2]);
  if (mm < 1 || mm > 12) return null;
  return `${m[1]}-${m[2]}`;
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }
  const b = body as Record<string, unknown>;
  const endMonth = validMonth(b?.endMonth);
  if (!endMonth) {
    return NextResponse.json(
      { ok: false, error: "endMonth required as YYYY-MM string" },
      { status: 400 }
    );
  }
  const absolute =
    typeof b?.thresholdAbsolute === "number" ? b.thresholdAbsolute : 500;
  const pct = typeof b?.thresholdPct === "number" ? b.thresholdPct : 0.2;
  const serviceTypes = Array.isArray(b?.serviceTypes)
    ? (b.serviceTypes as unknown[]).filter((x): x is string => typeof x === "string")
    : null;

  try {
    const result = await computePlComparison(endMonth, {
      threshold: { absolute, pct },
      serviceTypes,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof BusinessCentralError) {
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
