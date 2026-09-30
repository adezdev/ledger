import { code } from "../domain/statement.ts";
import type { EvidenceLog } from "../domain/evidence.ts";
import type { Finding, FindingArea, RepositorySnapshot, Statement } from "../domain/model.ts";
import { type CiConfiguration, type CommandPurpose, classifyCommand } from "./ci.ts";
import { classifyCommit } from "./commits.ts";
import type { Manifest } from "./manifests.ts";
import {
  baseName,
  ciSystemOf,
  isAgentGuide,
  isArchitectureRecord,
  isDocumentation,
  isReadme,
  isTestSource,
  isVendoredOrGenerated,
} from "./paths.ts";
import { isRecord, markdownSections, parseJsonc } from "./text.ts";
import { MARKERS } from "./technology.ts";

export interface EngineeringReport {
  findings: Finding[];
  testFiles: string[];
  ciFiles: string[];
  documentationFiles: string[];
}

const PURPOSE_LABELS: Record<CommandPurpose, string> = {
  test: "tests",
  typecheck: "type checking",
  lint: "linting",
  format: "format checking",
  build: "a build",
  coverage: "coverage",
  benchmark: "benchmarks",
  audit: "dependency auditing",
};

/**
 * Concrete, checkable statements about engineering practice. Every statement
 * describes what is present in the repository; none claims that anything
 * passes, because Ledger never runs the project.
 */
export function analyzeEngineering(
  snapshot: RepositorySnapshot,
  manifests: readonly Manifest[],
  ciConfigurations: readonly CiConfiguration[],
  log: EvidenceLog,
): EngineeringReport {
  const findings: Finding[] = [];
  const add = (area: FindingArea, statement: Statement): void => {
    findings.push({ area, statement });
  };
  const paths = snapshot.files.map((file) => file.path).filter((path) => !isVendoredOrGenerated(path));
  const testFiles = paths.filter(isTestSource);
  const ciFiles = paths.filter((path) => ciSystemOf(path) !== undefined);
  const documentationFiles = paths.filter(isDocumentation);
  const rootManifest = manifests.find((manifest) => !manifest.path.includes("/"));

  // Testing ------------------------------------------------------------------
  if (testFiles.length > 0) {
    const id = log.add({
      level: "observed",
      category: "testing",
      statement: `${testFiles.length} test file${plural(testFiles.length)} tracked at HEAD.`,
      source: { kind: "file-set", description: "Test files at HEAD (by naming convention and test directories)", total: testFiles.length, paths: testFiles.slice(0, 12) },
    });
    add("testing", { text: `Repository contains ${testFiles.length} test file${plural(testFiles.length)}.`, level: "observed", evidence: [id] });

    const nonMerge = snapshot.commits.filter((commit) => commit.parents.length <= 1);
    const touching = nonMerge.filter((commit) => commit.changes.some((change) => isTestSource(change.path) || (change.previousPath !== undefined && isTestSource(change.previousPath))));
    const firstTest = touching[0];
    if (firstTest && nonMerge.length > 1) {
      const rangeId = log.add({
        level: "observed",
        category: "testing",
        statement: `${touching.length} of ${nonMerge.length} non-merge commits modified test files.`,
        source: { kind: "commit-range", firstSha: firstTest.sha, lastSha: touching.at(-1)?.sha ?? firstTest.sha, count: touching.length, commits: touching.slice(0, 20).map((commit) => commit.shortSha) },
      });
      add("testing", { text: `Test files were changed in ${touching.length} of ${nonMerge.length} non-merge commits.`, level: "observed", evidence: [rangeId] });
      const firstIndex = nonMerge.indexOf(firstTest);
      const firstPath = firstTest.changes.find((change) => isTestSource(change.path))?.path;
      if (firstPath) {
        const firstId = log.add({
          level: "observed",
          category: "testing",
          statement: `First test file ${code(firstPath)} added.`,
          source: { kind: "commit", sha: firstTest.sha, shortSha: firstTest.shortSha, date: firstTest.authoredAt.slice(0, 10), files: [firstPath] },
        });
        const when = firstIndex === 0 ? "in the first commit" : `in commit ${firstIndex + 1} of ${nonMerge.length}`;
        add("testing", { text: `The first test file, ${code(firstPath)}, was added ${when} (${code(firstTest.shortSha)}).`, level: "observed", evidence: [firstId] });
      }
    }
  }

  // Package scripts -----------------------------------------------------------
  if (rootManifest) {
    for (const [name, command] of Object.entries(rootManifest.scripts)) {
      const { purposes } = classifyCommand(command);
      const purpose = purposes.find((candidate) => ["test", "typecheck", "lint", "format", "build", "benchmark"].includes(candidate));
      if (!purpose) continue;
      const area: FindingArea = purpose === "test" ? "testing" : purpose === "typecheck" ? "types" : purpose === "lint" || purpose === "format" ? "linting" : purpose === "benchmark" ? "benchmarks" : "build";
      const id = log.add({
        level: "observed",
        category: area === "testing" ? "testing" : area === "build" ? "build" : "quality",
        statement: `${code(rootManifest.path)} script ${code(name)} runs ${code(command)}.`,
        source: { kind: "file", path: rootManifest.path, section: "scripts", excerpt: `"${name}": "${command}"` },
      });
      add(area, { text: `${code(rootManifest.path)} defines a ${code(name)} script for ${PURPOSE_LABELS[purpose]}: ${code(command)}.`, level: "observed", evidence: [id] });
    }
    if (rootManifest.binaries.length > 0) {
      const id = log.add({
        level: "observed",
        category: "build",
        statement: `${code(rootManifest.path)} declares executable${plural(rootManifest.binaries.length)} ${rootManifest.binaries.map((bin) => `${code(bin)}`).join(", ")}.`,
        source: { kind: "file", path: rootManifest.path, section: "bin" },
      });
      add("build", { text: `The package exposes ${rootManifest.binaries.length === 1 ? "an executable" : "executables"}: ${rootManifest.binaries.map((bin) => `${code(bin)}`).join(", ")}.`, level: "observed", evidence: [id] });
    }
  }

  // Continuous integration ------------------------------------------------------
  for (const configuration of ciConfigurations) {
    const purposeful = configuration.commands.filter((command) => command.purposes.length > 0);
    if (purposeful.length === 0) {
      const id = log.add({ level: "observed", category: "ci", statement: `${configuration.system} configuration is tracked.`, source: { kind: "file", path: configuration.path } });
      add("ci", { text: `${configuration.system} configuration ${code(configuration.path)} is tracked; Ledger did not recognize test, lint, or build commands in it.`, level: "observed", evidence: [id] });
      continue;
    }
    const described = uniqueBy(purposeful, (command) => command.command).slice(0, 6).map((command) => {
      const via = command.resolvedScript ? ` (script: ${code(command.resolvedScript.command)})` : "";
      const purposes = command.purposes.filter((purpose) => purpose !== "coverage" || command.purposes.length === 1).map((purpose) => PURPOSE_LABELS[purpose]);
      return `${code(command.command)}${via} for ${joinWords(purposes)}`;
    });
    const first = purposeful[0];
    const id = log.add({
      level: "observed",
      category: "ci",
      statement: `${configuration.system} configuration runs ${purposeful.map((command) => `${code(command.command)}`).join(", ")}.`,
      source: { kind: "file", path: configuration.path, ...(first ? { line: first.line } : {}), excerpt: purposeful.map((command) => command.command).join("\n") },
    });
    add("ci", { text: `${configuration.system} configuration ${code(configuration.path)} includes steps running ${joinWords(described)}.`, level: "observed", evidence: [id] });
  }

  // Type checking -----------------------------------------------------------------
  const tsconfigText = snapshot.documents.get("tsconfig.json");
  if (tsconfigText !== undefined) {
    const flags = strictTypeScriptFlags(tsconfigText);
    if (flags.length > 0) {
      const line = tsconfigText.split(/\r?\n/).findIndex((text) => /"strict"\s*:/.test(text)) + 1;
      const id = log.add({
        level: "observed",
        category: "quality",
        statement: `\`tsconfig.json\` enables ${flags.map((flag) => `${code(flag)}`).join(", ")}.`,
        source: { kind: "file", path: "tsconfig.json", section: "compilerOptions", ...(line > 0 ? { line } : {}) },
      });
      const extra = flags.filter((flag) => flag !== "strict");
      const text = flags.includes("strict")
        ? `\`tsconfig.json\` enables TypeScript \`strict\` mode${extra.length > 0 ? ` plus ${joinWords(extra.map((flag) => `${code(flag)}`))}` : ""}.`
        : `\`tsconfig.json\` enables ${joinWords(extra.map((flag) => `${code(flag)}`))}.`;
      add("types", { text, level: "observed", evidence: [id] });
    }
  }
  for (const manifest of manifests) {
    for (const tool of ["mypy", "pyright"]) {
      if (manifest.details[`tool.${tool}`]) {
        const id = log.add({ level: "observed", category: "quality", statement: `${code(manifest.path)} configures ${tool}.`, source: { kind: "file", path: manifest.path, section: `tool.${tool}` } });
        add("types", { text: `${code(manifest.path)} includes ${tool} configuration.`, level: "observed", evidence: [id] });
      }
    }
  }

  // Linting and formatting ------------------------------------------------------------
  const lintMarkers = MARKERS.filter((marker) => ["ESLint", "Biome", "Prettier", "Ruff", "golangci-lint", "rustfmt", "Clippy", "EditorConfig", "pre-commit", "Husky"].includes(marker.name));
  const lintTools = lintMarkers
    .map((marker) => ({ name: marker.name, path: paths.find((path) => marker.test(path)) }))
    .filter((tool): tool is { name: string; path: string } => tool.path !== undefined);
  if (lintTools.length > 0) {
    const id = log.add({
      level: "observed",
      category: "quality",
      statement: `Lint and formatting configuration tracked: ${lintTools.map((tool) => `${code(tool.path)}`).join(", ")}.`,
      source: { kind: "file-set", description: "Lint and formatting configuration files", total: lintTools.length, paths: lintTools.map((tool) => tool.path) },
    });
    add("linting", { text: `Lint and formatting configuration is tracked for ${joinWords(lintTools.map((tool) => `${tool.name} (${code(tool.path)})`))}.`, level: "observed", evidence: [id] });
  }

  // Benchmarks ------------------------------------------------------------------------
  const benchmarks = paths.filter((path) => /(^|\/)(bench|benches|benchmarks?)\//i.test(path) || /\.bench\.[cm]?[jt]sx?$|_bench\.(go|py)$/.test(path));
  if (benchmarks.length > 0) {
    const id = log.add({ level: "observed", category: "quality", statement: `${benchmarks.length} benchmark file${plural(benchmarks.length)} tracked.`, source: { kind: "file-set", description: "Benchmark files", total: benchmarks.length, paths: benchmarks.slice(0, 10) } });
    add("benchmarks", { text: `Repository contains ${benchmarks.length} benchmark file${plural(benchmarks.length)}.`, level: "observed", evidence: [id] });
  }

  // Documentation -------------------------------------------------------------------
  const readmePath = paths.find(isReadme);
  const readme = readmePath ? snapshot.documents.get(readmePath) : undefined;
  if (readmePath && readme !== undefined) {
    const headings = markdownSections(readme).filter((section) => section.level === 2).map((section) => section.title);
    const id = log.add({
      level: "observed",
      category: "documentation",
      statement: headings.length > 0 ? `${code(readmePath)} has sections: ${headings.join("; ")}.` : `${code(readmePath)} is tracked.`,
      source: { kind: "file", path: readmePath },
    });
    const shown = headings.slice(0, 10).map((heading) => `“${heading}”`);
    add("documentation", {
      text: headings.length > 0 ? `${code(readmePath)} is organized into ${headings.length} sections, including ${joinWords(shown)}.` : `${code(readmePath)} is tracked.`,
      level: "observed",
      evidence: [id],
    });
  }

  const records = paths.filter(isArchitectureRecord);
  if (records.length > 0) {
    const id = log.add({ level: "observed", category: "documentation", statement: `${records.length} architecture decision record${plural(records.length)} tracked.`, source: { kind: "file-set", description: "Architecture decision records", total: records.length, paths: records.slice(0, 10) } });
    add("documentation", { text: `Repository contains ${records.length} architecture decision record${plural(records.length)}.`, level: "observed", evidence: [id] });
  }

  const notable: [RegExp, string][] = [
    [/^(architecture|design)\.(md|markdown)$/i, "architecture notes"],
    [/^contributing(\.[a-z]+)?$/i, "contribution guidelines"],
    [/^(changelog|changes|history)(\.[a-z]+)?$/i, "a changelog"],
    [/^security(\.[a-z]+)?$/i, "a security policy"],
  ];
  const guides = paths.filter((path) => path.split("/").length <= 2 && notable.some(([pattern]) => pattern.test(baseName(path))));
  const agentGuides = paths.filter((path) => !path.includes("/") && isAgentGuide(path));
  const otherDocs = documentationFiles.filter((path) => path !== readmePath && !isArchitectureRecord(path) && !guides.includes(path) && !agentGuides.includes(path));
  if (guides.length > 0 || otherDocs.length > 0 || agentGuides.length > 0) {
    const parts = guides.map((path) => `${notable.find(([pattern]) => pattern.test(baseName(path)))?.[1] ?? "documentation"} (${code(path)})`);
    if (agentGuides.length > 0) parts.push(`instructions for AI coding assistants (${agentGuides.map((path) => `${code(path)}`).join(", ")})`);
    if (otherDocs.length > 0) parts.push(`${otherDocs.length} other documentation file${plural(otherDocs.length)}`);
    const listed = [...guides, ...agentGuides, ...otherDocs];
    const id = log.add({ level: "observed", category: "documentation", statement: `Documentation files tracked: ${listed.length}.`, source: { kind: "file-set", description: "Documentation files other than the README", total: listed.length, paths: listed.slice(0, 12) } });
    add("documentation", { text: `Beyond the README, the repository includes ${joinWords(parts)}.`, level: "observed", evidence: [id] });
  }

  // Releases -------------------------------------------------------------------------
  if (snapshot.tags.length > 0) {
    const order = new Map(snapshot.commits.map((commit, index) => [commit.sha, index]));
    const tags = [...snapshot.tags].sort((a, b) => (order.get(a.sha) ?? 0) - (order.get(b.sha) ?? 0));
    const first = tags[0];
    const last = tags.at(-1);
    if (first && last) {
      const ids = [first, last].map((tag) => log.add({ level: "observed", category: "history", statement: `Tag ${code(tag.name)} points at ${code(tag.sha.slice(0, 7))}.`, source: { kind: "tag", name: tag.name, sha: tag.sha } }));
      add("release", {
        text: tags.length === 1 ? `History includes one tag, ${code(first.name)}.` : `History includes ${tags.length} tags, from ${code(first.name)} to ${code(last.name)}.`,
        level: "observed",
        evidence: [...new Set(ids)],
      });
    }
  }

  // Process ----------------------------------------------------------------------------
  const nonMerge = snapshot.commits.filter((commit) => commit.parents.length <= 1);
  if (nonMerge.length >= 3) {
    const conventional = nonMerge.filter((commit) => classifyCommit(commit).source === "conventional");
    const share = conventional.length / nonMerge.length;
    const first = nonMerge[0];
    const last = nonMerge.at(-1);
    if (share >= 0.5 && first && last) {
      const id = log.add({
        level: "observed",
        category: "history",
        statement: `${conventional.length} of ${nonMerge.length} non-merge commit subjects use a Conventional Commits prefix.`,
        source: { kind: "commit-range", firstSha: first.sha, lastSha: last.sha, count: nonMerge.length },
      });
      add("process", { text: `${conventional.length} of ${nonMerge.length} non-merge commits (${Math.round(share * 100)}%) use Conventional Commits prefixes.`, level: "observed", evidence: [id] });
    }
    const withBody = nonMerge.filter((commit) => commit.body.trim().length >= 20);
    if (withBody.length / nonMerge.length >= 0.25 && first && last) {
      const id = log.add({
        level: "observed",
        category: "history",
        statement: `${withBody.length} of ${nonMerge.length} non-merge commits include a message body.`,
        source: { kind: "commit-range", firstSha: first.sha, lastSha: last.sha, count: nonMerge.length, commits: withBody.slice(0, 20).map((commit) => commit.shortSha) },
      });
      add("process", { text: `${withBody.length} of ${nonMerge.length} non-merge commits include a message body describing the change.`, level: "observed", evidence: [id] });
    }
  }

  return { findings, testFiles, ciFiles, documentationFiles };
}

const STRICT_FLAGS = ["strict", "noUncheckedIndexedAccess", "exactOptionalPropertyTypes", "noImplicitOverride", "noImplicitReturns", "noFallthroughCasesInSwitch", "noPropertyAccessFromIndexSignature", "noUnusedLocals", "noUnusedParameters"];

export function strictTypeScriptFlags(tsconfigText: string): string[] {
  let config: unknown;
  try {
    config = parseJsonc(tsconfigText);
  } catch {
    return [];
  }
  if (!isRecord(config)) return [];
  const options = config["compilerOptions"];
  if (!isRecord(options)) return [];
  return STRICT_FLAGS.filter((flag) => options[flag] === true);
}

function plural(count: number): string {
  return count === 1 ? "" : "s";
}

export function joinWords(words: readonly string[]): string {
  if (words.length <= 1) return words[0] ?? "";
  if (words.length === 2) return `${words[0]} and ${words[1]}`;
  return `${words.slice(0, -1).join(", ")}, and ${words.at(-1)}`;
}

function uniqueBy<T>(items: readonly T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const value = key(item);
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}
