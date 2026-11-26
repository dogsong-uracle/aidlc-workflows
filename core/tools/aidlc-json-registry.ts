import { createHash } from "node:crypto";

export type JsonRegistrySpec = {
  key: string;
  matcherKey: string;
  handlersKey: string;
  identityKey: string;
};

export type JsonRegistryOwnership = { entries: Record<string, string> };
export type JsonRegistryResult =
  | { conflict: string }
  | { text: string; ownership: JsonRegistryOwnership };

type JsonNode = {
  kind: "object" | "array" | "value";
  start: number;
  end: number;
  members: Array<{ key: string; start: number; valueStart: number; valueEnd: number; end: number; node: JsonNode }>;
  items: Array<{ start: number; valueStart: number; valueEnd: number; end: number; node: JsonNode }>;
};
type Row = { key: string; value: Record<string, unknown>; hash: string; event: string; matcher: unknown };

const BOM = "\uFEFF";

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function hash(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonical(value)).digest("hex")}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function jsonRegistrySpecIsSafe(spec: unknown): spec is JsonRegistrySpec {
  if (!isRecord(spec)) return false;
  const fields = ["key", "matcherKey", "handlersKey", "identityKey"];
  return Object.keys(spec).length === fields.length &&
    fields.every((field) => typeof spec[field] === "string" && (spec[field] as string).length > 0);
}

export function registryOwnershipKey(event: string, matcher: unknown, identity: string): string {
  return JSON.stringify([event, matcher ?? null, identity]);
}

function rows(value: unknown, spec: JsonRegistrySpec): Row[] | null {
  if (!isRecord(value) || !isRecord(value[spec.key])) return null;
  const registry = value[spec.key] as Record<string, unknown>;
  const output: Row[] = [];
  const seen = new Set<string>();
  for (const [event, rawGroups] of Object.entries(registry)) {
    if (!Array.isArray(rawGroups)) return null;
    for (const group of rawGroups) {
      if (!isRecord(group) || !Array.isArray(group[spec.handlersKey])) return null;
      const matcher = group[spec.matcherKey] ?? null;
      for (const handler of group[spec.handlersKey] as unknown[]) {
        if (!isRecord(handler) || typeof handler[spec.identityKey] !== "string" || !handler[spec.identityKey]) return null;
        const key = registryOwnershipKey(event, matcher, handler[spec.identityKey] as string);
        if (seen.has(key)) return null;
        seen.add(key);
        output.push({ key, value: handler, hash: hash(handler), event, matcher });
      }
    }
  }
  return output;
}

function triviaEnd(text: string, start: number): number {
  let at = start;
  while (at < text.length) {
    if (/[\s\uFEFF]/.test(text[at])) at++;
    else if (text.startsWith("//", at)) {
      while (at < text.length && text[at] !== "\n") at++;
    } else if (text.startsWith("/*", at)) {
      const end = text.indexOf("*/", at + 2);
      if (end < 0) return -1;
      at = end + 2;
    } else break;
  }
  return at;
}

function stringEnd(text: string, start: number): number {
  for (let at = start + 1; at < text.length; at++) {
    if (text[at] === "\\") at++;
    else if (text[at] === '"') return at + 1;
    else if (text[at] === "\n") return -1;
  }
  return -1;
}

function valueEnd(text: string, start: number): number {
  if (text[start] === '"') return stringEnd(text, start);
  if (text[start] === "{" || text[start] === "[") {
    const stack = [text[start] === "{" ? "}" : "]"];
    let at = start + 1;
    while (at < text.length) {
      if (text[at] === '"') {
        at = stringEnd(text, at);
        if (at < 0) return -1;
        continue;
      }
      if (text.startsWith("//", at) || text.startsWith("/*", at)) {
        at = triviaEnd(text, at);
        if (at < 0) return -1;
        continue;
      }
      if (text[at] === "{" || text[at] === "[") stack.push(text[at] === "{" ? "}" : "]");
      else if (text[at] === "}" || text[at] === "]") {
        if (stack.pop() !== text[at]) return -1;
        if (stack.length === 0) return at + 1;
      }
      at++;
    }
    return -1;
  }
  let at = start;
  while (at < text.length && !/[\s,}\]]/.test(text[at])) at++;
  return at > start ? at : -1;
}

function parseNode(text: string, start: number): JsonNode | null {
  const first = text[start];
  if (first !== "{" && first !== "[") {
    const end = valueEnd(text, start);
    return end < 0 ? null : { kind: "value", start, end, members: [], items: [] };
  }
  const kind = first === "{" ? "object" : "array";
  const closing = kind === "object" ? "}" : "]";
  const node: JsonNode = { kind, start, end: -1, members: [], items: [] };
  let at = triviaEnd(text, start + 1);
  while (at >= 0 && at < text.length && text[at] !== closing) {
    const itemStart = at;
    let key = "";
    let valueStart = at;
    if (kind === "object") {
      if (text[at] !== '"') return null;
      const keyEnd = stringEnd(text, at);
      if (keyEnd < 0) return null;
      try {
        key = JSON.parse(text.slice(at, keyEnd)) as string;
      } catch {
        return null;
      }
      at = triviaEnd(text, keyEnd);
      if (at < 0 || text[at] !== ":") return null;
      valueStart = triviaEnd(text, at + 1);
      if (valueStart < 0) return null;
    }
    const child = parseNode(text, valueStart);
    if (!child) return null;
    at = triviaEnd(text, child.end);
    if (at < 0) return null;
    let end = child.end;
    if (text[at] === ",") {
      end = at + 1;
      at = triviaEnd(text, at + 1);
    } else if (text[at] !== closing) return null;
    if (kind === "object") node.members.push({ key, start: itemStart, valueStart, valueEnd: child.end, end, node: child });
    else node.items.push({ start: itemStart, valueStart, valueEnd: child.end, end, node: child });
  }
  if (at < 0 || text[at] !== closing) return null;
  node.end = at + 1;
  return node;
}

function tree(text: string): JsonNode | null {
  const start = triviaEnd(text, 0);
  if (start < 0 || start >= text.length) return null;
  const result = parseNode(text, start);
  return result && triviaEnd(text, result.end) === text.length ? result : null;
}

function nodeValue(text: string, node: JsonNode): unknown {
  try {
    return Bun.JSONC.parse(text.slice(node.start, node.end));
  } catch {
    return undefined;
  }
}

function layout(text: string, root: JsonNode): { eol: string; unit: string } {
  const first = root.members[0];
  const startLine = (position: number) => text.lastIndexOf("\n", position - 1) + 1;
  const indent = first ? /^[ \t]*/.exec(text.slice(startLine(first.start), first.start))?.[0] : "";
  return { eol: text.includes("\r\n") ? "\r\n" : "\n", unit: indent || "  " };
}

function lineStart(text: string, position: number): number {
  return text.lastIndexOf("\n", position - 1) + 1;
}

function onOwnLine(text: string, position: number): boolean {
  return text.slice(lineStart(text, position), position).trim() === "";
}

function inlineValue(text: string, node: JsonNode): boolean {
  return !text.slice(node.start, node.end).includes("\n");
}

function insertEntry(text: string, root: JsonNode, container: JsonNode, key: string | undefined, value: unknown): string {
  const entries = container.kind === "object" ? container.members : container.items;
  const close = container.end - 1;
  const fmt = layout(text, root);
  const inline = inlineValue(text, container) && (entries.length > 0 || container.kind === "array");
  const rendered = (indent: string) => `${key === undefined ? "" : `${JSON.stringify(key)}: `}${inline
    ? JSON.stringify(value)
    : JSON.stringify(value, null, fmt.unit).split("\n").join(`${fmt.eol}${indent}`)}`;
  if (inline) {
    if (entries.length === 0) return `${text.slice(0, container.start + 1)}${rendered("")}${text.slice(close)}`;
    const last = entries.at(-1) as (typeof entries)[number];
    return last.end !== last.valueEnd
      ? `${text.slice(0, last.end)} ${rendered("")}${text.slice(last.end)}`
      : `${text.slice(0, last.valueEnd)}, ${rendered("")}${text.slice(last.valueEnd)}`;
  }
  const outerIndent = /^[ \t]*/.exec(text.slice(lineStart(text, container.start), container.start))?.[0] ?? "";
  const first = entries[0];
  const indent = first && onOwnLine(text, first.start)
    ? /^[ \t]*/.exec(text.slice(lineStart(text, first.start), first.start))?.[0] ?? ""
    : `${outerIndent}${fmt.unit}`;
  const closeLine = lineStart(text, close);
  let result = closeLine > container.start && text.slice(closeLine, close).trim() === ""
    ? `${text.slice(0, closeLine)}${indent}${rendered(indent)}${fmt.eol}${text.slice(closeLine)}`
    : `${text.slice(0, close).trimEnd()}${fmt.eol}${indent}${rendered(indent)}${fmt.eol}${outerIndent}${text.slice(close)}`;
  const last = entries.at(-1) as (typeof entries)[number] | undefined;
  if (last && last.end === last.valueEnd) result = `${result.slice(0, last.valueEnd)},${result.slice(last.valueEnd)}`;
  return result;
}

function removeItem(text: string, items: Array<{ start: number; valueEnd: number; end: number }>, index: number): string {
  const item = items[index];
  const previous = items[index - 1];
  const following = items[index + 1];
  let after = item.end;
  while (text[after] === " " || text[after] === "\t") after++;
  const eol = text[after] === "\r" && text[after + 1] === "\n" ? 2 : text[after] === "\n" ? 1 : 0;
  if (onOwnLine(text, item.start) && eol) {
    let result = `${text.slice(0, lineStart(text, item.start))}${text.slice(after + eol)}`;
    if (!following && item.end === item.valueEnd && previous && previous.end !== previous.valueEnd) {
      result = `${result.slice(0, previous.end - 1)}${result.slice(previous.end)}`;
    }
    return result;
  }
  if (following) return `${text.slice(0, item.start)}${text.slice(following.start)}`;
  if (previous) return `${text.slice(0, previous.valueEnd)}${text.slice(item.end)}`;
  return `${text.slice(0, item.start)}${text.slice(item.end)}`;
}

function rootValue(text: string): { root: JsonNode; value: Record<string, unknown> } | null {
  const root = tree(text);
  const value = root ? nodeValue(text, root) : undefined;
  return root?.kind === "object" && isRecord(value) ? { root, value } : null;
}

function rowsInRoot(value: unknown, spec: JsonRegistrySpec, allowMissing = false): Row[] | null {
  if (!isRecord(value)) return null;
  if (value[spec.key] === undefined && allowMissing) return [];
  return rows(value, spec);
}

function locateHandler(root: JsonNode, text: string, spec: JsonRegistrySpec, row: Row): { array: JsonNode; index: number } | null {
  const registry = root.members.findLast((member) => member.key === spec.key)?.node;
  if (!registry || registry.kind !== "object") return null;
  const event = registry.members.findLast((member) => member.key === row.event)?.node;
  if (!event || event.kind !== "array") return null;
  for (const group of event.items) {
    const groupValue = nodeValue(text, group.node);
    if (!isRecord(groupValue) || canonical(groupValue[spec.matcherKey] ?? null) !== canonical(row.matcher ?? null)) continue;
    const handlers = group.node.members.findLast((member) => member.key === spec.handlersKey)?.node;
    if (!handlers || handlers.kind !== "array") continue;
    const index = handlers.items.findIndex((item) => {
      const handler = nodeValue(text, item.node);
      return isRecord(handler) && typeof handler[spec.identityKey] === "string" &&
        registryOwnershipKey(row.event, row.matcher, handler[spec.identityKey] as string) === row.key;
    });
    if (index >= 0) return { array: handlers, index };
  }
  return null;
}

function addHandler(text: string, spec: JsonRegistrySpec, row: Row): string | null {
  let parsed = rootValue(text);
  if (!parsed) return null;
  let root = parsed.root;
  let registry = root.members.findLast((member) => member.key === spec.key)?.node;
  if (!registry) {
    text = insertEntry(text, root, root, spec.key, {});
    parsed = rootValue(text);
    if (!parsed) return null;
    root = parsed.root;
    registry = root.members.findLast((member) => member.key === spec.key)?.node;
  }
  if (!registry || registry.kind !== "object") return null;
  let event = registry.members.findLast((member) => member.key === row.event)?.node;
  if (!event) {
    text = insertEntry(text, root, registry, row.event, []);
    parsed = rootValue(text);
    if (!parsed) return null;
    root = parsed.root;
    registry = root.members.findLast((member) => member.key === spec.key)?.node as JsonNode;
    event = registry.members.findLast((member) => member.key === row.event)?.node;
  }
  if (!registry || registry.kind !== "object" || !event || event.kind !== "array") return null;
  for (const group of event.items) {
    const groupValue = nodeValue(text, group.node);
    if (!isRecord(groupValue) || canonical(groupValue[spec.matcherKey] ?? null) !== canonical(row.matcher ?? null)) continue;
    const handlers = group.node.members.findLast((member) => member.key === spec.handlersKey)?.node;
    if (!handlers || handlers.kind !== "array") return null;
    return insertEntry(text, root, handlers, undefined, row.value);
  }
  return insertEntry(text, root, event, undefined, {
    [spec.matcherKey]: row.matcher,
    [spec.handlersKey]: [row.value],
  });
}

function replaceHandler(text: string, spec: JsonRegistrySpec, row: Row): string | null {
  const parsed = rootValue(text);
  if (!parsed) return null;
  const located = locateHandler(parsed.root, text, spec, row);
  if (!located) return null;
  const node = located.array.items[located.index].node;
  const indent = /^[ \t]*/.exec(text.slice(lineStart(text, node.start), node.start))?.[0] ?? "";
  const replacement = JSON.stringify(row.value, null, 2).split("\n").join(`\n${indent}`);
  return `${text.slice(0, node.start)}${replacement}${text.slice(node.end)}`;
}

function removeHandler(text: string, spec: JsonRegistrySpec, row: Row): string | null {
  const parsed = rootValue(text);
  if (!parsed) return null;
  const located = locateHandler(parsed.root, text, spec, row);
  return located ? removeItem(text, located.array.items, located.index) : null;
}

export function mergeJsonRegistry(current: string, shippedText: string, spec: JsonRegistrySpec, ownership: JsonRegistryOwnership): JsonRegistryResult {
  if (!jsonRegistrySpecIsSafe(spec) || !isRecord(ownership) || !isRecord(ownership.entries)) {
    return { conflict: "invalid JSON registry contract or ownership record" };
  }
  let shipped: unknown;
  try {
    shipped = Bun.JSONC.parse(shippedText.replace(/^\uFEFF/, ""));
  } catch {
    return { conflict: "shipped registry fragment is malformed" };
  }
  const desired = rowsInRoot(shipped, spec);
  if (!desired) return { conflict: "shipped registry fragment has an invalid shape or duplicate identity" };
  const bom = current.startsWith(BOM) ? BOM : "";
  let text = current.trim() ? current : `${bom}{}\n`;
  const parsed = rootValue(text);
  if (!parsed) return { conflict: "project registry is malformed or has an invalid shape" };
  const present = rowsInRoot(parsed.value, spec, true);
  if (!present) return { conflict: "project registry has an invalid shape or duplicate identity" };
  const presentByKey = new Map(present.map((row) => [row.key, row]));
  const desiredByKey = new Map(desired.map((row) => [row.key, row]));
  const nextEntries: Record<string, string> = {};
  for (const row of desired) {
    const existing = presentByKey.get(row.key);
    const priorHash = ownership.entries[row.key];
    if (existing && priorHash && existing.hash !== priorHash) {
      return { conflict: "a recorded project registry handler was locally modified" };
    }
    if (existing && priorHash && existing.hash !== priorHash) {
      return { conflict: "a recorded project registry handler was locally modified" };
    }
    if (!existing) {
      const nextText = addHandler(text, spec, row);
      if (!nextText) return { conflict: "could not safely add the shipped registry handler" };
      text = nextText;
      presentByKey.set(row.key, row);
      nextEntries[row.key] = row.hash;
      continue;
    }
    if (!priorHash) {
      if (existing.hash === row.hash) continue;
      return { conflict: "an unowned project registry handler has the same identity" };
    }
    if (existing.hash !== priorHash) return { conflict: "a recorded project registry handler was locally modified" };
    if (existing.hash !== row.hash) {
      const nextText = replaceHandler(text, spec, row);
      if (!nextText) return { conflict: "could not safely update the recorded registry handler" };
      text = nextText;
      presentByKey.set(row.key, row);
    }
    nextEntries[row.key] = row.hash;
  }
  for (const [key, priorHash] of Object.entries(ownership.entries)) {
    if (desiredByKey.has(key)) continue;
    const existing = presentByKey.get(key);
    if (!existing) continue;
    if (existing.hash !== priorHash) return { conflict: "a retired project registry handler was locally modified" };
    const nextText = removeHandler(text, spec, existing);
    if (!nextText) return { conflict: "could not safely remove a retired registry handler" };
    text = nextText;
  }
  return { text, ownership: { entries: nextEntries } };
}
