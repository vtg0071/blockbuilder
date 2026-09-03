export const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
export type Day = (typeof DAYS)[number];

export const SESSION_TYPES = [
  "strength",
  "power",
  "technique",
  "speed",
  "conditioning",
  "mobility",
  "rest",
] as const;
export type SessionType = (typeof SESSION_TYPES)[number];

export const WEEK_FOCUSES = [
  "accumulation",
  "intensification",
  "realization",
  "deload",
  "taper",
] as const;
export type WeekFocus = (typeof WEEK_FOCUSES)[number];

export interface AthleteProfile {
  sport: string;
  goal: string;
  eventDate: string;
  daysAvailable: Day[];
  constraints: string[];
}

export interface TrainingWeek {
  number: number;
  focus: WeekFocus | null;
  intent: string;
}

export interface Session {
  id: string;
  week: number;
  day: Day;
  type: SessionType;
  title: string;
  rpe: number;
  durationMin: number;
  notes: string;
  locked: boolean;
  createdBy: Actor;
}

export type Actor = "human" | "agent" | "system";

export interface ActivityEntry {
  id: string;
  actor: Actor;
  message: string;
  timestamp: string;
  tone?: "default" | "warning" | "success";
}

export interface HighlightState {
  sessionIds: string[];
  weeks: number[];
  message: string;
}

export type ProposedChange =
  | { operation: "add"; session: Session }
  | { operation: "update"; id: string; patch: Partial<Omit<Session, "id" | "createdBy" | "locked" | "week" | "day">> }
  | { operation: "move"; id: string; week: number; day: Day }
  | { operation: "remove"; id: string };

export interface ProposalLoadComparison {
  week: number;
  before: number;
  after: number;
}

export interface PlanProposal {
  id: string;
  summary: string;
  rationale: string;
  changes: ProposedChange[];
  descriptions: string[];
  baseRevision: number;
  loads: ProposalLoadComparison[];
  beforeFlagCount: number;
  afterFlagCount: number;
  createdAt: string;
}

export interface PlanState {
  profile: AthleteProfile;
  weeks: TrainingWeek[];
  sessions: Session[];
  highlight: HighlightState | null;
  proposal: PlanProposal | null;
  activity: ActivityEntry[];
  revision: number;
  canUndo: boolean;
}

export type FlagCode =
  | "load_spike"
  | "consecutive_high_rpe"
  | "deload_too_high"
  | "unavailable_day"
  | "high_monotony";

export interface MetricFlag {
  id: string;
  code: FlagCode;
  severity: "warning" | "caution";
  message: string;
  weeks: number[];
  cells: string[];
  sessionIds: string[];
}

export interface WeekMetrics {
  week: number;
  focus: WeekFocus | null;
  load: number;
  wowPct: number | null;
  monotony: number;
  strain: number;
  dailyLoads: Record<Day, number>;
  deloadCheck: boolean | null;
}

export interface PlanMetrics {
  weeks: WeekMetrics[];
  peakLoad: number;
  flags: MetricFlag[];
}

export type PlanAction =
  | { type: "SET_PROFILE"; patch: Partial<AthleteProfile>; actor: Actor }
  | { type: "SET_WEEK_FOCUS"; week: number; focus: WeekFocus; intent: string; actor: Actor }
  | { type: "ADD_SESSION"; session: Session; actor: Actor }
  | { type: "UPDATE_SESSION"; id: string; patch: Partial<Omit<Session, "id" | "createdBy">>; actor: Actor }
  | { type: "MOVE_SESSION"; id: string; week: number; day: Day; actor: Actor }
  | { type: "REMOVE_SESSION"; id: string; actor: Actor }
  | { type: "TOGGLE_LOCK"; id: string; actor: "human" }
  | { type: "HIGHLIGHT"; highlight: HighlightState; actor: Actor }
  | { type: "CLEAR_HIGHLIGHT"; actor: Actor }
  | { type: "SET_PROPOSAL"; proposal: PlanProposal; actor: "agent" }
  | { type: "DISMISS_PROPOSAL"; id: string; actor: "human" }
  | { type: "APPLY_PROPOSAL"; id: string; actor: "human" }
  | { type: "LOG"; actor: Actor; message: string; tone?: ActivityEntry["tone"] }
  | { type: "LOAD_DEMO" }
  | { type: "UNDO" }
  | { type: "RESET" };
