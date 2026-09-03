# BlockBuilder — submission kit

## Devpost one-liner

A training-plan repair workspace where ChatGPT adapts the remaining schedule when real life changes, while protected commitments stay under athlete control.

## Devpost description

Training plans rarely survive contact with real life. A missed session, irritated shoulder, travel day, or moved practice can make the rest of the week unsafe or unrealistic. Spreadsheets show the schedule, but they do not reason through the downstream repair. BlockBuilder does.

The athlete describes what changed. ChatGPT reads the latest four-week plan, constraints, protected commitments, and live Foster metrics, then submits a non-destructive repair proposal. The UI shows each exact add, update, move, or removal plus before/after weekly loads and safety-check counts. The athlete applies or dismisses the patch; nothing changes silently.

Four mechanics make the collaboration visible:

1. **Repair request:** a plain-language disruption becomes the agent’s bounded job.
2. **Proposal:** ChatGPT simulates a complete patch and its workload impact without touching the calendar.
3. **Lock:** athlete-owned sessions reject proposed and direct agent changes with “Locked by the athlete — ask them or work around it.”
4. **Approval:** the athlete applies the repair as one undoable change, or dismisses it.

BlockBuilder exposes ten Site tools: `get_plan`, `get_metrics`, `propose_changes`, `set_profile`, `set_week_focus`, `add_session`, `update_session`, `move_session`, `remove_session`, and `highlight`. `propose_changes` is the preferred repair path; direct mutation tools remain available for explicit immediate edits and initial plan creation.

The app is local-first, has no backend, persists through refresh, exports JSON, and remains manually editable without WebMCP.

## Human-agent experience summary

- The human supplies the disruption; the agent calculates the smallest coherent repair.
- The proposal card makes intent, exact changes, and consequences inspectable before approval.
- The human can still edit the grid at any time; an older proposal then becomes stale and cannot apply to the wrong revision.
- Locks turn human preference into enforceable tool behavior.
- Structured results return impact immediately and reduce tool-call churn.
- Errors explain how the agent should recover instead of merely rejecting the call.

## Two-minute demo script

### 0:00–0:20 — Start from a plan that already exists

- Load the 20-session javelin demo.
- Point out the meet goal and protected Tuesday/Thursday team practices.
- Say: “This is a real plan. Now real life changes.”

### 0:20–0:38 — Describe the disruption

In **What changed?**, enter:

> My shoulder is irritated after Tuesday practice. Reduce throwing stress this week without moving team practice, and keep the taper on track.

- Copy the repair request and paste it into ChatGPT.
- Say: “The request is short because the plan, locks, and metrics already live on the page.”

### 0:38–1:08 — Let ChatGPT propose, not mutate

- Show ChatGPT call `get_plan`, work around the protected practices, and call `propose_changes`.
- Pause on the proposal card: exact session changes, weekly load movement, and safety checks.
- Say: “The calendar has not changed yet.”

### 1:08–1:32 — Keep the athlete in control

- Click **Apply repair**.
- Show the sessions and workload update together, then point out **Undo**.
- Mention that a manual calendar edit makes an older proposal stale instead of applying it to the wrong plan.

### 1:32–1:48 — Demonstrate enforceable locks

- Ask ChatGPT to move a protected team practice immediately.
- Show the structured locked-session error and unchanged calendar.

### 1:48–2:00 — Close on the technical surface

- Open **Site tools** from the browser address bar.
- Show the ten registered tools.
- End on: “When life breaks the plan, ChatGPT repairs it—but the athlete approves it.”

## Recording checklist

- Use a 1600×900 or 1440×900 window at 100% zoom.
- Start from Reset, then load the demo live.
- Use GPT-5.6 Sol or Terra with Site tools enabled.
- Practice the tool flow once so the proposal appears within the two-minute limit.
- Keep the proposal card, calendar, and activity column in frame where possible.
- Record without notifications or personal tabs visible.

## Submission checklist

- [ ] Public repository URL
- [ ] Live HTTPS Vercel URL
- [ ] Unlisted YouTube video (≤2 minutes)
- [ ] Devpost one-liner and description
- [ ] README tool table and run instructions
- [ ] Test Site tools from the deployed top-level page
- [ ] Verify Reset → Load demo → repair request → proposal → approval → undo
- [ ] Confirm JSON export downloads from the deployed build
