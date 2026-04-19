import "server-only";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import {
  listOpenProjects,
  listOpenProjectTickets,
  listOpenServiceTickets,
  listProjectTicketTimeEntries,
  listServiceTicketTimeEntries,
  type CwTicketTimeEntry,
  type CwOpenProject,
} from "./connectwise";

// ---------------------------------------------------------------------------
// Unbilled Revenue aggregator
//
// Pulls unbilled project and service time from CW, buckets into three
// categories, and surfaces project-level cost context alongside each
// project row so the user can decide recognition % intelligently.
//
// The CW query pattern matches the procedure in docs/cw-wip-to-journal-entry.md
// (filter by chargeToType in conditions, filter invoice/billable in memory).
// ---------------------------------------------------------------------------

export type UnbilledCategory = "service-time" | "project-tm" | "project-fixed";

export const CATEGORY_LABELS: Record<UnbilledCategory, string> = {
  "service-time": "Service Time",
  "project-tm": "Project T&M",
  "project-fixed": "Project Fixed Fee",
};

// T&M-ish billing methods — anything that isn't FixedFee is treated as T&M
// for the WIP calc (ActualRates, NotToExceed, OverrideRate). This matches
// the doc's treatment.
function isFixedFeeMethod(m: string | null | undefined): boolean {
  return m === "FixedFee";
}

export type ProjectCostSnapshot = {
  billingMethod: string | null;
  billingAmount: number | null;
  budgetHours: number | null;
  estimatedHours: number | null;
  actualHours: number | null;
  estimatedTimeCost: number | null;
  estimatedTimeRevenue: number | null;
  percentComplete: number | null;
};

export type UnbilledRow = {
  // A row represents a grouping of entries — for project rows this is the
  // whole project; for service rows this is a single ticket (we roll entries
  // up per ticket so the list is readable).
  rowId: string;
  category: UnbilledCategory;
  label: string; // project name or ticket summary
  company: string;
  hours: number;
  revenue: number; // hours * hourlyRate summed across entries
  cost: number; // hours * hourlyCost summed across entries
  entryCount: number;
  project: ProjectCostSnapshot | null; // null for service-time
  notes?: string;
  // Per-period user decision persisted by rowId:
  //   pct = 0 → excluded; pct > 0 → included at that recognition %
  pct: number;
};

export type UnbilledCategoryGroup = {
  category: UnbilledCategory;
  label: string;
  rows: UnbilledRow[];
  grossTotal: number;
  recognizedTotal: number;
  includedCount: number;
  totalCount: number;
};

export type UnbilledRevenueResult = {
  asOfDate: string;
  periodKey: string;
  categories: UnbilledCategoryGroup[];
  grossTotal: number;
  recognizedTotal: number;
  lastSavedAt: string | null;
};

type StoredSelections = {
  savedAt: string;
  selections: Record<string, { pct: number }>;
};

function selectionsPath(periodKey: string): string {
  return path.join(process.cwd(), ".data", `unbilled-revenue-${periodKey}.json`);
}

async function readSelections(periodKey: string): Promise<StoredSelections | null> {
  try {
    const raw = await readFile(selectionsPath(periodKey), "utf8");
    return JSON.parse(raw) as StoredSelections;
  } catch {
    return null;
  }
}

export async function writeSelections(
  periodKey: string,
  selections: Record<string, { pct: number }>
): Promise<string> {
  const data: StoredSelections = {
    savedAt: new Date().toISOString(),
    selections,
  };
  const p = selectionsPath(periodKey);
  await mkdir(path.dirname(p), { recursive: true });
  await writeFile(p, JSON.stringify(data, null, 2), { mode: 0o600 });
  return data.savedAt;
}

function isUnbilledBillable(e: CwTicketTimeEntry): boolean {
  // Doc's pattern: invoice absent + billableOption is Billable. We exclude
  // NoCharge here because NoCharge has rate 0 and contributes nothing to
  // unbilled revenue; it only clutters the display.
  if (e.invoice && e.invoice.id != null) return false;
  return e.billableOption === "Billable";
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function inCutoff(e: CwTicketTimeEntry, asOfDate: string): boolean {
  // Time entries dated after the close cutoff shouldn't hit the JE for this
  // period. We compare on dateEntered — when the time was logged — which is
  // what the accounting team uses for cutoff per the procedure doc.
  if (!e.dateEntered) return true;
  return e.dateEntered.slice(0, 10) <= asOfDate;
}

export async function fetchUnbilledRevenue(
  asOfDate: string,
  opts: { projectLookbackMonths?: number; serviceLookbackMonths?: number } = {}
): Promise<UnbilledRevenueResult> {
  const periodKey = asOfDate.slice(0, 7);
  // Different lookbacks by category: project WIP can legitimately span many
  // months (a fixed-fee project runs a quarter or more), but service tickets
  // close and invoice monthly, so a 1-month window is plenty and keeps the
  // fetch fast. Large tenants accumulate tens of thousands of service-time
  // rows per month — a wider window is both slow and low-signal.
  const projectSince = monthsBack(asOfDate, opts.projectLookbackMonths ?? 6);
  const serviceSince = monthsBack(asOfDate, opts.serviceLookbackMonths ?? 1);

  const [
    projects,
    openProjectTickets,
    openServiceTickets,
    projectTimeRaw,
    serviceTimeRaw,
    storedSelections,
  ] = await Promise.all([
    listOpenProjects(),
    listOpenProjectTickets(),
    listOpenServiceTickets(),
    listProjectTicketTimeEntries(projectSince, asOfDate),
    listServiceTicketTimeEntries(serviceSince, asOfDate),
    readSelections(periodKey),
  ]);

  // Build open-ticket indexes up front so we can drop any time entries tied
  // to closed tickets without making additional CW calls.
  const openProjectTicketToProject = new Map<number, number>();
  for (const t of openProjectTickets) {
    if (t.projectId != null) openProjectTicketToProject.set(t.id, t.projectId);
  }
  const openServiceTicketById = new Map<
    number,
    { summary: string; companyName: string }
  >();
  for (const t of openServiceTickets) {
    openServiceTicketById.set(t.id, {
      summary: t.summary,
      companyName: t.companyName,
    });
  }

  // ---- PROJECT side: only entries on OPEN project tickets whose parent
  //      project is also OPEN. Closed tickets/projects are filtered out here. ----
  const projectTime = projectTimeRaw.filter(
    (e) =>
      isUnbilledBillable(e) &&
      inCutoff(e, asOfDate) &&
      typeof e.chargeToId === "number" &&
      openProjectTicketToProject.has(e.chargeToId)
  );

  const projectById = new Map<number, CwOpenProject>(
    projects.map((p) => [p.id, p])
  );

  type ProjectAgg = {
    projectId: number;
    name: string;
    companyName: string;
    billingMethod: string | null;
    hours: number;
    revenue: number;
    cost: number;
    entryCount: number;
  };
  const byProject = new Map<number, ProjectAgg>();
  for (const e of projectTime) {
    const tid = e.chargeToId;
    if (typeof tid !== "number") continue;
    const pid = openProjectTicketToProject.get(tid);
    if (typeof pid !== "number") continue;
    const proj = projectById.get(pid);
    // Project must also be open — we already filtered tickets above, this
    // is the belt + suspenders check for an open-ticket on a closed project.
    if (!proj) continue;
    let agg = byProject.get(pid);
    if (!agg) {
      agg = {
        projectId: pid,
        name: proj.name ?? `Project #${pid}`,
        companyName: proj.company?.name ?? "",
        billingMethod: proj.billingMethod ?? null,
        hours: 0,
        revenue: 0,
        cost: 0,
        entryCount: 0,
      };
      byProject.set(pid, agg);
    }
    const hrs = e.actualHours ?? 0;
    agg.hours += hrs;
    agg.revenue += hrs * (e.hourlyRate ?? 0);
    agg.cost += hrs * (e.hourlyCost ?? 0);
    agg.entryCount += 1;
  }

  // ---- SERVICE side: only time entries whose ticket is OPEN. ----
  const serviceTime = serviceTimeRaw.filter(
    (e) =>
      isUnbilledBillable(e) &&
      inCutoff(e, asOfDate) &&
      typeof e.chargeToId === "number" &&
      openServiceTicketById.has(e.chargeToId)
  );

  type ServiceAgg = {
    ticketId: number;
    summary: string;
    companyName: string;
    hours: number;
    revenue: number;
    cost: number;
    entryCount: number;
  };
  const byServiceTicket = new Map<number, ServiceAgg>();
  for (const e of serviceTime) {
    const tid = e.chargeToId;
    if (typeof tid !== "number") continue;
    const info = openServiceTicketById.get(tid);
    if (!info) continue; // shouldn't happen after the filter above, but keep the type tight
    let agg = byServiceTicket.get(tid);
    if (!agg) {
      agg = {
        ticketId: tid,
        summary: info.summary || `Ticket #${tid}`,
        companyName: info.companyName,
        hours: 0,
        revenue: 0,
        cost: 0,
        entryCount: 0,
      };
      byServiceTicket.set(tid, agg);
    }
    const hrs = e.actualHours ?? 0;
    agg.hours += hrs;
    agg.revenue += hrs * (e.hourlyRate ?? 0);
    agg.cost += hrs * (e.hourlyCost ?? 0);
    agg.entryCount += 1;
  }

  // ---- Assemble rows with saved selections ----
  const selections = storedSelections?.selections ?? {};
  const defaultPct = (rowId: string): number =>
    typeof selections[rowId]?.pct === "number" ? selections[rowId].pct : 100;

  const projectRows: UnbilledRow[] = [];
  for (const agg of byProject.values()) {
    const proj = projectById.get(agg.projectId)!;
    const cat: UnbilledCategory = isFixedFeeMethod(agg.billingMethod)
      ? "project-fixed"
      : "project-tm";
    const rowId = `project:${agg.projectId}`;
    projectRows.push({
      rowId,
      category: cat,
      label: agg.name,
      company: agg.companyName,
      hours: round2(agg.hours),
      revenue: round2(agg.revenue),
      cost: round2(agg.cost),
      entryCount: agg.entryCount,
      project: {
        billingMethod: agg.billingMethod,
        billingAmount: proj.billingAmount ?? null,
        budgetHours: proj.budgetHours ?? null,
        estimatedHours: proj.estimatedHours ?? null,
        actualHours: proj.actualHours ?? null,
        estimatedTimeCost: proj.estimatedTimeCost ?? null,
        estimatedTimeRevenue: proj.estimatedTimeRevenue ?? null,
        percentComplete: proj.percentComplete ?? null,
      },
      pct: defaultPct(rowId),
    });
  }

  const serviceRows: UnbilledRow[] = [];
  for (const agg of byServiceTicket.values()) {
    const rowId = `service:${agg.ticketId}`;
    serviceRows.push({
      rowId,
      category: "service-time",
      label: agg.summary,
      company: agg.companyName,
      hours: round2(agg.hours),
      revenue: round2(agg.revenue),
      cost: round2(agg.cost),
      entryCount: agg.entryCount,
      project: null,
      pct: defaultPct(rowId),
    });
  }

  const groupRows = (cat: UnbilledCategory) => {
    const rows =
      cat === "service-time"
        ? serviceRows
        : projectRows.filter((r) => r.category === cat);
    rows.sort(
      (a, b) => b.revenue - a.revenue || a.label.localeCompare(b.label)
    );
    const grossTotal = round2(rows.reduce((s, r) => s + r.revenue, 0));
    const recognizedTotal = round2(
      rows.reduce((s, r) => s + (r.revenue * r.pct) / 100, 0)
    );
    const includedCount = rows.filter((r) => r.pct > 0).length;
    return {
      category: cat,
      label: CATEGORY_LABELS[cat],
      rows,
      grossTotal,
      recognizedTotal,
      includedCount,
      totalCount: rows.length,
    };
  };

  const categories: UnbilledCategoryGroup[] = [
    groupRows("service-time"),
    groupRows("project-tm"),
    groupRows("project-fixed"),
  ];

  const grossTotal = round2(categories.reduce((s, c) => s + c.grossTotal, 0));
  const recognizedTotal = round2(
    categories.reduce((s, c) => s + c.recognizedTotal, 0)
  );

  return {
    asOfDate,
    periodKey,
    categories,
    grossTotal,
    recognizedTotal,
    lastSavedAt: storedSelections?.savedAt ?? null,
  };
}

function monthsBack(asOfDate: string, months: number): string {
  const [y, m, d] = asOfDate.split("-").map(Number);
  const anchor = new Date(Date.UTC(y, m - 1, d));
  anchor.setUTCMonth(anchor.getUTCMonth() - months);
  anchor.setUTCDate(1);
  const fy = anchor.getUTCFullYear();
  const fm = String(anchor.getUTCMonth() + 1).padStart(2, "0");
  return `${fy}-${fm}-01`;
}
