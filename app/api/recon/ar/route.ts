import { NextResponse } from "next/server";
import { getArReconInput, setArReconInput, type ArReconInput } from "@/lib/arRecon";
import { getEntityConfig } from "@/lib/settings";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json()) as { input: ArReconInput };
  const entity = await getEntityConfig();
  await setArReconInput(entity.periodEnd, body.input);
  const saved = await getArReconInput(entity.periodEnd);
  return NextResponse.json({ ok: true, input: saved });
}
