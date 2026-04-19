import "server-only";
import { listSalesInvoices, type BcSalesInvoice } from "./businessCentral";
import { listInvoices, type CwInvoice } from "./connectwise";

export type InvoiceMonth = { year: number; month: number }; // month: 1-12

export type InvoiceEntry = {
  invoiceNumber: string;
  date: string; // ISO YYYY-MM-DD
  amount: number;
  source: "cw" | "bc" | "both";
  status: "match" | "amount-mismatch" | "missing-cw" | "missing-bc";
  cwAmount: number | null;
  bcAmount: number | null;
};

export type CustomerGroup = {
  customerKey: string; // normalized name used for grouping
  customerName: string;
  cwTotal: number;
  bcTotal: number;
  discrepancyCount: number;
  invoiceCount: number;
  invoices: InvoiceEntry[];
};

export type InvoiceReconResult = {
  monthA: { year: number; month: number; start: string; end: string };
  monthB: { year: number; month: number; start: string; end: string };
  customers: CustomerGroup[];
  totals: {
    cw: number;
    bc: number;
    discrepancies: number;
    customers: number;
    invoices: number;
  };
};

function monthBounds(m: InvoiceMonth): { start: string; end: string } {
  const first = new Date(Date.UTC(m.year, m.month - 1, 1));
  const last = new Date(Date.UTC(m.year, m.month, 0)); // day 0 of next month = last day of this
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { start: fmt(first), end: fmt(last) };
}

function normalizeInvoiceNumber(n: string): string {
  return n.trim().toUpperCase();
}

function normalizeCustomerName(n: string): string {
  return n.trim().toLowerCase().replace(/\s+/g, " ");
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export async function reconcileInvoices(
  monthA: InvoiceMonth,
  monthB: InvoiceMonth
): Promise<InvoiceReconResult> {
  const a = monthBounds(monthA);
  const b = monthBounds(monthB);
  // Fetch the union window — one start-end range spanning both months. Order
  // them so start <= end regardless of which month the user picked first.
  const start = a.start <= b.start ? a.start : b.start;
  const end = a.end >= b.end ? a.end : b.end;
  const [bcInvoices, cwInvoices] = await Promise.all([
    listSalesInvoices(start, end),
    listInvoices(start, end),
  ]);
  return buildResult(monthA, monthB, a, b, bcInvoices, cwInvoices);
}

function buildResult(
  monthA: InvoiceMonth,
  monthB: InvoiceMonth,
  a: { start: string; end: string },
  b: { start: string; end: string },
  bcInvoices: BcSalesInvoice[],
  cwInvoices: CwInvoice[]
): InvoiceReconResult {
  // Keep only invoices that actually fall inside monthA OR monthB (the union
  // range can include a gap month if the user picks non-contiguous months).
  const inPickedMonths = (isoDate: string): boolean => {
    const d = isoDate.slice(0, 10);
    return (d >= a.start && d <= a.end) || (d >= b.start && d <= b.end);
  };

  type Entry = {
    invoiceNumber: string;
    customerName: string;
    customerKey: string;
    date: string;
    cwAmount: number | null;
    bcAmount: number | null;
  };
  const byKey = new Map<string, Entry>(); // key = customer|invoiceNumber

  for (const inv of bcInvoices) {
    if (!inv.invoiceDate || !inPickedMonths(inv.invoiceDate)) continue;
    const invNo = normalizeInvoiceNumber(inv.number ?? "");
    if (!invNo) continue;
    const custName = inv.customerName || inv.customerNumber || "(unknown customer)";
    const custKey = normalizeCustomerName(custName);
    const key = `${custKey}|${invNo}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.bcAmount = (existing.bcAmount ?? 0) + (inv.totalAmountIncludingTax ?? 0);
    } else {
      byKey.set(key, {
        invoiceNumber: invNo,
        customerName: custName,
        customerKey: custKey,
        date: inv.invoiceDate.slice(0, 10),
        cwAmount: null,
        bcAmount: inv.totalAmountIncludingTax ?? 0,
      });
    }
  }

  for (const inv of cwInvoices) {
    if (!inv.date || !inPickedMonths(inv.date)) continue;
    const invNo = normalizeInvoiceNumber(inv.invoiceNumber ?? "");
    if (!invNo) continue;
    const custName = inv.company?.name || inv.company?.identifier || "(unknown customer)";
    const custKey = normalizeCustomerName(custName);
    const key = `${custKey}|${invNo}`;
    // CW's `total` on /finance/invoices is already tax-inclusive in this
    // tenant (salesTax is a breakdown component of total, not additional).
    // Matches BC's totalAmountIncludingTax directly.
    const existing = byKey.get(key);
    if (existing) {
      existing.cwAmount = (existing.cwAmount ?? 0) + (inv.total ?? 0);
      // Prefer BC's date when we already have one; otherwise take CW's.
      existing.date = existing.date || inv.date.slice(0, 10);
    } else {
      byKey.set(key, {
        invoiceNumber: invNo,
        customerName: custName,
        customerKey: custKey,
        date: inv.date.slice(0, 10),
        cwAmount: inv.total ?? 0,
        bcAmount: null,
      });
    }
  }

  const grouped = new Map<string, CustomerGroup>();
  let grandCw = 0;
  let grandBc = 0;
  let grandDisc = 0;

  for (const entry of byKey.values()) {
    const cw = entry.cwAmount;
    const bc = entry.bcAmount;
    const cwR = cw === null ? null : round2(cw);
    const bcR = bc === null ? null : round2(bc);
    let status: InvoiceEntry["status"];
    let source: InvoiceEntry["source"];
    if (cwR === null && bcR !== null) {
      source = "bc";
      status = "missing-cw";
    } else if (cwR !== null && bcR === null) {
      source = "cw";
      status = "missing-bc";
    } else {
      source = "both";
      // cwR and bcR are both non-null here; the prior branches handle null cases.
      status = cwR === bcR ? "match" : "amount-mismatch";
    }
    grandCw += cwR ?? 0;
    grandBc += bcR ?? 0;
    if (status !== "match") grandDisc += 1;

    let group = grouped.get(entry.customerKey);
    if (!group) {
      group = {
        customerKey: entry.customerKey,
        customerName: entry.customerName,
        cwTotal: 0,
        bcTotal: 0,
        discrepancyCount: 0,
        invoiceCount: 0,
        invoices: [],
      };
      grouped.set(entry.customerKey, group);
    }
    group.cwTotal += cwR ?? 0;
    group.bcTotal += bcR ?? 0;
    group.invoiceCount += 1;
    if (status !== "match") group.discrepancyCount += 1;
    group.invoices.push({
      invoiceNumber: entry.invoiceNumber,
      date: entry.date,
      amount: bcR ?? cwR ?? 0,
      source,
      status,
      cwAmount: cwR,
      bcAmount: bcR,
    });
  }

  const customers = [...grouped.values()]
    .map((g) => {
      g.cwTotal = round2(g.cwTotal);
      g.bcTotal = round2(g.bcTotal);
      g.invoices.sort((x, y) => x.date.localeCompare(y.date) || x.invoiceNumber.localeCompare(y.invoiceNumber));
      return g;
    })
    .sort((x, y) => x.customerName.localeCompare(y.customerName, undefined, { sensitivity: "base" }));

  return {
    monthA: { year: monthA.year, month: monthA.month, start: a.start, end: a.end },
    monthB: { year: monthB.year, month: monthB.month, start: b.start, end: b.end },
    customers,
    totals: {
      cw: round2(grandCw),
      bc: round2(grandBc),
      discrepancies: grandDisc,
      customers: customers.length,
      invoices: byKey.size,
    },
  };
}
