// Shared types between PayrollClient.tsx and gustoJe.ts.

export type Dept = "professional" | "managed" | "admin" | "sales";

export type Bucket =
  | "managed"
  | "recurring"
  | "nonRecurring"
  | "voip"
  | "sales"
  | "admin";
