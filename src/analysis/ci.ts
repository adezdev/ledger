import { ciSystemOf } from "./paths.ts";

export type CommandPurpose = "test" | "typecheck" | "lint" | "format" | "build" | "coverage" | "benchmark" | "audit";

export interface CiCommand {
  command: string;
  line: number;
  purposes: CommandPurpose[];
  /** When the command runs a package script, the script's own command. */
  resolvedScript?: { name: string; command: string };
}

export interface CiConfiguration {
  path: string;
  system: string;
  commands: CiCommand[];
  /** Reusable actions referenced by GitHub Actions `uses:` steps. */
  actions: string[];
}

const PURPOSES: [CommandPurpose, RegExp][] = [
  ["test", /\b(bun test|deno test|(npm|pnpm|yarn|bun)( run)? test|vitest|jest|mocha|playwright test|cypress run|pytest|tox|nox|cargo (test|nextest)|go test|dotnet test|ctest|mvn (-\S+ )*(test|verify)|gradlew? (test|check)|rspec|phpunit|mix test|flutter test|swift test|make test)\b/],
  ["typecheck", /\b(tsc|vue-tsc|svelte-check|mypy|pyright|cargo check|flow check|deno check)\b/],
  ["lint", /\b(eslint|biome (check|lint|ci)|ruff check|ruff\b(?! format)|flake8|pylint|clippy|golangci-lint|go vet|rubocop|stylelint|shellcheck|hadolint|markdownlint|(npm|pnpm|yarn|bun)( run)? lint)\b/],
  ["format", /\b(prettier (--check|-c)|biome format|ruff format --check|black --check|cargo fmt|gofmt|rustfmt --check|dotnet format)\b/],
  ["build", /\b((npm|pnpm|yarn|bun)( run)? build|bun build|cargo build|go build|dotnet (build|publish)|cmake --build|mvn (-\S+ )*package|gradlew? (build|assemble)|docker build|vite build|next build|tsc (-b|--build)|make\b(?! test))/],
  ["coverage", /(--coverage|--cov\b|coverage run|cargo (tarpaulin|llvm-cov)|nyc\b|c8\b)/],
  ["benchmark", /\b(bench|benchmark|hyperfine)\b/],
  ["audit", /\b((npm|pnpm|yarn) audit|cargo (audit|deny)|pip-audit|safety check|govulncheck|trivy|snyk)\b/],
];

const SCRIPT_RUN = /^(?:npm|pnpm|yarn|bun)(?:\s+run)?\s+([A-Za-z0-9:_-]+)/;

export function classifyCommand(command: string, scripts: Readonly<Record<string, string>> = {}): Pick<CiCommand, "purposes" | "resolvedScript"> {
  const result: Pick<CiCommand, "purposes" | "resolvedScript"> = { purposes: [] };
  const scriptName = SCRIPT_RUN.exec(command.trim())?.[1];
  const scriptCommand = scriptName !== undefined ? scripts[scriptName] : undefined;
  if (scriptName !== undefined && scriptCommand !== undefined) result.resolvedScript = { name: scriptName, command: scriptCommand };
  const subject = expandScripts(command, scripts, new Set()).join("\n");
  for (const [purpose, pattern] of PURPOSES) {
    if (pattern.test(subject)) result.purposes.push(purpose);
  }
  return result;
}

/** Heredoc bodies are data fed to a command, not commands. */
const HEREDOC = /<<-?\s*(['"]?)([A-Za-z_]\w*)\1[^\n]*\n[\s\S]*?\n\s*\2\s*(?=\n|$)/g;

/** Splits a shell command line (or script) into its individual commands. */
export function commandSegments(command: string): string[] {
  return command
    .replace(HEREDOC, "")
    .split(/&&|\|\||;|\||\n/)
    .map((segment) => segment.trim())
    .filter((segment) => segment !== "");
}

/**
 * The command plus the scripts it runs, recursively, so a `check` script made
 * of `bun run typecheck && bun run lint` is recognized for both purposes.
 */
function expandScripts(command: string, scripts: Readonly<Record<string, string>>, seen: Set<string>): string[] {
  const expanded = [command];
  for (const segment of commandSegments(command)) {
    const name = SCRIPT_RUN.exec(segment)?.[1];
    const script = name !== undefined ? scripts[name] : undefined;
    if (name === undefined || script === undefined || seen.has(name) || seen.size >= 10) continue;
    seen.add(name);
    expanded.push(...expandScripts(script, scripts, seen));
  }
  return expanded;
}

/**
 * Extracts commands from YAML CI configuration without a YAML parser: it
 * recognizes `run:` steps (inline or block scalars) and list items under
 * `script:`-style keys. Commands it cannot recognize are simply not reported.
 */
export function parseCiConfiguration(path: string, text: string, scripts: Readonly<Record<string, string>> = {}): CiConfiguration | null {
  const system = ciSystemOf(path);
  if (!system) return null;
  const lines = text.split(/\r?\n/);
  const commands: CiCommand[] = [];
  const actions: string[] = [];

  const push = (command: string, line: number): void => {
    const trimmed = command.trim();
    // Unwrap a YAML-quoted value such as run: "npm test", but never strip an unmatched quote.
    const cleaned = /^(["']).*\1$/.test(trimmed) ? trimmed.slice(1, -1) : trimmed;
    if (cleaned === "" || cleaned.startsWith("#")) return;
    commands.push({ command: cleaned, line, ...classifyCommand(cleaned, scripts) });
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const uses = /^\s*-?\s*uses:\s*["']?([^\s"'#]+)/.exec(line);
    if (uses?.[1]) {
      actions.push(uses[1]);
      continue;
    }

    const run = /^(\s*)(?:-\s+)?(run|script|before_script|after_script|commands|command):\s*(.*)$/.exec(line);
    if (!run) continue;
    const indent = (run[1] ?? "").length;
    const value = (run[3] ?? "").replace(/\s+#.*$/, "").trim();

    if (/^[|>][-+]?\d*$/.test(value)) {
      // Block scalar: every more-indented line belongs to the command text.
      const start = i + 1;
      const block: string[] = [];
      while (i + 1 < lines.length && (lines[i + 1]?.trim() === "" || indentOf(lines[i + 1] ?? "") > indent)) block.push(lines[++i] ?? "");
      for (const command of joinContinuations(withoutHeredocBodies(block))) push(command.text, start + command.line + 1);
    } else if (value === "") {
      // A YAML list of commands.
      while (i + 1 < lines.length && /^\s*-\s+/.test(lines[i + 1] ?? "") && indentOf(lines[i + 1] ?? "") >= indent) {
        i++;
        push((lines[i] ?? "").replace(/^\s*-\s+/, ""), i + 1);
      }
    } else if (value.startsWith("[")) {
      for (const item of value.slice(1, value.lastIndexOf("]")).split(",")) push(item, i + 1);
    } else if (run[2] === "run" || run[2] === "command" || run[2]?.includes("script")) {
      push(value, i + 1);
    }
  }
  return { path, system, commands, actions };
}

/** Blanks the bodies of heredocs (data, not commands), keeping line positions. */
function withoutHeredocBodies(block: readonly string[]): string[] {
  const result: string[] = [];
  let delimiter: string | null = null;
  for (const line of block) {
    if (delimiter !== null) {
      if (line.trim() === delimiter) delimiter = null;
      result.push("");
      continue;
    }
    result.push(line);
    delimiter = /<<-?\s*(['"]?)([A-Za-z_]\w*)\1/.exec(line)?.[2] ?? null;
  }
  return result;
}

function indentOf(line: string): number {
  return /^(\s*)/.exec(line)?.[1]?.length ?? 0;
}

/** Joins shell lines ending in a backslash; returns commands with their offset in the block. */
function joinContinuations(block: readonly string[]): { text: string; line: number }[] {
  const commands: { text: string; line: number }[] = [];
  let current: { text: string; line: number } | null = null;
  block.forEach((raw, index) => {
    const line = raw.trim();
    if (line === "" && !current) return;
    if (!current) current = { text: "", line: index };
    current.text += `${current.text ? " " : ""}${line.replace(/\\$/, "").trim()}`;
    if (!line.endsWith("\\")) {
      commands.push(current);
      current = null;
    }
  });
  if (current) commands.push(current);
  return commands.filter((command) => command.text !== "");
}
