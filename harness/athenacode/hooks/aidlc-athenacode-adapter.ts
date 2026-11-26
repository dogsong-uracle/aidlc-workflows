#!/usr/bin/env bun
// Athena Code adapter for the static 1.0.15 hook payload contract.
// Only SessionStart and Stop have field-for-field core equivalents here.
// PreToolUse tool names are not mapped until an Athena-to-core name contract is
// verified; UserPromptSubmit is inert in Athena and never records a human turn.

import { spawnSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const MAX_INPUT_BYTES = 128 * 1024;
const TASK_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const HOOKS_DIR = dirname(fileURLToPath(import.meta.url));
const CORE_TARGETS = Object.freeze({
  SessionStart: "session-start",
  Stop: "continue-workflow",
} as const);

type CoreTarget = (typeof CORE_TARGETS)[keyof typeof CORE_TARGETS];

type AthenaPayload = {
  task_id: string;
  cwd: string;
  hook_event_name: string;
  source?: string;
  stop_hook_active?: boolean;
  last_assistant_message?: string;
};

export type AthenaNormalization =
  | { kind: "ignore" }
  | { kind: "reject"; reason: string }
  | { kind: "dispatch"; target: CoreTarget; input: Record<string, unknown> };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function withinProject(projectDir: string, candidate: string): boolean {
  const path = relative(projectDir, candidate);
  return path === "" || (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}

export function normalizeAthenaHookInput(raw: string, projectDir: string): AthenaNormalization {
  if (Buffer.byteLength(raw, "utf8") > MAX_INPUT_BYTES) {
    return { kind: "reject", reason: "hook input exceeds the supported size" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { kind: "reject", reason: "hook input is not valid JSON" };
  }
  if (!isRecord(parsed)) return { kind: "reject", reason: "hook input must be a JSON object" };
  const payload = parsed as Partial<AthenaPayload>;
  if (typeof payload.task_id !== "string" || !TASK_ID.test(payload.task_id)) {
    return { kind: "reject", reason: "task_id is missing or invalid" };
  }
  if (typeof payload.cwd !== "string" || !isAbsolute(payload.cwd)) {
    return { kind: "reject", reason: "cwd must be an absolute project path" };
  }
  const root = resolve(projectDir);
  const cwd = resolve(payload.cwd);
  if (!withinProject(root, cwd)) return { kind: "reject", reason: "cwd is outside the project" };
  if (typeof payload.hook_event_name !== "string") {
    return { kind: "reject", reason: "hook_event_name is missing" };
  }
  if (payload.hook_event_name === "UserPromptSubmit") return { kind: "ignore" };
  const target = CORE_TARGETS[payload.hook_event_name as keyof typeof CORE_TARGETS];
  if (!target) return { kind: "ignore" };

  if (payload.hook_event_name === "SessionStart") {
    if (payload.source !== "startup" && payload.source !== "resume") {
      return { kind: "reject", reason: "SessionStart source is missing or unsupported" };
    }
    return {
      kind: "dispatch",
      target,
      input: { hook_event_name: "SessionStart", cwd, source: payload.source },
    };
  }

  if (typeof payload.stop_hook_active !== "boolean") {
    return { kind: "reject", reason: "Stop stop_hook_active must be boolean" };
  }
  if (payload.last_assistant_message !== undefined && typeof payload.last_assistant_message !== "string") {
    return { kind: "reject", reason: "Stop last_assistant_message must be text" };
  }
  return {
    kind: "dispatch",
    target,
    input: {
      hook_event_name: "Stop",
      cwd,
      stop_hook_active: payload.stop_hook_active,
      ...(typeof payload.last_assistant_message === "string"
        ? { last_assistant_message: payload.last_assistant_message }
        : {}),
    },
  };
}

function realProjectDir(): string | null {
  const raw = process.env.AIDLC_PROJECT_DIR ?? process.cwd();
  try {
    return realpathSync(resolve(raw));
  } catch {
    return null;
  }
}

function runCore(target: CoreTarget, input: Record<string, unknown>, projectDir: string): number {
  const executable = process.env.AIDLC_COMPILED_EXECUTABLE;
  const command = executable
    ? [executable, "engine", "hook", target]
    : [process.execPath, join(HOOKS_DIR, "..", "tools", "aidlc.ts"), "engine", "hook", target];
  const result = spawnSync(command[0], command.slice(1), {
    cwd: projectDir,
    env: {
      ...process.env,
      AIDLC_PROJECT_DIR: projectDir,
      AIDLC_HARNESS_DIR: ".athena",
      AIDLC_HARNESS_NAME: "athenacode",
    },
    input: `${JSON.stringify(input)}\n`,
    encoding: "utf8",
    timeout: 30_000,
    maxBuffer: MAX_INPUT_BYTES,
    shell: false,
  });
  if (result.error || result.signal) {
    process.stderr.write(`AIDLC Athena adapter could not complete ${target}\n`);
    return 1;
  }
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) return result.status ?? 1;

  if (target === "session-start") {
    try {
      const context = JSON.parse(result.stdout) as { additionalContext?: unknown };
      if (typeof context.additionalContext === "string" && context.additionalContext.length > 0) {
        process.stdout.write(`${context.additionalContext}\n`);
      }
    } catch {
      // SessionStart context has no usable value; no host-specific field is made up.
    }
    return 0;
  }
  if (result.stdout) process.stdout.write(result.stdout);
  return 0;
}

export async function run(target: string, input: string, _extraArgs: string[] = []): Promise<number> {
  const projectDir = realProjectDir();
  if (!projectDir || !existsSync(projectDir)) {
    process.stderr.write("AIDLC Athena adapter requires an existing project directory\n");
    return 1;
  }
  const normalized = normalizeAthenaHookInput(input, projectDir);
  if (normalized.kind === "ignore") return 0;
  if (normalized.kind === "reject") {
    process.stderr.write(`AIDLC Athena adapter rejected hook input: ${normalized.reason}\n`);
    return 1;
  }
  if (target !== normalized.target) {
    process.stderr.write("AIDLC Athena adapter target does not match hook event\n");
    return 1;
  }
  return runCore(normalized.target, normalized.input, projectDir);
}

if (import.meta.main) {
  process.exit(await run(process.argv[2] ?? "", await Bun.stdin.text(), process.argv.slice(3)));
}
