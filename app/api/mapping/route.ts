import { NextResponse } from "next/server";
import { getAccountMappings, updateAccountMappings } from "@/lib/settings";
import { listAccounts, getAccountBalances, BusinessCentralError } from "@/lib/businessCentral";
import { getEntityConfig } from "@/lib/settings";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [accounts, mappings, entity] = await Promise.all([
      listAccounts(),
      getAccountMappings(),
      getEntityConfig(),
    ]);
    let balances = new Map<string, number>();
    try {
      balances = await getAccountBalances(entity.periodEnd);
    } catch {
      // balances are a nice-to-have; mapping UI can function without them.
    }
    return NextResponse.json({
      periodEnd: entity.periodEnd,
      accounts: accounts.map((a) => ({
        id: a.id,
        number: a.number,
        displayName: a.displayName,
        category: a.category,
        subCategory: a.subCategory,
        balance: balances.get(a.number) ?? 0,
        mappedTo: mappings[a.number] ?? null,
      })),
    });
  } catch (err) {
    if (err instanceof BusinessCentralError) {
      return NextResponse.json(
        { error: err.message, status: err.status, body: err.body },
        { status: 200 }
      );
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 200 });
  }
}

export async function POST(request: Request) {
  const body = (await request.json()) as {
    mappings: Record<string, string | null>;
  };
  await updateAccountMappings(body.mappings ?? {});
  const current = await getAccountMappings();
  return NextResponse.json({ ok: true, mappings: current });
}
