/**
 * Pure, in-memory edits to a workflow definition, so a small change can be
 * sent as a list of operations instead of the whole document. Nothing here
 * validates the grammar; the engine's validate does that after the save.
 */
import type { Definition } from "./workflow-draft";

export type PathSegment = string | number;
export type Path = string | PathSegment[];

export type EditOp =
  | { op: "upsert_node"; node: Record<string, any> }
  | { op: "remove_node"; node_id: string }
  | { op: "set"; node_id?: string; path: Path; value: unknown }
  | { op: "unset"; node_id?: string; path: Path }
  | { op: "insert_case"; node_id: string; case: Record<string, any>; index?: number }
  | { op: "replace_case"; node_id: string; index: number; case: Record<string, any> }
  | { op: "remove_case"; node_id: string; index: number }
  | { op: "rename_node"; node_id: string; new_id?: string; name?: string }
  | { op: "map_agent_variables"; node_id: string; overwrite?: boolean };

export class EditError extends Error {}

export const NODE_ID_PATTERN = /^[a-z0-9_]{1,64}$/;

// The four entry fields every execution carries whether or not the start node declares them.
const SYSTEM_ENTRY_FIELDS = ["reference_id", "mobile_number", "name", "email"];

// Keys whose string value names a node id: routing in the graph, plus the
// editor's ui.conditions block (predecessorId, placeholderThen.to, chain[].to).
const NODE_REF_KEYS = new Set(["entry_node_id", "on_no_match", "to", "target_node_id", "predecessorId"]);

export function parsePath(path: Path): PathSegment[] {
  if (Array.isArray(path)) return path;
  if (path === "") return [];
  return path.split(".").map((seg) => (/^\d+$/.test(seg) ? Number(seg) : seg));
}

function nodes(def: Definition): Record<string, any>[] {
  if (!Array.isArray(def.nodes)) def.nodes = [];
  return def.nodes;
}

export function findNode(def: Definition, nodeId: string): Record<string, any> {
  const node = nodes(def).find((n) => n?.id === nodeId);
  if (!node) throw new EditError(`no node with id '${nodeId}'`);
  return node;
}

function setAt(root: any, segments: PathSegment[], value: unknown): void {
  if (segments.length === 0) throw new EditError("path is empty");
  let cur = root;
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i]!;
    let next = cur[seg as any];
    if (next === undefined || next === null) {
      next = typeof segments[i + 1] === "number" ? [] : {};
      assign(cur, seg, next);
    }
    if (typeof next !== "object") throw new EditError(`'${segments.slice(0, i + 1).join(".")}' is not an object`);
    cur = next;
  }
  assign(cur, segments[segments.length - 1]!, value);
}

function assign(container: any, seg: PathSegment, value: unknown): void {
  if (Array.isArray(container)) {
    if (typeof seg !== "number") throw new EditError(`'${seg}' indexes a list; use a number`);
    if (seg > container.length) throw new EditError(`index ${seg} is past the end of a list of ${container.length}`);
    container[seg] = value;
    return;
  }
  container[seg as string] = value;
}

function unsetAt(root: any, segments: PathSegment[]): void {
  if (segments.length === 0) throw new EditError("path is empty");
  let cur = root;
  for (const seg of segments.slice(0, -1)) {
    cur = cur?.[seg as any];
    if (cur === undefined || cur === null) return;
  }
  const last = segments[segments.length - 1]!;
  if (Array.isArray(cur) && typeof last === "number") cur.splice(last, 1);
  else if (cur && typeof cur === "object") delete cur[last as string];
}

function caseList(node: Record<string, any>): any[] {
  if (node.type === "time") throw new EditError(`'${node.id}' is a time node: it has one exit, 'to', not cases`);
  if (!Array.isArray(node.cases)) node.cases = [];
  return node.cases;
}

function checkIndex(list: unknown[], index: number, nodeId: string): void {
  if (index < 0 || index >= list.length) {
    throw new EditError(`node '${nodeId}' has ${list.length} case(s); index ${index} is out of range`);
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Rewrites every reference to a node id; returns how many values changed. */
export function rewriteNodeRefs(def: Definition, oldId: string, newId: string): number {
  const ref = new RegExp(`(?<![A-Za-z0-9_.])node\\.${escapeRegExp(oldId)}(?![A-Za-z0-9_])`, "g");
  let changed = 0;
  const walk = (value: any): any => {
    if (typeof value === "string") {
      const next = value.replace(ref, `node.${newId}`);
      if (next !== value) changed++;
      return next;
    }
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) value[i] = walk(value[i]);
      return value;
    }
    if (value && typeof value === "object") {
      for (const [key, inner] of Object.entries(value)) {
        if (NODE_REF_KEYS.has(key) && inner === oldId) {
          value[key] = newId;
          changed++;
        } else {
          value[key] = walk(inner);
        }
      }
    }
    return value;
  };
  walk(def);
  return changed;
}

/** Where a node id is still routed to: entry, to, on_no_match, retry targets. */
export function routesTo(def: Definition, nodeId: string): string[] {
  const where: string[] = [];
  if (def.entry_node_id === nodeId) where.push("entry_node_id");
  if (def.on_no_match === nodeId) where.push("on_no_match");
  for (const node of nodes(def)) {
    if (node?.to === nodeId) where.push(`${node.id}.to`);
    if (node?.on_no_match === nodeId) where.push(`${node.id}.on_no_match`);
    if (node?.config?.target_node_id === nodeId) where.push(`${node.id}.config.target_node_id`);
    (Array.isArray(node?.cases) ? node.cases : []).forEach((c: any, i: number) => {
      if (c?.then?.to === nodeId) where.push(`${node.id}.cases.${i}.then.to`);
    });
  }
  return where;
}

/** Names the start node declares, plus the four system entry fields. */
export function entryFieldNames(def: Definition): Set<string> {
  const names = new Set(SYSTEM_ENTRY_FIELDS);
  const start = nodes(def).find((n) => n?.type === "start" || n?.id === def.entry_node_id);
  for (const field of start?.config?.fields ?? []) {
    if (typeof field?.name === "string") names.add(field.name);
  }
  return names;
}

export interface VariableMapping {
  mapped: string[];
  unmapped: string[];
  /** Unmapped variables a start field of the same name could fill. */
  auto_mappable: string[];
  /** Mappings on the node that the agent's prompts never read. */
  unused_mappings: string[];
}

export function compareAgentVariables(def: Definition, node: Record<string, any>, variables: string[]): VariableMapping {
  const mapping = node.config?.variables ?? {};
  const fields = entryFieldNames(def);
  const unmapped = variables.filter((v) => !(v in mapping));
  return {
    mapped: variables.filter((v) => v in mapping),
    unmapped,
    auto_mappable: unmapped.filter((v) => fields.has(v)),
    unused_mappings: Object.keys(mapping).filter((k) => !variables.includes(k)),
  };
}

export interface ApplyResult {
  applied: string[];
  warnings: string[];
  touched: Set<string>;
}

export type AgentVariablesLookup = (agentId: string) => Promise<string[]>;

/** Applies ops in order to def (mutated in place). Throws EditError naming the failing op. */
export async function applyOps(def: Definition, ops: EditOp[], agentVariables: AgentVariablesLookup): Promise<ApplyResult> {
  const result: ApplyResult = { applied: [], warnings: [], touched: new Set() };
  for (const [i, op] of ops.entries()) {
    try {
      await applyOne(def, op, agentVariables, result);
    } catch (err) {
      if (err instanceof EditError) throw new EditError(`operation ${i} (${op.op}): ${err.message}`);
      throw err;
    }
  }
  return result;
}

async function applyOne(def: Definition, op: EditOp, agentVariables: AgentVariablesLookup, r: ApplyResult) {
  switch (op.op) {
    case "upsert_node": {
      const id = op.node?.id;
      if (typeof id !== "string" || !NODE_ID_PATTERN.test(id)) {
        throw new EditError("node.id is required: 1-64 characters of a-z, 0-9 and _");
      }
      const list = nodes(def);
      const at = list.findIndex((n) => n?.id === id);
      if (at >= 0) list[at] = op.node;
      else list.push(op.node);
      r.touched.add(id);
      r.applied.push(`${at >= 0 ? "replaced" : "added"} node ${id}`);
      return;
    }
    case "remove_node": {
      const list = nodes(def);
      const at = list.findIndex((n) => n?.id === op.node_id);
      if (at < 0) throw new EditError(`no node with id '${op.node_id}'`);
      list.splice(at, 1);
      r.applied.push(`removed node ${op.node_id}`);
      const left = routesTo(def, op.node_id);
      if (left.length) r.warnings.push(`'${op.node_id}' is still routed to from ${left.join(", ")}`);
      return;
    }
    case "set":
    case "unset": {
      const target = op.node_id ? findNode(def, op.node_id) : def;
      const segments = parsePath(op.path);
      if (op.node_id && segments[0] === "id") throw new EditError("use rename_node to change a node id");
      if (op.op === "set") setAt(target, segments, op.value);
      else unsetAt(target, segments);
      if (op.node_id) r.touched.add(op.node_id);
      r.applied.push(`${op.op} ${op.node_id ? `${op.node_id}.` : ""}${segments.join(".")}`);
      return;
    }
    case "insert_case": {
      const node = findNode(def, op.node_id);
      const list = caseList(node);
      const index = op.index ?? list.length;
      if (index < 0 || index > list.length) {
        throw new EditError(`node '${op.node_id}' has ${list.length} case(s); index ${index} is out of range`);
      }
      list.splice(index, 0, op.case);
      r.touched.add(op.node_id);
      r.applied.push(`inserted case ${index} on ${op.node_id}`);
      if (index < list.length - 1) r.warnings.push(caseShiftWarning(op.node_id));
      return;
    }
    case "replace_case": {
      const node = findNode(def, op.node_id);
      const list = caseList(node);
      checkIndex(list, op.index, op.node_id);
      list[op.index] = op.case;
      r.touched.add(op.node_id);
      r.applied.push(`replaced case ${op.index} on ${op.node_id}`);
      return;
    }
    case "remove_case": {
      const node = findNode(def, op.node_id);
      const list = caseList(node);
      checkIndex(list, op.index, op.node_id);
      list.splice(op.index, 1);
      r.touched.add(op.node_id);
      r.applied.push(`removed case ${op.index} on ${op.node_id}`);
      if (op.index < list.length) r.warnings.push(caseShiftWarning(op.node_id));
      return;
    }
    case "rename_node": {
      const node = findNode(def, op.node_id);
      if (op.new_id === undefined && op.name === undefined) throw new EditError("give new_id, name, or both");
      if (op.name !== undefined) {
        node.name = op.name;
        r.applied.push(`renamed ${op.node_id} to "${op.name}"`);
      }
      if (op.new_id !== undefined && op.new_id !== op.node_id) {
        if (!NODE_ID_PATTERN.test(op.new_id)) throw new EditError("new_id must be 1-64 characters of a-z, 0-9 and _");
        if (nodes(def).some((n) => n?.id === op.new_id)) throw new EditError(`a node with id '${op.new_id}' already exists`);
        node.id = op.new_id;
        const refs = rewriteNodeRefs(def, op.node_id, op.new_id);
        r.applied.push(`changed id ${op.node_id} to ${op.new_id} (${refs} reference(s) rewritten)`);
        if (node.type === "callback") {
          r.warnings.push(
            `'${op.new_id}' is a callback node: its URL is keyed by node id, so it gets a new URL and signing secret (get_workflow_callback) and your system must POST there instead`
          );
        }
        r.touched.add(op.new_id);
      } else {
        r.touched.add(op.node_id);
      }
      return;
    }
    case "map_agent_variables": {
      const node = findNode(def, op.node_id);
      const agentId = node.config?.agent_id;
      if (node.type !== "agent" || typeof agentId !== "string") {
        throw new EditError(`'${op.node_id}' is not an agent node with a config.agent_id`);
      }
      const variables = await agentVariables(agentId);
      const fields = entryFieldNames(def);
      node.config.variables = node.config.variables ?? {};
      const added: string[] = [];
      const missing: string[] = [];
      for (const name of variables) {
        if (name in node.config.variables && !op.overwrite) continue;
        if (fields.has(name)) {
          node.config.variables[name] = { value: { var: `entry.${name}` } };
          added.push(name);
        } else {
          missing.push(name);
        }
      }
      r.touched.add(op.node_id);
      r.applied.push(`mapped ${added.length} agent variable(s) on ${op.node_id} from entry.*`);
      if (missing.length) {
        r.warnings.push(
          `no start field named ${missing.join(", ")} on ${op.node_id}: declare one or map it with a set op on config.variables`
        );
      }
      return;
    }
  }
}

function caseShiftWarning(nodeId: string): string {
  return `later cases on '${nodeId}' moved by one index; a ui.conditions entry keyed by caseIndex may now name the wrong case`;
}
