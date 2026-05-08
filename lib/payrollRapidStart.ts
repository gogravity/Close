/**
 * BC RapidStart Configuration Package generator for the payroll JE.
 *
 * Output is a gzipped UTF-16-LE XML `.rapidstart` file — BC's Configuration
 * Packages → Import Package action accepts it directly. Structure mirrors
 * what `Export Package` produces from BC.
 *
 * Pattern (modelled on Gravitron's ap_pax8_generator.py):
 *   1. Load the template `.rapidstart` (gzip → utf-16le decode → string)
 *   2. Locate every <GenJournalLine>...</GenJournalLine> block in the template
 *   3. Use the first block as the schema-defining clone source
 *   4. Replace ALL existing record blocks with one freshly-populated block
 *      per JE summary row, via simple regex `setField`
 *   5. Re-encode utf-16le with BOM, gzip, return as Buffer
 *
 * Template lives at `lib/rapidStart/payroll_je_template.rapidstart` and was
 * exported from BC's "GRAVITY PAYROLL" Configuration Package.
 */
import "server-only";
import { gunzip as gunzipCb, gzip as gzipCb } from "node:zlib";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import path from "node:path";

const gunzip = promisify(gunzipCb);
const gzip   = promisify(gzipCb);

const TEMPLATE_PATH = path.join(
  process.cwd(),
  "lib",
  "rapidStart",
  "payroll_je_template.rapidstart"
);

export type RapidStartLine = {
  account: string;
  accountName: string;
  lineItem: string;
  debit: number;
  credit: number;
  /** Customer name (exact CW name) — when set, stamps the DCS extension
   *  field BTG_BAS Manage Client Name (table 81 field 70201) on the line.
   *  Used for per-customer payroll attribution. */
  companyName?: string;
};

export type RapidStartConfig = {
  summaryRows: RapidStartLine[];
  /** YYYY-MM-DD — typically the last day of the pay period. */
  postingDate: string;
  /** e.g. "PAY APR 16 - APR 30" — capped at 20 chars by BC. */
  documentNo: string;
  /** Defaults to "GENERAL". */
  journalTemplate?: string;
  /** Defaults to "PAYROLL". */
  journalBatch?: string;
};

// ── Internal helpers ─────────────────────────────────────────────────────

async function loadTemplateXml(): Promise<string> {
  const buf = await readFile(TEMPLATE_PATH);
  const decompressed = await gunzip(buf);
  // Strip UTF-16-LE BOM (FF FE) if present
  const start = decompressed[0] === 0xff && decompressed[1] === 0xfe ? 2 : 0;
  return decompressed.subarray(start).toString("utf16le");
}

/** Replace inner content of the first matching `<tag>...</tag>` element.
 *  Preserves any attributes on the opening tag (ValidateField, ProcessingOrder). */
function setField(xml: string, tag: string, value: string): string {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pat = new RegExp(`(<${escaped}(?:\\s[^>]*)?>)([\\s\\S]*?)(</${escaped}>)`);
  return xml.replace(pat, (_full, open, _content, close) => `${open}${value}${close}`);
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildLineBlock(
  template: string,
  cfg: RapidStartConfig,
  row: RapidStartLine,
  lineNo: number
): string {
  const dr = row.debit  > 0 ? row.debit  : 0;
  const cr = row.credit > 0 ? row.credit : 0;
  // Amount/AmountLCY are signed: +DR, -CR (per BC's sample data)
  const signedAmount = dr > 0 ? dr : -cr;

  let b = template;
  b = setField(b, "JournalTemplateName", escapeXml(cfg.journalTemplate ?? "GENERAL"));
  b = setField(b, "JournalBatchName",    escapeXml(cfg.journalBatch ?? "PAYROLL"));
  b = setField(b, "LineNo",              String(lineNo));
  b = setField(b, "AccountType",         "0"); // 0 = G/L Account
  b = setField(b, "AccountNo",           escapeXml(row.account));
  b = setField(b, "PostingDate",         cfg.postingDate);
  b = setField(b, "DocumentType",        "0"); // 0 = blank (standard JE)
  // BC's Gen. Journal Line Document No. is capped at 20 chars
  b = setField(b, "DocumentNo",          escapeXml(cfg.documentNo.slice(0, 20)));
  b = setField(b, "DocumentDate",        cfg.postingDate);
  b = setField(b, "Description",         escapeXml(row.lineItem.slice(0, 100)));
  b = setField(b, "Amount",              signedAmount.toFixed(2));
  b = setField(b, "AmountLCY",           signedAmount.toFixed(2));
  b = setField(b, "DebitAmount",         dr.toFixed(2));
  b = setField(b, "CreditAmount",        cr.toFixed(2));
  if (row.companyName) {
    // Field 70201 — DCS BTG_BAS Manage Client Name extension
    b = setField(b, "BTG_BASManageClientName", escapeXml(row.companyName));
  }
  return b;
}

// ── Public API ───────────────────────────────────────────────────────────

export async function buildPayrollRapidStart(cfg: RapidStartConfig): Promise<Buffer> {
  if (!cfg.summaryRows.length) throw new Error("summaryRows is empty");

  const xml = await loadTemplateXml();

  const blockRe = /<GenJournalLine>[\s\S]*?<\/GenJournalLine>/g;
  const matches: { index: number; length: number; text: string }[] = [];
  for (const m of xml.matchAll(blockRe)) {
    matches.push({ index: m.index!, length: m[0].length, text: m[0] });
  }
  if (matches.length === 0) {
    throw new Error("Template has no <GenJournalLine> blocks");
  }

  const cloneSource = matches[0].text;
  const newBlocks: string[] = [];
  let lineNo = 10000;
  for (const row of cfg.summaryRows) {
    newBlocks.push(buildLineBlock(cloneSource, cfg, row, lineNo));
    lineNo += 10000;
  }

  const firstStart = matches[0].index;
  const lastEnd    = matches[matches.length - 1].index + matches[matches.length - 1].length;
  const joined     = newBlocks.join("\r\n    ");
  const outXml     = xml.slice(0, firstStart) + joined + xml.slice(lastEnd);

  const bom  = Buffer.from([0xff, 0xfe]);
  const body = Buffer.from(outXml, "utf16le");
  return gzip(Buffer.concat([bom, body]));
}
