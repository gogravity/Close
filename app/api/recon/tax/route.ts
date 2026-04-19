import { NextResponse } from "next/server";
import { getInputsForPeriod, setInput, type TaxReconInput } from "@/lib/taxRecon";
import { getEntityConfig } from "@/lib/settings";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json()) as {
    bcAccountNumber: string;
    input: TaxReconInput;
  };
  const entity = await getEntityConfig();
  await setInput(entity.periodEnd, body.bcAccountNumber, body.input);
  const saved = await getInputsForPeriod(entity.periodEnd);
  return NextResponse.json({ ok: true, input: saved[body.bcAccountNumber] ?? null });
}
