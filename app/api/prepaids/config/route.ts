import { NextResponse } from "next/server";
import {
  getPrepaidScanConfig,
  setPrepaidScanConfig,
  defaultSelectedAccounts,
} from "@/lib/prepaidConfig";
import { listAccounts } from "@/lib/businessCentral";

export const dynamic = "force-dynamic";

export async function GET() {
  const [accounts, config] = await Promise.all([
    listAccounts(),
    getPrepaidScanConfig(),
  ]);
  const expenseAccounts = accounts
    .filter((a) => a.category === "Expense" || a.category === "CostOfGoodsSold")
    .map((a) => ({
      number: a.number,
      displayName: a.displayName,
      subCategory: a.subCategory,
    }))
    .sort((a, b) => a.number.localeCompare(b.number));

  const includedSet = new Set(
    config.includedAccountNumbers.length > 0
      ? config.includedAccountNumbers
      : defaultSelectedAccounts(accounts)
  );

  return NextResponse.json({
    accounts: expenseAccounts.map((a) => ({
      ...a,
      included: includedSet.has(a.number),
    })),
    isCustom: config.includedAccountNumbers.length > 0,
  });
}

export async function POST(request: Request) {
  const body = (await request.json()) as { includedAccountNumbers: string[] };
  await setPrepaidScanConfig({
    includedAccountNumbers: body.includedAccountNumbers ?? [],
  });
  return NextResponse.json({ ok: true });
}
