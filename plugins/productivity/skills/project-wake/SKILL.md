---
name: project-wake
description: "Wake a SpecWithCode project after an update, restart or outage: list every thread of the current project, work out which ones stopped for the wrong reason, continue those on their own provider when it has quota, hand off only through existing handoff tools, and route finished-but-unclosed work to its owner for verify, review and close. Run it from a project coordinator when the user types /project-wake or asks to wake the project, resume what the restart stopped, or check that every thread finished. Do not use it on a schedule, to resume work a person stopped, or outside SpecWithCode (it needs the studio-code MCP tools)."
version: "1.0.2"
metadata:
  category: productivity
  tags: specwithcode, coordinator, restart, update, resume, handoff, threads, orchestration
---

# project-wake

One manual sweep of the current project. The user typing `/project-wake` authorizes continuing interrupted work inside the rules below; it does not authorize anything else. The coordinator routes, it does not implement: every action is a message to the thread that already owns the work.

## 1. Inventory

- `studio_thread_list` with no `machine` (federated), `includeArchived: false`, `limit: 100`; repeat with `cursor = nextCursor` until it is null. Keep `partial` and each unavailable or unauthorized member: their threads are **unknown**, never dead, and are never resumed or duplicated from here.
- Skip the calling thread. Skip threads whose `settled` is true unless the user asked for them.
- `studio_machine_list` and `orchestrator_capabilities` once, for which machines are ready and which providers are signed in and have usage left.

## 2. Classify each thread

Read the latest run with `studio_thread_read` (`view: "activity"`, the last 20 items, `runLimit: 3`). Use the run status plus the interrupt and failure text, not the title.

| State | Evidence | Action |
|---|---|---|
| Running or queued | `status` running/starting/queued, or `studio_queue_list` has undelivered, unheld messages | Leave alone. Never add a second executor or watcher. |
| Cut off by update or restart | interrupted with cause `service_update`/restart, "Closed to install the SpecWithCode update.", or failed with "The provider event stream closed unexpectedly" within minutes of an update | Continue (step 3). |
| Never started | "The provider did not start this turn within 2 minutes" / "Run interrupted before provider start" | Continue once (step 3); the work never ran. |
| Stopped by a person | interrupt requested by the user, Stop, cancel, or a held queue without a restart reason | Leave it. A person's Stop is final; list it in the report. |
| Waiting on a person | pending question, approval or `studio_pending_request_list` entry | Leave it; list what is being asked. |
| Usage limit | quota or rate-limit failure, "waiting for reset" | Step 4. |
| Real failure | provider, tool or code error unrelated to an update | Do not retry blindly. Report the error text and the owner. |
| Finished, not closed | completed run whose last message says the work is done, with an increment that still has open tasks, unverified ACs or an open PR | Step 5. |
| Finished and closed | completed, increment closed or no remaining work | Nothing. Do not wake it to poll. |

When the evidence does not settle it, mark the thread **unclear** and report it; do not act.

## 3. Continue cut-off work

- Only on the thread's own provider and model (`studio_thread_configuration`), and only when `orchestrator_capabilities` shows that provider signed in with usage available.
- Send one message to the same thread with `studio_thread_send`, `mode: "auto"`, a `clientRequestId` of `project-wake:<threadId>:<latestRunId>` so a second sweep cannot double-send: "SpecWithCode restarted and cut this turn off. Re-read your last messages and the repository state, then continue the same task where it stopped. If it is already finished, verify that and report instead of redoing it."
- If the result says `queueHeld: true`, the thread's queue was held. Resume it with `studio_queue_resume` only when the hold came from a restart or update, never from a person's Stop.
- Do not use `studio_threads_continue_all`: it also continues runs a person stopped.

## 4. Out of quota, or the machine is gone

- Never switch to an API-billed, pay-per-token or other paid provider, never raise a thread's permission mode, and never pick a fallback model the user has not configured.
- If the user's configured fallback order already covers this provider, the app applies it; report the reset time and leave the thread.
- If the owning machine is offline: check `studio_handoff_ready_list`; `studio_thread_continue_here` only threads it marks continuable. To move a thread you own to a ready machine, use `studio_thread_migrate`; a refusal is final, report it.
- Otherwise list the thread as blocked with the provider, reset time or machine.

## 5. Finished but not closed

Send the owning thread one message asking it to close its own work: record finished tasks, run `specweave verify <id>`, get a review in a fresh context, then `specweave complete <id>`, and report any gate that stops it. Do not verify, review or close it from the coordinator, and never count source, a merged PR or green CI as installed or manual acceptance.

## 6. Report

End with one table, then one line of totals:

| Thread | Found | Action | Needs you |
|---|---|---|---|

Link each thread with the `threadLink` the tools return. "Needs you" is only what a person must do: answer a question, sign in, approve a grant, wait for a reset, or decide on a real failure.
