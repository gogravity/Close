// Client-side utilities for turning a Gusto "Payroll Journal Report" CSV +
// the per-member bucket percentages computed by the Payroll Allocation page
// into a drafted BC payroll journal entry.

import type { Dept, Bucket } from "./types";

// ---------------------------------------------------------------------------
// Minimal CSV parser — handles quoted fields with commas, doubled quotes for
// escaping, and CRLF line endings. No fancy dependency needed for the shape
// Gusto emits.
// ---------------------------------------------------------------------------
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuote = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuote) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') {
        inQuote = false;
      } else {
        cell += c;
      }
    } else {
      if (c === '"') inQuote = true;
      else if (c === ",") {
        row.push(cell);
        cell = "";
      } else if (c === "\r") {
        // ignore
      } else if (c === "\n") {
        row.push(cell);
        rows.push(row);
        row = [];
        cell = "";
      } else {
        cell += c;
      }
    }
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Gusto Payroll Journal Report shape
// ---------------------------------------------------------------------------

export type GustoEmployee = {
  lastName: string;
  firstName: string;
  gustoName: string; // "Last, First"
  // Earnings
  regularHours: number;
  regularAmount: number;
  timeOffHours: number;
  timeOffAmount: number;
  grossEarnings: number;
  // Taxes
  employeeTaxes: number;
  employerTaxes: number;
  federalIncomeTax: number;
  socialSecurityEmployee: number;
  medicareEmployee: number;
  stateIncomeTax: number;
  socialSecurityEmployer: number;
  medicareEmployer: number;
  futa: number;
  suta: number;
  // Benefits — company contribution totals (employer piece)
  medicalInsuranceEmployer: number;
  medicalInsuranceEmployee: number;
  dentalInsuranceEmployee: number;
  dentalInsuranceEmployer: number;
  aflacPreEmployee: number;
  aflacPreEmployer: number;
  aflacAfterEmployee: number;
  aflacAfterEmployer: number;
  trad401kEmployee: number;
  trad401kEmployer: number;
  roth401kEmployee: number;
  roth401kEmployer: number;
  principalLifeEmployee: number;
  principalLifeEmployer: number;
  visionEmployee: number;
  visionEmployer: number;
  voluntaryLifeEmployee: number;
  voluntaryLifeEmployer: number;
  hsaEmployee: number;
  hsaEmployer: number;
  cellPhoneReimbursement: number;
  netPay: number;
};

function num(s: string | undefined): number {
  if (s == null) return 0;
  const trimmed = s.trim();
  if (!trimmed) return 0;
  const n = Number(trimmed.replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/** Parse the Gusto "Payroll Journal Report" CSV into per-employee rows.
 *  The header row with "Last Name,First Name,..." is typically on or near
 *  line 10 — we scan for the first row whose first cell is "Last Name". */
export function parseGustoCsv(text: string): {
  employees: GustoEmployee[];
  totals: GustoEmployee | null;
} {
  const rows = parseCsv(text);
  let headerIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    if ((rows[i][0] ?? "").trim().toLowerCase() === "last name") {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx < 0) return { employees: [], totals: null };
  const headers = rows[headerIdx].map((h) => (h ?? "").trim());
  const col = (name: string): number => headers.findIndex((h) => h === name);

  const cols = {
    last: col("Last Name"),
    first: col("First Name"),
    regHours: col("Regular (Hours)"),
    regAmount: col("Regular (Amount)"),
    timeOffHours: col("Time Off (Hours)"),
    timeOffAmount: col("Time Off (Amount)"),
    gross: col("Gross Earnings"),
    empTaxes: col("Employee Taxes"),
    erTaxes: col("Employer Taxes"),
    fed: col("Federal Income Tax (Employee)"),
    ssEmp: col("Social Security (Employee)"),
    medEmp: col("Medicare (Employee)"),
    stateEmp: col("UT Withholding Tax (Employee)"),
    ssEr: col("Social Security (Employer)"),
    medEr: col("Medicare (Employer)"),
    futa: col("FUTA (Employer)"),
    suta: col("TN Unemployment Insurance Premiums (Employer)"),
    medicalEmp: col("Medical Insurance (Employee Deduction)"),
    medicalEr: col("Medical Insurance (Company Contribution)"),
    dentalEmp: col("Dental Insurance (Employee Deduction)"),
    dentalEr: col("Dental Insurance (Company Contribution)"),
    aflacPreEmp: col("Aflac Pre (Employee Deduction)"),
    aflacPreEr: col("Aflac Pre (Company Contribution)"),
    aflacAfterEmp: col("Aflac After (Employee Deduction)"),
    aflacAfterEr: col("Aflac After (Company Contribution)"),
    tradEmp: col("Guideline Traditional 401(k) (Employee Deduction)"),
    tradEr: col("Guideline Traditional 401(k) (Company Contribution)"),
    rothEmp: col("Guideline Roth 401(k) (Employee Deduction)"),
    rothEr: col("Guideline Roth 401(k) (Company Contribution)"),
    lifeEmp: col("Principal Life (Employee Deduction)"),
    lifeEr: col("Principal Life (Company Contribution)"),
    visionEmp: col("Vision (Employee Deduction)"),
    visionEr: col("Vision (Company Contribution)"),
    volLifeEmp: col("Voluntary Life (Employee Deduction)"),
    volLifeEr: col("Voluntary Life (Company Contribution)"),
    hsaEmp: col("Health Savings Account (Employee Deduction)"),
    hsaEr: col("Health Savings Account (Company Contribution)"),
    cellPhone: col("Cell phone"),
    netPay: col("Net Pay"),
  };

  const mkRow = (r: string[]): GustoEmployee => {
    const lastName = (r[cols.last] ?? "").trim();
    const firstName = (r[cols.first] ?? "").trim();
    return {
      lastName,
      firstName,
      gustoName: `${lastName}, ${firstName}`,
      regularHours: num(r[cols.regHours]),
      regularAmount: num(r[cols.regAmount]),
      timeOffHours: num(r[cols.timeOffHours]),
      timeOffAmount: num(r[cols.timeOffAmount]),
      grossEarnings: num(r[cols.gross]),
      employeeTaxes: num(r[cols.empTaxes]),
      employerTaxes: num(r[cols.erTaxes]),
      federalIncomeTax: num(r[cols.fed]),
      socialSecurityEmployee: num(r[cols.ssEmp]),
      medicareEmployee: num(r[cols.medEmp]),
      stateIncomeTax: num(r[cols.stateEmp]),
      socialSecurityEmployer: num(r[cols.ssEr]),
      medicareEmployer: num(r[cols.medEr]),
      futa: num(r[cols.futa]),
      suta: num(r[cols.suta]),
      medicalInsuranceEmployer: num(r[cols.medicalEr]),
      medicalInsuranceEmployee: num(r[cols.medicalEmp]),
      dentalInsuranceEmployee: num(r[cols.dentalEmp]),
      dentalInsuranceEmployer: num(r[cols.dentalEr]),
      aflacPreEmployee: num(r[cols.aflacPreEmp]),
      aflacPreEmployer: num(r[cols.aflacPreEr]),
      aflacAfterEmployee: num(r[cols.aflacAfterEmp]),
      aflacAfterEmployer: num(r[cols.aflacAfterEr]),
      trad401kEmployee: num(r[cols.tradEmp]),
      trad401kEmployer: num(r[cols.tradEr]),
      roth401kEmployee: num(r[cols.rothEmp]),
      roth401kEmployer: num(r[cols.rothEr]),
      principalLifeEmployee: num(r[cols.lifeEmp]),
      principalLifeEmployer: num(r[cols.lifeEr]),
      visionEmployee: num(r[cols.visionEmp]),
      visionEmployer: num(r[cols.visionEr]),
      voluntaryLifeEmployee: num(r[cols.volLifeEmp]),
      voluntaryLifeEmployer: num(r[cols.volLifeEr]),
      hsaEmployee: num(r[cols.hsaEmp]),
      hsaEmployer: num(r[cols.hsaEr]),
      cellPhoneReimbursement: num(r[cols.cellPhone]),
      netPay: num(r[cols.netPay]),
    };
  };

  const employees: GustoEmployee[] = [];
  let totals: GustoEmployee | null = null;
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    const last = (r[cols.last] ?? "").trim();
    if (!last) continue;
    if (last.toLowerCase() === "totals") {
      totals = mkRow(r);
      continue;
    }
    employees.push(mkRow(r));
  }
  return { employees, totals };
}

// ---------------------------------------------------------------------------
// Match Gusto employees to CW members (name-based).
// ---------------------------------------------------------------------------

export type CwMemberLike = {
  memberId: number;
  name: string; // "First Last"
  identifier: string;
};

export type EmployeeMatch = {
  gusto: GustoEmployee;
  cwMember: CwMemberLike | null;
};

/** Case-insensitive match on last name + first-letter of first name. */
export function matchEmployees(
  gustoEmps: GustoEmployee[],
  cwMembers: CwMemberLike[]
): EmployeeMatch[] {
  const normalize = (s: string) => s.trim().toLowerCase();
  return gustoEmps.map((g) => {
    const last = normalize(g.lastName);
    const firstLetter = normalize(g.firstName).charAt(0);
    const match = cwMembers.find((m) => {
      const parts = m.name.split(/\s+/);
      if (parts.length < 2) return false;
      const mLast = normalize(parts[parts.length - 1]);
      const mFirstLetter = normalize(parts[0]).charAt(0);
      return mLast === last && mFirstLetter === firstLetter;
    });
    return { gusto: g, cwMember: match ?? null };
  });
}

// ---------------------------------------------------------------------------
// Journal-entry construction
// ---------------------------------------------------------------------------

export const BUCKET_ACCOUNTS: Record<
  Bucket,
  { grossWages: string; payrollTaxes: string; name: string }
> = {
  managed: {
    grossWages: "500010",
    payrollTaxes: "500040",
    name: "Managed IT Services COGS",
  },
  recurring: {
    grossWages: "503000",
    payrollTaxes: "500040",
    name: "Re-ocurring Services COGS",
  },
  nonRecurring: {
    grossWages: "505010",
    payrollTaxes: "500040",
    name: "Non-recurring Professional Services COGS",
  },
  voip: {
    grossWages: "502040",
    payrollTaxes: "500040",
    name: "Recurring VOIP & Connectivity Resale COGS",
  },
  sales: {
    grossWages: "600010",
    payrollTaxes: "600040",
    name: "Salary and Wages / Payroll Taxes",
  },
  admin: {
    grossWages: "600010",
    payrollTaxes: "600040",
    name: "Salary and Wages / Payroll Taxes",
  },
};

export const BUCKET_ORDER: Bucket[] = [
  "managed",
  "recurring",
  "nonRecurring",
  "voip",
  "sales",
  "admin",
];

export const BUCKET_LABELS: Record<Bucket, string> = {
  managed: "Managed Services",
  recurring: "Re-occurring",
  nonRecurring: "Non-recurring",
  voip: "VOIP",
  sales: "Sales",
  admin: "Admin",
};

export type PctByBucket = Record<Bucket, number>; // numbers are percentages (0-100)

/** Resolve a weight vector across the 6 buckets for a single employee.
 *  Prefers the tracked-time percentages (pct); falls back to a 100% weight
 *  on the bucket that matches the employee's department. */
function weightsFor(
  pct: PctByBucket | null,
  defaultDept: Dept
): Record<Bucket, number> {
  const w: Record<Bucket, number> = zeroBuckets();
  if (pct) {
    const sum = BUCKET_ORDER.reduce((s, b) => s + pct[b], 0);
    if (sum > 0.001) {
      for (const b of BUCKET_ORDER) w[b] = pct[b] / sum;
      return w;
    }
  }
  const fb: Bucket =
    defaultDept === "sales"
      ? "sales"
      : defaultDept === "managed"
        ? "managed"
        : defaultDept === "professional"
          ? "nonRecurring"
          : "admin";
  w[fb] = 1;
  return w;
}

function splitAmount(
  amount: number,
  w: Record<Bucket, number>
): Record<Bucket, number> {
  const out: Record<Bucket, number> = zeroBuckets();
  for (const b of BUCKET_ORDER) out[b] = amount * w[b];
  return out;
}

/** Build per-employee bucket split of wages, taxes, and employer-paid
 *  benefits using their percentages. Employee deductions and benefit totals
 *  are NOT split — they're period-level credits that don't vary by dept. */
export function splitEmployeeByBucket(
  emp: GustoEmployee,
  pct: PctByBucket | null,
  defaultDept: Dept = "admin"
): {
  grossByBucket: Record<Bucket, number>;
  erTaxByBucket: Record<Bucket, number>;
  medicalErByBucket: Record<Bucket, number>;
  principalLifeErByBucket: Record<Bucket, number>;
  trad401kErByBucket: Record<Bucket, number>;
} {
  // Cash wages only — exclude imputed income (Principal Life imputed col)
  // from the DR basis. Imputed is phantom taxable income with no cash
  // movement; Sheet1 template uses Regular + Time Off for the wage DR and
  // ignores imputed. Including it would inflate DRs with no offsetting CR
  // and throw the JE out of balance.
  const cashWages = emp.regularAmount + emp.timeOffAmount;
  const w = weightsFor(pct, defaultDept);
  return {
    grossByBucket: splitAmount(cashWages, w),
    erTaxByBucket: splitAmount(emp.employerTaxes, w),
    medicalErByBucket: splitAmount(emp.medicalInsuranceEmployer, w),
    principalLifeErByBucket: splitAmount(emp.principalLifeEmployer, w),
    trad401kErByBucket: splitAmount(emp.trad401kEmployer, w),
  };
}

function zeroBuckets(): Record<Bucket, number> {
  return {
    managed: 0,
    recurring: 0,
    nonRecurring: 0,
    voip: 0,
    sales: 0,
    admin: 0,
  };
}

export type JeBucketRow = {
  lineItem: string;
  byBucket: Record<Bucket, number>;
  total: number;
  accountByBucket: Record<Bucket, string>; // BC account # per bucket (same for some lines)
};

export type JeSummaryRow = {
  lineItem: string;
  debit: number;
  credit: number;
  account: string;
  accountName: string;
};

export type JournalEntry = {
  /** Per-bucket breakdown rows for display (mirrors Sheet1 format). */
  bucketRows: JeBucketRow[];
  /** Flat DR/CR summary for export. */
  summaryRows: JeSummaryRow[];
  debitTotal: number;
  creditTotal: number;
};

/** Aggregate per-employee splits into a full BC-ready JE. Unmatched Gusto
 *  employees (no CW member) can have a user-chosen dept override keyed by
 *  gustoName ("Last, First"); without one, they fall to admin. */
export function buildPayrollJe(
  matches: EmployeeMatch[],
  percentagesByMemberId: Record<number, PctByBucket>,
  deptByMemberId: Record<number, Dept>,
  unmatchedDeptByGustoName: Record<string, Dept>,
  totals: GustoEmployee | null
): JournalEntry {
  const totalGrossByBucket = zeroBuckets();
  const totalErTaxByBucket = zeroBuckets();
  const totalMedicalErByBucket = zeroBuckets();
  const totalPrincipalLifeErByBucket = zeroBuckets();
  const totalTrad401kErByBucket = zeroBuckets();

  for (const m of matches) {
    const memberId = m.cwMember?.memberId;
    const pct =
      memberId != null ? percentagesByMemberId[memberId] ?? null : null;
    const dept =
      memberId != null
        ? deptByMemberId[memberId] ?? "admin"
        : unmatchedDeptByGustoName[m.gusto.gustoName] ?? "admin";
    const split = splitEmployeeByBucket(m.gusto, pct, dept);
    for (const b of BUCKET_ORDER) {
      totalGrossByBucket[b] += split.grossByBucket[b];
      totalErTaxByBucket[b] += split.erTaxByBucket[b];
      totalMedicalErByBucket[b] += split.medicalErByBucket[b];
      totalPrincipalLifeErByBucket[b] += split.principalLifeErByBucket[b];
      totalTrad401kErByBucket[b] += split.trad401kErByBucket[b];
    }
  }

  // Roll up Gusto totals for the non-split lines.
  const grand = totals ?? aggregateTotals(matches.map((m) => m.gusto));

  const grossWagesAcctMap: Record<Bucket, string> = {
    managed: BUCKET_ACCOUNTS.managed.grossWages,
    recurring: BUCKET_ACCOUNTS.recurring.grossWages,
    nonRecurring: BUCKET_ACCOUNTS.nonRecurring.grossWages,
    voip: BUCKET_ACCOUNTS.voip.grossWages,
    sales: BUCKET_ACCOUNTS.sales.grossWages,
    admin: BUCKET_ACCOUNTS.admin.grossWages,
  };
  const payrollTaxAcctMap: Record<Bucket, string> = {
    managed: BUCKET_ACCOUNTS.managed.payrollTaxes,
    recurring: BUCKET_ACCOUNTS.recurring.payrollTaxes,
    nonRecurring: BUCKET_ACCOUNTS.nonRecurring.payrollTaxes,
    voip: BUCKET_ACCOUNTS.voip.payrollTaxes,
    sales: BUCKET_ACCOUNTS.sales.payrollTaxes,
    admin: BUCKET_ACCOUNTS.admin.payrollTaxes,
  };

  // Benefits all book to the same account regardless of bucket (per Sheet1
  // template: Medical ER + Principal Life ER → 600080, 401k Match → 600090).
  // The bucket breakdown is informational — it shows which dept the
  // benefit cost attaches to, even though it hits a single SG&A account.
  const benefitAcctMap = (acct: string): Record<Bucket, string> => ({
    managed: acct,
    recurring: acct,
    nonRecurring: acct,
    voip: acct,
    sales: acct,
    admin: acct,
  });

  const bucketRows: JeBucketRow[] = [
    {
      lineItem: "Gross wages",
      byBucket: totalGrossByBucket,
      total: sumBuckets(totalGrossByBucket),
      accountByBucket: grossWagesAcctMap,
    },
    {
      lineItem: "Employer payroll taxes",
      byBucket: totalErTaxByBucket,
      total: sumBuckets(totalErTaxByBucket),
      accountByBucket: payrollTaxAcctMap,
    },
    {
      lineItem: "Medical Insurance (employer)",
      byBucket: totalMedicalErByBucket,
      total: sumBuckets(totalMedicalErByBucket),
      accountByBucket: benefitAcctMap("600080"),
    },
    {
      lineItem: "Principal Life (employer)",
      byBucket: totalPrincipalLifeErByBucket,
      total: sumBuckets(totalPrincipalLifeErByBucket),
      accountByBucket: benefitAcctMap("600080"),
    },
    {
      lineItem: "Guideline 401(k) Match (employer)",
      byBucket: totalTrad401kErByBucket,
      total: sumBuckets(totalTrad401kErByBucket),
      accountByBucket: benefitAcctMap("600090"),
    },
  ];

  // ---- Summary rows (flat DR/CR JE) ----
  const summaryRows: JeSummaryRow[] = [];
  const pushDr = (li: string, amt: number, acct: string, name: string) => {
    if (Math.abs(amt) < 0.005) return;
    summaryRows.push({ lineItem: li, debit: round2(amt), credit: 0, account: acct, accountName: name });
  };
  const pushCr = (li: string, amt: number, acct: string, name: string) => {
    if (Math.abs(amt) < 0.005) return;
    summaryRows.push({ lineItem: li, debit: 0, credit: round2(amt), account: acct, accountName: name });
  };

  // Aggregate per-bucket wages into one DR per account (since VOIP → 502040,
  // Sales+Admin both → 600010, etc.).
  const drByAcct = new Map<string, { amount: number; name: string }>();
  for (const b of BUCKET_ORDER) {
    const acct = grossWagesAcctMap[b];
    const amount = totalGrossByBucket[b];
    if (Math.abs(amount) < 0.005) continue;
    const cur = drByAcct.get(acct) ?? { amount: 0, name: BUCKET_ACCOUNTS[b].name };
    cur.amount += amount;
    drByAcct.set(acct, cur);
  }
  for (const [acct, { amount, name }] of drByAcct.entries()) {
    pushDr(`Gross wages — ${name}`, amount, acct, name);
  }
  drByAcct.clear();
  for (const b of BUCKET_ORDER) {
    const acct = payrollTaxAcctMap[b];
    const amount = totalErTaxByBucket[b];
    if (Math.abs(amount) < 0.005) continue;
    const cur = drByAcct.get(acct) ?? {
      amount: 0,
      name: b === "sales" || b === "admin" ? "Payroll Taxes (SG&A)" : "Payroll Taxes (COGS)",
    };
    cur.amount += amount;
    drByAcct.set(acct, cur);
  }
  for (const [acct, { amount, name }] of drByAcct.entries()) {
    pushDr(`Employer payroll taxes — ${name}`, amount, acct, name);
  }

  // Fixed-account benefit DRs (employer portion only). Rest is credited.
  pushDr(
    "Medical Insurance (employer)",
    grand.medicalInsuranceEmployer,
    "600080",
    "Health Insurance & Benefits"
  );
  pushDr(
    "Principal Life (employer)",
    grand.principalLifeEmployer,
    "600080",
    "Health Insurance & Benefits"
  );
  pushDr(
    "Guideline Traditional 401(k) (employer)",
    grand.trad401kEmployer,
    "600090",
    "401k Match"
  );

  // Credits — payroll liabilities
  pushCr("Net pay", grand.netPay, "202010", "Accrued Wages");
  pushCr(
    "Employer + employee taxes",
    grand.employerTaxes + grand.employeeTaxes,
    "202040",
    "Accrued Payroll Tax"
  );
  pushCr(
    "Guideline Traditional 401(k) (total)",
    grand.trad401kEmployee + grand.trad401kEmployer,
    "202050",
    "Accrued 401k Match"
  );
  pushCr(
    "Guideline Roth 401(k) (total)",
    grand.roth401kEmployee + grand.roth401kEmployer,
    "202050",
    "Accrued 401k Match"
  );
  pushCr(
    "Health Savings Account (total)",
    grand.hsaEmployee + grand.hsaEmployer,
    "202070",
    "Employee FSA Liability"
  );
  pushCr(
    "Medical Insurance (total)",
    grand.medicalInsuranceEmployee + grand.medicalInsuranceEmployer,
    "202080",
    "Accrued Other Employee Benefits"
  );
  pushCr(
    "Dental Insurance (total)",
    grand.dentalInsuranceEmployee + grand.dentalInsuranceEmployer,
    "202080",
    "Accrued Other Employee Benefits"
  );
  pushCr(
    "Aflac Pre (total)",
    grand.aflacPreEmployee + grand.aflacPreEmployer,
    "202080",
    "Accrued Other Employee Benefits"
  );
  pushCr(
    "Aflac After (total)",
    grand.aflacAfterEmployee + grand.aflacAfterEmployer,
    "202080",
    "Accrued Other Employee Benefits"
  );
  pushCr(
    "Principal Life (total)",
    grand.principalLifeEmployee + grand.principalLifeEmployer,
    "202080",
    "Accrued Other Employee Benefits"
  );
  pushCr(
    "Vision (total)",
    grand.visionEmployee + grand.visionEmployer,
    "202080",
    "Accrued Other Employee Benefits"
  );
  pushCr(
    "Voluntary Life (total)",
    grand.voluntaryLifeEmployee + grand.voluntaryLifeEmployer,
    "202080",
    "Accrued Other Employee Benefits"
  );

  const debitTotal = round2(summaryRows.reduce((s, r) => s + r.debit, 0));
  const creditTotal = round2(summaryRows.reduce((s, r) => s + r.credit, 0));

  return { bucketRows, summaryRows, debitTotal, creditTotal };
}

function sumBuckets(b: Record<Bucket, number>): number {
  return round2(BUCKET_ORDER.reduce((s, k) => s + b[k], 0));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function aggregateTotals(emps: GustoEmployee[]): GustoEmployee {
  const out = emps[0] ? { ...emps[0] } : ({} as GustoEmployee);
  const keys = Object.keys(out) as Array<keyof GustoEmployee>;
  for (const k of keys) {
    if (typeof out[k] === "number") {
      let sum = 0;
      for (const e of emps) sum += (e[k] as number) ?? 0;
      (out as unknown as Record<string, number>)[k as string] = sum;
    } else {
      (out as unknown as Record<string, string>)[k as string] = "";
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// CSV export
// ---------------------------------------------------------------------------

export function jeToCsv(je: JournalEntry, periodLabel: string): string {
  const lines: string[] = [];
  lines.push(`Payroll Journal Entry — ${periodLabel}`);
  lines.push("");
  lines.push("Account,Account Name,Line Item,Debit,Credit");
  for (const r of je.summaryRows) {
    lines.push(
      [
        r.account,
        csvEscape(r.accountName),
        csvEscape(r.lineItem),
        r.debit ? r.debit.toFixed(2) : "",
        r.credit ? r.credit.toFixed(2) : "",
      ].join(",")
    );
  }
  lines.push(`,,Totals,${je.debitTotal.toFixed(2)},${je.creditTotal.toFixed(2)}`);
  return lines.join("\n");
}

function csvEscape(s: string): string {
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
