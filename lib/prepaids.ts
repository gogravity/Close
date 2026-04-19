import "server-only";
import {
  listAccounts,
  bcGet,
  type BcGlLedgerEntry,
  type BcAccount,
} from "./businessCentral";
import { getEntityConfig } from "./settings";
import { resolveSelectedAccounts } from "./prepaidConfig";

type BcPage<T> = { value: T[]; "@odata.nextLink"?: string };

export type PrepaidCandidate = {
  entry: BcGlLedgerEntry;
  account: { number: string; displayName: string };
  amount: number;
  isTravel: boolean;
  isRecurring: boolean;
  recurringMonthCount: number;
  reason: "travel" | "one-off-large";
};

export type PrepaidScan = {
  periodStart: string;
  periodEnd: string;
  lookbackMonths: number;
  travelThreshold: number;
  generalThreshold: number;
  candidates: PrepaidCandidate[];
  skipped: {
    recurring: number;
    belowThreshold: number;
    totalExpenseEntriesInPeriod: number;
  };
};

const TRAVEL_THRESHOLD = 200;
const GENERAL_THRESHOLD = 500;
const LOOKBACK_MONTHS = 2;

function firstOfMonth(dateStr: string): string {
  const d = new Date(dateStr);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

function shiftMonths(dateStr: string, months: number): string {
  const d = new Date(dateStr);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

function normalizeDesc(s: string): string {
  return (s || "")
    .toUpperCase()
    .replace(/[^A-Z]+/g, " ")
    .trim()
    .split(/\s+/)
    .slice(0, 3)
    .join(" ");
}

function isTravelAccount(a: BcAccount): boolean {
  return /travel|airline|airfare|hotel|lodging/i.test(a.displayName);
}

async function getCompanyId(): Promise<string> {
  const entity = await getEntityConfig();
  const { listCompanies } = await import("./businessCentral");
  const companies = await listCompanies();
  const match = companies.find(
    (c) =>
      c.name === entity.name ||
      c.displayName === entity.name ||
      c.id === entity.name
  );
  if (!match) throw new Error(`BC company '${entity.name}' not found`);
  return match.id;
}

async function listGlEntriesInRange(
  startDate: string,
  endDate: string
): Promise<BcGlLedgerEntry[]> {
  const companyId = await getCompanyId();
  const filter = `postingDate ge ${startDate} and postingDate le ${endDate}`;
  const path =
    `/companies(${companyId})/generalLedgerEntries?` +
    `$filter=${encodeURIComponent(filter)}&` +
    `$select=entryNumber,postingDate,documentNumber,documentType,accountNumber,description,debitAmount,creditAmount&` +
    `$orderby=postingDate,entryNumber`;
  // For the 3-month window the volume comfortably fits BC's default page size
  // (~20k rows). Paginate only if nextLink appears.
  const out: BcGlLedgerEntry[] = [];
  let res: BcPage<BcGlLedgerEntry> = await bcGet<BcPage<BcGlLedgerEntry>>(path);
  out.push(...res.value);
  while (res["@odata.nextLink"]) {
    // Fall back to plain fetch for continuation URLs.
    const contRes = await fetch(res["@odata.nextLink"], {
      headers: {
        Authorization: `Bearer ${await getBearerToken()}`,
        Accept: "application/json",
      },
      cache: "no-store",
    });
    if (!contRes.ok) break;
    res = (await contRes.json()) as BcPage<BcGlLedgerEntry>;
    out.push(...res.value);
  }
  return out;
}

async function getBearerToken(): Promise<string> {
  // Piggyback on bcGet's internal OAuth — simplest: do a tiny dummy call and
  // pluck the token from an env-style round-trip. Since bcGet doesn't expose
  // the token, the cleanest path is to just re-request from AAD here.
  const { getIntegrationSecrets } = await import("./settings");
  const secrets = await getIntegrationSecrets("business-central");
  const body = new URLSearchParams({
    client_id: secrets.clientId,
    client_secret: secrets.clientSecret,
    scope: "https://api.businesscentral.dynamics.com/.default",
    grant_type: "client_credentials",
  });
  const res = await fetch(
    `https://login.microsoftonline.com/${encodeURIComponent(
      secrets.tenantId
    )}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      cache: "no-store",
    }
  );
  const json = (await res.json()) as { access_token: string };
  return json.access_token;
}

export async function findPrepaidCandidates(): Promise<PrepaidScan> {
  const entity = await getEntityConfig();
  const periodStart = firstOfMonth(entity.periodEnd);
  const periodEnd = entity.periodEnd;
  const lookbackStart = shiftMonths(periodStart, -LOOKBACK_MONTHS);

  const [allAccounts, entries] = await Promise.all([
    listAccounts(),
    listGlEntriesInRange(lookbackStart, periodEnd),
  ]);

  const accountsByNumber = new Map(allAccounts.map((a) => [a.number, a]));
  const selectedAccountNumbers = await resolveSelectedAccounts(allAccounts);
  const expenseEntries = entries.filter((e) =>
    selectedAccountNumbers.has(e.accountNumber)
  );

  const monthKey = (postingDate: string) => postingDate.slice(0, 7);
  const currentMonth = periodEnd.slice(0, 7);

  // Build a map of (accountNumber|vendorSig) → set of prior months it appeared in.
  const priorMonthsByKey = new Map<string, Set<string>>();
  for (const e of expenseEntries) {
    const ym = monthKey(e.postingDate);
    if (ym === currentMonth) continue;
    const key = `${e.accountNumber}|${normalizeDesc(e.description)}`;
    if (!priorMonthsByKey.has(key)) priorMonthsByKey.set(key, new Set());
    priorMonthsByKey.get(key)!.add(ym);
  }

  const candidates: PrepaidCandidate[] = [];
  let skippedRecurring = 0;
  let skippedBelowThreshold = 0;
  let totalCurrentPeriodExpense = 0;

  for (const e of expenseEntries) {
    if (monthKey(e.postingDate) !== currentMonth) continue;
    totalCurrentPeriodExpense++;
    const acct = accountsByNumber.get(e.accountNumber);
    if (!acct) continue;
    const amount = e.debitAmount - e.creditAmount;
    if (amount <= 0) continue;

    const isTravel = isTravelAccount(acct);
    const key = `${e.accountNumber}|${normalizeDesc(e.description)}`;
    const priorMonthCount = priorMonthsByKey.get(key)?.size ?? 0;
    const isRecurring = priorMonthCount > 0;

    if (isTravel && amount >= TRAVEL_THRESHOLD) {
      candidates.push({
        entry: e,
        account: { number: acct.number, displayName: acct.displayName },
        amount,
        isTravel,
        isRecurring,
        recurringMonthCount: priorMonthCount,
        reason: "travel",
      });
    } else if (!isRecurring && amount >= GENERAL_THRESHOLD) {
      candidates.push({
        entry: e,
        account: { number: acct.number, displayName: acct.displayName },
        amount,
        isTravel,
        isRecurring,
        recurringMonthCount: priorMonthCount,
        reason: "one-off-large",
      });
    } else if (isRecurring) {
      skippedRecurring++;
    } else {
      skippedBelowThreshold++;
    }
  }

  candidates.sort((a, b) => b.amount - a.amount);

  return {
    periodStart,
    periodEnd,
    lookbackMonths: LOOKBACK_MONTHS,
    travelThreshold: TRAVEL_THRESHOLD,
    generalThreshold: GENERAL_THRESHOLD,
    candidates,
    skipped: {
      recurring: skippedRecurring,
      belowThreshold: skippedBelowThreshold,
      totalExpenseEntriesInPeriod: totalCurrentPeriodExpense,
    },
  };
}
