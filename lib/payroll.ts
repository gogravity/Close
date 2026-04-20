import "server-only";
import {
  listTimeEntriesForRange,
  type CwPayrollTimeEntry,
} from "./connectwise";

// ---------------------------------------------------------------------------
// Payroll allocation
//
// Splits each member's pay-period hours across six buckets:
//   1. Managed Services      — time billed to a Managed-type CW agreement
//   2. Re-occurring Services — time billed to a Block-type CW agreement
//   3. Non-recurring Services — other billable time (project/service without
//                               one of the above agreements)
//   4. VOIP Hard COGS        — heuristic: ticket board/type/agreement mentions
//                               "voip", "phone", "sip", "telecom", etc.
//   5. Sales                 — unassigned time for Sales-department members
//   6. Admin                 — unassigned time for Admin-department members
//                               (also catch-all for non-billable misc time)
//
// Sales/Admin department members are assumed to work a fixed 40hrs/week —
// their tracked time counts toward the service buckets and the remainder of
// the 40-hr baseline goes to their dept bucket. Service-dept members use
// their actual tracked hours as the baseline; Sales/Admin columns stay 0.
// ---------------------------------------------------------------------------

export type PayrollBucket =
  | "managed"
  | "recurring"
  | "nonRecurring"
  | "voip"
  | "sales"
  | "admin";

export const BUCKET_LABELS: Record<PayrollBucket, string> = {
  managed: "Managed Services",
  recurring: "Re-occurring Services",
  nonRecurring: "Non-recurring Services",
  voip: "VOIP Hard COGS",
  sales: "Sales",
  admin: "Admin",
};

export const BUCKET_ORDER: PayrollBucket[] = [
  "managed",
  "recurring",
  "nonRecurring",
  "voip",
  "sales",
  "admin",
];

export type PayPeriodHalf = "first" | "second";

export type PayPeriodInput = {
  year: number;
  month: number; // 1-12
  half: PayPeriodHalf;
};

export type PayPeriod = PayPeriodInput & {
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  label: string; // "Mar 2026 · 1st half"
  weeks: number; // for the 40×weeks baseline
};

/** Departments that matter for cost allocation. CW's own department
 *  taxonomy doesn't map cleanly, so the user sets this per member via a
 *  dropdown on the client. Professional Services + Managed Services use
 *  actual tracked hours as the baseline; Admin + Sales use 40×weeks. */
export type PayrollDept = "professional" | "managed" | "admin" | "sales";

export const DEPT_LABELS: Record<PayrollDept, string> = {
  professional: "Professional Services",
  managed: "Managed Services",
  admin: "Admin",
  sales: "Sales",
};

export const DEPT_ORDER: PayrollDept[] = [
  "professional",
  "managed",
  "admin",
  "sales",
];

export type PayrollMemberRow = {
  memberId: number;
  identifier: string; // CW username
  name: string;
  /** Pre-override default. Currently always "professional" — user flips
   *  via the dropdown. */
  defaultDept: PayrollDept;
  totalTrackedHours: number;
  /** Raw classified hours, before the Sales/Admin remainder logic is applied.
   *  The client applies that + percentages dynamically based on the dept
   *  dropdown so changing the dept updates immediately. `sales` and `admin`
   *  entries here are always 0 — they get populated client-side. */
  rawHoursByBucket: Record<PayrollBucket, number>;
  entryCount: number;
};

export type PayrollResult = {
  period: PayPeriod;
  members: PayrollMemberRow[];
  /** Distinct company names that had any time in the window, with their
   *  total hours. Drives the exclude-company UI. */
  companies: Array<{ name: string; hours: number }>;
  /** Companies that were actually excluded by this run (echoed back for UX). */
  excludedCompanies: string[];
};

// ---------------------------------------------------------------------------

function buildPayPeriod(input: PayPeriodInput): PayPeriod {
  const { year, month, half } = input;
  // Day 0 of month+1 gives the last day of the target month (handles 28/30/31 etc.)
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const startDay = half === "first" ? 1 : 16;
  const endDay = half === "first" ? 15 : lastDay;
  const pad = (n: number) => String(n).padStart(2, "0");
  const startDate = `${year}-${pad(month)}-${pad(startDay)}`;
  const endDate = `${year}-${pad(month)}-${pad(endDay)}`;
  // Payroll convention: each half is ~2 weeks = 40×2 = 80 hrs baseline.
  // Days inclusive × (5/7) approximates working-day weeks but the user's rule
  // is "40 hrs per week" with a hard two-week assumption per half.
  const weeks = 2;
  const label = `${new Date(Date.UTC(year, month - 1, 1)).toLocaleString("en-US", { month: "short", timeZone: "UTC" })} ${year} · ${half === "first" ? "1st" : "2nd"} half`;
  return { year, month, half, startDate, endDate, label, weeks };
}

export function currentPayPeriodFor(date: Date = new Date()): PayPeriodInput {
  const day = date.getUTCDate();
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  return { year, month, half: day <= 15 ? "first" : "second" };
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

const MANAGED_PATTERN = /managed/i;
const BLOCK_PATTERN = /block/i;
const VOIP_PATTERN = /voip|\bsip\b|\btelecom\b|\bphone\b|\bpbx\b/i;

function agreementTypeLabel(e: CwPayrollTimeEntry): string {
  return (
    e.agreement?.type ||
    e.agreementType ||
    ""
  );
}

function isVoipEntry(e: CwPayrollTimeEntry): boolean {
  // Signals that this is VOIP work. Any match wins. CW doesn't have a clean
  // VOIP flag so we look at several free-text fields.
  const haystack = [
    e.ticketBoard,
    e.ticketType,
    e.agreement?.name,
    e.agreement?.type,
    e.agreementType,
    e.ticket?.summary,
    e.ticket?.name,
    e.notes,
  ]
    .filter((x): x is string => typeof x === "string" && x.length > 0)
    .join(" | ");
  return VOIP_PATTERN.test(haystack);
}

function classifyEntry(e: CwPayrollTimeEntry): PayrollBucket | null {
  // Non-billable (DoNotBill / NoCharge) is considered internal — falls through
  // to null and bubbles to the member's dept bucket (Sales/Admin remainder).
  const billable = e.billableOption === "Billable";

  // VOIP check first — VOIP classification trumps other agreement types when
  // the ticket/board/notes clearly indicate telecom work.
  if (billable && isVoipEntry(e)) return "voip";

  const agr = agreementTypeLabel(e);
  if (billable && agr) {
    if (MANAGED_PATTERN.test(agr)) return "managed";
    if (BLOCK_PATTERN.test(agr)) return "recurring";
    // Billable against an agreement that isn't Managed or Block — bucket as
    // Non-recurring until we have a better rule.
    return "nonRecurring";
  }

  if (billable) {
    // Billable work without an agreement = project / ad-hoc service ticket.
    return "nonRecurring";
  }

  return null;
}

function emptyBuckets(): Record<PayrollBucket, number> {
  return {
    managed: 0,
    recurring: 0,
    nonRecurring: 0,
    voip: 0,
    sales: 0,
    admin: 0,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

export type PayrollOptions = {
  /** Company names (case-insensitive exact match) to drop entirely from the
   *  allocation. Internal-work companies like "Gravity Networks LLC" should
   *  be here so their hours don't inflate COGS buckets. */
  excludeCompanies?: string[];
};

function matchesAny(company: string, patterns: Set<string>): boolean {
  const lower = company.toLowerCase();
  for (const p of patterns) if (lower === p) return true;
  return false;
}

export async function computePayroll(
  input: PayPeriodInput,
  opts: PayrollOptions = {}
): Promise<PayrollResult> {
  const period = buildPayPeriod(input);
  const rawEntries = await listTimeEntriesForRange(period.startDate, period.endDate);
  const excludedSet = new Set(
    (opts.excludeCompanies ?? []).map((c) => c.trim().toLowerCase()).filter(Boolean)
  );

  // Distinct companies + total hours (for the UI company-picker). Computed
  // over ALL entries, pre-exclusion, so the user can see what they're
  // excluding.
  const companyHours = new Map<string, number>();
  for (const e of rawEntries) {
    const c = (e.company?.name ?? "").trim();
    if (!c) continue;
    companyHours.set(c, (companyHours.get(c) ?? 0) + (e.actualHours ?? 0));
  }
  const companies = [...companyHours.entries()]
    .map(([name, hours]) => ({ name, hours: round2(hours) }))
    .sort((a, b) => b.hours - a.hours);

  // Apply exclusion.
  const entries = rawEntries.filter((e) => {
    const c = (e.company?.name ?? "").trim();
    return !c || !matchesAny(c, excludedSet);
  });

  type MemberAcc = {
    memberId: number;
    identifier: string;
    name: string;
    totalHours: number;
    hoursByBucket: Record<PayrollBucket, number>;
    entryCount: number;
  };
  const byMember = new Map<number, MemberAcc>();

  for (const e of entries) {
    const memberId = e.member?.id;
    if (typeof memberId !== "number") continue;
    const hrs = e.actualHours ?? 0;
    if (hrs === 0) continue;

    let acc = byMember.get(memberId);
    if (!acc) {
      acc = {
        memberId,
        identifier: e.member?.identifier ?? "",
        name: e.member?.name ?? e.member?.identifier ?? `Member #${memberId}`,
        totalHours: 0,
        hoursByBucket: emptyBuckets(),
        entryCount: 0,
      };
      byMember.set(memberId, acc);
    }
    acc.totalHours += hrs;
    acc.entryCount += 1;

    const bucket = classifyEntry(e);
    if (bucket) acc.hoursByBucket[bucket] += hrs;
  }

  const members: PayrollMemberRow[] = [];
  for (const acc of byMember.values()) {
    const raw = { ...acc.hoursByBucket };
    for (const b of BUCKET_ORDER) raw[b] = round2(raw[b]);
    members.push({
      memberId: acc.memberId,
      identifier: acc.identifier,
      name: acc.name,
      defaultDept: "professional",
      totalTrackedHours: round2(acc.totalHours),
      rawHoursByBucket: raw,
      entryCount: acc.entryCount,
    });
  }
  members.sort((a, b) => a.name.localeCompare(b.name));

  return {
    period,
    members,
    companies,
    excludedCompanies: [...excludedSet].sort(),
  };
}
