import { z } from "zod";

// E.164: + followed by 1-15 digits, first digit non-zero.
// A factory, not a shared instance: two properties on the same tool
// (recipient_phone_number/from_phone_number) both use this, and the JSON
// Schema converter collapses reused Zod object references into a `$ref`
// rather than repeating the definition. Claude's submission portal doesn't
// resolve that `$ref` when displaying parameter types, so the second
// property showed up as "missing type" — confirmed live 2026-07-21.
export function e164Phone() {
  return z
    .string()
    .regex(/^\+[1-9]\d{1,14}$/, "must be a valid E.164 phone number, e.g. +14155552671");
}

// §5: page_size default 10, hard cap 50 in the tool schema regardless of
// what the Bolna API allows.
export const pageNumberSchema = z
  .number()
  .int()
  .min(1)
  .optional()
  .default(1);

export const pageSizeSchema = z
  .number()
  .int()
  .min(1)
  .max(50)
  .optional()
  .default(10);

export const agentIdSchema = z
  .string()
  .min(1, "agent_id is required");

export const executionIdSchema = z
  .string()
  .min(1, "execution_id is required");

/** Applies tool-schema-level pagination to an array the Bolna API returns unpaginated. */
export function paginate<T>(items: T[], pageNumber: number, pageSize: number): T[] {
  const start = (pageNumber - 1) * pageSize;
  return items.slice(start, start + pageSize);
}
