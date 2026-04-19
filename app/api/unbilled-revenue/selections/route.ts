import { NextResponse } from "next/server";
import { writeSelections } from "@/lib/unbilledRevenue";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }
  const b = body as Record<string, unknown>;
  const periodKey = typeof b?.periodKey === "string" ? b.periodKey : "";
  if (!/^\d{4}-\d{2}$/.test(periodKey)) {
    return NextResponse.json(
      { ok: false, error: "periodKey required as YYYY-MM" },
      { status: 400 }
    );
  }
  const selections = b?.selections;
  if (!selections || typeof selections !== "object" || Array.isArray(selections)) {
    return NextResponse.json(
      { ok: false, error: "selections must be an object keyed by row id" },
      { status: 400 }
    );
  }
  const clean: Record<string, { pct: number }> = {};
  for (const [k, v] of Object.entries(selections as Record<string, unknown>)) {
    if (!v || typeof v !== "object") continue;
    const pctRaw = (v as { pct?: unknown }).pct;
    const pct = typeof pctRaw === "number" ? pctRaw : 100;
    const clamped = Math.max(0, Math.min(100, Math.round(pct)));
    clean[k] = { pct: clamped };
  }
  try {
    const savedAt = await writeSelections(periodKey, clean);
    return NextResponse.json({ ok: true, savedAt, savedCount: Object.keys(clean).length });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 }
    );
  }
}
