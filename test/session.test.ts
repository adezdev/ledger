import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EvidenceLog } from "../src/domain/evidence.ts";
import { extractSessionInsights, testSummaryOf } from "../src/session/extract.ts";
import { parseJsonlSession, parseJsonSession, parseSession, parseTextSession, SessionInputError } from "../src/session/formats.ts";
import { loadSession, sessionFormatFor } from "../src/session/load.ts";

describe("JSON sessions", () => {
  test("normalizes common message shapes and keeps source identifiers", () => {
    const source = parseJsonSession(
      "chat.json",
      JSON.stringify({
        title: "Session",
        messages: [
          { id: "m1", role: "user", timestamp: "2024-05-01T10:00:00Z", content: "Please add caching." },
          { id: "m2", author: { role: "assistant" }, created_at: 1714557660, content: [{ type: "text", text: "I decided to use an LRU cache instead of a plain map." }] },
          { uuid: "m3", type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", name: "Bash", input: { command: "bun test" } }] } },
          { id: "m4", type: "user", message: { role: "user", content: [{ type: "tool_result", content: " 12 pass\n 0 fail\n" }] } },
          { id: "m5", role: "assistant", content: [{ type: "thinking", thinking: "private reasoning" }, { type: "text", text: "Done." }] },
          { unexpected: { deeply: ["nested"] } },
          42,
        ],
      }),
    );
    expect(source.format).toBe("json");
    const byId = new Map(source.events.map((event) => [event.id, event]));
    expect(byId.get("m1")).toMatchObject({ kind: "message", role: "user", timestamp: "2024-05-01T10:00:00.000Z", text: "Please add caching." });
    expect(byId.get("m2")).toMatchObject({ role: "assistant", timestamp: "2024-05-01T10:01:00.000Z" });
    expect(source.events.find((event) => event.kind === "command")).toMatchObject({ command: "bun test", tool: "Bash", role: "assistant" });
    expect(source.events.find((event) => event.kind === "result")?.text).toContain("12 pass");
    expect(byId.get("m5")?.text).toBe("Done.");
    expect(source.events.some((event) => event.text.includes("private reasoning"))).toBe(false);
  });

  test("accepts a top-level array and command/output records", () => {
    const source = parseJsonSession("log.json", JSON.stringify([{ command: "cargo test", output: "test result: ok. 3 passed; 0 failed", exit_code: 0 }]));
    expect(source.events.map((event) => event.kind)).toEqual(["command", "result"]);
    expect(source.events[1]?.text).toContain("(exit code 0)");
  });

  test("rejects invalid JSON with a clear message", () => {
    expect(() => parseJsonSession("broken.json", "{ nope")).toThrow(SessionInputError);
    expect(() => parseJsonSession("broken.json", "{ nope")).toThrow(/broken\.json: invalid JSON/);
  });

  test("rejects files with no recognizable events", () => {
    expect(() => parseSession("empty.json", "[]", "json")).toThrow(/no recognizable session events/);
  });
});

describe("JSONL sessions", () => {
  test("parses one entry per line and uses line numbers as fallback identifiers", () => {
    const text = ['{"role":"user","content":"Start"}', "", '{"type":"assistant","message":{"role":"assistant","content":"We will use SQLite rather than Postgres for local runs."}}'].join("\n");
    const source = parseJsonlSession("s.jsonl", text);
    expect(source.events.map((event) => [event.id, event.role])).toEqual([
      ["line 1", "user"],
      ["line 3", "assistant"],
    ]);
    expect(source.warnings).toEqual([]);
  });

  test("skips malformed lines with a warning instead of failing", () => {
    const source = parseJsonlSession("s.jsonl", '{"content":"ok"}\n{broken\nnot json either\n{"content":"fine"}\n');
    expect(source.events).toHaveLength(2);
    expect(source.warnings).toEqual(["Skipped 2 lines that are not valid JSON (lines 2, 3)."]);
  });

  test("fails when no line is valid JSON", () => {
    expect(() => parseJsonlSession("s.jsonl", "a\nb\n")).toThrow(/no line contains valid JSON/);
  });
});

describe("text and Markdown sessions", () => {
  test("splits speaker turns and extracts shell commands with output", () => {
    const text = [
      "# Session notes",
      "",
      "**User:** Can we make the parser faster?",
      "",
      "**Assistant (2024-05-01 10:30):** The root cause was repeated string concatenation.",
      "I chose a single buffer instead of concatenating strings.",
      "",
      "```console",
      "$ bun test",
      " 40 pass",
      " 0 fail",
      "```",
      "",
      "## User",
      "Thanks!",
    ].join("\n");
    const source = parseTextSession("notes.md", text);
    const messages = source.events.filter((event) => event.kind === "message");
    expect(messages.map((event) => [event.id, event.role])).toEqual([
      ["line 1", undefined],
      ["line 3", "user"],
      ["line 5", "assistant"],
      ["line 14", "user"],
    ]);
    expect(messages[2]?.timestamp).toBe(new Date("2024-05-01T10:30").toISOString());
    expect(source.events.find((event) => event.kind === "command")).toMatchObject({ id: "line 9", command: "bun test", role: "assistant" });
    expect(source.events.find((event) => event.kind === "result")?.text).toBe("40 pass\n 0 fail");
  });

  test("falls back to paragraphs when there are no speaker markers", () => {
    const source = parseTextSession("log.txt", "First paragraph here.\n\nSecond paragraph\ncontinues.\n");
    expect(source.events.map((event) => [event.id, event.text])).toEqual([
      ["line 1", "First paragraph here."],
      ["line 3", "Second paragraph\ncontinues."],
    ]);
  });

  test("chooses formats by extension", () => {
    expect(sessionFormatFor("a.JSON")).toBe("json");
    expect(sessionFormatFor("a.ndjson")).toBe("jsonl");
    expect(sessionFormatFor("notes.md")).toBe("text");
    expect(sessionFormatFor("transcript")).toBe("text");
  });
});

describe("session evidence", () => {
  test("extracts decisions, commands, test output, and debugging notes as documented evidence", () => {
    const source = parseTextSession(
      "notes.md",
      [
        "User: Should we use SQLite or Postgres?",
        "",
        "Assistant: We decided to use SQLite instead of Postgres because the tool runs locally.",
        "The root cause was a missing index on the events table.",
        "",
        "```bash",
        "$ bun test",
        "12 pass",
        "0 fail",
        "$ bun test",
        "13 pass",
        "0 fail",
        "```",
      ].join("\n"),
    );
    const log = new EvidenceLog();
    const insights = extractSessionInsights([source], log);

    expect(insights.decisions).toHaveLength(1);
    expect(insights.decisions[0]).toMatchObject({ status: "documented", title: "We decided to use SQLite instead of Postgres because the tool runs locally." });
    const texts = insights.findings.map((finding) => finding.statement.text);
    expect(texts).toContain("Session `notes.md` records 2 commands, including `bun test` (2×).");
    expect(texts).toContain("Session `notes.md` records 2 test runs; the last recorded output reads “13 pass, 0 fail”.");
    expect(texts.some((text) => text.includes("missing index"))).toBe(true);
    expect(insights.findings.every((finding) => finding.statement.level === "documented")).toBe(true);
    expect(log.items.every((item) => item.source.kind === "session" && item.source.file === "notes.md")).toBe(true);
    expect(insights.summaries).toEqual([{ file: "notes.md", format: "text", events: source.events.length, commands: 2, warnings: [] }]);
  });

  test("recognizes test runner summaries", () => {
    expect(testSummaryOf("=== 12 passed, 1 skipped in 0.52s ===")).toBe("12 passed, 1 skipped");
    expect(testSummaryOf("test result: ok. 7 passed; 0 failed; 0 ignored")).toBe("7 passed, 0 failed");
    expect(testSummaryOf("Tests:       3 failed, 9 passed, 12 total")).toBe("3 failed, 9 passed, 12 total");
    expect(testSummaryOf("ok  \tgithub.com/me/pkg\t0.012s")).toBe("ok  \tgithub.com/me/pkg\t0.012s");
    expect(testSummaryOf("nothing to see")).toBeUndefined();
  });
});

describe("loading session files", () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "ledger-session-"));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("reads a file from a path containing spaces and records only its base name", async () => {
    const path = join(dir, "my notes", "session one.jsonl");
    await Bun.write(path, '{"role":"user","content":"hello there"}\n');
    const source = await loadSession(path);
    expect(source.file).toBe("session one.jsonl");
    expect(source.events).toHaveLength(1);
  });

  test("reports missing and binary files", async () => {
    await expect(loadSession(join(dir, "missing.md"))).rejects.toThrow(/Session file not found/);
    await expect(loadSession(dir)).rejects.toThrow(/not a file/);
    const binary = join(dir, "blob.md");
    await writeFile(binary, new Uint8Array([0x89, 0x50, 0x00, 0x01]));
    await expect(loadSession(binary)).rejects.toThrow(/looks binary/);
  });
});
