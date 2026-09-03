import { calculateMetrics } from "./metrics";
import { applyProposedChanges, createId, createSession, planStore, sessionsInCell } from "./store";
import {
  DAYS,
  SESSION_TYPES,
  WEEK_FOCUSES,
  type AthleteProfile,
  type Day,
  type PlanState,
  type PlanProposal,
  type ProposedChange,
  type Session,
  type SessionType,
  type WeekFocus,
} from "./types";

interface JsonSchema {
  type?: "object" | "array" | "string" | "number" | "integer" | "boolean";
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean;
  minProperties?: number;
  items?: JsonSchema;
  enum?: readonly unknown[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
  format?: "date";
}

type ToolDefinition = Omit<WebMCP.ModelContextTool, "inputSchema" | "execute"> & {
  inputSchema: JsonSchema;
  execute: WebMCP.ToolExecuteCallback<any>;
};

export interface WebMcpStatus {
  supported: boolean;
  registered: number;
  source: "document" | "none";
  error?: string;
}

function contextDetails(): { context?: WebMCP.ModelContext; source: WebMcpStatus["source"] } {
  if (typeof document.modelContext?.registerTool === "function") {
    return { context: document.modelContext, source: "document" };
  }
  return { source: "none" };
}

export function detectWebMcp(): boolean {
  return Boolean(contextDetails().context);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

function validateSchema(schema: JsonSchema, value: unknown, path = "input"): string[] {
  const errors: string[] = [];

  if (schema.enum && !schema.enum.some((candidate) => Object.is(candidate, value))) {
    errors.push(`${path} must be one of ${schema.enum.join(", ")}`);
    return errors;
  }

  switch (schema.type) {
    case "object": {
      if (!isPlainObject(value)) return [`${path} must be an object`];
      const properties = schema.properties ?? {};
      const keys = Object.keys(value);
      if (schema.minProperties !== undefined && keys.length < schema.minProperties) {
        errors.push(`${path} must contain at least ${schema.minProperties} properties`);
      }
      for (const required of schema.required ?? []) {
        if (!(required in value)) errors.push(`${path}.${required} is required`);
      }
      if (schema.additionalProperties === false) {
        for (const key of keys) {
          if (!(key in properties)) errors.push(`${path}.${key} is not allowed`);
        }
      }
      for (const [key, propertySchema] of Object.entries(properties)) {
        if (key in value) errors.push(...validateSchema(propertySchema, value[key], `${path}.${key}`));
      }
      return errors;
    }
    case "array": {
      if (!Array.isArray(value)) return [`${path} must be an array`];
      if (schema.minItems !== undefined && value.length < schema.minItems) {
        errors.push(`${path} must contain at least ${schema.minItems} items`);
      }
      if (schema.maxItems !== undefined && value.length > schema.maxItems) {
        errors.push(`${path} must contain at most ${schema.maxItems} items`);
      }
      if (schema.uniqueItems && new Set(value.map((item) => JSON.stringify(item))).size !== value.length) {
        errors.push(`${path} must not contain duplicates`);
      }
      if (schema.items) {
        value.forEach((item, index) => errors.push(...validateSchema(schema.items!, item, `${path}[${index}]`)));
      }
      return errors;
    }
    case "string": {
      if (typeof value !== "string") return [`${path} must be a string`];
      if (schema.minLength !== undefined && value.trim().length < schema.minLength) {
        errors.push(`${path} must contain at least ${schema.minLength} non-whitespace characters`);
      }
      if (schema.maxLength !== undefined && value.length > schema.maxLength) {
        errors.push(`${path} must contain at most ${schema.maxLength} characters`);
      }
      if (schema.format === "date" && !isValidDate(value)) errors.push(`${path} must be a valid YYYY-MM-DD date`);
      return errors;
    }
    case "integer":
      if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)) {
        return [`${path} must be an integer`];
      }
      break;
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value)) return [`${path} must be a finite number`];
      break;
    case "boolean":
      if (typeof value !== "boolean") return [`${path} must be a boolean`];
      return errors;
  }

  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${path} must be at least ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${path} must be at most ${schema.maximum}`);
  }
  return errors;
}

function serializeSession(session: Session) {
  return {
    id: session.id,
    week: session.week,
    day: session.day,
    type: session.type,
    title: session.title,
    rpe: session.rpe,
    duration_min: session.durationMin,
    load: session.rpe * session.durationMin,
    notes: session.notes,
    locked: session.locked,
  };
}

function serializeMetrics(state: PlanState) {
  const metrics = calculateMetrics(state);
  return {
    weekly: metrics.weeks.map((week) => ({
      week: week.week,
      focus: week.focus,
      load: week.load,
      wow_pct: week.wowPct,
      monotony: week.monotony,
      strain: week.strain,
      deload_check: week.deloadCheck,
      daily_loads: week.dailyLoads,
    })),
    peak_load: metrics.peakLoad,
    flags: metrics.flags.map((flag) => ({
      code: flag.code,
      message: flag.message,
      weeks: flag.weeks,
      cells: flag.cells,
      session_ids: flag.sessionIds,
    })),
  };
}

function serializePlan(state: PlanState) {
  return {
    revision: state.revision,
    profile: {
      sport: state.profile.sport,
      goal: state.profile.goal,
      event_date: state.profile.eventDate,
      days_available: state.profile.daysAvailable,
      constraints: state.profile.constraints,
    },
    weeks: state.weeks.map((week) => ({
      week: week.number,
      focus: week.focus,
      intent: week.intent,
      sessions: state.sessions
        .filter((session) => session.week === week.number)
        .sort((a, b) => DAYS.indexOf(a.day) - DAYS.indexOf(b.day))
        .map(serializeSession),
    })),
    metrics: serializeMetrics(state),
    highlight: state.highlight
      ? {
          session_ids: state.highlight.sessionIds,
          weeks: state.highlight.weeks,
          message: state.highlight.message,
        }
      : null,
    pending_proposal: state.proposal
      ? {
          id: state.proposal.id,
          summary: state.proposal.summary,
          rationale: state.proposal.rationale,
          changes: state.proposal.descriptions,
          base_revision: state.proposal.baseRevision,
          loads: state.proposal.loads,
          flags_before: state.proposal.beforeFlagCount,
          flags_after: state.proposal.afterFlagCount,
        }
      : null,
  };
}

function mutationResult(changed: string, extra: Record<string, unknown> = {}) {
  const current = planStore.getState();
  const metrics = serializeMetrics(current);
  return {
    ok: true,
    changed,
    revision: current.revision,
    weekly_loads: Object.fromEntries(metrics.weekly.map((week) => [`week_${week.week}`, week.load])),
    flags: metrics.flags,
    ...extra,
  };
}

function failure(code: string, error: string, session?: Session) {
  planStore.dispatch({ type: "LOG", actor: "agent", message: `Agent tool stopped: ${error}`, tone: "warning" });
  return {
    ok: false,
    code,
    error,
    session: session ? serializeSession(session) : undefined,
    current_metrics: serializeMetrics(planStore.getState()),
  };
}

function invalidInputFailure(toolName: string, errors: string[]) {
  return {
    ok: false,
    code: "INVALID_INPUT",
    error: `Invalid ${toolName} input: ${errors.slice(0, 3).join("; ")}.`,
    current_metrics: serializeMetrics(planStore.getState()),
  };
}

function findSession(id: string): Session | undefined {
  return planStore.getState().sessions.find((session) => session.id === id);
}

function lockedFailure(session: Session) {
  return failure(
    "SESSION_LOCKED",
    "Locked by the athlete — ask them or work around it.",
    session,
  );
}

function withRuntimeValidation(tool: ToolDefinition): WebMCP.ModelContextTool {
  const execute = tool.execute;
  return {
    ...tool,
    execute: async (input, options) => {
      if (options?.signal.aborted) throw options.signal.reason;
      const errors = validateSchema(tool.inputSchema, input);
      if (errors.length > 0) {
        return invalidInputFailure(tool.name, errors);
      }
      const executionOptions = options ?? { signal: new AbortController().signal };
      return execute(input, executionOptions);
    },
  };
}

interface ProposalChangeInput {
  operation: "add" | "update" | "move" | "remove";
  id?: string;
  week?: number;
  day?: Day;
  type?: SessionType;
  title?: string;
  rpe?: number;
  duration_min?: number;
  notes?: string;
}

const proposalChangeSchema: JsonSchema = {
  type: "object",
  properties: {
    operation: { type: "string", enum: ["add", "update", "move", "remove"] },
    id: { type: "string", minLength: 1 },
    week: { type: "integer", minimum: 1, maximum: 4 },
    day: { type: "string", enum: DAYS },
    type: { type: "string", enum: SESSION_TYPES },
    title: { type: "string", minLength: 1, maxLength: 80 },
    rpe: { type: "number", minimum: 1, maximum: 10 },
    duration_min: { type: "integer", minimum: 5, maximum: 300 },
    notes: { type: "string", maxLength: 500 },
  },
  required: ["operation"],
  additionalProperties: false,
};

function unexpectedFields(input: ProposalChangeInput, allowed: string[]): string[] {
  return Object.keys(input).filter((key) => !allowed.includes(key));
}

function updateDescription(session: Session, patch: Extract<ProposedChange, { operation: "update" }>["patch"]): string {
  const details: string[] = [];
  if (patch.title !== undefined && patch.title !== session.title) details.push(`name → ${patch.title}`);
  if (patch.type !== undefined && patch.type !== session.type) details.push(`${session.type} → ${patch.type}`);
  if (patch.rpe !== undefined && patch.rpe !== session.rpe) details.push(`RPE ${session.rpe} → ${patch.rpe}`);
  if (patch.durationMin !== undefined && patch.durationMin !== session.durationMin) details.push(`${session.durationMin} → ${patch.durationMin} min`);
  if (patch.notes !== undefined && patch.notes !== session.notes) details.push("notes revised");
  return `Update ${session.title} · ${details.join(" · ")}`;
}

function buildProposal(
  state: PlanState,
  summary: string,
  rationale: string,
  inputs: ProposalChangeInput[],
): PlanProposal | { code: string; error: string; session?: Session } {
  const changes: ProposedChange[] = [];
  const descriptions: string[] = [];
  let workingSessions = [...state.sessions];

  for (const [index, input] of inputs.entries()) {
    const label = `Change ${index + 1}`;
    if (input.operation === "add") {
      const extras = unexpectedFields(input, ["operation", "week", "day", "type", "title", "rpe", "duration_min", "notes"]);
      if (extras.length) return { code: "INVALID_PROPOSAL", error: `${label} includes fields that do not apply to add: ${extras.join(", ")}.` };
      if (input.week === undefined || input.day === undefined || input.type === undefined || input.title === undefined || input.rpe === undefined || input.duration_min === undefined) {
        return { code: "INVALID_PROPOSAL", error: `${label} must include week, day, type, title, rpe, and duration_min.` };
      }
      if (workingSessions.filter((session) => session.week === input.week && session.day === input.day).length >= 3) {
        return { code: "CELL_FULL", error: `W${input.week} ${input.day} already has the maximum of three sessions.` };
      }
      const session = createSession({
        week: input.week,
        day: input.day,
        type: input.type,
        title: input.title,
        rpe: input.rpe,
        durationMin: input.duration_min,
        notes: input.notes,
        actor: "agent",
      });
      const change: ProposedChange = { operation: "add", session };
      changes.push(change);
      descriptions.push(`Add ${session.title} · W${session.week} ${session.day} · RPE ${session.rpe} × ${session.durationMin} min`);
      workingSessions = applyProposedChanges(workingSessions, [change]);
      continue;
    }

    if (!input.id) return { code: "INVALID_PROPOSAL", error: `${label} must include a session id.` };
    const session = workingSessions.find((item) => item.id === input.id);
    if (!session) return { code: "NOT_FOUND", error: `No session exists with id ${input.id}.` };
    if (session.locked) return { code: "SESSION_LOCKED", error: "Locked by the athlete — ask them or work around it.", session };

    if (input.operation === "update") {
      const extras = unexpectedFields(input, ["operation", "id", "type", "title", "rpe", "duration_min", "notes"]);
      if (extras.length) return { code: "INVALID_PROPOSAL", error: `${label} includes fields that do not apply to update: ${extras.join(", ")}.` };
      const patch: Extract<ProposedChange, { operation: "update" }>["patch"] = {};
      if (input.type !== undefined) patch.type = input.type;
      if (input.title !== undefined) patch.title = input.title.trim();
      if (input.rpe !== undefined) patch.rpe = input.rpe;
      if (input.duration_min !== undefined) patch.durationMin = input.duration_min;
      if (input.notes !== undefined) patch.notes = input.notes.trim();
      const description = updateDescription(session, patch);
      if (description.endsWith(" · ")) return { code: "NO_CHANGE", error: `${label} does not change ${session.title}.` };
      const change: ProposedChange = { operation: "update", id: input.id, patch };
      changes.push(change);
      descriptions.push(description);
      workingSessions = applyProposedChanges(workingSessions, [change]);
      continue;
    }

    if (input.operation === "move") {
      const extras = unexpectedFields(input, ["operation", "id", "week", "day"]);
      if (extras.length) return { code: "INVALID_PROPOSAL", error: `${label} includes fields that do not apply to move: ${extras.join(", ")}.` };
      if (input.week === undefined || input.day === undefined) return { code: "INVALID_PROPOSAL", error: `${label} must include week and day.` };
      if (input.week === session.week && input.day === session.day) return { code: "NO_CHANGE", error: `${session.title} is already on W${input.week} ${input.day}.` };
      if (workingSessions.filter((item) => item.id !== input.id && item.week === input.week && item.day === input.day).length >= 3) {
        return { code: "CELL_FULL", error: `W${input.week} ${input.day} already has the maximum of three sessions.` };
      }
      const change: ProposedChange = { operation: "move", id: input.id, week: input.week, day: input.day };
      changes.push(change);
      descriptions.push(`Move ${session.title} · W${session.week} ${session.day} → W${input.week} ${input.day}`);
      workingSessions = applyProposedChanges(workingSessions, [change]);
      continue;
    }

    const extras = unexpectedFields(input, ["operation", "id"]);
    if (extras.length) return { code: "INVALID_PROPOSAL", error: `${label} includes fields that do not apply to remove: ${extras.join(", ")}.` };
    const change: ProposedChange = { operation: "remove", id: input.id };
    changes.push(change);
    descriptions.push(`Remove ${session.title} · W${session.week} ${session.day}`);
    workingSessions = applyProposedChanges(workingSessions, [change]);
  }

  const beforeMetrics = calculateMetrics(state);
  const afterMetrics = calculateMetrics({ ...state, sessions: workingSessions });
  return {
    id: createId("proposal"),
    summary: summary.trim(),
    rationale: rationale.trim(),
    changes,
    descriptions,
    baseRevision: state.revision,
    loads: beforeMetrics.weeks.map((week, index) => ({
      week: week.week,
      before: week.load,
      after: afterMetrics.weeks[index].load,
    })),
    beforeFlagCount: beforeMetrics.flags.length,
    afterFlagCount: afterMetrics.flags.length,
    createdAt: new Date().toISOString(),
  };
}

const readOnlyAnnotations: WebMCP.ToolAnnotations = {
  readOnlyHint: true,
  untrustedContentHint: true,
};
const writeAnnotations: WebMCP.ToolAnnotations = {
  readOnlyHint: false,
  untrustedContentHint: false,
};

function toolDefinitions(): ToolDefinition[] {
  return [
    {
      name: "get_plan",
      title: "Get training plan",
      description:
        "Call this first before planning, repairing, or editing. The athlete may have changed the live calendar since your last call. Returns the complete profile, sessions and lock state, metrics, flags, highlights, and any repair already awaiting approval.",
      inputSchema: {
        type: "object",
        properties: {},
        required: [],
        additionalProperties: false,
      },
      annotations: readOnlyAnnotations,
      execute: () => ({ ok: true, plan: serializePlan(planStore.getState()) }),
    },
    {
      name: "get_metrics",
      title: "Get block metrics",
      description:
        "Read the current weekly load, week-over-week change, Foster monotony, strain, deload checks, and safety flags without fetching every session. Use after the athlete asks whether the block still works.",
      inputSchema: {
        type: "object",
        properties: {},
        required: [],
        additionalProperties: false,
      },
      annotations: readOnlyAnnotations,
      execute: () => ({ ok: true, metrics: serializeMetrics(planStore.getState()) }),
    },
    {
      name: "propose_changes",
      title: "Propose a plan repair",
      description:
        "Preferred tool for replanning after a missed session, schedule conflict, fatigue, pain, travel, or changed priority. Read the current plan first, then submit the smallest useful set of changes. This simulates the result and shows the athlete an approval card; it does not alter the calendar. Never include a locked session—work around it instead.",
      inputSchema: {
        type: "object",
        properties: {
          summary: { type: "string", minLength: 1, maxLength: 120 },
          rationale: { type: "string", minLength: 1, maxLength: 300 },
          changes: { type: "array", items: proposalChangeSchema, minItems: 1, maxItems: 12 },
        },
        required: ["summary", "rationale", "changes"],
        additionalProperties: false,
      },
      annotations: writeAnnotations,
      execute: (input: { summary: string; rationale: string; changes: ProposalChangeInput[] }) => {
        const base = planStore.getState();
        const proposal = buildProposal(base, input.summary, input.rationale, input.changes);
        if ("error" in proposal) return failure(proposal.code, proposal.error, proposal.session);
        planStore.dispatch({ type: "SET_PROPOSAL", proposal, actor: "agent" });
        return {
          ok: true,
          changed: "Created a non-destructive repair proposal for athlete approval.",
          proposal: {
            id: proposal.id,
            summary: proposal.summary,
            changes: proposal.descriptions,
            base_revision: proposal.baseRevision,
            load_comparison: proposal.loads,
            flags_before: proposal.beforeFlagCount,
            flags_after: proposal.afterFlagCount,
          },
        };
      },
    },
    {
      name: "set_profile",
      title: "Update athlete profile",
      description:
        "Partially update the athlete profile. Preserve fields the athlete did not ask to change. Returns current weekly loads and flags because availability changes can create conflicts.",
      inputSchema: {
        type: "object",
        properties: {
          sport: { type: "string", minLength: 1, maxLength: 80 },
          goal: { type: "string", minLength: 1, maxLength: 240 },
          event_date: { type: "string", format: "date" },
          days_available: {
            type: "array",
            items: { type: "string", enum: DAYS },
            uniqueItems: true,
            minItems: 1,
          },
          constraints: {
            type: "array",
            items: { type: "string", minLength: 1, maxLength: 200 },
            maxItems: 20,
          },
        },
        required: [],
        additionalProperties: false,
      },
      annotations: writeAnnotations,
      execute: (input: {
        sport?: string;
        goal?: string;
        event_date?: string;
        days_available?: Day[];
        constraints?: string[];
      }) => {
        const patch: Partial<AthleteProfile> = {};
        if (input.sport !== undefined) patch.sport = input.sport.trim();
        if (input.goal !== undefined) patch.goal = input.goal.trim();
        if (input.event_date !== undefined) patch.eventDate = input.event_date;
        if (input.days_available !== undefined) patch.daysAvailable = input.days_available;
        if (input.constraints !== undefined) patch.constraints = input.constraints.map((item) => item.trim()).filter(Boolean);
        planStore.dispatch({ type: "SET_PROFILE", patch, actor: "agent" });
        return mutationResult("Updated athlete profile.");
      },
    },
    {
      name: "set_week_focus",
      title: "Set week focus",
      description:
        "Set the periodization focus and human-readable intent for one week. Use before adding that week's sessions so the calendar explains the load shape. Returns current loads and flags.",
      inputSchema: {
        type: "object",
        properties: {
          week: { type: "integer", minimum: 1, maximum: 4 },
          focus: { type: "string", enum: WEEK_FOCUSES },
          intent: { type: "string", minLength: 1, maxLength: 240 },
        },
        required: ["week", "focus", "intent"],
        additionalProperties: false,
      },
      annotations: writeAnnotations,
      execute: (input: { week: number; focus: WeekFocus; intent: string }) => {
        planStore.dispatch({
          type: "SET_WEEK_FOCUS",
          week: input.week,
          focus: input.focus,
          intent: input.intent.trim(),
          actor: "agent",
        });
        return mutationResult(`Set Week ${input.week} to ${input.focus}.`);
      },
    },
    {
      name: "add_session",
      title: "Add training session",
      description:
        "Immediately add one training session. For repair or replanning requests, prefer propose_changes so the athlete can inspect and approve the full patch. A cell holds at most three sessions.",
      inputSchema: {
        type: "object",
        properties: {
          week: { type: "integer", minimum: 1, maximum: 4 },
          day: { type: "string", enum: DAYS },
          type: { type: "string", enum: SESSION_TYPES },
          title: { type: "string", minLength: 1, maxLength: 80 },
          rpe: { type: "number", minimum: 1, maximum: 10 },
          duration_min: { type: "integer", minimum: 5, maximum: 300 },
          notes: { type: "string", maxLength: 500 },
        },
        required: ["week", "day", "type", "title", "rpe", "duration_min"],
        additionalProperties: false,
      },
      annotations: writeAnnotations,
      execute: (input: {
        week: number;
        day: Day;
        type: SessionType;
        title: string;
        rpe: number;
        duration_min: number;
        notes?: string;
      }) => {
        if (sessionsInCell(planStore.getState(), input.week, input.day).length >= 3) {
          return failure("CELL_FULL", `W${input.week} ${input.day} already has the maximum of three sessions.`);
        }
        const session = createSession({
          week: input.week,
          day: input.day,
          type: input.type,
          title: input.title,
          rpe: input.rpe,
          durationMin: input.duration_min,
          notes: input.notes,
          actor: "agent",
        });
        planStore.dispatch({ type: "ADD_SESSION", session, actor: "agent" });
        return mutationResult(`Added ${session.title} to W${session.week} ${session.day}.`, { id: session.id });
      },
    },
    {
      name: "update_session",
      title: "Update training session",
      description:
        "Immediately update one session. For repair or replanning requests, prefer propose_changes. Never use this to move a session; use move_session. Locked sessions reject the change.",
      inputSchema: {
        type: "object",
        minProperties: 2,
        properties: {
          id: { type: "string", minLength: 1 },
          type: { type: "string", enum: SESSION_TYPES },
          title: { type: "string", minLength: 1, maxLength: 80 },
          rpe: { type: "number", minimum: 1, maximum: 10 },
          duration_min: { type: "integer", minimum: 5, maximum: 300 },
          notes: { type: "string", maxLength: 500 },
        },
        required: ["id"],
        additionalProperties: false,
      },
      annotations: writeAnnotations,
      execute: (input: {
        id: string;
        type?: SessionType;
        title?: string;
        rpe?: number;
        duration_min?: number;
        notes?: string;
      }) => {
        const session = findSession(input.id);
        if (!session) return failure("NOT_FOUND", `No session exists with id ${input.id}.`);
        if (session.locked) return lockedFailure(session);
        const patch: Partial<Session> = {};
        if (input.type !== undefined) patch.type = input.type;
        if (input.title !== undefined) patch.title = input.title.trim();
        if (input.rpe !== undefined) patch.rpe = input.rpe;
        if (input.duration_min !== undefined) patch.durationMin = input.duration_min;
        if (input.notes !== undefined) patch.notes = input.notes.trim();
        planStore.dispatch({ type: "UPDATE_SESSION", id: input.id, patch, actor: "agent" });
        return mutationResult(`Updated ${session.title}.`);
      },
    },
    {
      name: "move_session",
      title: "Move training session",
      description:
        "Immediately move one session. For repair or replanning requests, prefer propose_changes. Check capacity and lock state; a locked commitment must be worked around.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", minLength: 1 },
          week: { type: "integer", minimum: 1, maximum: 4 },
          day: { type: "string", enum: DAYS },
        },
        required: ["id", "week", "day"],
        additionalProperties: false,
      },
      annotations: writeAnnotations,
      execute: (input: { id: string; week: number; day: Day }) => {
        const session = findSession(input.id);
        if (!session) return failure("NOT_FOUND", `No session exists with id ${input.id}.`);
        if (session.locked) return lockedFailure(session);
        const destination = sessionsInCell(planStore.getState(), input.week, input.day).filter((item) => item.id !== input.id);
        if (destination.length >= 3) {
          return failure("CELL_FULL", `W${input.week} ${input.day} already has the maximum of three sessions.`);
        }
        planStore.dispatch({ type: "MOVE_SESSION", id: input.id, week: input.week, day: input.day, actor: "agent" });
        return mutationResult(`Moved ${session.title} to W${input.week} ${input.day}.`);
      },
    },
    {
      name: "remove_session",
      title: "Remove training session",
      description:
        "Immediately remove one session. For repair or replanning requests, prefer propose_changes. Locked sessions reject removal because only the athlete can change them.",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string", minLength: 1 } },
        required: ["id"],
        additionalProperties: false,
      },
      annotations: writeAnnotations,
      execute: (input: { id: string }) => {
        const session = findSession(input.id);
        if (!session) return failure("NOT_FOUND", `No session exists with id ${input.id}.`);
        if (session.locked) return lockedFailure(session);
        planStore.dispatch({ type: "REMOVE_SESSION", id: input.id, actor: "agent" });
        return mutationResult(`Removed ${session.title}.`);
      },
    },
    {
      name: "highlight",
      title: "Highlight plan details",
      description:
        "Gesture at sessions or whole weeks in the visible planner while explaining a risk, tradeoff, or recommendation. Each call replaces the prior highlight. Omit both arrays to clear the visual emphasis after your message is resolved.",
      inputSchema: {
        type: "object",
        properties: {
          session_ids: {
            type: "array",
            items: { type: "string", minLength: 1 },
            uniqueItems: true,
            maxItems: 20,
          },
          weeks: {
            type: "array",
            items: { type: "integer", minimum: 1, maximum: 4 },
            uniqueItems: true,
            maxItems: 4,
          },
          message: { type: "string", minLength: 1, maxLength: 300 },
        },
        required: ["message"],
        additionalProperties: false,
      },
      annotations: writeAnnotations,
      execute: (input: { session_ids?: string[]; weeks?: number[]; message: string }) => {
        const sessionIds = input.session_ids ?? [];
        const unknown = sessionIds.filter((id) => !findSession(id));
        if (unknown.length) return failure("NOT_FOUND", `Unknown session ids: ${unknown.join(", ")}.`);
        planStore.dispatch({
          type: "HIGHLIGHT",
          actor: "agent",
          highlight: { sessionIds, weeks: input.weeks ?? [], message: input.message.trim() },
        });
        return mutationResult("Updated the visible agent highlight.");
      },
    },
  ];
}

let registration: Promise<WebMcpStatus> | null = null;
let registrationController: AbortController | null = null;

export function unregisterWebMcpTools(): void {
  registrationController?.abort();
  registrationController = null;
  registration = null;
}

export function registerWebMcpTools(): Promise<WebMcpStatus> {
  if (registration) return registration;
  const details = contextDetails();
  const context = details.context;
  if (!context) return Promise.resolve({ supported: false, registered: 0, source: "none" });
  registration = (async () => {
    const controller = new AbortController();
    registrationController = controller;
    let count = 0;
    try {
      for (const tool of toolDefinitions()) {
        await context.registerTool(withRuntimeValidation(tool), { signal: controller.signal });
        count += 1;
      }
      planStore.dispatch({
        type: "LOG",
        actor: "system",
        message: `${count} site tools are online. Your agent can now work in this block.`,
        tone: "success",
      });
      return { supported: true, registered: count, source: details.source };
    } catch (error) {
      controller.abort();
      if (registrationController === controller) registrationController = null;
      registration = null;
      const message = error instanceof Error ? error.message : String(error);
      planStore.dispatch({
        type: "LOG",
        actor: "system",
        message: `Site tool registration failed after ${count} tools; the partial set was rolled back: ${message}`,
        tone: "warning",
      });
      return { supported: true, registered: 0, source: details.source, error: message };
    }
  })();
  return registration;
}

export function exportPlanSnapshot() {
  return serializePlan(planStore.getState());
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => unregisterWebMcpTools());
}
