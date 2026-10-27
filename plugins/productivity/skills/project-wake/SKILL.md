---
name: project-wake
description: "Manual sweep of a SpecWithCode project after an update, restart or outage: list every thread, continue only work the restart cut off and the app did not continue, never touch work a person stopped, hand off one thread at a time only through existing handoff tools, and ask owners of finished-but-unclosed work to verify, review and close it. Use only when the user invokes $project-wake or /project-wake, or explicitly asks to run project wake in a project coordinator. Not for schedules, routine status questions, or outside SpecWithCode (it needs the studio-code MCP tools)."
metadata:
  version: "1.0.5"
  category: productivity
  tags: specwithcode, coordinator, restart, update, resume, handoff, threads, orchestration
---

# project-wake

One manual sweep of the current project. The user invoking `$project-wake` (or `/project-wake`) authorizes continuing interrupted work inside the rules below and nothing else. The coordinator routes, it does not implement: every action is one message to the thread that already owns the work.

## 1. Inventory

- `studio_thread_list` with no `machine` (federated), `includeArchived: false`, `limit: 100`; repeat with `cursor = nextCursor` until it is null. Keep `partial` and every unavailable or unauthorized member: their threads are **unknown**, never dead, and are never resumed or duplicated from here, except through step 4's handoff tools when `studio_handoff_ready_list` lists them.
- Skip the calling thread, and threads whose `settled` is true unless the user named them.
- Remember each thread's machine. Pass that `machine` on every `studio_thread_read` and `studio_thread_send` for a thread that is not on this machine. `studio_queue_list`, `studio_queue_resume`, `studio_thread_configuration` and `studio_pending_request_list` only see this machine: for a remote thread whose state depends on them, classify it **unclear**.
- Call `studio_machine_list` once for which machines are ready. Provider quota is not listed anywhere: treat a provider as out of quota only when the thread's own failure text or a reset time says so.

## 2. Classify each thread

Read the latest run with `studio_thread_read` (`view: "activity"`, `runLimit: 1`), paging with `afterPosition = nextPosition` until `nextPosition` is null. Use run status and the interrupt, failure and approval items, not the title.

| State | Evidence | Action |
|---|---|---|
| Running or queued | status running/starting/queued, or `studio_queue_list` shows undelivered messages that are not held | Leave alone. Never add a second executor or watcher. |
| Already continued by the app | a newer run or a "Continue where you left off" / update-continuation message after the interrupt | Leave alone. |
| Cut off by update or restart | interrupted with cause `service_update` or restart; "Closed to install the SpecWithCode update."; failed with "The provider event stream closed unexpectedly" only when the same thread's activity also shows an update or restart notice; or `cancelled` with no interrupt request and an update or restart notice in the same thread | Step 3, after the wait below. |
| Never started | "The provider did not start this turn within 2 minutes" or "Run interrupted before provider start" | Step 3, once. The app never retries these. |
| Stopped by a person | an interrupt request from the user, Stop, or `cancelled` with an interrupt request | Leave it. A person's Stop is final; list it. A `cancelled` run with neither an interrupt request nor an update or restart notice is **unclear**. |
| Waiting on a person | a pending question or approval in the activity, or a `studio_pending_request_list` entry | Leave it; list what is asked. |
| Usage limit | quota or rate-limit failure text, a reset time | Step 4. |
| Real failure | provider, tool or code error unrelated to an update | Do not retry. Report the error text and the owner. |
| Finished, not closed | completed run that says the work is done, with an increment that still has open tasks, unverified ACs or an open PR | Step 5. |
| Finished and closed | completed, increment closed or no remaining work | Nothing. Never wake it to poll. |

When the evidence does not settle it, mark the thread **unclear** and report it; do not act.

## Rules for every send

These apply to every `studio_thread_send` in steps 3 and 5.

- A send releases the thread's held queue. Check `studio_queue_list` first: if the queue is held and the hold does not follow an update or restart interrupt in the activity, treat it as a person's hold (a hold after a provider failure counts as a person's too), so do not send. Never call `studio_queue_resume` on a person's hold.
- For a thread on another machine the queue is not visible: send only when its activity shows no Stop by a person after the interrupt; otherwise mark it **unclear**.
- Read the result: report any `releasedHeldMessages`, and if it has `queueHeld: true`, report the message as not delivered, with its `notice`.

## 3. Continue cut-off work

- The app continues update-cut runs under 24 hours old on its own. Act on a cut-off run only when the interrupt is at least 15 minutes old and no newer run or continuation message exists. Re-read the thread immediately before sending; if anything changed, leave it.
- Only on the thread's own provider and model, with no model or permission change.
- Send one message to the same thread with `studio_thread_send`, `mode: "auto"`, `clientRequestId: "project-wake:<threadId>:<latestRunId>"` so a second sweep cannot double-send: "SpecWithCode restarted and cut this turn off. Re-read your last messages and the repository state, then continue the same task where it stopped. If it is already finished, verify that and report instead of redoing it."
- Never use `studio_threads_continue_all`: it also continues runs a person stopped.

## 4. Out of quota, or the machine is gone

- Never switch to an API-billed, pay-per-token or other paid provider, never raise a thread's permission mode, and never pass `modelSelection` to any tool.
- If the user's configured fallback order covers this provider, the app applies it; report the reset time and leave the thread.
- If the owning machine is offline: read `studio_handoff_ready_list` and call `studio_thread_continue_here` only for a thread it marks continuable, without `modelSelection`. That is the only way to continue a thread from an offline machine.
- `studio_thread_migrate` is the alternative for a thread on this machine only (it refuses threads elsewhere): to move it to a ready machine, pass exactly one `threadIds` entry; omitting `threadIds` moves every running handoff-mode thread. A refusal is final; report it.
- Otherwise list the thread as blocked with the provider, reset time or machine.

## 5. Finished but not closed

Send the owning thread one message, `clientRequestId: "project-wake-close:<threadId>:<latestRunId>"`, asking it to close its own work: record finished tasks, run `specweave verify <id>`, get a review in a fresh context, then `specweave complete <id>`, and report any gate that stops it. Do not verify, review or close it from the coordinator, and never count source, a merged PR or green CI as installed or manual acceptance.

## 6. Report

End with one table, then one line of totals:

| Thread | Found | Action | Needs you |
|---|---|---|---|

Link each thread with the `threadLink` the tools return. "Needs you" is only what a person must do: answer a question, sign in, approve a grant, wait for a reset, or decide on a real failure.
