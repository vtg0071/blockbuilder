import { describe, expect, it } from "vitest";
import { calculateMetrics, sessionLoad } from "./metrics";
import { DAYS, type PlanState, type Session } from "./types";

function session(input: Partial<Session> & Pick<Session, "id" | "week" | "day" | "rpe" | "durationMin">): Session {
  return {
    type: "strength",
    title: input.id,
    notes: "",
    locked: false,
    createdBy: "human",
    ...input,
  };
}

function state(sessions: Session[]): PlanState {
  return {
    profile: {
      sport: "Javelin",
      goal: "Peak",
      eventDate: "2026-10-01",
      daysAvailable: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
      constraints: [],
    },
    weeks: [
      { number: 1, focus: "accumulation", intent: "Build" },
      { number: 2, focus: "intensification", intent: "Load" },
      { number: 3, focus: "realization", intent: "Express" },
      { number: 4, focus: "deload", intent: "Freshen" },
    ],
    sessions,
    highlight: null,
    proposal: null,
    activity: [],
    revision: 0,
    canUndo: false,
  };
}

describe("Foster metrics", () => {
  it("calculates session and weekly load from RPE × duration", () => {
    const monday = session({ id: "a", week: 1, day: "Mon", rpe: 8, durationMin: 60 });
    const thursday = session({ id: "b", week: 1, day: "Thu", rpe: 5, durationMin: 40 });
    const result = calculateMetrics(state([monday, thursday]));

    expect(sessionLoad(monday)).toBe(480);
    expect(result.weeks[0].load).toBe(680);
    expect(result.weeks[0].dailyLoads.Mon).toBe(480);
    expect(result.weeks[0].dailyLoads.Thu).toBe(200);
    expect(result.weeks[0].strain).toBeGreaterThan(0);
  });

  it("flags load spikes, back-to-back hard days, unavailable days, and an oversized deload", () => {
    const sessions: Session[] = [
      session({ id: "w1", week: 1, day: "Mon", rpe: 5, durationMin: 100 }),
      session({ id: "hard-a", week: 2, day: "Tue", rpe: 8, durationMin: 60 }),
      session({ id: "hard-b", week: 2, day: "Wed", rpe: 9, durationMin: 60 }),
      session({ id: "extra", week: 2, day: "Fri", rpe: 6, durationMin: 60 }),
      session({ id: "sunday", week: 3, day: "Sun", rpe: 5, durationMin: 60 }),
      session({ id: "deload", week: 4, day: "Mon", rpe: 10, durationMin: 100 }),
    ];
    const result = calculateMetrics(state(sessions));
    const codes = result.flags.map((flag) => flag.code);

    expect(codes).toContain("load_spike");
    expect(codes).toContain("consecutive_high_rpe");
    expect(codes).toContain("unavailable_day");
    expect(codes).toContain("deload_too_high");
    expect(result.flags.find((flag) => flag.code === "consecutive_high_rpe")?.cells).toEqual(["2-Tue", "2-Wed"]);
  });

  it("keeps every week on a seven-day calculation base", () => {
    const result = calculateMetrics(state([]));
    for (const week of result.weeks) {
      expect(Object.keys(week.dailyLoads)).toEqual([...DAYS]);
      expect(week.load).toBe(0);
      expect(week.monotony).toBe(0);
      expect(week.strain).toBe(0);
    }
  });
});
