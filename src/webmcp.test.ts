import { beforeEach, describe, expect, it, vi } from "vitest";

describe("WebMCP registration", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  it("registers the complete ten-tool surface and protects athlete locks", async () => {
    const tools: WebMCP.ModelContextTool[] = [];
    const registrationSignals: AbortSignal[] = [];
    Object.defineProperty(document, "modelContext", {
      configurable: true,
      value: {
        registerTool: vi.fn(async (definition: WebMCP.ModelContextTool, options?: WebMCP.ModelContextRegisterToolOptions) => {
          tools.push(definition);
          if (options?.signal) registrationSignals.push(options.signal);
        }),
      },
    });

    const [{ registerWebMcpTools, unregisterWebMcpTools }, { planStore }] = await Promise.all([
      import("./webmcp"),
      import("./store"),
    ]);
    const status = await registerWebMcpTools();

    expect(status).toMatchObject({ supported: true, registered: 10, source: "document" });
    expect(tools.map((tool) => tool.name)).toEqual([
      "get_plan",
      "get_metrics",
      "propose_changes",
      "set_profile",
      "set_week_focus",
      "add_session",
      "update_session",
      "move_session",
      "remove_session",
      "highlight",
    ]);
    expect(tools.every((tool) => Boolean(tool.title))).toBe(true);
    expect(tools.every((tool) => Object.keys(tool.annotations ?? {}).every((key) => ["readOnlyHint", "untrustedContentHint"].includes(key)))).toBe(true);
    expect(registrationSignals).toHaveLength(10);
    expect(new Set(registrationSignals).size).toBe(1);
    expect(registrationSignals[0].aborted).toBe(false);

    const activityBeforeReads = planStore.getState().activity.length;
    const getPlan = tools.find((tool) => tool.name === "get_plan")!;
    const executionOptions = { signal: new AbortController().signal };
    const readResult = await getPlan.execute({}, executionOptions) as { ok: boolean };
    const invalidReadResult = await getPlan.execute({ unexpected: true }, executionOptions) as { ok: boolean; code: string };
    expect(readResult.ok).toBe(true);
    expect(invalidReadResult).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(planStore.getState().activity).toHaveLength(activityBeforeReads);

    planStore.dispatch({ type: "LOAD_DEMO" });
    const locked = planStore.getState().sessions.find((session) => session.locked)!;
    const move = tools.find((tool) => tool.name === "move_session")!;
    const result = await move.execute({ id: locked.id, week: 1, day: "Wed" }, executionOptions) as { ok: boolean; code: string; error: string };

    expect(result.ok).toBe(false);
    expect(result.code).toBe("SESSION_LOCKED");
    expect(result.error).toBe("Locked by the athlete — ask them or work around it.");
    expect(planStore.getState().sessions.find((session) => session.id === locked.id)?.day).toBe("Tue");

    const propose = tools.find((tool) => tool.name === "propose_changes")!;
    const unlocked = planStore.getState().sessions.find((session) => !session.locked)!;
    const sessionsBeforeProposal = structuredClone(planStore.getState().sessions);
    const proposalResult = await propose.execute({
      summary: "Move strength around the missed day",
      rationale: "Keeps the protected practices in place and opens recovery time.",
      changes: [{ operation: "move", id: unlocked.id, week: unlocked.week, day: "Wed" }],
    }, executionOptions) as { ok: boolean; proposal: { id: string } };
    expect(proposalResult.ok).toBe(true);
    expect(planStore.getState().sessions).toEqual(sessionsBeforeProposal);
    expect(planStore.getState().proposal?.id).toBe(proposalResult.proposal.id);

    planStore.dispatch({ type: "APPLY_PROPOSAL", id: proposalResult.proposal.id, actor: "human" });
    expect(planStore.getState().sessions.find((session) => session.id === unlocked.id)?.day).toBe("Wed");
    expect(planStore.getState().proposal).toBeNull();

    const lockedProposal = await propose.execute({
      summary: "Move protected practice",
      rationale: "This should be rejected.",
      changes: [{ operation: "move", id: locked.id, week: 1, day: "Wed" }],
    }, executionOptions) as { ok: boolean; code: string };
    expect(lockedProposal).toMatchObject({ ok: false, code: "SESSION_LOCKED" });

    const add = tools.find((tool) => tool.name === "add_session")!;
    const beforeInvalidCall = planStore.getState().sessions.length;
    const invalid = await add.execute(
      { week: 9, day: "Funday", type: "power", title: "Invalid", rpe: 12, duration_min: 0 },
      executionOptions,
    ) as { ok: boolean; code: string; error: string };
    expect(invalid.ok).toBe(false);
    expect(invalid.code).toBe("INVALID_INPUT");
    expect(invalid.error).toContain("input.week must be at most 4");
    expect(planStore.getState().sessions).toHaveLength(beforeInvalidCall);

    unregisterWebMcpTools();
    expect(registrationSignals[0].aborted).toBe(true);
  });

  it("rolls back partial registration and permits a clean retry", async () => {
    const firstSignals: AbortSignal[] = [];
    let calls = 0;
    Object.defineProperty(document, "modelContext", {
      configurable: true,
      value: {
        registerTool: vi.fn(async (_definition: WebMCP.ModelContextTool, options?: WebMCP.ModelContextRegisterToolOptions) => {
          calls += 1;
          if (options?.signal) firstSignals.push(options.signal);
          if (calls === 3) throw new DOMException("Rejected for test", "InvalidStateError");
        }),
      },
    });

    const { registerWebMcpTools, unregisterWebMcpTools } = await import("./webmcp");
    const failed = await registerWebMcpTools();
    expect(failed.registered).toBe(0);
    expect(failed.error).toContain("Rejected for test");
    expect(firstSignals.every((signal) => signal.aborted)).toBe(true);

    const retriedTools: WebMCP.ModelContextTool[] = [];
    Object.defineProperty(document, "modelContext", {
      configurable: true,
      value: {
        registerTool: vi.fn(async (definition: WebMCP.ModelContextTool) => retriedTools.push(definition)),
      },
    });
    const retried = await registerWebMcpTools();
    expect(retried).toMatchObject({ supported: true, registered: 10 });
    expect(retriedTools).toHaveLength(10);
    unregisterWebMcpTools();
  });
});
