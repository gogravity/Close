import ExcelJS from "exceljs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import "server-only";
import { listAccounts, getAccountBalances, type BcAccount } from "./businessCentral";
import { getEntityConfig } from "./settings";

const TEMPLATE_FILE = path.join(process.cwd(), ".data", "bs-summary-template.json");

type BsTemplate = {
  source: string;
  sheet: string;
  rows: (string | number | null)[][];
  balanceColumn: number;
  accountNameColumn: number;
  classificationColumn: number;
};

async function loadTemplate(): Promise<BsTemplate | null> {
  try {
    const raw = await readFile(TEMPLATE_FILE, "utf8");
    return JSON.parse(raw) as BsTemplate;
  } catch {
    return null;
  }
}

/** Normalizes names for fuzzy matching: lowercase, strip punctuation/spaces. */
function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Tokens present in a name for overlap scoring. */
function tokens(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 2)
  );
}

function bestMatch(
  reportRowName: string,
  bcAccounts: BcAccount[]
): BcAccount | null {
  const targetNorm = norm(reportRowName);
  const targetTokens = tokens(reportRowName);
  // Rows containing "adjustment" in the label are manual adjustment lines in the
  // live report — they shouldn't auto-match to a BC account.
  if (/\badjustment\b/i.test(reportRowName)) return null;

  let best: { account: BcAccount; score: number } | null = null;
  for (const a of bcAccounts) {
    // Skip BC accounts with blank display names (usually header/total placeholders).
    if (!a.displayName || !a.displayName.trim()) continue;
    const candidateNorm = norm(a.displayName);
    if (!candidateNorm) continue;
    let score = 0;
    if (candidateNorm === targetNorm) score = 100;
    else if (targetNorm.includes(candidateNorm) || candidateNorm.includes(targetNorm))
      score = 70;
    else {
      const candidateTokens = tokens(a.displayName);
      const overlap = [...targetTokens].filter((t) => candidateTokens.has(t)).length;
      if (overlap > 0) score = overlap * 10;
    }
    if (a.subCategory && targetNorm.includes(norm(a.subCategory))) score += 5;
    if (!best || score > best.score) best = { account: a, score };
  }
  // Require a strong score to accept a match — substring or full-name match only.
  return best && best.score >= 50 ? best.account : null;
}

export type RowMatch = {
  rowIndex: number;
  label: string;
  matchedNumber: string | null;
  matchedName: string | null;
  balance: number | null;
};

export async function buildClosePackage(): Promise<{
  workbook: ExcelJS.Workbook;
  summary: {
    asOf: string;
    matched: number;
    unmatched: number;
    rows: RowMatch[];
  };
}> {
  const entity = await getEntityConfig();
  const template = await loadTemplate();
  if (!template) {
    throw new Error(
      "BS Summary template not loaded. Drop a bs-summary-template.json into .data/."
    );
  }
  const [accounts, balances] = await Promise.all([
    listAccounts(),
    getAccountBalances(entity.periodEnd),
  ]);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "BS Recon";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet(template.sheet);
  const matches: RowMatch[] = [];

  for (let r = 0; r < template.rows.length; r++) {
    const src = template.rows[r];
    const excelRow = sheet.getRow(r + 1);
    for (let c = 0; c < src.length; c++) {
      const v = src[c];
      if (v !== null && v !== undefined && v !== "") {
        excelRow.getCell(c + 1).value = v as string | number;
      }
    }
    // If this row has an account name (column D = index 3) and a numeric balance slot
    // (column F = index 5), try to populate from BC.
    const label = src[template.accountNameColumn - 1];
    const cls = src[template.classificationColumn - 1];
    if (
      typeof label === "string" &&
      typeof cls === "string" &&
      ["Assets", "Liabilities", "Equity"].includes(cls)
    ) {
      const match = bestMatch(label, accounts);
      const balance = match ? balances.get(match.number) ?? 0 : null;
      if (match) {
        excelRow.getCell(template.balanceColumn).value = balance;
        excelRow.getCell(template.balanceColumn).numFmt = "#,##0.00;(#,##0.00);-";
      }
      matches.push({
        rowIndex: r + 1,
        label,
        matchedNumber: match?.number ?? null,
        matchedName: match?.displayName ?? null,
        balance,
      });
    }
  }

  // Set column widths for readability
  sheet.getColumn(1).width = 5;
  sheet.getColumn(2).width = 14;
  sheet.getColumn(3).width = 18;
  sheet.getColumn(4).width = 32;
  sheet.getColumn(5).width = 30;
  sheet.getColumn(6).width = 16;

  // Second sheet: BC trial balance — every non-zero posting account for drill-down
  const tbSheet = workbook.addWorksheet("BC Trial Balance");
  tbSheet.addRow(["Account #", "Account Name", "Category", "Sub-category", "Balance"]);
  tbSheet.getRow(1).font = { bold: true };
  const sortedAccounts = [...accounts].sort((a, b) => a.number.localeCompare(b.number));
  for (const a of sortedAccounts) {
    const bal = balances.get(a.number) ?? 0;
    if (bal === 0) continue;
    const r = tbSheet.addRow([a.number, a.displayName, a.category, a.subCategory, bal]);
    r.getCell(5).numFmt = "#,##0.00;(#,##0.00);-";
  }
  tbSheet.getColumn(1).width = 12;
  tbSheet.getColumn(2).width = 36;
  tbSheet.getColumn(3).width = 20;
  tbSheet.getColumn(4).width = 22;
  tbSheet.getColumn(5).width = 16;

  const matched = matches.filter((m) => m.matchedNumber).length;
  return {
    workbook,
    summary: {
      asOf: entity.periodEnd,
      matched,
      unmatched: matches.length - matched,
      rows: matches,
    },
  };
}
