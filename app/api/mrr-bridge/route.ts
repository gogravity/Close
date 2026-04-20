import { NextResponse } from "next/server";
import { BusinessCentralError } from "@/lib/businessCentral";
import { ConnectWiseError } from "@/lib/connectwise";
import { computeMrrBridge } from "@/lib/mrrBridge";

export const dynamic = "force-dynamic";

function validDate(val: unknown): string | null {
  if (typeof val !== "string") return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(val.trim()) ? val.trim() : null;
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }
  const b = body as Record<string, unknown>;
  const priorStart = validDate(b?.priorStart);
  const priorEnd = validDate(b?.priorEnd);
  const currentStart = validDate(b?.currentStart);
  const currentEnd = validDate(b?.currentEnd);
  if (!priorStart || !priorEnd || !currentStart || !currentEnd) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "priorStart, priorEnd, currentStart, currentEnd all required as YYYY-MM-DD",
      },
      { status: 400 }
    );
  }
  const priorSignedNotOnboarded =
    typeof b?.priorSignedNotOnboarded === "number" ? b.priorSignedNotOnboarded : 0;
  const skipHubspot = Boolean(b?.skipHubspot);

  try {
    const result = await computeMrrBridge({
      priorStart,
      priorEnd,
      currentStart,
      currentEnd,
      priorSignedNotOnboarded,
      skipHubspot,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof BusinessCentralError || err instanceof ConnectWiseError) {
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
