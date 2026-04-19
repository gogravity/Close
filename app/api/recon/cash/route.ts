import { NextResponse } from "next/server";
import {
  getCashReconInput,
  setCashReconInput,
  type CashReconInput,
} from "@/lib/cashRecon";
import { getEntityConfig } from "@/lib/settings";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json()) as {
    bcAccountNumber: string;
    input: CashReconInput;
  };
  const entity = await getEntityConfig();
  await setCashReconInput(entity.periodEnd, body.bcAccountNumber, body.input);
  const saved = await getCashReconInput(entity.periodEnd, body.bcAccountNumber);
  return NextResponse.json({ ok: true, input: saved });
}
