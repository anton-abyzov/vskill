// ---------------------------------------------------------------------------
// InstallEngineModal — confirmation + progress modal for engine installation.
// Ref: 0734 US-005 (AC-US5-04..AC-US5-06).
//
// Stages:
//   1. confirming — show exact command + security note, [Run install] / [Cancel]
//   2. streaming  — spinner + live tail (last 60 chars of stdout)
//   3. success    — green checkmark, auto-close after a moment
//   4. failure    — red X + expandable stderr + [Retry]
// ---------------------------------------------------------------------------

import React from "react";
import type { Engine } from "./EngineSelector";
import { useInstallEngine } from "../hooks/useInstallEngine";

const COMMAND_BY_ENGINE: Record<Exclude<Engine, "none">, string> = {
  vskill: "vskill install anton-abyzov/vskill/skill-builder",
  "anthropic-skill-creator": "claude plugin install skill-creator",
};

const LABEL_BY_ENGINE: Record<Exclude<Engine, "none">, string> = {
  vskill: "VSkill skill-builder",
  "anthropic-skill-creator": "Anthropic skill-creator",
};

const SECURITY_NOTE =
  "This runs the command in your terminal as your user. Inspect before approving.";

export interface InstallEngineModalProps {
  engine: Exclude<Engine, "none">;
  onClose: () => void;
  /** Called once after a successful install so the parent can refresh detection. */
  onSuccess: () => void;
  /** Test seam for SSE / fetch — leave undefined in prod. */
  hookOpts?: Parameters<typeof useInstallEngine>[0];
}

export function InstallEngineModal(props: InstallEngineModalProps): React.ReactElement {
  const { engine, onClose, onSuccess, hookOpts } = props;
  const { state, install, retry } = useInstallEngine(hookOpts);
  const command = COMMAND_BY_ENGINE[engine];
  const label = LABEL_BY_ENGINE[engine];
  const successFiredRef = React.useRef(false);

  React.useEffect(() => {
    if (state.status === "success" && !successFiredRef.current) {
      successFiredRef.current = true;
      onSuccess();
    }
  }, [state.status, onSuccess]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="install-engine-title"
      data-testid="install-engine-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
    >
      <div className="w-full max-w-lg rounded-lg bg-white p-6 shadow-xl">
        <h2 id="install-engine-title" className="text-lg font-semibold text-gray-900">
          Install {label}
        </h2>

        {state.status === "idle" && (
          <ConfirmStage
            command={command}
            onCancel={onClose}
            onRun={() => install(engine)}
          />
        )}

        {(state.status === "spawning" || state.status === "streaming") && (
          <StreamingStage command={command} liveTail={state.liveTail} />
        )}

        {state.status === "success" && (
          <SuccessStage label={label} onClose={onClose} />
        )}

        {state.status === "failure" && (
          <FailureStage
            error={state.error ?? "Install failed"}
            stderr={state.stderr}
            progress={state.progress}
            onRetry={() => retry()}
            onClose={onClose}
          />
        )}
      </div>
    </div>
  );
}

function CommandPreview({ command }: { command: string }): React.ReactElement {
  return (
    <pre
      data-testid="install-command-preview"
      className="my-3 overflow-x-auto rounded bg-gray-900 px-3 py-2 font-mono text-xs text-green-300"
    >
      $ {command}
    </pre>
  );
}

function ConfirmStage(props: { command: string; onRun: () => void; onCancel: () => void }): React.ReactElement {
  return (
    <>
      <p className="mt-2 text-sm text-gray-700">
        Studio will run this command on your behalf:
      </p>
      <CommandPreview command={props.command} />
      <p className="text-xs text-amber-700" data-testid="install-security-note">
        {SECURITY_NOTE}
      </p>
      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          data-testid="install-cancel"
          className="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
          onClick={props.onCancel}
        >
          Cancel
        </button>
        <button
          type="button"
          data-testid="install-run"
          className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
          onClick={props.onRun}
        >
          Run install
        </button>
      </div>
    </>
  );
}

function StreamingStage(props: { command: string; liveTail: string }): React.ReactElement {
  return (
    <>
      <p className="mt-2 text-sm text-gray-700">Installing…</p>
      <CommandPreview command={props.command} />
      <div className="mt-3 flex items-center gap-2 text-xs text-gray-600">
        <span data-testid="install-spinner" className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-gray-300 border-t-blue-600" />
        <span data-testid="install-live-tail" className="font-mono">{props.liveTail || "starting…"}</span>
      </div>
    </>
  );
}

function SuccessStage(props: { label: string; onClose: () => void }): React.ReactElement {
  return (
    <>
      <p data-testid="install-success" className="mt-3 text-sm font-medium text-green-700">
        ✓ {props.label} installed
      </p>
      <div className="mt-4 flex justify-end">
        <button
          type="button"
          data-testid="install-close"
          className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
          onClick={props.onClose}
        >
          Done
        </button>
      </div>
    </>
  );
}

function FailureStage(props: {
  error: string;
  stderr: string;
  progress: Array<{ stream: string; line: string }>;
  onRetry: () => void;
  onClose: () => void;
}): React.ReactElement {
  const [expanded, setExpanded] = React.useState(false);
  const stderrLines = props.progress.filter((p) => p.stream === "stderr").map((p) => p.line);
  const fullStderr = stderrLines.length > 0 ? stderrLines.join("\n") : props.stderr;
  return (
    <>
      <p data-testid="install-failure" className="mt-3 text-sm font-medium text-red-700">
        ✗ Install failed
      </p>
      <p className="mt-1 text-xs text-gray-700">{props.error}</p>
      {fullStderr && (
        <details
          className="mt-3 text-xs"
          open={expanded}
          onToggle={(e) => setExpanded((e.currentTarget as HTMLDetailsElement).open)}
        >
          <summary className="cursor-pointer text-gray-600">stderr</summary>
          <pre data-testid="install-stderr" className="mt-2 overflow-x-auto rounded bg-gray-900 px-3 py-2 font-mono text-xs text-red-300">
            {fullStderr}
          </pre>
        </details>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          data-testid="install-close"
          className="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
          onClick={props.onClose}
        >
          Close
        </button>
        <button
          type="button"
          data-testid="install-retry"
          className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
          onClick={props.onRetry}
        >
          Retry
        </button>
      </div>
    </>
  );
}
