import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { getIntegrationSecrets } from "./settings";

export class AnthropicConfigError extends Error {}

let cached: { client: Anthropic; model: string; key: string } | null = null;

export async function getAnthropicClient(): Promise<{ client: Anthropic; model: string }> {
  const secrets = await getIntegrationSecrets("anthropic");
  if (!secrets.apiKey) {
    throw new AnthropicConfigError(
      "Anthropic API key not configured. Add it in Settings."
    );
  }
  const model = secrets.model || "claude-sonnet-4-6";
  if (!cached || cached.key !== secrets.apiKey) {
    cached = {
      key: secrets.apiKey,
      model,
      client: new Anthropic({ apiKey: secrets.apiKey }),
    };
  }
  return { client: cached.client, model };
}

/**
 * Extracts structured data from a bank statement PDF.
 * Returns what Claude could confidently read; fields it couldn't find are null.
 */
export type StatementExtraction = {
  endingBalance: number | null;
  asOfDate: string | null; // YYYY-MM-DD
  statementPeriodStart: string | null;
  statementPeriodEnd: string | null;
  accountNumberLast4: string | null;
  bankName: string | null;
  outstandingChecks: { checkNumber: string; date: string | null; amount: number }[];
  depositsInTransit: { date: string | null; amount: number; description?: string }[];
  notes: string;
  confidence: "high" | "medium" | "low";
};

const EXTRACTION_PROMPT = `You are extracting data from a US bank statement for month-end reconciliation.

IMPORTANT privacy rules:
- The input has been pre-scrubbed for PII. You will see tokens like [ADDRESS_REDACTED], [PHONE_REDACTED], [NAME_REDACTED], or "xxxx<last4>" in place of full account numbers.
- You MUST NOT include any PII in your output. No names, addresses, phone numbers, or full account numbers. Only the last-4 digits of an account are allowed.
- If you detect PII that slipped past the scrubber (a full account number, a full name, a home address), do not include it — omit the field or use null.

Return a single JSON object with this exact schema:
{
  "endingBalance": number | null,
  "asOfDate": "YYYY-MM-DD" | null,
  "statementPeriodStart": "YYYY-MM-DD" | null,
  "statementPeriodEnd": "YYYY-MM-DD" | null,
  "accountNumberLast4": "1234" | null,
  "bankName": string | null,
  "outstandingChecks": [{ "checkNumber": "1234", "date": "YYYY-MM-DD" | null, "amount": number }],
  "depositsInTransit": [{ "date": "YYYY-MM-DD" | null, "amount": number, "description": string | null }],
  "notes": string,
  "confidence": "high" | "medium" | "low"
}

Rules:
- endingBalance is the statement's closing/ending balance for the period. Positive number.
- If the statement doesn't show explicit outstanding checks or deposits-in-transit sections, return empty arrays.
- bankName is OK to include (US Bank, Chase, etc.) — that's not PII.
- Put any caveats (partial period, multiple accounts, unclear figures, scrubbing interference) in notes.
- Output ONLY the JSON object — no markdown, no prose, no code fences.`;

export async function extractStatementFromText(
  scrubbedText: string
): Promise<StatementExtraction> {
  const { client, model } = await getAnthropicClient();
  const response = await client.messages.create({
    model,
    max_tokens: 2048,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: EXTRACTION_PROMPT },
          {
            type: "text",
            text: `--- BEGIN SCRUBBED STATEMENT TEXT ---\n${scrubbedText}\n--- END SCRUBBED STATEMENT TEXT ---`,
          },
        ],
      },
    ],
  });

  const text = response.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { text: string }).text)
    .join("")
    .trim();

  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  const parsed = JSON.parse(cleaned) as StatementExtraction;
  return parsed;
}
