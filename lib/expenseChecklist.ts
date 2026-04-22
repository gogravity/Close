/**
 * Expense Checklist configuration.
 * Each item represents a recurring vendor expense that should be verified
 * each month during close. "dayOfMonth" is the approximate calendar day the
 * invoice normally arrives; null means the timing varies.
 */

export type Frequency = "monthly" | "quarterly" | "semi-annually" | "annually" | "various";

export type ExpenseItem = {
  id: string;
  vendor: string;
  frequency: Frequency;
  /** Expected day of month (1-31), or null for "Various" / unknown */
  dayOfMonth: number | null;
  notes: string;
  /** Case-insensitive substrings matched against BC vendorName */
  searchTerms: string[];
  /** True if this is typically a manual journal entry rather than a vendor bill */
  isJournalEntry?: boolean;
};

export const EXPENSE_CHECKLIST: ExpenseItem[] = [
  {
    id: "a-lign",
    vendor: "A-Lign",
    frequency: "semi-annually",
    dayOfMonth: null,
    notes: "3 separate annual invoices — expense monthly",
    searchTerms: ["A-Lign", "A Lign"],
  },
  {
    id: "addigy",
    vendor: "Addigy",
    frequency: "monthly",
    dayOfMonth: 1,
    notes: "Accrue into closing month",
    searchTerms: ["Addigy"],
  },
  {
    id: "adobe",
    vendor: "Adobe",
    frequency: "various",
    dayOfMonth: null,
    notes: "",
    searchTerms: ["Adobe"],
  },
  {
    id: "acensus-vanguard",
    vendor: "Acensus-Vanguard (Recordkeeping Fees)",
    frequency: "quarterly",
    dayOfMonth: null,
    notes: "Under threshold — expense when paid",
    searchTerms: ["Acensus", "Vanguard"],
  },
  {
    id: "calendly",
    vendor: "Calendly",
    frequency: "monthly",
    dayOfMonth: 18,
    notes: "",
    searchTerms: ["Calendly"],
  },
  {
    id: "cheney-brothers",
    vendor: "Cheney Brothers International (Soda and Snacks)",
    frequency: "various",
    dayOfMonth: null,
    notes: "",
    searchTerms: ["Cheney Brothers", "Cheney"],
  },
  {
    id: "city-of-tampa",
    vendor: "City of Tampa Utilities",
    frequency: "monthly",
    dayOfMonth: 24,
    notes: "",
    searchTerms: ["City of Tampa", "Tampa Utilities"],
  },
  {
    id: "clearent",
    vendor: "Clearent",
    frequency: "monthly",
    dayOfMonth: 8,
    notes: "",
    searchTerms: ["Clearent"],
  },
  {
    id: "cna-insurance",
    vendor: "CNA Insurance",
    frequency: "monthly",
    dayOfMonth: 10,
    notes: "",
    searchTerms: ["CNA Insurance", "CNA"],
  },
  {
    id: "colonial-life",
    vendor: "Colonial Life",
    frequency: "monthly",
    dayOfMonth: 13,
    notes: "",
    searchTerms: ["Colonial Life"],
  },
  {
    id: "connectwise",
    vendor: "ConnectWise (Includes SentinelOne)",
    frequency: "monthly",
    dayOfMonth: 10,
    notes: "",
    searchTerms: ["ConnectWise"],
  },
  {
    id: "craig-caruso",
    vendor: "Craig Caruso",
    frequency: "monthly",
    dayOfMonth: 22,
    notes: "",
    searchTerms: ["Craig Caruso", "Caruso"],
  },
  {
    id: "cyberfox",
    vendor: "CyberFox (AutoElevate)",
    frequency: "monthly",
    dayOfMonth: 2,
    notes: "",
    searchTerms: ["CyberFox", "AutoElevate"],
  },
  {
    id: "dex-imaging",
    vendor: "DEX Imaging",
    frequency: "quarterly",
    dayOfMonth: null,
    notes: "Under threshold — expense when paid",
    searchTerms: ["DEX Imaging", "DEX"],
  },
  {
    id: "duo",
    vendor: "Duo",
    frequency: "monthly",
    dayOfMonth: 3,
    notes: "Accrue into closing month",
    searchTerms: ["Duo Security", "Duo"],
  },
  {
    id: "easy-dmarc",
    vendor: "Easy DMARC",
    frequency: "monthly",
    dayOfMonth: 1,
    notes: "Immaterial",
    searchTerms: ["Easy DMARC", "EasyDMARC"],
  },
  {
    id: "efax",
    vendor: "eFax",
    frequency: "monthly",
    dayOfMonth: 1,
    notes: "",
    searchTerms: ["eFax", "j2 Global"],
  },
  {
    id: "first-choice-coffee",
    vendor: "First Choice Coffee",
    frequency: "monthly",
    dayOfMonth: 31,
    notes: "",
    searchTerms: ["First Choice Coffee", "First Choice"],
  },
  {
    id: "flexential",
    vendor: "Flexential",
    frequency: "monthly",
    dayOfMonth: 12,
    notes: "Accrue into closing month",
    searchTerms: ["Flexential"],
  },
  {
    id: "fl-dept-revenue",
    vendor: "Florida Department of Revenue (Sales Tax)",
    frequency: "monthly",
    dayOfMonth: 8,
    notes: "",
    searchTerms: ["Florida Department of Revenue", "FL Dept of Revenue", "Dept of Revenue"],
  },
  {
    id: "frontier",
    vendor: "Frontier",
    frequency: "monthly",
    dayOfMonth: 31,
    notes: "",
    searchTerms: ["Frontier"],
  },
  {
    id: "gaggle-properties",
    vendor: "Gaggle Properties I — Rent (ASC 842)",
    frequency: "monthly",
    dayOfMonth: 3,
    notes: "Journal entry — not a vendor bill",
    searchTerms: ["Gaggle Properties", "Gaggle"],
    isJournalEntry: true,
  },
  {
    id: "gateway-services",
    vendor: "Gateway Services",
    frequency: "monthly",
    dayOfMonth: 7,
    notes: "",
    searchTerms: ["Gateway Services", "Gateway"],
  },
  {
    id: "humana",
    vendor: "Humana — Dental / Vision / Life",
    frequency: "monthly",
    dayOfMonth: 8,
    notes: "",
    searchTerms: ["Humana"],
  },
  {
    id: "immybot",
    vendor: "IMMYBOT",
    frequency: "monthly",
    dayOfMonth: 28,
    notes: "",
    searchTerms: ["IMMYBOT", "ImmyBot", "Immy"],
  },
  {
    id: "indeed",
    vendor: "Indeed.com",
    frequency: "various",
    dayOfMonth: null,
    notes: "",
    searchTerms: ["Indeed"],
  },
  {
    id: "ingram-micro",
    vendor: "Ingram Micro (Arctic Wolf)",
    frequency: "monthly",
    dayOfMonth: 7,
    notes: "",
    searchTerms: ["Ingram Micro", "Arctic Wolf"],
  },
];

/**
 * Returns true if a checklist item is "expected" in the given month.
 * Monthly items are always expected; quarterly/semi-annual/annual use
 * a simple calendar heuristic.
 */
export function isExpectedThisMonth(item: ExpenseItem, month: number): boolean {
  switch (item.frequency) {
    case "monthly":
      return true;
    case "quarterly":
      // Jan (1), Apr (4), Jul (7), Oct (10)
      return month % 3 === 1;
    case "semi-annually":
      // Jan (1), Jul (7)
      return month === 1 || month === 7;
    case "annually":
      return false; // Would need to know the specific month
    case "various":
      return false;
    default:
      return false;
  }
}
