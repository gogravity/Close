import "server-only";
import { listSalesInvoices, type BcSalesInvoice } from "./businessCentral";
import { listInvoices, type CwInvoice } from "./connectwise";

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
  period: { start: string; end: string };
  customers: CustomerGroup[];
  totals: {
    cw: number;
    bc: number;
    discrepancies: number;
    customers: number;
    invoices: number;
  };
};

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
  start: string,
  end: string
): Promise<InvoiceReconResult> {
  const [bcInvoices, cwInvoices] = await Promise.all([
    listSalesInvoices(start, end),
    listInvoices(start, end),
  ]);
  return buildResult(start, end, bcInvoices, cwInvoices);
}

function buildResult(
  start: string,
  end: string,
  bcInvoices: BcSalesInvoice[],
  cwInvoices: CwInvoice[]
): InvoiceReconResult {
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
    const date = inv.invoiceDate?.slice(0, 10);
    if (!date || date < start || date > end) continue;
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
        date,
        cwAmount: null,
        bcAmount: inv.totalAmountIncludingTax ?? 0,
      });
    }
  }

  for (const inv of cwInvoices) {
    const date = inv.date?.slice(0, 10);
    if (!date || date < start || date > end) continue;
    const invNo = normalizeInvoiceNumber(inv.invoiceNumber ?? "");
    if (!invNo) continue;
    const custName = inv.company?.name || inv.company?.identifier || "(unknown customer)";
    const custKey = normalizeCustomerName(custName);
    const key = `${custKey}|${invNo}`;
    // CW's `total` is tax-inclusive in this tenant; matches BC's totalAmountIncludingTax.
    const existing = byKey.get(key);
    if (existing) {
      existing.cwAmount = (existing.cwAmount ?? 0) + (inv.total ?? 0);
      existing.date = existing.date || date;
    } else {
      byKey.set(key, {
        invoiceNumber: invNo,
        customerName: custName,
        customerKey: custKey,
        date,
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
    const cwR = entry.cwAmount === null ? null : round2(entry.cwAmount);
    const bcR = entry.bcAmount === null ? null : round2(entry.bcAmount);
    let status: InvoiceEntry["status"];
    let source: InvoiceEntry["source"];
    if (cwR === null && bcR !== null) {
      source = "bc"; status = "missing-cw";
    } else if (cwR !== null && bcR === null) {
      source = "cw"; status = "missing-bc";
    } else {
      source = "both";
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
        cwTotal: 0, bcTotal: 0,
        discrepancyCount: 0, invoiceCount: 0,
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
      source, status,
      cwAmount: cwR, bcAmount: bcR,
    });
  }

  const customers = [...grouped.values()]
    .map((g) => {
      g.cwTotal = round2(g.cwTotal);
      g.bcTotal = round2(g.bcTotal);
      g.invoices.sort((x, y) =>
        x.date.localeCompare(y.date) || x.invoiceNumber.localeCompare(y.invoiceNumber)
      );
      return g;
    })
    .sort((x, y) =>
      x.customerName.localeCompare(y.customerName, undefined, { sensitivity: "base" })
    );

  return {
    period: { start, end },
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
