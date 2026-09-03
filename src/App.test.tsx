import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import App from "./App";
import { planStore } from "./store";
import { unregisterWebMcpTools } from "./webmcp";

const originalMatchMedia = window.matchMedia;

describe("BlockBuilder interface workflows", () => {
  beforeEach(() => {
    localStorage.clear();
    planStore.dispatch({ type: "RESET" });
    unregisterWebMcpTools();
    Object.defineProperty(document, "modelContext", {
      configurable: true,
      value: { registerTool: vi.fn(async () => undefined) },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: originalMatchMedia,
    });
    cleanup();
    unregisterWebMcpTools();
  });

  it("adds, protects, edits, and duplicates a session through accessible controls", async () => {
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Add session to Week 1 Mon" }));
    fireEvent.click(screen.getByRole("button", { name: "Strength 45" }));
    fireEvent.click(screen.getByRole("button", { name: "Save session" }));

    await waitFor(() => expect(planStore.getState().sessions).toHaveLength(1));
    expect(planStore.getState().sessions[0]).toMatchObject({
      title: "Strength session",
      week: 1,
      day: "Mon",
      rpe: 7,
      durationMin: 45,
    });

    fireEvent.click(screen.getByRole("button", { name: "Protect Strength session from ChatGPT changes" }));
    expect(planStore.getState().sessions[0].locked).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Edit Strength session, 7 RPE for 45 minutes" }));
    fireEvent.click(screen.getByRole("button", { name: "Duplicate next week" }));

    await waitFor(() => expect(planStore.getState().sessions).toHaveLength(2));
    expect(planStore.getState().sessions[1]).toMatchObject({ title: "Strength session", week: 2, day: "Mon", locked: false });
  });

  it("shows inline athlete-brief validation and saves useful context", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /Athlete/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save athlete brief" }));

    expect((await screen.findByRole("alert")).textContent).toContain("Add the sport or event");

    fireEvent.change(screen.getByLabelText("Sport or event"), { target: { value: "Rowing" } });
    fireEvent.change(screen.getByLabelText("Target outcome"), { target: { value: "Peak for a 2k test" } });
    fireEvent.click(screen.getByRole("button", { name: "Save athlete brief" }));

    await waitFor(() => expect(planStore.getState().profile).toMatchObject({ sport: "Rowing", goal: "Peak for a 2k test" }));
  });

  it("requires an explicit second action before resetting the block", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /Athlete/ }));
    fireEvent.click(screen.getByRole("button", { name: "Load demo" }));
    await waitFor(() => expect(planStore.getState().sessions).toHaveLength(20));

    fireEvent.click(screen.getByRole("button", { name: "Reset block" }));
    expect(planStore.getState().sessions).toHaveLength(20);

    fireEvent.click(screen.getByRole("button", { name: "Confirm reset" }));
    await waitFor(() => expect(planStore.getState().sessions).toHaveLength(0));
  });

  it("uses the reduced-motion close path without a spatial editor exit", () => {
    vi.useFakeTimers();
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn((query: string) => ({
        matches: query === "(prefers-reduced-motion: reduce)",
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });

    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Add session to Week 1 Mon" }));
    fireEvent.click(screen.getByRole("button", { name: "Close session editor" }));

    const layer = screen.getByRole("dialog").parentElement;
    expect(layer?.classList.contains("closing")).toBe(true);

    act(() => vi.advanceTimersByTime(100));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("explains the product without overwhelming first-time users", () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: "Build the starting plan." })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add athlete details" })).toBeTruthy();
    expect(screen.queryByText("Goals & constraints")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Weekly load" })).toBeNull();
  });

  it("centers an existing plan on a concrete repair request", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /Athlete/ }));
    fireEvent.click(screen.getByRole("button", { name: "Load demo" }));

    await waitFor(() => expect(screen.getByRole("heading", { name: "Tell us what changed. Repair the plan." })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "My shoulder feels irritated" }));
    expect((screen.getByRole("textbox", { name: "What changed?" }) as HTMLTextAreaElement).value).toBe("My shoulder feels irritated");
    expect((screen.getByRole("button", { name: "Copy repair request" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("shows and applies a ChatGPT repair as one undoable decision", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /Athlete/ }));
    fireEvent.click(screen.getByRole("button", { name: "Load demo" }));
    const current = planStore.getState();
    const session = current.sessions.find((item) => !item.locked)!;
    const originalDay = session.day;

    act(() => {
      planStore.dispatch({
        type: "SET_PROPOSAL",
        actor: "agent",
        proposal: {
          id: "proposal-test",
          summary: "Move strength away from the missed day",
          rationale: "Keeps protected practices in place.",
          changes: [{ operation: "move", id: session.id, week: session.week, day: "Wed" }],
          descriptions: [`Move ${session.title} · W${session.week} ${session.day} → W${session.week} Wed`],
          baseRevision: current.revision,
          loads: current.weeks.map((week) => ({ week: week.number, before: 0, after: 0 })),
          beforeFlagCount: 0,
          afterFlagCount: 0,
          createdAt: new Date().toISOString(),
        },
      });
    });

    expect(screen.getByRole("heading", { name: "Move strength away from the missed day" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Apply repair" }));
    expect(planStore.getState().sessions.find((item) => item.id === session.id)?.day).toBe("Wed");
    fireEvent.click(screen.getByRole("button", { name: "Undo last plan change" }));
    expect(planStore.getState().sessions.find((item) => item.id === session.id)?.day).toBe(originalDay);
  });
});
