import { NextResponse } from "next/server";
import { buildCurrentBillEstimate, Pax8Error, type CurrentBillEstimate } from "@/lib/pax8";

export const dynamic = "force-dynamic";

export type Pax8EstimateResponse = {
  ok: true;
  estimate: CurrentBillEstimate;
};

export type Pax8EstimateErrorResponse = {
  ok: false;
  error: string;
};

export async function GET(): Promise<NextResponse> {
  try {
    const estimate = await buildCurrentBillEstimate();
    return NextResponse.json<Pax8EstimateResponse>({ ok: true, estimate });
  } catch (err) {
    const msg =
      err instanceof Pax8Error
        ? `Pax8 ${err.status}: ${err.message}`
        : (err as Error).message;
    return NextResponse.json<Pax8EstimateErrorResponse>(
      { ok: false, error: msg },
      { status: 500 }
    );
  }
}
