import { NextResponse } from "next/server";
import { getAzureCosts, getAzureCostsByService, AzureCostError, type AzureCostResult } from "@/lib/azureCostManagement";

export const dynamic = "force-dynamic";

export type AzureCostResponse = {
  ok: true;
  byCustomer: AzureCostResult;
  byService: AzureCostResult;
};

export type AzureCostErrorResponse = {
  ok: false;
  error: string;
};

export async function GET(): Promise<NextResponse> {
  try {
    const [byCustomer, byService] = await Promise.all([
      getAzureCosts("BillingMonthToDate"),
      getAzureCostsByService("BillingMonthToDate"),
    ]);
    return NextResponse.json<AzureCostResponse>({ ok: true, byCustomer, byService });
  } catch (err) {
    const msg =
      err instanceof AzureCostError
        ? `Azure Cost Management ${err.status}: ${err.message}`
        : (err as Error).message;
    return NextResponse.json<AzureCostErrorResponse>(
      { ok: false, error: msg },
      { status: err instanceof AzureCostError && err.status === 400 ? 400 : 500 }
    );
  }
}
