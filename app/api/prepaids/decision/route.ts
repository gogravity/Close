import { NextResponse } from "next/server";
import { setDecision, type PrepaidRecognition } from "@/lib/prepaidDecisions";
import { getEntityConfig } from "@/lib/settings";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json()) as {
    entryNumber: number;
    confirmed: boolean;
    recognition?: PrepaidRecognition;
    notes?: string;
  };
  const entity = await getEntityConfig();
  await setDecision(entity.periodEnd, body.entryNumber, {
    confirmed: body.confirmed,
    recognition: body.recognition,
    notes: body.notes,
  });
  return NextResponse.json({ ok: true });
}
