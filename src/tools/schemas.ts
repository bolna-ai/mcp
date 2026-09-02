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

export const batchIdSchema = z.string().min(1, "batch_id is required");
export const dispositionIdSchema = z.string().min(1, "disposition_id is required");
export const categoryIdSchema = z.string().min(1, "category_id is required");
export const phoneNumberIdSchema = z.string().min(1, "phone_number_id is required");
export const trunkIdSchema = z.string().min(1, "trunk_id is required");
export const subAccountIdSchema = z.string().min(1, "sub_account_id is required");
export const workflowIdSchema = z.string().min(1, "workflow_id is required");
export const workflowCampaignIdSchema = z.string().min(1, "campaign_id is required");
export const workflowExecutionIdSchema = z.string().min(1, "execution_id is required");

// A contact/entry for a workflow run or campaign upload. Only reference_id,
// mobile_number, name, and email are documented system fields — everything
// else (declared by the workflow's start node, or nested under
// custom_fields) is passed through as-is rather than re-modeled here.
export const workflowContactSchema = z
  .object({
    reference_id: z.string().optional(),
    mobile_number: e164Phone().optional(),
    name: z.string().optional(),
    email: z.string().email().optional(),
    custom_fields: z.record(z.any()).optional(),
  })
  .passthrough();

// Lets a single call target a different Bolna account than the one this
// connection authenticated with — e.g. a sub-account's key from
// list_sub_accounts' api_key field (format sa-...) — without reconnecting.
// A factory for the same $ref-collapsing reason as e164Phone above.
export function apiKeyOverrideSchema() {
  return z
    .string()
    .optional()
    .describe(
      "Optional: use this specific Bolna API key for this call instead of the connected account's key. Pass a sub-account's key (get it from list_sub_accounts' api_key field, format sa-...) to operate within that sub-account instead of the main account."
    );
}

/** Applies tool-schema-level pagination to an array the Bolna API returns unpaginated. */
export function paginate<T>(items: T[], pageNumber: number, pageSize: number): T[] {
  const start = (pageNumber - 1) * pageSize;
  return items.slice(start, start + pageSize);
}
