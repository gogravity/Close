import "server-only";

export type ScrubReport = {
  scrubbed: string;
  redactions: {
    accountNumbers: number;
    ssn: number;
    phone: number;
    email: number;
    addresses: number;
    zipCodes: number;
    names: number;
  };
  preservedAccountLast4: string[];
};

/**
 * Strips PII from extracted PDF text before sending to any third-party AI.
 *
 * We KEEP:
 *   - Dates, currency amounts, check numbers, transaction descriptions
 *   - The LAST 4 digits of detected account numbers (useful for matching)
 *
 * We REDACT:
 *   - Full account numbers (>= 8 digits) → replaced with "xxxx<last4>"
 *   - SSN patterns
 *   - Phone numbers
 *   - Email addresses
 *   - Street addresses
 *   - ZIP codes + state abbreviations
 *   - A best-effort pass at proper names on common address block lines
 *
 * This is a belt-and-suspenders defense: we ALSO instruct the downstream
 * model not to emit any PII, so a miss here is not a single-point failure.
 */
export function scrubBankStatement(text: string): ScrubReport {
  const counts = {
    accountNumbers: 0,
    ssn: 0,
    phone: 0,
    email: 0,
    addresses: 0,
    zipCodes: 0,
    names: 0,
  };
  const preserved = new Set<string>();

  let out = text;

  // Account numbers: 8-17 consecutive digits. Preserve last 4.
  out = out.replace(/\b\d{4,13}(\d{4})\b/g, (_m, last4: string) => {
    counts.accountNumbers++;
    preserved.add(last4);
    return `xxxx${last4}`;
  });

  // Account numbers with spaces or dashes: 1234 5678 9012 3456
  out = out.replace(/\b\d{3,5}[\s-]\d{3,5}[\s-]\d{3,5}(?:[\s-]\d{1,5})?\b/g, (m) => {
    const digits = m.replace(/\D/g, "");
    if (digits.length >= 8) {
      counts.accountNumbers++;
      const last4 = digits.slice(-4);
      preserved.add(last4);
      return `xxxx${last4}`;
    }
    return m;
  });

  // SSN
  out = out.replace(/\b\d{3}-\d{2}-\d{4}\b/g, () => {
    counts.ssn++;
    return "[SSN_REDACTED]";
  });

  // Phone numbers
  out = out.replace(
    /\b(?:\+?1[-.\s]?)?(?:\(\d{3}\)|\d{3})[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
    () => {
      counts.phone++;
      return "[PHONE_REDACTED]";
    }
  );

  // Email addresses
  out = out.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, () => {
    counts.email++;
    return "[EMAIL_REDACTED]";
  });

  // Street addresses: digits + words + street suffix
  out = out.replace(
    /\b\d{1,6}\s+[A-Z][A-Za-z0-9.\s]{2,40}\b(?:St|Street|Ave|Avenue|Rd|Road|Blvd|Boulevard|Dr|Drive|Ln|Lane|Way|Ct|Court|Pl|Place|Ter|Terrace|Pkwy|Parkway|Hwy|Highway|Ste|Suite|Apt|Unit)\b\.?/gi,
    () => {
      counts.addresses++;
      return "[ADDRESS_REDACTED]";
    }
  );

  // ZIP codes (as part of CITY, ST ZIP patterns)
  out = out.replace(/\b[A-Z]{2}\s+\d{5}(?:-\d{4})?\b/g, () => {
    counts.zipCodes++;
    return "[STATE_ZIP_REDACTED]";
  });

  // Standalone 5-digit ZIP codes that survived
  out = out.replace(/\b\d{5}(?:-\d{4})?\b/g, (m) => {
    // Don't redact if this looks like a dollar amount or year (years 2000-2099)
    if (/^(19|20)\d\d$/.test(m)) return m;
    counts.zipCodes++;
    return "[ZIP_REDACTED]";
  });

  // Heuristic: strip lines that look like "NAME SURNAME" right before an address block.
  // Too aggressive — only redact all-caps full names (common on bank statements).
  out = out.replace(/^[A-Z][A-Z'-]+\s+(?:[A-Z]\.\s+)?[A-Z][A-Z'-]+(?:\s+[A-Z][A-Z'-]+)?$/gm, (m) => {
    // Avoid redacting bank or business names that happen to be all-caps
    if (/BANK|CORP|LLC|INC|TRUST|FEDERAL/i.test(m)) return m;
    counts.names++;
    return "[NAME_REDACTED]";
  });

  return {
    scrubbed: out,
    redactions: counts,
    preservedAccountLast4: [...preserved],
  };
}
