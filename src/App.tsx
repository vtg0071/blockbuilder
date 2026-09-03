import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import {
  ArrowCounterClockwise,
  ArrowRight,
  CalendarBlank,
  CalendarDots,
  ChartLineUp,
  Check,
  Copy,
  CopySimple,
  DownloadSimple,
  LockKey,
  LockKeyOpen,
  Plus,
  Sparkle,
  Trash,
  User,
  Warning,
  X,
  type IconProps,
} from "@phosphor-icons/react";
import { calculateMetrics, sessionLoad } from "./metrics";
import { createSession, planStore, sessionsInCell } from "./store";
import {
  DAYS,
  SESSION_TYPES,
  WEEK_FOCUSES,
  type ActivityEntry,
  type AthleteProfile,
  type Day,
  type MetricFlag,
  type PlanMetrics,
  type PlanProposal,
  type PlanState,
  type Session,
  type SessionType,
  type WeekFocus,
} from "./types";
import { detectWebMcp, exportPlanSnapshot, registerWebMcpTools, type WebMcpStatus } from "./webmcp";

type IconName =
  | "arrow"
  | "calendar"
  | "check"
  | "close"
  | "copy"
  | "download"
  | "duplicate"
  | "insights"
  | "lock"
  | "plan"
  | "plus"
  | "profile"
  | "spark"
  | "trash"
  | "undo"
  | "unlock"
  | "warning";

const ICONS: Record<IconName, React.ComponentType<IconProps>> = {
  arrow: ArrowRight,
  calendar: CalendarBlank,
  check: Check,
  close: X,
  copy: Copy,
  download: DownloadSimple,
  duplicate: CopySimple,
  insights: ChartLineUp,
  lock: LockKey,
  plan: CalendarDots,
  plus: Plus,
  profile: User,
  spark: Sparkle,
  trash: Trash,
  undo: ArrowCounterClockwise,
  unlock: LockKeyOpen,
  warning: Warning,
};

function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  const Component = ICONS[name];
  return <Component size={size} weight="bold" aria-hidden="true" />;
}

function formatLoad(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function relativeTime(iso: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return "now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

type MotionTransitionKind = "workspace" | "week";

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function runViewTransition(
  kind: MotionTransitionKind,
  update: () => void,
  direction?: "forward" | "backward",
): void {
  const motionDocument = document as Document & {
    startViewTransition?: (callback: () => void) => { finished: Promise<void> };
  };
  if (!motionDocument.startViewTransition || prefersReducedMotion()) {
    update();
    return;
  }

  document.documentElement.dataset.motionTransition = kind;
  if (direction) document.documentElement.dataset.motionDirection = direction;
  const cleanup = () => {
    delete document.documentElement.dataset.motionTransition;
    delete document.documentElement.dataset.motionDirection;
  };

  try {
    void motionDocument.startViewTransition(update).finished.then(cleanup, cleanup);
  } catch {
    cleanup();
    update();
  }
}

function WebMcpBanner({ status }: { status: WebMcpStatus | null }) {
  if (status?.supported || (status === null && detectWebMcp())) return null;
  return (
    <div className="webmcp-banner" role="status" aria-label="Manual mode. ChatGPT repair is off in this browser. You can still edit the calendar and copy a repair request. Open this page in ChatGPT with Site tools enabled for live proposals.">
      <span className="banner-icon"><Icon name="spark" size={16} /></span>
      <div>
        <strong>Manual mode</strong>
        <span>ChatGPT repair is off</span>
      </div>
    </div>
  );
}

function ProfilePanel({
  onToast,
  onPlanReady,
  onExport,
  onReset,
  resetPending,
}: {
  onToast: (message: string) => void;
  onPlanReady: () => void;
  onExport: () => void;
  onReset: () => void;
  resetPending: boolean;
}) {
  const state = useSyncExternalStore(planStore.subscribe, planStore.getState);
  const [draft, setDraft] = useState<AthleteProfile>(state.profile);
  const [constraintsText, setConstraintsText] = useState(state.profile.constraints.join("\n"));
  const [error, setError] = useState<string | null>(null);
  const [replacePending, setReplacePending] = useState(false);

  useEffect(() => {
    setDraft(state.profile);
    setConstraintsText(state.profile.constraints.join("\n"));
  }, [state.profile]);

  const updateDay = (day: Day) => {
    setError(null);
    setDraft((current) => ({
      ...current,
      daysAvailable: current.daysAvailable.includes(day)
        ? current.daysAvailable.filter((item) => item !== day)
        : DAYS.filter((item) => [...current.daysAvailable, day].includes(item)),
    }));
  };

  const save = (event: FormEvent) => {
    event.preventDefault();
    if (!draft.sport.trim()) {
      setError("Add the sport or event so the plan has useful context.");
      return;
    }
    if (!draft.goal.trim()) {
      setError("Add the outcome this block should support.");
      return;
    }
    if (draft.daysAvailable.length === 0) {
      setError("Choose at least one available training day.");
      return;
    }
    const constraints = constraintsText.split("\n").map((item) => item.trim()).filter(Boolean);
    planStore.dispatch({
      type: "SET_PROFILE",
      patch: { ...draft, sport: draft.sport.trim(), goal: draft.goal.trim(), constraints },
      actor: "human",
    });
    setError(null);
    onToast("Athlete brief saved");
  };

  const loadDemo = () => {
    if (state.sessions.length > 0 && !replacePending) {
      setReplacePending(true);
      return;
    }
    planStore.dispatch({ type: "LOAD_DEMO" });
    setReplacePending(false);
    onToast("Javelin demo loaded");
    onPlanReady();
  };

  return (
    <aside className="profile-column" aria-labelledby="athlete-brief-title">
      <section className="support-panel profile-panel">
        <div className="panel-heading">
          <div>
            <h2 id="athlete-brief-title">Athlete brief</h2>
            <p>The constraints your plan must respect.</p>
          </div>
          <span className="panel-icon"><Icon name="profile" size={18} /></span>
        </div>

        <form onSubmit={save} className="profile-form" noValidate>
          <label className="field">
            <span>Sport or event</span>
            <input
              name="sport"
              value={draft.sport}
              onChange={(event) => { setError(null); setDraft({ ...draft, sport: event.target.value }); }}
              placeholder="Javelin"
              maxLength={80}
              required
            />
          </label>
          <label className="field">
            <span>Target outcome</span>
            <textarea
              name="goal"
              rows={3}
              value={draft.goal}
              onChange={(event) => { setError(null); setDraft({ ...draft, goal: event.target.value }); }}
              placeholder="Peak for the conference meet"
              maxLength={240}
              required
            />
          </label>
          <label className="field">
            <span>Event date <em>optional</em></span>
            <div className="input-icon-wrap">
              <Icon name="calendar" size={16} />
              <input name="event-date" type="date" value={draft.eventDate} onChange={(event) => setDraft({ ...draft, eventDate: event.target.value })} />
            </div>
          </label>

          <fieldset className="days-fieldset">
            <legend>Available days</legend>
            <div className="day-toggles">
              {DAYS.map((day) => (
                <button
                  type="button"
                  key={day}
                  className={draft.daysAvailable.includes(day) ? "selected" : ""}
                  onClick={() => updateDay(day)}
                  aria-pressed={draft.daysAvailable.includes(day)}
                >
                  {day}
                </button>
              ))}
            </div>
          </fieldset>

          <label className="field">
            <span>Constraints <em>one per line</em></span>
            <textarea
              name="constraints"
              rows={4}
              value={constraintsText}
              onChange={(event) => setConstraintsText(event.target.value)}
              placeholder={"Team practice Tue / Thu\nProtect throwing shoulder"}
              maxLength={2000}
            />
          </label>

          {error && <p className="form-error" role="alert"><Icon name="warning" size={15} />{error}</p>}

          <button className="primary-button" type="submit">
            <span>Save athlete brief</span>
            <Icon name="arrow" size={17} />
          </button>
        </form>

        <div className={`demo-callout ${replacePending ? "confirming" : ""}`}>
          <div className="demo-icon"><Icon name="spark" size={17} /></div>
          <div>
            <strong>{replacePending ? "Replace this plan?" : "Need a realistic example?"}</strong>
            <p>{replacePending ? "The current sessions will be replaced by the javelin demo." : "Load a full plan with eight protected team practices."}</p>
          </div>
          <div className="demo-actions">
            {replacePending && <button type="button" className="text-button" onClick={() => setReplacePending(false)}>Cancel</button>}
            <button type="button" className={replacePending ? "danger-button" : "secondary-button"} onClick={loadDemo}>
              {replacePending ? "Replace" : "Load demo"}
            </button>
          </div>
        </div>

        <div className="profile-utilities" aria-label="Plan utilities">
          <button type="button" onClick={onExport}><Icon name="download" size={16} />Export JSON</button>
          <button type="button" className={resetPending ? "confirm" : ""} onClick={onReset}><Icon name="trash" size={16} />{resetPending ? "Confirm reset" : "Reset block"}</button>
        </div>
      </section>
    </aside>
  );
}

interface EditorTarget {
  mode: "add" | "edit";
  week: number;
  day: Day;
  id?: string;
}

const SESSION_PRESETS: Array<{
  label: string;
  title: string;
  type: SessionType;
  rpe: number;
  duration: number;
}> = [
  { label: "Strength 45", title: "Strength session", type: "strength", rpe: 7, duration: 45 },
  { label: "Technique 60", title: "Technique practice", type: "technique", rpe: 5, duration: 60 },
  { label: "Speed 30", title: "Speed session", type: "speed", rpe: 8, duration: 30 },
  { label: "Recovery 30", title: "Recovery mobility", type: "mobility", rpe: 2, duration: 30 },
];

function SessionEditor({
  target,
  session,
  onClose,
  onToast,
}: {
  target: EditorTarget;
  session?: Session;
  onClose: () => void;
  onToast: (message: string) => void;
}) {
  const titleId = useId();
  const [title, setTitle] = useState(session?.title ?? "");
  const [type, setType] = useState<SessionType>(session?.type ?? "strength");
  const [rpe, setRpe] = useState(session?.rpe ?? 6);
  const [duration, setDuration] = useState(session?.durationMin ?? 60);
  const [notes, setNotes] = useState(session?.notes ?? "");
  const [week, setWeek] = useState(session?.week ?? target.week);
  const [day, setDay] = useState<Day>(session?.day ?? target.day);
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  const validate = (): string | null => {
    if (!title.trim()) return "Give the session a clear title.";
    if (!Number.isFinite(rpe) || rpe < 1 || rpe > 10) return "RPE must be between 1 and 10.";
    if (!Number.isInteger(duration) || duration < 5 || duration > 300) return "Duration must be a whole number from 5 to 300 minutes.";
    const destination = sessionsInCell(planStore.getState(), week, day).filter((item) => item.id !== session?.id);
    if (destination.length >= 3) return `Week ${week} ${day} already has three sessions.`;
    return null;
  };

  const save = (event: FormEvent) => {
    event.preventDefault();
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }
    if (session) {
      planStore.dispatch({
        type: "UPDATE_SESSION",
        id: session.id,
        patch: { title: title.trim(), type, rpe, durationMin: duration, notes: notes.trim(), week, day },
        actor: "human",
      });
      onToast("Session updated");
    } else {
      const next = createSession({ week, day, type, title, rpe, durationMin: duration, notes, actor: "human" });
      planStore.dispatch({ type: "ADD_SESSION", session: next, actor: "human" });
      onToast("Session added");
    }
    onClose();
  };

  const remove = () => {
    if (!session) return;
    if (!confirmRemove) {
      setConfirmRemove(true);
      return;
    }
    planStore.dispatch({ type: "REMOVE_SESSION", id: session.id, actor: "human" });
    onToast("Session removed");
    onClose();
  };

  const duplicateNextWeek = () => {
    if (!session) return;
    if (session.week >= 4) {
      setError("Week 4 is the end of this block; move or edit the session instead.");
      return;
    }
    const nextWeek = session.week + 1;
    if (sessionsInCell(planStore.getState(), nextWeek, session.day).length >= 3) {
      setError(`Week ${nextWeek} ${session.day} already has three sessions.`);
      return;
    }
    const copy = createSession({
      week: nextWeek,
      day: session.day,
      type: session.type,
      title: session.title,
      rpe: session.rpe,
      durationMin: session.durationMin,
      notes: session.notes,
      actor: "human",
    });
    planStore.dispatch({ type: "ADD_SESSION", session: copy, actor: "human" });
    onToast(`Duplicated to Week ${nextWeek} ${session.day}`);
    onClose();
  };

  return (
    <form
      className="session-editor"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onSubmit={save}
      onMouseDown={(event) => event.stopPropagation()}
      noValidate
    >
      <div className="editor-heading">
        <div>
          <span>{session ? "Edit session" : "Add session"}</span>
          <h2 id={titleId}>Week {week}, {day}</h2>
        </div>
        <button className="icon-button" type="button" onClick={onClose} aria-label="Close session editor"><Icon name="close" size={18} /></button>
      </div>

      {!session && (
        <div className="preset-group" aria-label="Quick session presets">
          <span>Quick start</span>
          <div>
            {SESSION_PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                onClick={() => {
                  setTitle(preset.title);
                  setType(preset.type);
                  setRpe(preset.rpe);
                  setDuration(preset.duration);
                  setError(null);
                }}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <label className="mini-field editor-title">
        <span>Session title</span>
        <input autoFocus value={title} onChange={(event) => { setTitle(event.target.value); setError(null); }} placeholder="Heavy clean" maxLength={80} required />
      </label>
      <div className="editor-grid">
        <label className="mini-field editor-type">
          <span>Type</span>
          <select value={type} onChange={(event) => setType(event.target.value as SessionType)}>
            {SESSION_TYPES.map((item) => <option key={item} value={item}>{capitalize(item)}</option>)}
          </select>
        </label>
        <label className="mini-field">
          <span>RPE</span>
          <input type="number" min={1} max={10} step={0.5} value={rpe} onChange={(event) => { setRpe(Number(event.target.value)); setError(null); }} />
        </label>
        <label className="mini-field">
          <span>Minutes</span>
          <input type="number" min={5} max={300} step={5} value={duration} onChange={(event) => { setDuration(Number(event.target.value)); setError(null); }} />
        </label>
        <label className="mini-field">
          <span>Week</span>
          <select value={week} onChange={(event) => setWeek(Number(event.target.value))}>
            {[1, 2, 3, 4].map((item) => <option key={item} value={item}>Week {item}</option>)}
          </select>
        </label>
        <label className="mini-field">
          <span>Day</span>
          <select value={day} onChange={(event) => setDay(event.target.value as Day)}>
            {DAYS.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
      </div>
      <div className="load-preview">
        <span>Planned load</span>
        <strong>{Number.isFinite(rpe * duration) ? formatLoad(rpe * duration) : "0"}</strong>
        <small>RPE × minutes</small>
      </div>
      <label className="mini-field editor-notes">
        <span>Notes <em>optional</em></span>
        <textarea rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={500} placeholder="Coaching cue, constraint, or purpose" />
      </label>

      {!planStore.getState().profile.daysAvailable.includes(day) && (
        <p className="form-advisory"><Icon name="warning" size={15} />{day} is outside the athlete's available days. You can still save it.</p>
      )}
      {error && <p className="form-error" role="alert"><Icon name="warning" size={15} />{error}</p>}

      <div className="editor-actions">
        <div>
          {session && !confirmRemove && <button className="quiet-button" type="button" onClick={duplicateNextWeek}><Icon name="duplicate" size={15} />Duplicate next week</button>}
          {session && confirmRemove && <button className="quiet-button" type="button" onClick={() => setConfirmRemove(false)}>Cancel</button>}
        </div>
        <div>
          {session && <button className={`delete-button ${confirmRemove ? "confirm" : ""}`} type="button" onClick={remove}><Icon name="trash" size={15} />{confirmRemove ? "Confirm remove" : "Remove"}</button>}
          <button className="save-button" type="submit"><Icon name="check" size={15} />Save session</button>
        </div>
      </div>
    </form>
  );
}

function SessionCard({
  session,
  flags,
  highlighted,
  highlightMessage,
  onEdit,
}: {
  session: Session;
  flags: MetricFlag[];
  highlighted: boolean;
  highlightMessage?: string;
  onEdit: () => void;
}) {
  const warning = flags.length > 0;
  const details = flags.map((flag) => flag.message).join(" ") || session.notes || `Edit ${session.title}`;
  return (
    <article
      className={`session-card type-${session.type} ${warning ? "has-warning" : ""} ${highlighted ? "agent-highlight" : ""}`}
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData("text/blockbuilder-session", session.id);
        event.dataTransfer.effectAllowed = "move";
      }}
      title={highlighted ? highlightMessage : details}
      data-session-id={session.id}
    >
      <button className="session-open" type="button" onClick={onEdit} aria-label={`Edit ${session.title}, ${session.rpe} RPE for ${session.durationMin} minutes`}>
        <span className="type-label"><i />{session.type}</span>
        <h3>{session.title}</h3>
        <span className="session-dose">
          <span><b>{session.rpe}</b> RPE</span>
          <span><b>{session.durationMin}</b> min</span>
          <span><b>{formatLoad(sessionLoad(session))}</b> load</span>
        </span>
      </button>
      <button
        type="button"
        className={`lock-button ${session.locked ? "locked" : ""}`}
        aria-label={session.locked ? `Unlock ${session.title}` : `Protect ${session.title} from ChatGPT changes`}
        title={session.locked ? "Protected from ChatGPT changes" : "Protect from ChatGPT changes"}
        onClick={() => planStore.dispatch({ type: "TOGGLE_LOCK", id: session.id, actor: "human" })}
      >
        <Icon name={session.locked ? "lock" : "unlock"} size={14} />
      </button>
      {warning && <span className="card-warning"><Icon name="warning" size={12} /> {flags.length}</span>}
    </article>
  );
}

const FOCUS_INTENTS: Record<WeekFocus, string> = {
  accumulation: "Build repeatable work capacity without chasing fatigue.",
  intensification: "Raise specificity and quality while protecting recovery.",
  realization: "Convert the block into high-quality, competition-like work.",
  deload: "Reduce fatigue while preserving rhythm and movement quality.",
  taper: "Keep intensity familiar while sharply reducing volume.",
};

function WeekFocusControl({ week, focus, intent }: { week: number; focus: WeekFocus | null; intent: string }) {
  const [editing, setEditing] = useState(false);
  const [nextFocus, setNextFocus] = useState<WeekFocus>(focus ?? "accumulation");
  const [nextIntent, setNextIntent] = useState(intent);

  useEffect(() => {
    setNextFocus(focus ?? "accumulation");
    setNextIntent(intent);
  }, [focus, intent]);

  if (!editing) {
    return (
      <button
        className="focus-button"
        type="button"
        onClick={() => {
          if (!nextIntent) setNextIntent(FOCUS_INTENTS[nextFocus]);
          setEditing(true);
        }}
        aria-label={`${focus ? "Edit" : "Set"} Week ${week} focus`}
      >
        <span>{focus ? capitalize(focus) : "Choose focus"}</span>
        <Icon name={focus ? "arrow" : "plus"} size={13} />
      </button>
    );
  }

  return (
    <div className="focus-editor">
      <div>
        <select
          aria-label={`Week ${week} focus`}
          value={nextFocus}
          onChange={(event) => {
            const value = event.target.value as WeekFocus;
            setNextFocus(value);
            setNextIntent(FOCUS_INTENTS[value]);
          }}
        >
          {WEEK_FOCUSES.map((item) => <option key={item} value={item}>{capitalize(item)}</option>)}
        </select>
        <button type="button" aria-label="Cancel focus editing" onClick={() => setEditing(false)}><Icon name="close" size={13} /></button>
      </div>
      <textarea aria-label={`Week ${week} intent`} rows={3} value={nextIntent} onChange={(event) => setNextIntent(event.target.value)} maxLength={240} />
      <button
        className="focus-save"
        type="button"
        onClick={() => {
          planStore.dispatch({ type: "SET_WEEK_FOCUS", week, focus: nextFocus, intent: nextIntent.trim() || FOCUS_INTENTS[nextFocus], actor: "human" });
          setEditing(false);
        }}
      ><Icon name="check" size={14} />Save focus</button>
    </div>
  );
}

function getPlanGuidance(state: PlanState, metrics: PlanMetrics) {
  if (!state.profile.sport.trim() || !state.profile.goal.trim()) {
    return { tone: "action", title: "Add athlete details", message: "Sport, goal, and available days give ChatGPT the inputs needed to build the schedule." };
  }
  if (state.sessions.length === 0) {
    return { tone: "action", title: "Build the schedule", message: "Ask ChatGPT to create four weeks of sessions, or add them manually." };
  }
  if (metrics.flags.length > 0) {
    return { tone: "warning", title: `Fix ${metrics.flags.length} training check${metrics.flags.length === 1 ? "" : "s"}`, message: metrics.flags[0].message };
  }
  const unsetFocuses = state.weeks.filter((week) => !week.focus).length;
  if (unsetFocuses > 0) {
    return { tone: "action", title: `Set goals for ${unsetFocuses} week${unsetFocuses === 1 ? "" : "s"}`, message: "Give each week a purpose so the schedule builds toward the event." };
  }
  return { tone: "clear", title: "Plan checks passed", message: `${state.sessions.length} sessions are scheduled with no current load or availability conflicts.` };
}

function MetricsStrip({ metrics }: { metrics: PlanMetrics }) {
  return (
    <section className="metrics-section" aria-labelledby="metrics-title">
      <div className="section-heading-row">
        <h2 id="metrics-title">Weekly load</h2>
      </div>
      <div className="metrics-strip">
        {metrics.weeks.map((week) => {
          const flags = metrics.flags.filter((flag) => flag.weeks.includes(week.week));
          return (
            <article className={`metric-tile ${flags.length ? "metric-flagged" : ""}`} key={week.week}>
              <div className="metric-title">
                <span>Week {week.week}</span>
                {flags.length > 0
                  ? <em><Icon name="warning" size={12} />{flags.length} flag{flags.length === 1 ? "" : "s"}</em>
                  : <em className="clean"><Icon name="check" size={12} />Clear</em>}
              </div>
              <div className="metric-primary">
                <strong>{formatLoad(week.load)}</strong>
                <span>load</span>
              </div>
              <dl className="metric-details">
                <div><dt>Change</dt><dd className={week.wowPct !== null && week.wowPct > 15 ? "up" : ""}>{week.wowPct === null ? "Baseline" : `${week.wowPct > 0 ? "+" : ""}${week.wowPct}%`}</dd></div>
                <div><dt title="Day-to-day load consistency">Monotony</dt><dd>{week.monotony.toFixed(2)}</dd></div>
                <div><dt title="Weekly load multiplied by monotony">Strain</dt><dd>{formatLoad(week.strain)}</dd></div>
              </dl>
            </article>
          );
        })}
      </div>
    </section>
  );
}

const REPAIR_EXAMPLES = [
  "I missed yesterday's session",
  "My shoulder feels irritated",
  "I can’t train this Friday",
];

function RepairComposer({
  value,
  onChange,
  onSubmit,
  connected,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  connected: boolean;
}) {
  return (
    <section className="repair-composer" aria-labelledby="repair-title">
      <div className="repair-heading">
        <div>
          <span className="repair-kicker"><Icon name="spark" size={14} />Plan repair</span>
          <h2 id="repair-title">What changed?</h2>
        </div>
        <span className={`repair-connection ${connected ? "online" : ""}`}><i />{connected ? "Site tools ready" : "Copy to ChatGPT"}</span>
      </div>
      <textarea
        aria-label="What changed?"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Example: I missed Wednesday’s strength session and can only train Saturday this week."
        rows={3}
        maxLength={400}
      />
      <div className="repair-examples" aria-label="Example changes">
        {REPAIR_EXAMPLES.map((example) => (
          <button type="button" key={example} onClick={() => onChange(example)}>{example}</button>
        ))}
      </div>
      <div className="repair-submit-row">
        <p>ChatGPT will inspect the live plan and return a safe patch for approval.</p>
        <button type="button" className="primary-button" onClick={onSubmit} disabled={!value.trim()}>
          <Icon name="copy" size={16} />Copy repair request<Icon name="arrow" size={15} />
        </button>
      </div>
    </section>
  );
}

function ProposalCard({ proposal, revision, onToast }: { proposal: PlanProposal; revision: number; onToast: (message: string) => void }) {
  const stale = proposal.baseRevision !== revision;
  const loadChanges = proposal.loads.filter((week) => week.before !== week.after);

  const apply = () => {
    if (stale) {
      onToast("This proposal is out of date. Ask ChatGPT for a fresh repair.");
      return;
    }
    planStore.dispatch({ type: "APPLY_PROPOSAL", id: proposal.id, actor: "human" });
    onToast("Repair applied — you can still undo it");
  };

  return (
    <section className={`proposal-card ${stale ? "stale" : ""}`} aria-labelledby="proposal-title">
      <header className="proposal-heading">
        <span className="proposal-mark"><Icon name={stale ? "warning" : "spark"} size={18} /></span>
        <div>
          <span>{stale ? "Fresh review needed" : "Ready for your approval"}</span>
          <h2 id="proposal-title">{proposal.summary}</h2>
          <p>{proposal.rationale}</p>
        </div>
      </header>

      <ol className="proposal-changes">
        {proposal.descriptions.map((description, index) => <li key={`${description}-${index}`}>{description}</li>)}
      </ol>

      <div className="proposal-impact" aria-label="Proposed workload impact">
        <div className="impact-loads">
          <span>Weekly load</span>
          {loadChanges.length > 0 ? loadChanges.map((week) => (
            <strong key={week.week}>W{week.week} <b>{formatLoad(week.before)}</b><Icon name="arrow" size={12} /><b>{formatLoad(week.after)}</b></strong>
          )) : <strong>No change</strong>}
        </div>
        <div className="impact-flags">
          <span>Plan checks</span>
          <strong><b>{proposal.beforeFlagCount}</b><Icon name="arrow" size={12} /><b>{proposal.afterFlagCount}</b></strong>
        </div>
      </div>

      {stale && <p className="proposal-stale" role="alert"><Icon name="warning" size={15} />The calendar changed after this review. Ask ChatGPT to inspect it again.</p>}

      <div className="proposal-actions">
        <button type="button" className="secondary-button" onClick={() => planStore.dispatch({ type: "DISMISS_PROPOSAL", id: proposal.id, actor: "human" })}>Dismiss</button>
        <button type="button" className="primary-button" onClick={apply} disabled={stale}><Icon name="check" size={16} />Apply repair</button>
      </div>
    </section>
  );
}

function Planner({
  onToast,
  onOpenProfile,
  onCopyAgentPrompt,
  status,
}: {
  onToast: (message: string) => void;
  onOpenProfile: () => void;
  onCopyAgentPrompt: (repairRequest?: string) => void;
  status: WebMcpStatus | null;
}) {
  const state = useSyncExternalStore(planStore.subscribe, planStore.getState);
  const metrics = useMemo(() => calculateMetrics(state), [state]);
  const [editor, setEditor] = useState<EditorTarget | null>(null);
  const [editorClosing, setEditorClosing] = useState(false);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [mobileWeek, setMobileWeek] = useState(1);
  const [repairRequest, setRepairRequest] = useState("");
  const editorCloseTimer = useRef<number | null>(null);
  const profileReady = Boolean(state.profile.sport.trim() && state.profile.goal.trim() && state.profile.daysAvailable.length);
  const hasPlan = state.sessions.length > 0;
  const lockedCount = state.sessions.filter((session) => session.locked).length;
  const connected = status?.registered === 10;

  useEffect(() => () => {
    if (editorCloseTimer.current !== null) window.clearTimeout(editorCloseTimer.current);
  }, []);

  const openEditor = (target: EditorTarget) => {
    if (editorCloseTimer.current !== null) window.clearTimeout(editorCloseTimer.current);
    setEditorClosing(false);
    setMobileWeek(target.week);
    setEditor(target);
  };

  const closeEditor = () => {
    if (!editor || editorClosing) return;
    const closeDuration = prefersReducedMotion() ? 100 : 200;
    setEditorClosing(true);
    editorCloseTimer.current = window.setTimeout(() => {
      setEditor(null);
      setEditorClosing(false);
      editorCloseTimer.current = null;
    }, closeDuration);
  };

  const changeMobileWeek = (nextWeek: number) => {
    if (nextWeek === mobileWeek) return;
    runViewTransition("week", () => setMobileWeek(nextWeek), nextWeek > mobileWeek ? "forward" : "backward");
  };

  const moveByDrag = (id: string, week: number, day: Day) => {
    const session = state.sessions.find((item) => item.id === id);
    if (!session) return;
    const destination = sessionsInCell(state, week, day).filter((item) => item.id !== id);
    if (destination.length >= 3) {
      onToast(`Week ${week} ${day} already has three sessions`);
      return;
    }
    planStore.dispatch({ type: "MOVE_SESSION", id, week, day, actor: "human" });
    onToast(`${session.title} moved to Week ${week} ${day}`);
  };

  return (
    <main className="planner-column" id="main-content" tabIndex={-1}>
      <header className="planner-heading">
        <div className="planner-title">
          <h1>{hasPlan ? "Tell us what changed. Repair the plan." : "Build the starting plan."}</h1>
          <p>{hasPlan ? "ChatGPT proposes the smallest useful changes. You approve them." : "Add the athlete context once, then let ChatGPT create a schedule you can adjust and protect."}</p>
          {hasPlan && <div className="plan-facts" aria-label="Current plan summary"><span><b>{state.sessions.length}</b> sessions</span><span><b>{lockedCount}</b> protected</span><span><b>{metrics.flags.length}</b> checks</span></div>}
          {!hasPlan && (
            <div className="planner-actions">
              <button type="button" className="primary-button planner-primary" onClick={profileReady ? () => onCopyAgentPrompt() : onOpenProfile}>
                <Icon name={profileReady ? "spark" : "profile"} size={16} />
                <span>{profileReady ? "Copy build prompt" : "Add athlete details"}</span>
                <Icon name="arrow" size={16} />
              </button>
              {profileReady && <button type="button" className="secondary-button" onClick={onOpenProfile}><Icon name="profile" size={15} />Edit athlete details</button>}
            </div>
          )}
        </div>
        {hasPlan && <button type="button" className="edit-context-button" onClick={onOpenProfile}><Icon name="profile" size={15} />Athlete details</button>}
      </header>

      {hasPlan && <RepairComposer value={repairRequest} onChange={setRepairRequest} onSubmit={() => onCopyAgentPrompt(repairRequest)} connected={connected} />}

      {state.proposal && <ProposalCard proposal={state.proposal} revision={state.revision} onToast={onToast} />}

      {state.highlight && (
        <div className="active-highlight" role="status">
          <div><span><Icon name="spark" size={15} />ChatGPT note</span><p>{state.highlight.message}</p></div>
          <button type="button" onClick={() => planStore.dispatch({ type: "CLEAR_HIGHLIGHT", actor: "human" })}>Clear highlight</button>
        </div>
      )}

      {state.sessions.length === 0 && (
        <section className="empty-plan" aria-labelledby="empty-plan-title">
          <div>
            <h2 id="empty-plan-title">No sessions scheduled yet</h2>
            <p>Start with ChatGPT or add a session manually.</p>
          </div>
          <div className="empty-actions">
            <button type="button" onClick={() => onCopyAgentPrompt()} disabled={!profileReady}><Icon name="spark" size={16} />Copy build prompt</button>
            <button type="button" onClick={() => openEditor({ mode: "add", week: 1, day: "Mon" })}><Icon name="plus" size={16} />Add manually</button>
          </div>
        </section>
      )}

      {hasPlan && <MetricsStrip metrics={metrics} />}

      <section className="calendar-section" aria-labelledby="calendar-title">
        <div className="section-heading-row calendar-heading">
          <div><h2 id="calendar-title">Schedule</h2></div>
          <div className="mobile-week-tabs" aria-label="Choose week">
            {state.weeks.map((week) => (
              <button key={week.number} type="button" className={mobileWeek === week.number ? "active" : ""} onClick={() => changeMobileWeek(week.number)} aria-pressed={mobileWeek === week.number}>
                W{week.number}
              </button>
            ))}
          </div>
        </div>

        <div className="calendar-frame">
          <div className="calendar-scroll" tabIndex={0} aria-label="Training calendar, scroll horizontally to see all days">
            <div className="calendar-grid day-header-grid">
              <div className="week-corner">Week plan</div>
              {DAYS.map((day) => <div className="day-header" key={day}>{day}</div>)}
            </div>

            {state.weeks.map((week) => {
              const weekMetric = metrics.weeks[week.number - 1];
              const weekFlags = metrics.flags.filter((flag) => flag.weeks.includes(week.number));
              const weekHighlighted = state.highlight?.weeks.includes(week.number) ?? false;
              return (
                <section
                  className={`calendar-grid week-row ${mobileWeek === week.number ? "mobile-current" : ""} ${weekHighlighted ? "week-highlighted" : ""}`}
                  key={week.number}
                  data-week={week.number}
                  aria-label={`Week ${week.number}`}
                  title={weekHighlighted ? state.highlight?.message : undefined}
                >
                  <div className="week-header">
                    <div className="week-index"><span>Week</span><strong>{week.number}</strong></div>
                    <WeekFocusControl week={week.number} focus={week.focus} intent={week.intent} />
                    {week.intent && <p className="week-intent">{week.intent}</p>}
                    <div className="week-load">
                      <span><b>{formatLoad(weekMetric.load)}</b> load</span>
                      <span className={weekMetric.wowPct !== null && weekMetric.wowPct > 15 ? "load-spike" : ""}>
                        {weekMetric.wowPct === null ? "Baseline" : `${weekMetric.wowPct > 0 ? "+" : ""}${weekMetric.wowPct}% change`}
                      </span>
                    </div>
                    {weekMetric.deloadCheck !== null && (
                      <span className={`deload-check ${weekMetric.deloadCheck ? "passes" : "fails"}`}>
                        <Icon name={weekMetric.deloadCheck ? "check" : "warning"} size={12} />
                        {weekMetric.deloadCheck ? "Deload in range" : "Deload too high"}
                      </span>
                    )}
                    {weekFlags.length > 0 && <span className="week-warning-count"><Icon name="warning" size={12} />{weekFlags.length} flag{weekFlags.length === 1 ? "" : "s"}</span>}
                  </div>

                  {DAYS.map((day) => {
                    const cellId = `${week.number}-${day}`;
                    const sessions = sessionsInCell(state, week.number, day);
                    const cellFlags = metrics.flags.filter((flag) => flag.cells.includes(cellId));
                    const cellHighlighted = Boolean(weekHighlighted || sessions.some((session) => state.highlight?.sessionIds.includes(session.id)));
                    return (
                      <div
                        className={`day-cell ${cellFlags.length ? "cell-flagged" : ""} ${cellHighlighted ? "cell-highlighted" : ""} ${dragOver === cellId ? "drag-over" : ""}`}
                        key={day}
                        data-day={day}
                        onDragOver={(event) => { event.preventDefault(); setDragOver(cellId); }}
                        onDragLeave={() => setDragOver((current) => current === cellId ? null : current)}
                        onDrop={(event) => {
                          event.preventDefault();
                          setDragOver(null);
                          moveByDrag(event.dataTransfer.getData("text/blockbuilder-session"), week.number, day);
                        }}
                        title={cellFlags.map((flag) => flag.message).join("\n") || (cellHighlighted ? state.highlight?.message : undefined)}
                      >
                        <div className="cell-topline"><span className="mobile-day-name">{day}</span><span>{formatLoad(weekMetric.dailyLoads[day])} load</span>{cellFlags.length > 0 && <em><Icon name="warning" size={11} />{cellFlags.length}</em>}</div>
                        <div className="session-stack">
                          {sessions.map((session) => {
                            const sessionFlags = metrics.flags.filter((flag) => flag.sessionIds.includes(session.id));
                            const highlighted = state.highlight?.sessionIds.includes(session.id) ?? false;
                            return (
                              <SessionCard
                                key={session.id}
                                session={session}
                                flags={sessionFlags}
                                highlighted={highlighted}
                                highlightMessage={state.highlight?.message}
                                onEdit={() => openEditor({ mode: "edit", week: session.week, day: session.day, id: session.id })}
                              />
                            );
                          })}
                        </div>
                        {sessions.length < 3 && (
                          <button className="add-session" type="button" onClick={() => openEditor({ mode: "add", week: week.number, day })} aria-label={`Add session to Week ${week.number} ${day}`}>
                            <Icon name="plus" size={13} /><span>Add session</span>
                          </button>
                        )}
                      </div>
                    );
                  })}
                </section>
              );
            })}
          </div>
        </div>

        <div className="session-legend" aria-label="Session types">
          {SESSION_TYPES.filter((type) => type !== "rest").map((type) => <span key={type}><i className={`legend-dot type-${type}`} />{capitalize(type)}</span>)}
        </div>
      </section>

      {editor && (
        <div className={`editor-layer ${editorClosing ? "closing" : ""}`} onMouseDown={closeEditor}>
          <SessionEditor
            key={`${editor.mode}-${editor.id ?? `${editor.week}-${editor.day}`}`}
            target={editor}
            session={editor.id ? state.sessions.find((item) => item.id === editor.id) : undefined}
            onClose={closeEditor}
            onToast={onToast}
          />
        </div>
      )}
    </main>
  );
}

function ActivityPanel({ status, onViewPlan }: { status: WebMcpStatus | null; onViewPlan: () => void }) {
  const state = useSyncExternalStore(planStore.subscribe, planStore.getState);
  const metrics = useMemo(() => calculateMetrics(state), [state]);
  const guidance = getPlanGuidance(state, metrics);
  const recent = [...state.activity].reverse().slice(0, 18);

  const showFlag = (flag: MetricFlag) => {
    planStore.dispatch({
      type: "HIGHLIGHT",
      actor: "human",
      highlight: { sessionIds: flag.sessionIds, weeks: flag.weeks, message: flag.message },
    });
    onViewPlan();
  };

  return (
    <aside className="activity-column" aria-labelledby="review-title">
      <section className="support-panel activity-panel">
        <div className="panel-heading">
          <div><h2 id="review-title">Plan review</h2></div>
          <span className={`connection-status ${status?.registered === 10 ? "online" : ""}`}><i />{status?.registered === 10 ? "ChatGPT connected" : "Manual mode"}</span>
        </div>

        <div className={`guidance-block tone-${guidance.tone}`}>
          <span>Recommended now</span>
          <strong>{guidance.title}</strong>
          <p>{guidance.message}</p>
        </div>

        <section className="flag-summary" aria-labelledby="flags-title">
          <div className="subsection-heading"><h3 id="flags-title">Plan checks</h3><b>{metrics.flags.length}</b></div>
          {metrics.flags.length === 0 ? (
            <div className="all-clear"><Icon name="check" size={17} /><span>No current load or availability conflicts.</span></div>
          ) : (
            <div className="flag-list">
              {metrics.flags.slice(0, 6).map((flag) => (
                <button type="button" key={flag.id} onClick={() => showFlag(flag)}>
                  <Icon name="warning" size={15} />
                  <span>{flag.message}</span>
                  <b>Show</b>
                </button>
              ))}
              {metrics.flags.length > 6 && <small>{metrics.flags.length - 6} more checks are marked in the calendar.</small>}
            </div>
          )}
        </section>

        <section className="activity-section" aria-labelledby="activity-title">
          <div className="subsection-heading"><h3 id="activity-title">Recent changes</h3><span>{recent.length}</span></div>
          <div className="activity-feed">
            {recent.map((entry: ActivityEntry) => (
              <div className={`activity-entry actor-${entry.actor} tone-${entry.tone ?? "default"}`} key={entry.id}>
                <span className="activity-avatar">{entry.actor === "agent" ? <Icon name="spark" size={14} /> : entry.actor === "human" ? "You" : "BB"}</span>
                <div><p>{entry.message}</p><time dateTime={entry.timestamp}>{relativeTime(entry.timestamp)}</time></div>
              </div>
            ))}
          </div>
        </section>
      </section>
    </aside>
  );
}

type MobilePane = "plan" | "profile" | "insights";

function App() {
  const state = useSyncExternalStore(planStore.subscribe, planStore.getState);
  const [status, setStatus] = useState<WebMcpStatus | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [mobilePane, setMobilePane] = useState<MobilePane>("plan");
  const [resetPending, setResetPending] = useState(false);
  const [toastLeaving, setToastLeaving] = useState(false);

  useEffect(() => {
    registerWebMcpTools().then(setStatus);
  }, []);

  useEffect(() => {
    if (!toast) return;
    setToastLeaving(false);
    const leaveTimer = window.setTimeout(() => setToastLeaving(true), 2200);
    const removeTimer = window.setTimeout(() => setToast(null), 2400);
    return () => {
      window.clearTimeout(leaveTimer);
      window.clearTimeout(removeTimer);
    };
  }, [toast]);

  useEffect(() => {
    if (!resetPending) return;
    const timer = window.setTimeout(() => setResetPending(false), 5000);
    return () => window.clearTimeout(timer);
  }, [resetPending]);

  const exportJson = () => {
    const payload = JSON.stringify(exportPlanSnapshot(), null, 2);
    const url = URL.createObjectURL(new Blob([payload], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `blockbuilder-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    setToast("Plan exported as JSON");
  };

  const copyAgentPrompt = async (repairRequest = "") => {
    const hasPlan = state.sessions.length > 0;
    const prompt = hasPlan
      ? `Read my current BlockBuilder plan first. Something changed: ${repairRequest.trim() || "ask me what changed before editing"}. Repair the remaining schedule with the smallest useful set of changes. Preserve the goal, work around every locked session, check the resulting workload and conflicts, then use propose_changes so I can review the exact patch before anything is applied.`
      : "Read my BlockBuilder athlete brief first, then build a balanced four-week training block around my goal, available days, event date, and constraints. Set each week's focus before adding sessions. Create a realistic progression toward the event, monitor load and monotony as you go, and highlight any tradeoffs I should review. Respect every locked session.";
    try {
      await navigator.clipboard.writeText(prompt);
      setToast(hasPlan ? "Repair request copied — paste it into ChatGPT" : "ChatGPT build prompt copied");
    } catch {
      setToast("Copy unavailable. Ask ChatGPT to read this BlockBuilder plan and build or review the block.");
    }
  };

  const reset = () => {
    if (!resetPending) {
      setResetPending(true);
      setToast("Press Confirm reset to clear the entire block");
      return;
    }
    planStore.dispatch({ type: "RESET" });
    setResetPending(false);
    setToast("Training block reset");
  };

  const changeMobilePane = (pane: MobilePane) => {
    if (pane === mobilePane) return;
    if (typeof window.matchMedia === "function" && window.matchMedia("(max-width: 1080px)").matches) {
      runViewTransition("workspace", () => setMobilePane(pane));
      return;
    }
    setMobilePane(pane);
  };

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to planner</a>
      <WebMcpBanner status={status} />
      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-symbol"><i /><i /><i /></span>
          <div><strong>BlockBuilder</strong><span>Training plan repair</span></div>
        </div>
        <div className="topbar-center">
          <span className={`connection-pill ${status?.registered === 10 ? "connected" : ""}`}>
            <i />{status?.registered === 10 ? "ChatGPT repair connected" : status?.error ? "AI setup needs attention" : "Manual mode"}
          </span>
        </div>
        <div className="topbar-actions">
          <button type="button" onClick={() => planStore.dispatch({ type: "UNDO" })} disabled={!state.canUndo} aria-label="Undo last plan change" title="Undo last change"><Icon name="undo" size={17} /><span>Undo</span></button>
          <button type="button" onClick={exportJson} aria-label="Export plan as JSON" title="Export plan"><Icon name="download" size={17} /><span>Export</span></button>
          {resetPending && <button type="button" className="reset-cancel" onClick={() => setResetPending(false)} aria-label="Cancel reset"><Icon name="close" size={16} /></button>}
          <button type="button" className={`reset-action ${resetPending ? "confirm" : ""}`} onClick={reset} aria-label={resetPending ? "Confirm reset entire block" : "Reset entire block"} title={resetPending ? "Confirm reset" : "Reset block"}><Icon name="trash" size={16} /><span>{resetPending ? "Confirm reset" : "Reset"}</span></button>
          <button type="button" className="agent-cta" onClick={() => copyAgentPrompt()} aria-label={state.sessions.length ? "Copy a ChatGPT repair prompt" : "Copy a ChatGPT build prompt"}>
            <Icon name="copy" size={17} /><span>{state.sessions.length ? "Copy repair prompt" : "Copy build prompt"}</span><Icon name="arrow" size={15} />
          </button>
        </div>
      </header>

      <nav className="mobile-workspace-nav" aria-label="Workspace views">
        <button type="button" className={mobilePane === "plan" ? "active" : ""} onClick={() => changeMobilePane("plan")} aria-selected={mobilePane === "plan"}><Icon name="plan" size={17} />Plan</button>
        <button type="button" className={mobilePane === "profile" ? "active" : ""} onClick={() => changeMobilePane("profile")} aria-selected={mobilePane === "profile"}><Icon name="profile" size={17} />Athlete</button>
        <button type="button" className={mobilePane === "insights" ? "active" : ""} onClick={() => changeMobilePane("insights")} aria-selected={mobilePane === "insights"}><Icon name="insights" size={17} />Review</button>
      </nav>

      <div className={`workspace pane-${mobilePane}`}>
        <ProfilePanel
          onToast={setToast}
          onPlanReady={() => changeMobilePane("plan")}
          onExport={exportJson}
          onReset={reset}
          resetPending={resetPending}
        />
        <Planner status={status} onToast={setToast} onOpenProfile={() => changeMobilePane("profile")} onCopyAgentPrompt={copyAgentPrompt} />
        <ActivityPanel status={status} onViewPlan={() => changeMobilePane("plan")} />
      </div>

      <footer className="app-footer">
        <strong>BlockBuilder</strong>
        <span>Saved locally</span>
      </footer>

      {toast && <div className={`toast ${toastLeaving ? "leaving" : ""}`} role="status" aria-live="polite"><Icon name="check" size={16} />{toast}</div>}
    </div>
  );
}

export default App;
