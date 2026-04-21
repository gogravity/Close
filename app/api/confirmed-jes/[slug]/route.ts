import { NextResponse } from "next/server";
import { confirmJe, unconfirmJe } from "@/lib/confirmedJes";
import type { ConfirmedJeLine } from "@/lib/confirmedJes";

export const dynamic = "force-dynamic";

type Params = { slug: string };

/** POST /api/confirmed-jes/[slug] — mark a JE as confirmed for a period */
export async function POST(
  request: Request,
  { params }: { params: Promise<Params> }
) {
  const { slug } = await params;
  const body = await request.json() as {
    period: string;
    memo: string;
    lines: ConfirmedJeLine[];
  };

  if (!body.period || !body.lines?.length) {
    return NextResponse.json({ error: "period and lines are required" }, { status: 400 });
  }

  await confirmJe(body.period, slug, { memo: body.memo ?? "", lines: body.lines });
  return NextResponse.json({ ok: true });
}

/** DELETE /api/confirmed-jes/[slug] — remove a confirmed JE for a period */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<Params> }
) {
  const { slug } = await params;
  const body = await request.json() as { period: string };

  if (!body.period) {
    return NextResponse.json({ error: "period is required" }, { status: 400 });
  }

  await unconfirmJe(body.period, slug);
  return NextResponse.json({ ok: true });
}
