// covers: file:harness/athenacode/manifest.ts, file:harness/athenacode/hooks/aidlc-athenacode-adapter.ts
// covers: function:resolveAction, file:core/tools/aidlc-json-registry.ts
//
// Athena Code 1.0.15 is wired only to the event and field contracts confirmed
// from its installed bundle. No test treats an unmeasured UI block as proof of
// runtime enforcement, and task_id is never upgraded into a session identity.

import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveAction } from "../../core/tools/aidlc.ts";
import { normalizeAthenaHookInput } from "../../harness/athenacode/hooks/aidlc-athenacode-adapter.ts";
import { harnessByName } from "../harness/harness-matrix.ts";

const ROOT = join(import.meta.dir, "..", "..");
const INIT = join(ROOT, "core", "tools", "aidlc-init.ts");
const ATHENA_DIST = join(ROOT, "dist", "athenacode");
const PROJECT = "/workspace/athena-project";
const temporary: string[] = [];

afterAll(() => {
  for (const path of temporary) rmSync(path, { recursive: true, force: true });
});

function temp(prefix: string): string {
  const path = mkdtempSync(join(tmpdir(), prefix));
  temporary.push(path);
  return path;
}

function projectionSnapshot(root: string): string[] {
  const rows: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(path);
      } else {
        const digest = createHash("sha256").update(readFileSync(path)).digest("hex");
        rows.push(`${path.slice(root.length + 1)} ${digest}`);
      }
    }
  };
  walk(root);
  return rows.sort();
}

describe("Athena Code authored harness contract", () => {
  test("the harness matrix describes Athena without requiring an OpenCode project sample", () => {
    const { capabilities, manifest } = harnessByName("athenacode");

    expect(capabilities.harnessDir).toBe(".athena");
    expect(capabilities.skillsRoot).toBe(".athena/skills");
    expect(capabilities.rootFiles).not.toContain(".gitignore");
    expect(capabilities.rootFiles).toContain(".athenamodes");
    expect(manifest.tierFlavor).toBe("athenacode");
    expect(manifest.orchestratorSkillPath).toBe(".athena/skills/aidlc/SKILL.md");
    expect(manifest.rootIntegrations.map(({ path }) => path)).toContain(".athenamodes");
    expect(manifest.rootIntegrations.map(({ path }) => path)).not.toContain(".athena/hooks.json");
    expect(manifest.harnessFiles).toContainEqual({
      src: "hooks/hooks.json",
      dst: "hooks/hooks.json",
    });
    expect(manifest.harnessFiles.some(({ dst }) => dst === "settings/custom_modes.yaml")).toBe(false);
  });

  test("Athena is declared to have no always-included native memory surface", () => {
    const { capabilities, manifest } = harnessByName("athenacode");

    expect(capabilities.memoryInclude).toBe("athena-no-native-include");
    expect(manifest.harnessFiles.some(({ dst }) => /steering|rules\/aidlc/.test(dst))).toBe(false);
  });

  test("the authored mode roster contains the conductor and each real core persona exactly once", () => {
    const modes = JSON.parse(readFileSync(join(ROOT, "harness", "athenacode", "athenamodes"), "utf8")) as {
      customModes: Array<{ slug: string }>;
    };
    const coreAgentSlugs = [
      "aidlc-architect", "aidlc-architecture-reviewer", "aidlc-aws-platform", "aidlc-compliance",
      "aidlc-composer", "aidlc-delivery", "aidlc-design", "aidlc-developer", "aidlc-devsecops",
      "aidlc-operations", "aidlc-pipeline-deploy", "aidlc-product", "aidlc-product-lead", "aidlc-quality",
    ];
    const slugs = modes.customModes.map(({ slug }) => slug);

    expect(slugs).toHaveLength(coreAgentSlugs.length + 1);
    expect(slugs).toContain("aidlc");
    expect([...slugs].sort()).toEqual(["aidlc", ...coreAgentSlugs].sort());
  });

  test("the unverified hook registry stays out of root integrations", () => {
    const manifest = harnessByName("athenacode").manifest;
    expect(manifest.rootIntegrations.map(({ path }) => path)).not.toContain(".athena/hooks/hooks.json");
  });

  test("Athena mode file and slash command source are packaged as authored surfaces", () => {
    const { manifest } = harnessByName("athenacode");

    expect(manifest.harnessFiles).toContainEqual({
      src: "athenamodes",
      dst: ".athenamodes",
      projectRoot: true,
    });
    expect(manifest.harnessFiles).toContainEqual({
      src: "commands/aidlc.md",
      dst: "commands/aidlc.md",
    });
    expect(manifest.harnessFiles.some(({ dst }) => dst === "settings/custom_modes.yaml")).toBe(false);
    expect(manifest.emit).toBeNull();
  });

  test("Athena question guidance uses its numbered-prose renderer, not a host question tool", () => {
    const skillDir = join(ROOT, "harness", "athenacode", "skills", "aidlc");
    const skill = readFileSync(join(skillDir, "SKILL.md"), "utf8");
    const composer = readFileSync(join(skillDir, "composer.md"), "utf8");
    const renderer = readFileSync(join(skillDir, "question-rendering.md"), "utf8");

    expect(skill).not.toContain("AskUserQuestion");
    expect(skill).toContain("numbered-prose convention in `question-rendering.md`");
    expect(composer).not.toContain("AskUserQuestion");
    expect(composer).not.toContain("same question tool");
    expect(composer).toContain("numbered-prose rendering in `question-rendering.md`");
    expect(renderer).toContain("numbered prose options in chat");
  });

  test("the engine dispatcher resolves only the Athena adapter file for its route", () => {
    const action = resolveAction(["engine", "adapter", "athenacode", "session-start"]);

    expect(action).toMatchObject({
      type: "adapter",
      harness: "athenacode",
      target: "session-start",
      extraArgs: [],
    });
    if (action.type === "adapter") {
      expect(action.path.endsWith("aidlc-athenacode-adapter.ts")).toBe(true);
    }
  });

  test("the source manifest and native entry surfaces exist without claiming UI verification", () => {
    const manifestPath = join(ROOT, "harness", "athenacode", "manifest.ts");
    const adapterPath = join(ROOT, "harness", "athenacode", "hooks", "aidlc-athenacode-adapter.ts");
    const skillPath = join(ROOT, "harness", "athenacode", "skills", "aidlc", "SKILL.md");
    const fillsPath = join(ROOT, "harness", "athenacode", "onboarding.fills.ts");

    expect(existsSync(manifestPath)).toBe(true);
    expect(existsSync(adapterPath)).toBe(true);
    expect(existsSync(skillPath)).toBe(true);
    expect(existsSync(fillsPath)).toBe(true);

    const manifest = readFileSync(manifestPath, "utf8");
    expect(manifest).toContain('name: "athenacode"');
    expect(manifest).toContain('harnessDir: ".athena"');
  });
});

describe("Athena hook payload normalization", () => {
  test("normalizes only SessionStart without inventing session or human-turn fields", () => {
    const result = normalizeAthenaHookInput(JSON.stringify({
      task_id: "task-001",
      cwd: PROJECT,
      hook_event_name: "SessionStart",
      source: "resume",
      model: "model-id",
    }), PROJECT);

    expect(result).toEqual({
      kind: "dispatch",
      target: "session-start",
      input: {
        hook_event_name: "SessionStart",
        cwd: PROJECT,
        source: "resume",
      },
    });
    if (result.kind === "dispatch") {
      expect(result.input).not.toHaveProperty("session_id");
      expect(result.input).not.toHaveProperty("prompt");
    }
  });

  test("normalizes Stop with only the confirmed control fields", () => {
    const result = normalizeAthenaHookInput(JSON.stringify({
      task_id: "task-004",
      cwd: `${PROJECT}/nested/..`,
      hook_event_name: "Stop",
      stop_hook_active: true,
      last_assistant_message: "Response text is forwarded but not logged by the adapter.",
      session_id: "unconfirmed-session-field",
    }), PROJECT);

    expect(result).toEqual({
      kind: "dispatch",
      target: "continue-workflow",
      input: {
        hook_event_name: "Stop",
        cwd: PROJECT,
        stop_hook_active: true,
        last_assistant_message: "Response text is forwarded but not logged by the adapter.",
      },
    });
    if (result.kind === "dispatch") expect(result.input).not.toHaveProperty("session_id");
  });

  test("ignores Athena's inert UserPromptSubmit without recording a person or approval", () => {
    const result = normalizeAthenaHookInput(JSON.stringify({
      task_id: "task-002",
      cwd: PROJECT,
      hook_event_name: "UserPromptSubmit",
      prompt: "approve",
    }), PROJECT);

    expect(result).toEqual({ kind: "ignore" });
  });

  test("rejects missing or invalid common fields and malformed JSON values", () => {
    const valid = { task_id: "task-005", cwd: PROJECT, hook_event_name: "SessionStart", source: "startup" };
    expect(normalizeAthenaHookInput("{", PROJECT).kind).toBe("reject");
    expect(normalizeAthenaHookInput("null", PROJECT).kind).toBe("reject");
    expect(normalizeAthenaHookInput("[]", PROJECT).kind).toBe("reject");
    expect(normalizeAthenaHookInput(JSON.stringify({ ...valid, task_id: undefined }), PROJECT).kind).toBe("reject");
    expect(normalizeAthenaHookInput(JSON.stringify({ ...valid, cwd: undefined }), PROJECT).kind).toBe("reject");
    expect(normalizeAthenaHookInput(JSON.stringify({ ...valid, hook_event_name: undefined }), PROJECT).kind).toBe("reject");
    expect(normalizeAthenaHookInput(JSON.stringify({ ...valid, task_id: "../outside" }), PROJECT).kind).toBe("reject");
    expect(normalizeAthenaHookInput(JSON.stringify({ ...valid, task_id: "" }), PROJECT).kind).toBe("reject");
  });

  test("rejects relative paths, traversal, and sibling-prefix escapes from the project", () => {
    const valid = { task_id: "task-006", hook_event_name: "SessionStart", source: "startup" };
    for (const cwd of ["relative/project", `${PROJECT}-sibling`, `${PROJECT}/../../outside`]) {
      expect(normalizeAthenaHookInput(JSON.stringify({ ...valid, cwd }), PROJECT).kind).toBe("reject");
    }
  });

  test("rejects unsupported SessionStart sources and malformed Stop control fields", () => {
    const base = { task_id: "task-007", cwd: PROJECT };
    expect(normalizeAthenaHookInput(JSON.stringify({ ...base, hook_event_name: "SessionStart" }), PROJECT).kind).toBe("reject");
    expect(normalizeAthenaHookInput(JSON.stringify({ ...base, hook_event_name: "SessionStart", source: "clear" }), PROJECT).kind).toBe("reject");
    expect(normalizeAthenaHookInput(JSON.stringify({ ...base, hook_event_name: "Stop" }), PROJECT).kind).toBe("reject");
    expect(normalizeAthenaHookInput(JSON.stringify({ ...base, hook_event_name: "Stop", stop_hook_active: "true" }), PROJECT).kind).toBe("reject");
    expect(normalizeAthenaHookInput(JSON.stringify({
      ...base,
      hook_event_name: "Stop",
      stop_hook_active: false,
      last_assistant_message: { text: "not a string" },
    }), PROJECT).kind).toBe("reject");
  });

  test("rejects oversized payloads and leaves unconfirmed events unconnected", () => {
    expect(normalizeAthenaHookInput(" ".repeat(128 * 1024 + 1), PROJECT).kind).toBe("reject");
    expect(normalizeAthenaHookInput(JSON.stringify({
      task_id: "task-008",
      cwd: PROJECT,
      hook_event_name: "PreToolUse",
      tool_name: "execute_bash",
      tool_input: { command: "echo do not guess mappings" },
    }), PROJECT)).toEqual({ kind: "ignore" });
  });
});

describe("Athena first project config projection", () => {
  test("creates a missing .athena tree and keeps it stable on a repeated config", () => {
    expect(existsSync(ATHENA_DIST), "build dist/athenacode before this integration test").toBe(true);
    const project = temp("aidlc-t355-athena-project-");
    const machine = temp("aidlc-t355-athena-machine-");
    mkdirSync(join(project, ".git"));
    const env: NodeJS.ProcessEnv = { ...process.env };
    for (const key of Object.keys(env)) {
      if (/^(?:AIDLC|CLAUDE|KIRO|CODEX|CURSOR|OPENCODE|COPILOT)_/i.test(key)) delete env[key];
    }
    Object.assign(env, {
      HOME: join(machine, "home"),
      USERPROFILE: join(machine, "home"),
      XDG_CONFIG_HOME: join(machine, "home", ".config"),
      AIDLC_INSTALL_ROOT: join(machine, "share", "aidlc"),
      AIDLC_BIN_DIR: join(machine, "bin"),
      AIDLC_RUNTIME_ROOT: join(ROOT, "dist-release"),
    });
    const args = [
      INIT,
      "config",
      "--project-dir",
      project,
      "--from",
      ATHENA_DIST,
      "--harness",
      "athenacode",
      "--mcp",
      "none",
      "--yes",
    ];
    const configure = () => spawnSync(process.execPath, args, {
      cwd: project,
      env,
      encoding: "utf8",
      timeout: 60_000,
    });

    const first = configure();
    expect(first.error, `${first.stdout ?? ""}${first.stderr ?? ""}`).toBeUndefined();
    expect(first.status, `${first.stdout ?? ""}${first.stderr ?? ""}`).toBe(0);
    const harnessRoot = join(project, ".athena");
    expect(existsSync(join(harnessRoot, "tools", "data", "harness.json"))).toBe(true);
    expect(existsSync(join(harnessRoot, "hooks", "aidlc-athenacode-adapter.ts"))).toBe(true);
    expect(existsSync(join(harnessRoot, "skills", "aidlc", "SKILL.md"))).toBe(true);
    expect(existsSync(join(project, ".athenamodes"))).toBe(true);
    const beforeRefresh = projectionSnapshot(harnessRoot);

    const refreshed = configure();
    expect(refreshed.error, `${refreshed.stdout ?? ""}${refreshed.stderr ?? ""}`).toBeUndefined();
    expect(refreshed.status, `${refreshed.stdout ?? ""}${refreshed.stderr ?? ""}`).toBe(0);
    expect(projectionSnapshot(harnessRoot)).toEqual(beforeRefresh);
  });
});
