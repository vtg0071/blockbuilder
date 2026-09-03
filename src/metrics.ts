import { DAYS, type Day, type MetricFlag, type PlanMetrics, type PlanState, type Session, type WeekMetrics } from "./types";

export function sessionLoad(session: Pick<Session, "rpe" | "durationMin">): number {
  return session.rpe * session.durationMin;
}

function round(value: number, digits = 1): number {
  const multiplier = 10 ** digits;
  return Math.round(value * multiplier) / multiplier;
}

function populationStandardDeviation(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function makeFlag(
  code: MetricFlag["code"],
  message: string,
  weeks: number[],
  cells: string[] = [],
  sessionIds: string[] = [],
  severity: MetricFlag["severity"] = "warning",
): MetricFlag {
  return {
    id: `${code}:${weeks.join("-")}:${cells.join("-")}:${sessionIds.join("-")}`,
    code,
    severity,
    message,
    weeks,
    cells,
    sessionIds,
  };
}

export function calculateMetrics(state: Pick<PlanState, "profile" | "weeks" | "sessions">): PlanMetrics {
  const weekly: WeekMetrics[] = state.weeks.map((week) => {
    const dailyLoads = Object.fromEntries(
      DAYS.map((day) => [
        day,
        state.sessions
          .filter((session) => session.week === week.number && session.day === day)
          .reduce((sum, session) => sum + sessionLoad(session), 0),
      ]),
    ) as Record<Day, number>;
    const loads = DAYS.map((day) => dailyLoads[day]);
    const load = loads.reduce((sum, value) => sum + value, 0);
    const mean = load / DAYS.length;
    const sd = populationStandardDeviation(loads);
    const monotony = sd === 0 ? (mean > 0 ? 99 : 0) : mean / sd;

    return {
      week: week.number,
      focus: week.focus,
      load,
      wowPct: null,
      monotony: round(monotony, 2),
      strain: round(load * monotony),
      dailyLoads,
      deloadCheck: null,
    };
  });

  weekly.forEach((metrics, index) => {
    if (index === 0) return;
    const prior = weekly[index - 1].load;
    metrics.wowPct = prior === 0 ? null : round(((metrics.load - prior) / prior) * 100);
  });

  const peakLoad = Math.max(0, ...weekly.map((week) => week.load));
  weekly.forEach((metrics) => {
    if (metrics.focus === "deload" || metrics.focus === "taper") {
      metrics.deloadCheck = peakLoad === 0 ? true : metrics.load <= peakLoad * 0.6;
    }
  });

  const flags: MetricFlag[] = [];

  weekly.forEach((metrics) => {
    if (
      metrics.wowPct !== null &&
      metrics.wowPct > 15 &&
      metrics.focus !== "deload" &&
      metrics.focus !== "taper"
    ) {
      flags.push(
        makeFlag(
          "load_spike",
          `Week ${metrics.week} load rises ${metrics.wowPct}% — above the 15% guardrail.`,
          [metrics.week],
        ),
      );
    }

    if (metrics.monotony > 2) {
      flags.push(
        makeFlag(
          "high_monotony",
          `Week ${metrics.week} monotony is ${metrics.monotony.toFixed(2)} — vary hard and easy days.`,
          [metrics.week],
          [],
          [],
          "caution",
        ),
      );
    }

    if (metrics.deloadCheck === false) {
      flags.push(
        makeFlag(
          "deload_too_high",
          `Week ${metrics.week} is marked ${metrics.focus}, but exceeds 60% of peak load.`,
          [metrics.week],
        ),
      );
    }
  });

  const orderedDays = state.weeks.flatMap((week) =>
    DAYS.map((day) => ({ week: week.number, day, sessions: state.sessions.filter((s) => s.week === week.number && s.day === day) })),
  );
  for (let index = 0; index < orderedDays.length - 1; index += 1) {
    const current = orderedDays[index];
    const next = orderedDays[index + 1];
    const currentHard = current.sessions.filter((session) => session.rpe >= 8);
    const nextHard = next.sessions.filter((session) => session.rpe >= 8);
    if (currentHard.length && nextHard.length) {
      flags.push(
        makeFlag(
          "consecutive_high_rpe",
          `High-RPE sessions sit back-to-back on W${current.week} ${current.day} and W${next.week} ${next.day}.`,
          [...new Set([current.week, next.week])],
          [`${current.week}-${current.day}`, `${next.week}-${next.day}`],
          [...currentHard, ...nextHard].map((session) => session.id),
        ),
      );
    }
  }

  state.sessions.forEach((session) => {
    if (!state.profile.daysAvailable.includes(session.day)) {
      flags.push(
        makeFlag(
          "unavailable_day",
          `${session.title} is scheduled on ${session.day}, outside the athlete's available days.`,
          [session.week],
          [`${session.week}-${session.day}`],
          [session.id],
        ),
      );
    }
  });

  return { weeks: weekly, peakLoad, flags };
}
