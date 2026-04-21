import { NextResponse } from "next/server";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { listAccounts, getAccountBalances, BusinessCentralError } from "@/lib/businessCentral";
import { getEntityConfig, updateSettings } from "@/lib/settings";
import { accounts } from "@/lib/recon";

export const dynamic = "force-dynamic";

const BALANCES_FILE = path.join(process.cwd(), ".data", "balances.json");

/**
 * Payroll-section accounts are populated by the payroll process (sections 8–9)
 * and should never be overwritten by the BC sync. The GL balances for these
 * accounts come from posted payroll JEs in BC, but the *adjustments* layer
 * (accrued wages not yet posted) is entered by the payroll flow and lives
 * separately in adjustments-template / section-adjustments files.
 *
 * We still pull BC GL balances for these accounts (they represent the
 * unadjusted/posted balance), so the flag is reserved for a future where
 * payroll writes its own unposted TB line here.
 */
const PAYROLL_OWNED_ACCOUNTS = new Set([
  "Wages Payable",
  "Accrued Wages",
  "Accrued Payroll Tax",
  "Accrued 401K Match",
  "Employee FSA Liability",
  "Accrued Other Employee Benefits",
  "Accrued PTO",
  "Accrued Bonus",
]);

export async function POST(request: Request) {
  let periodEnd: string | undefined;
  try {
    const body = await request.json();
    periodEnd = (body as { periodEnd?: string }).periodEnd;
  } catch {
    // body optional
  }

  // Persist the period if provided
  const entity = await getEntityConfig();
  const asOf = periodEnd ?? entity.periodEnd;
  if (!asOf) {
    return NextResponse.json({ error: "No period end set" }, { status: 400 });
  }
  if (periodEnd && periodEnd !== entity.periodEnd) {
    await updateSettings({ periodEnd });
  }

  // --- Fetch from Business Central ---
  let bcAccounts: Awaited<ReturnType<typeof listAccounts>>;
  let bcBalances: Map<string, number>;
  try {
    [bcAccounts, bcBalances] = await Promise.all([
      listAccounts(),
      getAccountBalances(asOf),
    ]);
  } catch (err) {
    if (err instanceof BusinessCentralError) {
      return NextResponse.json(
        { error: `Business Central error: ${err.message}` },
        { status: err.status >= 400 && err.status < 600 ? err.status : 502 }
      );
    }
    throw err;
  }

  // Build a lookup: BC displayName (lower) → net balance
  // Multiple BC accounts may share a display name prefix — accumulate them.
  const byDisplayName = new Map<string, number>();
  for (const acct of bcAccounts) {
    const bal = bcBalances.get(acct.number) ?? 0;
    if (bal === 0) continue;
    const key = acct.displayName.trim().toLowerCase();
    byDisplayName.set(key, (byDisplayName.get(key) ?? 0) + bal);
  }

  // --- Load existing balances so we can preserve payroll-owned entries
  //     when they've been manually set by the payroll flow.
  let existing: Record<string, number> = {};
  try {
    const { readFile } = await import("node:fs/promises");
    existing = JSON.parse(await readFile(BALANCES_FILE, "utf8")) as Record<string, number>;
  } catch {
    // file may not exist yet — that's fine
  }

  // --- Match recon accounts to BC balances ---
  const result: Record<string, number> = {};
  let matched = 0;

  for (const reconAcct of accounts) {
    // Payroll-owned accounts: preserve existing value if present; fall through
    // to BC sync otherwise (posted BC JEs are still the unadjusted source).
    // A future payroll flow can set a "payroll_locked" flag here.
    const isPayrollOwned = PAYROLL_OWNED_ACCOUNTS.has(reconAcct.name);
    if (isPayrollOwned && existing[reconAcct.name] !== undefined) {
      result[reconAcct.name] = existing[reconAcct.name];
      matched++;
      continue;
    }

    const key = reconAcct.name.trim().toLowerCase();

    // 1. Exact match
    if (byDisplayName.has(key)) {
      result[reconAcct.name] = byDisplayName.get(key)!;
      matched++;
      continue;
    }

    // 2. Fuzzy: BC displayName contains our name or our name contains it
    let fuzzyTotal = 0;
    let fuzzyHit = false;
    for (const [bcName, bal] of byDisplayName) {
      if (bcName.includes(key) || key.includes(bcName)) {
        fuzzyTotal += bal;
        fuzzyHit = true;
      }
    }
    if (fuzzyHit) {
      result[reconAcct.name] = fuzzyTotal;
      matched++;
    }
    // If no match at all, omit (falls to 0 in balanceOf)
  }

  await mkdir(path.dirname(BALANCES_FILE), { recursive: true });
  await writeFile(BALANCES_FILE, JSON.stringify(result, null, 2));

  return NextResponse.json({ ok: true, asOf, synced: matched, total: accounts.length });
}
