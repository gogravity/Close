import { readFile } from "node:fs/promises";
import path from "node:path";
import "server-only";
import { sections as sectionDefs, type Section } from "./recon";
import { getAccountMappings, getEntityConfig } from "./settings";
import { listAccounts, getAccountBalances } from "./businessCentral";

const TEMPLATE_FILE = path.join(process.cwd(), ".data", "adjustments-template.json");

export type Tier = "live" | "roll-forward" | "template";

export type JournalEntryLine = {
  account: string;
  debit: number;
  credit: number;
};

export type JournalEntry = {
  memo: string;
  reverseFlag?: string | null;
  lines: JournalEntryLine[];
};

export type SectionAccount = {
  number: string;
  displayName: string;
  unadjustedBalance: number;
};

export type SectionComputed = {
  section: Section;
  tier: Tier;
  sourceLabel: string;
  unadjusted: number;
  expected: number;
  adjustment: number;
  accounts: SectionAccount[];
  journalEntry: JournalEntry | null;
  rolledForwardFrom?: string;
  notes: string[];
};

// Columns of the prior-period adjustments template mapped to our recon sections.
// When we roll forward, each section uses its matching template column as the
// expected adjustment pattern.
const SECTION_ADJUSTMENT_COLUMNS: Record<string, string[]> = {
  "accounts-receivable": ["J"], // allowance true-up
  "accounts-payable": ["Q"], // AP adjustment
  "accrued-expenses": ["W", "X", "Y"], // Accrued Exp + Bonus + PTO
  "payroll-liabilities": ["T"], // Accrue Payroll Liabilities
  "tax-liabilities": ["Z"], // Sales Tax true-up
  "deferred-revenue": [], // none in template
  "unbilled-revenue": [], // none in template
  cash: ["G", "H"], // US Bank true-up + FlexPoint
  "credit-cards": [],
  "customer-prepayments": ["I"], // Reclass credit AR → Customer Prepayments
  inventory: [],
};

type AdjustmentColumn = {
  columnLetter: string;
  description: string;
  reverseFlag: string | null;
  entries: Record<string, number>;
  entryCount: number;
};

type AdjustmentsTemplate = {
  source: string;
  sourcePeriod: string;
  asOf: string;
  adjustments: AdjustmentColumn[];
};

async function loadTemplate(): Promise<AdjustmentsTemplate | null> {
  try {
    const raw = await readFile(TEMPLATE_FILE, "utf8");
    return JSON.parse(raw) as AdjustmentsTemplate;
  } catch {
    return null;
  }
}

type TierAssignment = {
  tier: Tier;
  sourceLabel: string;
};

// Each section's tier determines how expected balance is computed.
// For the Lyra-approval demo, Credit Cards is wired as "live" (via Ramp once
// we implement the statement pull); the rest are "roll-forward" using last
// period's adjustment template; empty template columns fall back to "template"
// (no adjustment = expected matches unadjusted).
const TIER_ASSIGNMENTS: Record<string, TierAssignment> = {
  cash: { tier: "roll-forward", sourceLabel: "Last period bank rec + FlexPoint holdings" },
  "accounts-receivable": { tier: "roll-forward", sourceLabel: "Prior-period allowance calc" },
  inventory: { tier: "template", sourceLabel: "No recurring adjustment" },
  "accounts-payable": { tier: "roll-forward", sourceLabel: "Prior-period AP reclass" },
  "customer-prepayments": { tier: "roll-forward", sourceLabel: "Prior-period AR credit reclass" },
  "credit-cards": { tier: "live", sourceLabel: "Ramp statement balance (not yet wired)" },
  "payroll-liabilities": { tier: "roll-forward", sourceLabel: "Prior-period payroll accrual (Gusto when wired)" },
  "accrued-expenses": { tier: "roll-forward", sourceLabel: "Prior-period accrual (expenses, bonus, PTO)" },
  "tax-liabilities": { tier: "roll-forward", sourceLabel: "Prior-period sales tax true-up" },
  "deferred-revenue": { tier: "template", sourceLabel: "ConnectWise agreements (not yet wired)" },
  "unbilled-revenue": { tier: "template", sourceLabel: "ConnectWise time entries (not yet wired)" },
};

/**
 * Compute all sections against BC unadjusted + roll-forward template.
 * Returns the snapshot used by both the section page and the export.
 */
export async function computeAllSections(): Promise<SectionComputed[]> {
  const [mappings, template, entity] = await Promise.all([
    getAccountMappings(),
    loadTemplate(),
    getEntityConfig(),
  ]);
  const [bcAccounts, bcBalances] = await Promise.all([
    listAccounts(),
    getAccountBalances(entity.periodEnd),
  ]);
  const bcByNumber = new Map(bcAccounts.map((a) => [a.number, a]));

  // Accounts assigned to each section via /mapping
  const accountsBySection = new Map<string, SectionAccount[]>();
  for (const [accountNumber, sectionSlug] of Object.entries(mappings)) {
    if (!sectionSlug) continue;
    const a = bcByNumber.get(accountNumber);
    if (!a) continue;
    const bal = bcBalances.get(a.number) ?? 0;
    const list = accountsBySection.get(sectionSlug) ?? [];
    list.push({
      number: a.number,
      displayName: a.displayName,
      unadjustedBalance: bal,
    });
    accountsBySection.set(sectionSlug, list);
  }

  const results: SectionComputed[] = [];
  for (const def of sectionDefs) {
    const sectionAccounts = accountsBySection.get(def.slug) ?? [];
    const unadjusted = sectionAccounts.reduce((s, a) => s + a.unadjustedBalance, 0);
    const assignment = TIER_ASSIGNMENTS[def.slug] ?? { tier: "template" as Tier, sourceLabel: "—" };
    const templateCols = SECTION_ADJUSTMENT_COLUMNS[def.slug] ?? [];
    const notes: string[] = [];

    // Build the journal entry from matching template columns (roll-forward).
    let adjustment = 0;
    let journalEntry: JournalEntry | null = null;
    let rolledForwardFrom: string | undefined;
    if (template && templateCols.length > 0) {
      const lines: JournalEntryLine[] = [];
      const memos: string[] = [];
      let reverseFlag: string | null | undefined;
      for (const colLetter of templateCols) {
        const col = template.adjustments.find((a) => a.columnLetter === colLetter);
        if (!col || col.entryCount === 0) continue;
        memos.push(col.description);
        if (!reverseFlag) reverseFlag = col.reverseFlag;
        for (const [acct, amount] of Object.entries(col.entries)) {
          if (amount === 0) continue;
          // Accumulate into the adjustment (balance impact on the BS section).
          // The JE has offsetting sides: the entry on the BS account side contributes
          // to adjustment; the opposite side is usually to an income/expense account.
          // We treat every non-zero entry as a line and the adjustment as the net of
          // lines that hit this section's BS accounts.
          const sign = amount > 0 ? "debit" : "credit";
          const abs = Math.abs(amount);
          lines.push({
            account: acct,
            debit: sign === "debit" ? abs : 0,
            credit: sign === "credit" ? abs : 0,
          });
          // If this adjustment entry targets one of our section's accounts, include
          // its signed amount in the adjustment.
          const targetsSection = sectionAccounts.some(
            (sa) =>
              acct.toLowerCase().includes(sa.displayName.toLowerCase()) ||
              sa.displayName.toLowerCase().includes(acct.toLowerCase())
          );
          if (targetsSection) adjustment += amount;
        }
      }
      if (lines.length > 0) {
        journalEntry = {
          memo: memos.join(" · "),
          reverseFlag,
          lines,
        };
        rolledForwardFrom = template.sourcePeriod;
      } else {
        notes.push("Template columns referenced but no non-zero entries to roll forward.");
      }
    }

    if (!template && templateCols.length > 0) {
      notes.push("No adjustments template loaded — roll-forward unavailable until .data/adjustments-template.json is present.");
    }

    results.push({
      section: def,
      tier: assignment.tier,
      sourceLabel: assignment.sourceLabel,
      unadjusted,
      expected: unadjusted + adjustment,
      adjustment,
      accounts: sectionAccounts,
      journalEntry,
      rolledForwardFrom,
      notes,
    });
  }
  return results;
}

export async function computeSection(slug: string): Promise<SectionComputed | null> {
  const all = await computeAllSections();
  return all.find((s) => s.section.slug === slug) ?? null;
}
