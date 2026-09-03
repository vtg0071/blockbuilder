import {
  DAYS,
  type ActivityEntry,
  type Actor,
  type AthleteProfile,
  type Day,
  type PlanAction,
  type ProposedChange,
  type PlanState,
  type Session,
  type SessionType,
  type TrainingWeek,
} from "./types";

const STORAGE_KEY = "blockbuilder.plan.v1";

type UndoSnapshot = Omit<PlanState, "activity" | "canUndo" | "proposal"> & { proposal: null };

const listeners = new Set<() => void>();
let previous: UndoSnapshot | null = null;

export function createId(prefix = "item"): string {
  const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${random}`;
}

function now(): string {
  return new Date().toISOString();
}

function emptyProfile(): AthleteProfile {
  return {
    sport: "",
    goal: "",
    eventDate: "",
    daysAvailable: [...DAYS],
    constraints: [],
  };
}

function emptyWeeks(): TrainingWeek[] {
  return Array.from({ length: 4 }, (_, index) => ({ number: index + 1, focus: null, intent: "" }));
}

function welcomeEntry(): ActivityEntry {
  return {
    id: createId("log"),
    actor: "system",
    message: "Block ready. Build a starting plan, then use ChatGPT to repair it when life changes.",
    timestamp: now(),
  };
}

export function createEmptyState(): PlanState {
  return {
    profile: emptyProfile(),
    weeks: emptyWeeks(),
    sessions: [],
    highlight: null,
    proposal: null,
    activity: [welcomeEntry()],
    revision: 0,
    canUndo: false,
  };
}

function isPersistedState(value: unknown): value is PlanState {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<PlanState>;
  return Boolean(candidate.profile && Array.isArray(candidate.weeks) && Array.isArray(candidate.sessions));
}

function loadState(): PlanState {
  if (typeof localStorage === "undefined") return createEmptyState();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createEmptyState();
    const parsed: unknown = JSON.parse(raw);
    if (!isPersistedState(parsed)) return createEmptyState();
    return {
      ...createEmptyState(),
      ...parsed,
      activity: parsed.activity?.length ? parsed.activity : [welcomeEntry()],
      canUndo: false,
    };
  } catch {
    return createEmptyState();
  }
}

let state = loadState();

function actorSubject(actor: Actor): string {
  if (actor === "agent") return "Agent";
  if (actor === "human") return "You";
  return "BlockBuilder";
}

function addActivity(
  current: PlanState,
  actor: Actor,
  message: string,
  tone: ActivityEntry["tone"] = "default",
): PlanState {
  return {
    ...current,
    activity: [
      ...current.activity,
      { id: createId("log"), actor, message, timestamp: now(), tone },
    ].slice(-120),
  };
}

function reduce(current: PlanState, action: Exclude<PlanAction, { type: "UNDO" }>): PlanState {
  const subject = "actor" in action ? actorSubject(action.actor) : "BlockBuilder";

  switch (action.type) {
    case "SET_PROFILE": {
      const next = {
        ...current,
        profile: { ...current.profile, ...action.patch },
        revision: current.revision + 1,
      };
      return addActivity(next, action.actor, `${subject} updated the athlete profile.`);
    }
    case "SET_WEEK_FOCUS": {
      const next = {
        ...current,
        weeks: current.weeks.map((week) =>
          week.number === action.week ? { ...week, focus: action.focus, intent: action.intent } : week,
        ),
        revision: current.revision + 1,
      };
      return addActivity(next, action.actor, `${subject} set Week ${action.week} to ${action.focus}.`);
    }
    case "ADD_SESSION": {
      const next = {
        ...current,
        sessions: [...current.sessions, action.session],
        revision: current.revision + 1,
      };
      return addActivity(
        next,
        action.actor,
        `${subject} added ${action.session.title} to W${action.session.week} ${action.session.day}.`,
        "success",
      );
    }
    case "UPDATE_SESSION": {
      const session = current.sessions.find((item) => item.id === action.id);
      if (!session) return current;
      const next = {
        ...current,
        sessions: current.sessions.map((item) => (item.id === action.id ? { ...item, ...action.patch } : item)),
        revision: current.revision + 1,
      };
      return addActivity(next, action.actor, `${subject} updated ${session.title}.`);
    }
    case "MOVE_SESSION": {
      const session = current.sessions.find((item) => item.id === action.id);
      if (!session || (session.week === action.week && session.day === action.day)) return current;
      const next = {
        ...current,
        sessions: current.sessions.map((item) =>
          item.id === action.id ? { ...item, week: action.week, day: action.day } : item,
        ),
        revision: current.revision + 1,
      };
      return addActivity(
        next,
        action.actor,
        `${subject} moved ${session.title} from W${session.week} ${session.day} to W${action.week} ${action.day}.`,
        "success",
      );
    }
    case "REMOVE_SESSION": {
      const session = current.sessions.find((item) => item.id === action.id);
      if (!session) return current;
      const next = {
        ...current,
        sessions: current.sessions.filter((item) => item.id !== action.id),
        revision: current.revision + 1,
      };
      return addActivity(next, action.actor, `${subject} removed ${session.title}.`);
    }
    case "TOGGLE_LOCK": {
      const session = current.sessions.find((item) => item.id === action.id);
      if (!session) return current;
      const locked = !session.locked;
      const next = {
        ...current,
        sessions: current.sessions.map((item) => (item.id === action.id ? { ...item, locked } : item)),
        revision: current.revision + 1,
      };
      return addActivity(
        next,
        "human",
        `You ${locked ? "locked" : "unlocked"} ${session.title} (W${session.week} ${session.day}).`,
      );
    }
    case "HIGHLIGHT": {
      const next = { ...current, highlight: action.highlight };
      return addActivity(next, action.actor, `${subject} highlighted the plan: ${action.highlight.message}`, "warning");
    }
    case "CLEAR_HIGHLIGHT": {
      if (!current.highlight) return current;
      const next = { ...current, highlight: null };
      return addActivity(next, action.actor, `${subject} cleared the active highlight.`);
    }
    case "SET_PROPOSAL": {
      const next = { ...current, proposal: action.proposal };
      return addActivity(next, "agent", `ChatGPT proposed a repair: ${action.proposal.summary}`, "success");
    }
    case "DISMISS_PROPOSAL": {
      if (current.proposal?.id !== action.id) return current;
      const next = { ...current, proposal: null };
      return addActivity(next, "human", "You dismissed ChatGPT's proposed repair.");
    }
    case "APPLY_PROPOSAL": {
      const proposal = current.proposal;
      if (!proposal || proposal.id !== action.id || proposal.baseRevision !== current.revision) return current;
      const next = {
        ...current,
        sessions: applyProposedChanges(current.sessions, proposal.changes),
        proposal: null,
        revision: current.revision + 1,
      };
      return addActivity(next, "human", `You applied ChatGPT's repair: ${proposal.summary}`, "success");
    }
    case "LOG":
      return addActivity(current, action.actor, action.message, action.tone);
    case "LOAD_DEMO": {
      const sessions: Session[] = [1, 2, 3, 4].flatMap((week) => {
        const taper = week === 4;
        return [
          {
            id: createId("session"),
            week,
            day: "Mon" as Day,
            type: "strength" as SessionType,
            title: taper ? "Primer Strength" : "Lower Body Strength",
            rpe: taper ? 5 : week === 3 ? 8 : 7,
            durationMin: taper ? 35 : week === 3 ? 45 : 50,
            notes: taper ? "Keep the bar fast; stop well before fatigue." : "Squat pattern, unilateral work, and trunk stiffness.",
            locked: false,
            createdBy: "agent" as Actor,
          },
          {
          id: createId("session"),
          week,
          day: "Tue" as Day,
          type: "technique" as SessionType,
          title: "Team Practice",
          rpe: taper ? 5 : 6,
          durationMin: taper ? 60 : 90,
          notes: "Coach-led javelin practice. Fixed team commitment.",
          locked: true,
          createdBy: "human" as Actor,
        },
        {
          id: createId("session"),
          week,
          day: "Thu" as Day,
          type: "technique" as SessionType,
          title: "Team Practice",
          rpe: taper ? 4 : 6,
          durationMin: taper ? 50 : 90,
          notes: "Coach-led javelin practice. Fixed team commitment.",
          locked: true,
          createdBy: "human" as Actor,
        },
          {
            id: createId("session"),
            week,
            day: "Fri" as Day,
            type: "power" as SessionType,
            title: taper ? "Speed Primer" : "Med Ball + Sprints",
            rpe: taper ? 5 : week === 3 ? 8 : 7,
            durationMin: taper ? 25 : 40,
            notes: "Short, high-quality explosive work with full recovery.",
            locked: false,
            createdBy: "agent" as Actor,
          },
          {
            id: createId("session"),
            week,
            day: "Sat" as Day,
            type: "mobility" as SessionType,
            title: "Shoulder Recovery",
            rpe: 2,
            durationMin: taper ? 25 : 30,
            notes: "Easy range-of-motion and cuff capacity work.",
            locked: false,
            createdBy: "agent" as Actor,
          },
        ];
      });
      const next: PlanState = {
        ...current,
        profile: {
          sport: "Javelin",
          goal: "Peak for the conference meet in five weeks",
          eventDate: "2026-10-07",
          daysAvailable: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
          constraints: ["Team practice Tuesday and Thursday", "Protect throwing shoulder", "No Sunday training"],
        },
        weeks: [
          { number: 1, focus: "accumulation", intent: "Build repeatable technical volume and strength quality." },
          { number: 2, focus: "intensification", intent: "Raise power output without adding training days." },
          { number: 3, focus: "realization", intent: "Prioritize high-quality throws and event-specific speed." },
          { number: 4, focus: "taper", intent: "Reduce fatigue while keeping the competition rhythm familiar." },
        ],
        sessions,
        highlight: null,
        proposal: null,
        revision: current.revision + 1,
      };
      return addActivity(next, "human", "You loaded a complete javelin block with protected team practices.", "success");
    }
    case "RESET": {
      const fresh = createEmptyState();
      fresh.revision = current.revision + 1;
      return addActivity(fresh, "human", "You reset the entire training block.");
    }
  }
}

function snapshot(current: PlanState): UndoSnapshot {
  const { activity: _activity, canUndo: _canUndo, proposal: _proposal, ...rest } = current;
  return structuredClone({ ...rest, proposal: null });
}

function isUndoable(action: PlanAction): boolean {
  return !["LOG", "HIGHLIGHT", "CLEAR_HIGHLIGHT", "SET_PROPOSAL", "DISMISS_PROPOSAL", "UNDO"].includes(action.type);
}

function persist(current: PlanState): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...current, canUndo: false }));
  } catch {
    // Storage can be disabled in hardened browsers. The app remains usable in-memory.
  }
}

export const planStore = {
  getState(): PlanState {
    return state;
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  dispatch(action: PlanAction): PlanState {
    if (action.type === "UNDO") {
      if (!previous) return state;
      const restored: PlanState = {
        ...previous,
        activity: state.activity,
        revision: state.revision + 1,
        canUndo: false,
      };
      state = addActivity(restored, "human", "You undid the last plan change.");
      previous = null;
    } else {
      const before = state;
      const next = reduce(state, action);
      if (next === before) return state;
      if (isUndoable(action)) previous = snapshot(before);
      state = { ...next, canUndo: previous !== null };
    }
    persist(state);
    listeners.forEach((listener) => listener());
    return state;
  },
};

export function sessionsInCell(current: PlanState, week: number, day: Day): Session[] {
  return current.sessions.filter((session) => session.week === week && session.day === day);
}

export function createSession(input: {
  week: number;
  day: Day;
  type: SessionType;
  title: string;
  rpe: number;
  durationMin: number;
  notes?: string;
  actor: Actor;
}): Session {
  return {
    id: createId("session"),
    week: input.week,
    day: input.day,
    type: input.type,
    title: input.title.trim(),
    rpe: input.rpe,
    durationMin: input.durationMin,
    notes: input.notes?.trim() ?? "",
    locked: false,
    createdBy: input.actor,
  };
}

export function applyProposedChanges(sessions: Session[], changes: ProposedChange[]): Session[] {
  return changes.reduce<Session[]>((current, change) => {
    switch (change.operation) {
      case "add":
        return [...current, change.session];
      case "update":
        return current.map((session) => session.id === change.id ? { ...session, ...change.patch } : session);
      case "move":
        return current.map((session) => session.id === change.id ? { ...session, week: change.week, day: change.day } : session);
      case "remove":
        return current.filter((session) => session.id !== change.id);
    }
  }, sessions);
}
