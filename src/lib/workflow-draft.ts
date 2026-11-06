import { bolnaFetch } from "./bolna-client";
import { BolnaApiError } from "./errors";

export type Definition = Record<string, any>;

export interface LoadedDraft {
  definition: Definition;
  revision: number;
  /** false when the engine holds no draft row yet; the next save creates one at revision 0. */
  draft_exists: boolean;
  /** The published version a missing draft will be seeded from, when there is one. */
  based_on_version?: number;
}

interface WorkflowDetail {
  workflow?: { latest_published_version?: number | null };
  draft?: unknown;
}

const draftPath = (workflowId: string) => `/workflows/${encodeURIComponent(workflowId)}/draft`;

/**
 * The draft as the next save will see it. After a publish the engine holds no
 * draft row, so GET /draft answers 404 until the next save lazily creates one
 * at revision 0 from the latest published version; this returns that version
 * in its place instead of the 404.
 */
export async function loadDraft(workflowId: string, apiKey: string | undefined): Promise<LoadedDraft> {
  try {
    const draft = await bolnaFetch<{ definition: Definition; revision: number }>(draftPath(workflowId), apiKey);
    return { definition: draft.definition ?? {}, revision: draft.revision, draft_exists: true };
  } catch (err) {
    if (!(err instanceof BolnaApiError) || err.status !== 404) throw err;
    let detail: WorkflowDetail;
    try {
      detail = await bolnaFetch<WorkflowDetail>(`/workflows/${encodeURIComponent(workflowId)}`, apiKey);
    } catch {
      throw err;
    }
    if (detail.draft) throw err;
    const latest = detail.workflow?.latest_published_version;
    if (!latest) return { definition: {}, revision: 0, draft_exists: false };
    const version = await bolnaFetch<{ definition?: Definition }>(
      `/workflows/${encodeURIComponent(workflowId)}/versions/${latest}`,
      apiKey
    );
    return { definition: version.definition ?? {}, revision: 0, draft_exists: false, based_on_version: latest };
  }
}

export interface SavedDraft {
  revision: number;
  issues?: unknown[];
  validate_error?: string;
}

/** PUT the draft, then run validate so a save reports what publish would reject. */
export async function saveDraftAndValidate(
  workflowId: string,
  apiKey: string | undefined,
  expectedRevision: number,
  definition: Definition
): Promise<SavedDraft> {
  const saved = await bolnaFetch<{ revision: number }>(draftPath(workflowId), apiKey, {
    method: "PUT",
    body: { expected_revision: expectedRevision, definition },
  });
  try {
    const validated = await bolnaFetch<{ issues?: unknown[] }>(
      `/workflows/${encodeURIComponent(workflowId)}/validate`,
      apiKey,
      { method: "POST", body: {} }
    );
    return { revision: saved.revision, issues: validated.issues ?? [] };
  } catch (err) {
    return { revision: saved.revision, validate_error: err instanceof Error ? err.message : String(err) };
  }
}

/** The revision the next save_workflow_draft must send. */
export async function nextExpectedRevision(workflowId: string, apiKey: string | undefined): Promise<number> {
  try {
    const draft = await bolnaFetch<{ revision: number }>(draftPath(workflowId), apiKey);
    return draft.revision;
  } catch (err) {
    if (err instanceof BolnaApiError && err.status === 404) return 0;
    throw err;
  }
}

/** current_revision from a 409 revision_conflict, when the engine sent one. */
export function conflictRevision(err: unknown): number | undefined {
  if (!(err instanceof BolnaApiError) || err.status !== 409) return undefined;
  const detail = (err.body as { detail?: { current_revision?: unknown } } | undefined)?.detail;
  return typeof detail?.current_revision === "number" ? detail.current_revision : undefined;
}
