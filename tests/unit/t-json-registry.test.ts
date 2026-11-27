// covers: file:core/tools/aidlc-json-registry.ts
//
// The JSON registry merge helper owns only manifest-identified registrations. It
// preserves the project's other events, matchers, handlers, and metadata, and
// follows/removes its own registrations only while their recorded values hold.

import { describe, expect, test } from "bun:test";
import {
  mergeJsonRegistry,
  registryOwnershipKey,
  type JsonRegistryOwnership,
  type JsonRegistrySpec,
} from "../../core/tools/aidlc-json-registry.ts";

const SPEC: JsonRegistrySpec = {
  key: "hooks",
  matcherKey: "matcher",
  handlersKey: "hooks",
  identityKey: "command",
};

const USER_HOOK = { type: "command", command: "team-hook", env: { TEAM: "kept" } };
const AIDLC_V1 = { type: "command", command: "aidlc engine hook session-start", timeout: 30 };
const AIDLC_V2 = { type: "command", command: "aidlc engine hook session-start", timeout: 45 };
const SHIPPED_V1 = JSON.stringify({
  hooks: {
    SessionStart: [{ matcher: "startup|resume", hooks: [AIDLC_V1] }],
  },
});
const SHIPPED_V2 = JSON.stringify({
  hooks: {
    SessionStart: [{ matcher: "startup|resume", hooks: [AIDLC_V2] }],
  },
});

type ParsedHookRegistry = {
  hooks: Record<string, Array<{ [key: string]: unknown; hooks: unknown[] }>> & {
    SessionStart: Array<{ [key: string]: unknown; hooks: unknown[] }>;
  };
  [key: string]: unknown;
};

function value(text: string): ParsedHookRegistry {
  return Bun.JSONC.parse(text.replace(/^\uFEFF/, "")) as ParsedHookRegistry;
}

function registrations(text: string): unknown[] {
  const parsed = value(text);
  return parsed.hooks.SessionStart.flatMap((group) => group.hooks);
}

function merge(
  current: string,
  shipped = SHIPPED_V1,
  ownership: JsonRegistryOwnership = { entries: {} },
) {
  return mergeJsonRegistry(current, shipped, SPEC, ownership);
}

describe("JSON registry root integration ownership", () => {
  test("creates a missing registry file from only the shipped fragment and records its registration", () => {
    const result = merge("");
    expect("conflict" in result).toBe(false);
    if ("conflict" in result) return;
    expect(value(result.text)).toEqual(value(SHIPPED_V1));
    const key = registryOwnershipKey("SessionStart", "startup|resume", AIDLC_V1.command);
    expect(result.ownership.entries[key]).toBeDefined();
  });

  test("adds its registration without replacing user events, groups, handlers, or extension fields", () => {
    const current = `{
  // Project hook configuration belongs to the team.
  "hooks": {
    "PreToolUse": [{ "matcher": "Write", "hooks": [${JSON.stringify(USER_HOOK)}], "teamGroup": true }],
    "SessionStart": [
      { "matcher": "other matcher", "hooks": [${JSON.stringify(USER_HOOK)}], "teamGroup": "same event" },
      { "matcher": "startup|resume", "hooks": [${JSON.stringify(USER_HOOK)}], "teamGroup": "same matcher" }
    ]
  },
  "teamSetting": { "keep": true }
}\n`;
    const result = merge(current);
    expect("conflict" in result).toBe(false);
    if ("conflict" in result) return;
    const parsed = value(result.text);
    expect(parsed.teamSetting).toEqual({ keep: true });
    expect(parsed.hooks.PreToolUse).toEqual(value(current).hooks.PreToolUse);
    expect(parsed.hooks.SessionStart[0].matcher).toBe("other matcher");
    expect(parsed.hooks.SessionStart[0].teamGroup).toBe("same event");
    expect(parsed.hooks.SessionStart[0].hooks).toEqual([USER_HOOK]);
    expect(parsed.hooks.SessionStart[1].matcher).toBe("startup|resume");
    expect(parsed.hooks.SessionStart[1].teamGroup).toBe("same matcher");
    expect(parsed.hooks.SessionStart[1].hooks).toContainEqual(USER_HOOK);
    expect(registrations(result.text)).toContainEqual(AIDLC_V1);
    expect(result.text).toContain("// Project hook configuration belongs to the team.");
  });

  test("is byte-idempotent on a second merge using the recorded ownership", () => {
    const first = merge('{"hooks":{}}');
    expect("conflict" in first).toBe(false);
    if ("conflict" in first) return;
    const second = merge(first.text, SHIPPED_V1, first.ownership);
    expect("conflict" in second).toBe(false);
    if ("conflict" in second) return;
    expect(second.text).toBe(first.text);
    expect(second.ownership).toEqual(first.ownership);
  });

  test("updates only an unchanged recorded registration when the shipped handler changes", () => {
    const first = merge(`{"hooks":{"SessionStart":[{"matcher":"startup|resume","hooks":[${JSON.stringify(USER_HOOK)}]}]}}`);
    expect("conflict" in first).toBe(false);
    if ("conflict" in first) return;
    const second = merge(first.text, SHIPPED_V2, first.ownership);
    expect("conflict" in second).toBe(false);
    if ("conflict" in second) return;
    expect(registrations(second.text)).toContainEqual(AIDLC_V2);
    expect(registrations(second.text)).toContainEqual(USER_HOOK);
    expect(registrations(second.text)).not.toContainEqual(AIDLC_V1);
  });

  test("does not overwrite a recorded registration changed by the project", () => {
    const first = merge('{"hooks":{}}');
    expect("conflict" in first).toBe(false);
    if ("conflict" in first) return;
    const edited = first.text.replace(/("timeout"\s*:\s*)30/, (_match, prefix: string) => `${prefix}99`);
    const next = merge(edited, SHIPPED_V2, first.ownership);
    expect("conflict" in next).toBe(true);
    if ("conflict" in next) expect(next.conflict).toMatch(/modified|changed|ownership/i);
    expect(value(edited).hooks.SessionStart[0].hooks[0]).toEqual({ ...AIDLC_V1, timeout: 99 });
  });

  test("does not adopt an identical-looking pre-existing project registration without a baseline", () => {
    const current = `{"hooks":{"SessionStart":[{"matcher":"startup|resume","hooks":[${JSON.stringify(AIDLC_V1)}]}]}}`;
    const result = merge(current);
    expect("conflict" in result).toBe(false);
    if ("conflict" in result) return;
    expect(registrations(result.text)).toEqual([AIDLC_V1]);
    expect(result.ownership.entries).toEqual({});
  });

  test("conflicts instead of duplicating an unowned registration with the same identity but different value", () => {
    const existing = { ...AIDLC_V1, timeout: 999 };
    const current = `{"hooks":{"SessionStart":[{"matcher":"startup|resume","hooks":[${JSON.stringify(existing)}]}]}}`;
    const result = merge(current);
    expect("conflict" in result).toBe(true);
    expect(current).toContain('"timeout":999');
  });

  test("rejects ambiguous duplicate shipped identities without changing the input", () => {
    const shipped = JSON.stringify({
      hooks: {
        SessionStart: [
          { matcher: "startup|resume", hooks: [AIDLC_V1] },
          { matcher: "startup|resume", hooks: [{ ...AIDLC_V1, timeout: 31 }] },
        ],
      },
    });
    const current = '{"hooks":{}}';
    const result = merge(current, shipped);
    expect("conflict" in result).toBe(true);
    expect(current).toBe('{"hooks":{}}');
  });

  test("preserves BOM, CRLF, comments, and unrelated bytes while adding a handler", () => {
    const current = '\uFEFF{\r\n  // keep this comment\r\n  "hooks": { "PreToolUse": [] },\r\n  "team": 1\r\n}\r\n';
    const result = merge(current);
    expect("conflict" in result).toBe(false);
    if ("conflict" in result) return;
    expect(result.text.startsWith("\uFEFF")).toBe(true);
    expect(result.text).toContain("\r\n");
    expect(result.text).toContain("// keep this comment");
    expect(value(result.text).team).toBe(1);
    expect(value(result.text).hooks.PreToolUse).toEqual([]);
    expect(registrations(result.text)).toContainEqual(AIDLC_V1);
  });

  test("treats malformed JSONC and malformed registry shapes as conflicts", () => {
    expect("conflict" in merge('{"hooks":')).toBe(true);
    expect("conflict" in merge('{"hooks": {"SessionStart": {}}}')).toBe(true);
    expect("conflict" in merge('{"hooks": {"SessionStart": [{"hooks": "not-array"}]}}')).toBe(true);
  });

  test("retires only the unchanged recorded handler and keeps neighboring project handlers", () => {
    const current = `{"hooks":{"SessionStart":[{"matcher":"startup|resume","hooks":[${JSON.stringify(USER_HOOK)}]}]}}`;
    const first = merge(current);
    expect("conflict" in first).toBe(false);
    if ("conflict" in first) return;
    const retired = merge(first.text, '{"hooks":{}}', first.ownership);
    expect("conflict" in retired).toBe(false);
    if ("conflict" in retired) return;
    expect(registrations(retired.text)).toContainEqual(USER_HOOK);
    expect(registrations(retired.text)).not.toContainEqual(AIDLC_V1);
    expect(retired.ownership.entries).toEqual({});
  });

  test("retains a project-modified registration when the release retires it", () => {
    const first = merge('{"hooks":{}}');
    expect("conflict" in first).toBe(false);
    if ("conflict" in first) return;
    const edited = first.text.replace(/("timeout"\s*:\s*)30/, (_match, prefix: string) => `${prefix}77`);
    const retired = merge(edited, '{"hooks":{}}', first.ownership);
    expect("conflict" in retired).toBe(true);
    expect(value(edited).hooks.SessionStart[0].hooks[0]).toEqual({ ...AIDLC_V1, timeout: 77 });
  });

});
