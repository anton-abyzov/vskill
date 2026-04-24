// ---------------------------------------------------------------------------
// 0688 T-019: useScopeTransfer — client-side orchestrator for promote /
// test-install / revert.
//
// Each operation runs this sequence:
//   1. captureRect(skill)   — FLIP: First (row's on-screen position pre-move)
//   2. api.<verb>Skill(...) — POST-initiated SSE; resolves on `done`
//   3. refreshSkills()      — re-scan so the row is now at its new position
//   4. rAF → runFlip(...)   — FLIP: Last / Invert / Play
//   5. toast(...)           — success (5s + Undo for promote) or error
//
// All side-effecty collaborators (api, flip, StudioContext, toast) are
// consumed via their existing module-level exports so the tests in
// `__tests__/use-scope-transfer.test.ts` can stub them with `vi.mock`.
// ---------------------------------------------------------------------------

import { useCallback, useState } from "react";
import { api } from "../api";
import { captureRect, runFlip } from "./flip";
import { useStudio } from "../StudioContext";
import { useToast } from "../components/ToastProvider";
import type { TransferEvent } from "../types";

type SkillRef = { plugin: string; skill: string };

type Verb = "promote" | "test-install" | "revert";

type State =
  | { status: "idle" }
  | { status: "running"; verb: Verb; skill: SkillRef }
  | { status: "error"; verb: Verb; skill: SkillRef; message: string; code?: string };

export interface UseScopeTransferReturn {
  promote: (skill: SkillRef) => Promise<void>;
  testInstall: (skill: SkillRef, dest?: "installed" | "global") => Promise<void>;
  revert: (skill: SkillRef) => Promise<void>;
  state: State;
}

function extractMessage(err: unknown): { message: string; code?: string } {
  if (err && typeof err === "object") {
    const e = err as { message?: unknown; code?: unknown };
    const message = typeof e.message === "string" && e.message.length > 0 ? e.message : "Operation failed";
    const code = typeof e.code === "string" ? e.code : undefined;
    return { message, code };
  }
  return { message: "Operation failed" };
}

export function useScopeTransfer(): UseScopeTransferReturn {
  const { refreshSkills } = useStudio();
  const { toast } = useToast();
  const [state, setState] = useState<State>({ status: "idle" });

  const runFlipDeferred = useCallback((skill: SkillRef, first: DOMRect | null) => {
    requestAnimationFrame(() => runFlip(skill, first));
  }, []);

  const revert = useCallback(
    async (skill: SkillRef) => {
      const first = captureRect(skill);
      setState({ status: "running", verb: "revert", skill });
      try {
        await api.revertSkill(skill.plugin, skill.skill, {
          onEvent: (_evt: TransferEvent) => {},
        });
        refreshSkills();
        runFlipDeferred(skill, first);
        toast({
          message: `Reverted ${skill.skill}`,
          severity: "success",
          durationMs: 4000,
        });
        setState({ status: "idle" });
      } catch (err) {
        const { message, code } = extractMessage(err);
        toast({
          message: `Revert failed: ${message}`,
          severity: "error",
          durationMs: 6000,
        });
        setState({ status: "error", verb: "revert", skill, message, code });
      }
    },
    [refreshSkills, runFlipDeferred, toast],
  );

  const promote = useCallback(
    async (skill: SkillRef) => {
      const first = captureRect(skill);
      setState({ status: "running", verb: "promote", skill });
      try {
        await api.promoteSkill(skill.plugin, skill.skill, {
          onEvent: (_evt: TransferEvent) => {},
        });
        refreshSkills();
        runFlipDeferred(skill, first);
        toast({
          message: `Promoted ${skill.skill} → OWN`,
          severity: "success",
          durationMs: 5000,
          action: { label: "Undo", onInvoke: () => { void revert(skill); } },
        });
        setState({ status: "idle" });
      } catch (err) {
        const { message, code } = extractMessage(err);
        toast({
          message: `Promote failed: ${message}`,
          severity: "error",
          durationMs: 6000,
        });
        setState({ status: "error", verb: "promote", skill, message, code });
      }
    },
    [refreshSkills, revert, runFlipDeferred, toast],
  );

  const testInstall = useCallback(
    async (skill: SkillRef, dest: "installed" | "global" = "installed") => {
      const first = captureRect(skill);
      setState({ status: "running", verb: "test-install", skill });
      try {
        await api.testInstallSkill(skill.plugin, skill.skill, {
          dest,
          onEvent: (_evt: TransferEvent) => {},
        });
        refreshSkills();
        runFlipDeferred(skill, first);
        toast({
          message: `Test-installed ${skill.skill} → ${dest.toUpperCase()}`,
          severity: "success",
          durationMs: 4000,
        });
        setState({ status: "idle" });
      } catch (err) {
        const { message, code } = extractMessage(err);
        toast({
          message: `Test-install failed: ${message}`,
          severity: "error",
          durationMs: 6000,
        });
        setState({ status: "error", verb: "test-install", skill, message, code });
      }
    },
    [refreshSkills, runFlipDeferred, toast],
  );

  return { promote, testInstall, revert, state };
}
