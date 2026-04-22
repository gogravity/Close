import { NextResponse } from "next/server";
import { listAccounts, BusinessCentralError } from "@/lib/businessCentral";

export const dynamic = "force-dynamic";

export type BcAccountEntry = {
  number: string;
  displayName: string;
  category: string;
};

export type BcAccountsResponse = {
  ok: true;
  accounts: BcAccountEntry[];
};

export type BcAccountsErrorResponse = {
  ok: false;
  error: string;
};

export async function GET(): Promise<NextResponse> {
  try {
    const all = await listAccounts();
    // Include Expense and Cost of Goods Sold accounts (BC encodes spaces as _x0020_)
    const accounts = all
      .filter(
        (a) =>
          a.category === "Expense" ||
          a.category === "Cost_x0020_of_x0020_Goods_x0020_Sold" ||
          a.category === "CostOfGoodsSold"
      )
      .map((a) => ({
        number: a.number,
        displayName: a.displayName,
        category:
          a.category === "Expense"
            ? "Expense"
            : "COGS",
      }));

    return NextResponse.json<BcAccountsResponse>({ ok: true, accounts });
  } catch (err) {
    const msg =
      err instanceof BusinessCentralError
        ? `BC ${err.status}: ${err.message}`
        : (err as Error).message;
    return NextResponse.json<BcAccountsErrorResponse>(
      { ok: false, error: msg },
      { status: 500 }
    );
  }
}
