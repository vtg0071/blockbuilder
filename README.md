# BlockBuilder

**Repair the plan when life happens.**

BlockBuilder turns “my week changed” into a safe, reviewable training-plan patch. The athlete describes a missed session, pain flare-up, travel day, or schedule conflict. ChatGPT reads the live four-week plan, works around protected commitments, simulates the workload impact, and returns the smallest useful repair. Nothing changes until the athlete approves it.

Built for the 2026 WebMCP Challenge.

**Live app:** [blockbuilder-jet.vercel.app](https://blockbuilder-jet.vercel.app)

**Source:** [github.com/vtg0071/blockbuilder](https://github.com/vtg0071/blockbuilder)

## Why the collaboration matters

Static plans break as soon as real life changes. Rebuilding a schedule by hand means rechecking progression, recovery, availability, and fixed commitments after every adjustment. BlockBuilder gives ChatGPT that bounded repair job while preserving athlete authority:

- **Proposals are non-destructive.** ChatGPT submits a complete patch with exact session changes, before/after weekly loads, and before/after safety checks.
- **Approval is explicit.** The calendar stays untouched until the athlete applies the proposal; the whole repair is one undoable action.
- **Locks are athlete authority.** Proposed or direct agent updates, moves, and removals fail on locked sessions with a recovery-oriented error.
- **Highlights are agent gestures.** The agent can illuminate a session or week and explain the tradeoff in the live UI.
- **The activity feed is shared memory.** Human and agent changes are narrated differently and remain visible together.
- **The grid is the source of truth.** `get_plan` always returns the latest human edits, current metrics, flags, and lock state.

## Features

- Four-week × seven-day calendar with up to three sessions per cell
- Responsive Plan / Athlete / Review workspace with a one-week mobile planning view
- A focused “What changed?” repair composer with realistic examples and a ready-to-paste ChatGPT request
- Non-destructive repair proposals with exact changes, workload comparison, conflict comparison, approve, dismiss, stale-plan protection, and undo
- Accessible session editor with quick presets, live load preview, duplicate-to-next-week, move, remove, and inline validation
- Native drag-and-drop plus keyboard- and touch-friendly edit controls, athlete locks, single-level undo, and deliberate reset confirmation
- Profile for sport, outcome, event date, available days, and free-text constraints
- Foster session load, weekly load, monotony, strain, week-over-week change, and deload checks
- Live flags for load spikes, consecutive high-RPE days, oversized deloads/tapers, unavailable days, and high monotony
- Contextual “next best action” guidance that prioritizes active safety flags, missing athlete context, and unfinished week structure
- Agent highlight state with message, cell/session glow, and manual clear
- Human/agent activity feed
- `localStorage` persistence and JSON export
- Fully usable manual mode when WebMCP is unavailable
- One-click 20-session javelin demo with a realistic progression and locked Tuesday/Thursday team practices
- Responsive desktop and mobile-safe layouts
- Material 3-aligned motion: functional standard feedback, directional week continuity, a focused expressive editor entrance, and a fade-only reduced-motion mode

## Site tools

BlockBuilder registers ten tools from the top-level page using the current `document.modelContext.registerTool(...)` contract and the WebMCP repository's published `webmcp-types` declarations.

| Tool | Purpose |
|---|---|
| `get_plan` | Read the latest profile, focuses, sessions, lock state, metrics, flags, and highlights. The description tells the agent to call it first. |
| `get_metrics` | Read weekly load, WoW change, monotony, strain, deload checks, and flags without fetching the whole plan. |
| `propose_changes` | Simulate up to 12 adds, updates, moves, or removals and create a non-destructive approval card with exact changes and before/after impact. This is the preferred replanning tool. |
| `set_profile` | Partially update sport, goal, event date, available days, or constraints. |
| `set_week_focus` | Set accumulation, intensification, realization, deload, or taper plus a human-readable intent. |
| `add_session` | Add one session and return its ID, running weekly loads, and current flags. Rejects a fourth session in any cell. |
| `update_session` | Change session content or dose. Rejects athlete-locked sessions. |
| `move_session` | Move a session to another week/day. Rejects athlete locks and full cells. |
| `remove_session` | Remove an unlocked session. |
| `highlight` | Visually gesture at session IDs or weeks with an explanatory message. Replaces the previous highlight. |

Every schema uses narrow enums and ranges, explicit `required` arrays, and `additionalProperties: false`. Inputs are validated again when a tool executes, so invalid calls return a useful structured error instead of touching the plan. Every mutation returns what changed, the current revision, all four weekly loads, and any active flags so the agent can self-correct without unnecessary follow-up reads.

## Run locally

Requirements: Node.js 22+ and npm.

```bash
npm install
npm run dev
```

Open the local URL Vite prints, normally `http://localhost:5173`.

Quality checks:

```bash
npm test
npm run build
```

## Enable Site tools / WebMCP

### ChatGPT desktop browser

1. Update the ChatGPT desktop app.
2. Use GPT-5.6 Sol or GPT-5.6 Terra; Luna currently has Site tools disabled.
3. In ChatGPT, open **Settings → Browser → Permissions** and enable **Site tools**.
4. Open the deployed BlockBuilder URL in the built-in browser.
5. Select **Site tools** in the address bar to inspect the ten available tools, then describe what changed and ask ChatGPT to repair the plan.

Site-tool availability can depend on product rollout and workspace type. The app shows a persistent manual-mode banner when no supported model context is present.

### Chrome Origin Trial

Chrome's WebMCP implementation status currently lists an Origin Trial in Chrome 149.

1. Serve BlockBuilder from its final HTTPS origin.
2. Follow the [Chrome WebMCP Origin Trial guide](https://developer.chrome.com/blog/ai-webmcp-origin-trial).
3. Enroll the production origin and add the issued trial token as instructed.
4. Open BlockBuilder in a top-level tab. Tools registered inside iframes are intentionally not discovered by the current ChatGPT surface.

## Suggested repair prompt

> Read my current BlockBuilder plan first. I missed Wednesday’s strength session and can only train Saturday this week. Repair the remaining schedule with the smallest useful set of changes. Preserve the goal, work around every locked session, check the resulting workload and conflicts, then use `propose_changes` so I can review the exact patch before anything is applied.

The on-page repair composer builds this prompt from the athlete’s own disruption.

## Metrics

- Session load = `RPE × duration in minutes`
- Weekly load = sum of session loads
- Daily load = sum of sessions on that day, including zero for empty days
- Monotony = mean daily load ÷ population standard deviation across all seven days
- Strain = weekly load × monotony

Flags are raised when:

1. A non-deload/taper week increases load by more than 15% over the prior loaded week.
2. Sessions at RPE 8+ occur on consecutive calendar days, including Sunday → Monday across weeks.
3. A deload/taper exceeds 60% of the block's peak weekly load.
4. A session falls outside the athlete's available days.
5. Weekly monotony exceeds 2.0.

## Architecture

- Vite + React + TypeScript
- One synchronous external store shared by React and Site tools
- Revision-bound proposal previews that cannot be applied after the underlying plan changes
- Pure calculation layer for metrics and flags
- Runtime validation at every tool callback boundary
- Atomic, abortable registration so a partial tool set is never left behind
- No account, backend, database, model, or network request
- Browser persistence through `localStorage`
- Native View Transitions for grouped mobile pane and week changes, with CSS fallbacks and no animation dependency

The synchronous store is deliberate: a tool mutation can update the visible React grid and immediately return metrics calculated from that exact new state.

## Deploy

The repository includes `vercel.json` and builds as a static Vite site.

The production deployment is available at [blockbuilder-jet.vercel.app](https://blockbuilder-jet.vercel.app). The Vercel project is connected to this GitHub repository, so future pushes to `main` deploy automatically.

```bash
npm run build
```

Deploy the repository to Vercel and keep the default Vite build settings, or upload `dist/` to any static host. Site tools must run in the top-level page; do not wrap the app in an iframe.

## Test coverage

Automated tests verify:

- RPE × duration session load and seven-day Foster metrics
- All five flag families
- Registration of the complete ten-tool surface
- Non-destructive repair proposal creation, lock rejection, and atomic approval
- Runtime rejection of invalid tool inputs without state changes
- Rollback and clean retry after a partial registration failure
- The exact locked-session error and unchanged calendar state
- Athlete-brief validation and save behavior
- Session preset creation, lock protection, editing, and duplication
- Two-step destructive reset protection

Browser QA additionally covers Plan / Athlete / Review navigation, the responsive session editor, mobile action availability, a full-width laptop calendar, the single-week phone layout, zero page overflow, and console cleanliness.

## Privacy

BlockBuilder stores the plan only in the current browser. Export is user-initiated. There are no accounts, analytics, API calls, or remote data stores.

## License

Released under the [MIT License](LICENSE).
