/**
 * Path classification. Everything here is a heuristic over file names only;
 * no file contents are involved.
 */

const TEST_FILE = [
  /(^|\/)(__tests__|__test__)\//,
  /\.(test|spec)\.[cm]?[jt]sx?$/,
  /\.(test|spec)\.(py|rb|go|rs|php|kt|swift|dart|ex|exs)$/,
  /(^|\/)test_[^/]+\.py$/,
  /_test\.(py|go|exs|dart)$/,
  /_spec\.rb$/,
  /(Test|Tests|Spec)\.(java|kt|cs|swift|scala|php)$/,
  /(^|\/)(tests?|spec|specs|testing)\/.+\.[a-z0-9]+$/i,
];

const TEST_SUPPORT = /(^|\/)(fixtures?|snapshots?|__snapshots__|testdata|mocks?)\//i;

export function isTestFile(path: string): boolean {
  if (isDocumentation(path)) return false;
  return TEST_FILE.some((pattern) => pattern.test(path));
}

/** Test files that contain tests rather than fixtures or snapshots. */
export function isTestSource(path: string): boolean {
  return isTestFile(path) && !TEST_SUPPORT.test(path) && languageOf(path)?.type === "programming";
}

const DOC_EXTENSIONS = /\.(md|mdx|markdown|rst|adoc|asciidoc|txt)$/i;

export function isDocumentation(path: string): boolean {
  const name = baseName(path);
  if (/^(readme|changelog|changes|history|contributing|architecture|design|security|code_of_conduct|authors|notice)(\.[a-z]+)?$/i.test(name)) {
    return true;
  }
  if (/^(license|licence|copying)(\.[a-z]+)?$/i.test(name)) return false;
  if (/(^|\/)(docs?|documentation|adr|adrs|rfcs?)\//i.test(path)) return DOC_EXTENSIONS.test(path);
  return /\.(md|mdx|markdown|rst|adoc|asciidoc)$/i.test(path);
}

export function isReadme(path: string): boolean {
  return /^readme(\.(md|markdown|rst|txt|adoc))?$/i.test(path);
}

export function isArchitectureRecord(path: string): boolean {
  return /(^|\/)(adr|adrs|decisions|decision-records)\/[^/]+\.(md|markdown)$/i.test(path);
}

export function isAgentGuide(path: string): boolean {
  return /^(CLAUDE|AGENTS|GEMINI|\.cursorrules|copilot-instructions)(\.md)?$/i.test(baseName(path));
}

export interface CiSystem {
  name: string;
  pattern: RegExp;
}

export const CI_SYSTEMS: readonly CiSystem[] = [
  { name: "GitHub Actions", pattern: /^\.github\/workflows\/[^/]+\.ya?ml$/ },
  { name: "GitLab CI", pattern: /^\.gitlab-ci\.ya?ml$/ },
  { name: "CircleCI", pattern: /^\.circleci\/config\.ya?ml$/ },
  { name: "Azure Pipelines", pattern: /^azure-pipelines\.ya?ml$/ },
  { name: "Travis CI", pattern: /^\.travis\.ya?ml$/ },
  { name: "Bitbucket Pipelines", pattern: /^bitbucket-pipelines\.ya?ml$/ },
  { name: "Buildkite", pattern: /^\.buildkite\/[^/]+\.ya?ml$/ },
  { name: "Drone CI", pattern: /^\.drone\.ya?ml$/ },
  { name: "Woodpecker CI", pattern: /^\.woodpecker(\.ya?ml|\/[^/]+\.ya?ml)$/ },
  { name: "Jenkins", pattern: /(^|\/)Jenkinsfile$/ },
];

export function ciSystemOf(path: string): string | undefined {
  return CI_SYSTEMS.find((system) => system.pattern.test(path))?.name;
}

const LOCKFILES = new Set([
  "bun.lock",
  "bun.lockb",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "deno.lock",
  "Cargo.lock",
  "poetry.lock",
  "uv.lock",
  "Pipfile.lock",
  "pdm.lock",
  "go.sum",
  "Gemfile.lock",
  "composer.lock",
  "mix.lock",
  "pubspec.lock",
  "Package.resolved",
  "packages.lock.json",
  "flake.lock",
  "gradle.lockfile",
]);

export function isLockfile(path: string): boolean {
  return LOCKFILES.has(baseName(path));
}

const GENERATED = [
  /(^|\/)(node_modules|vendor|third_party|third-party|bower_components|\.yarn)\//,
  /(^|\/)(dist|build|out|coverage|target|\.next|\.nuxt|\.svelte-kit)\//,
  /\.min\.(js|css)$/,
  /\.(map|snap)$/,
];

export function isVendoredOrGenerated(path: string): boolean {
  return GENERATED.some((pattern) => pattern.test(path));
}

/**
 * Files Ledger must never read even if tracked: they commonly hold credentials.
 * Ledger only reads an allowlist of metadata and documentation files, so this
 * is a second line of defense.
 */
export function isSensitivePath(path: string): boolean {
  const name = baseName(path).toLowerCase();
  return (
    /^\.env(\..*)?$/.test(name) ||
    /^\.?(npmrc|pypirc|netrc|pgpass|git-credentials|htpasswd)$/.test(name) ||
    /\.(pem|key|p12|pfx|jks|keystore|kdbx|gpg|asc|ovpn)$/.test(name) ||
    /^id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/.test(name) ||
    /(secret|credential|password|token)s?(\.[a-z0-9]+)?$/.test(name) ||
    /(^|\/)\.(ssh|aws|gnupg|docker|kube)\//.test(path.toLowerCase())
  );
}

export interface LanguageInfo {
  name: string;
  type: "programming" | "markup" | "data" | "prose";
}

const LANGUAGES: Record<string, LanguageInfo> = {};
function define(type: LanguageInfo["type"], name: string, extensions: string[]): void {
  for (const extension of extensions) LANGUAGES[extension] = { name, type };
}
define("programming", "TypeScript", ["ts", "tsx", "mts", "cts"]);
define("programming", "JavaScript", ["js", "jsx", "mjs", "cjs"]);
define("programming", "Python", ["py", "pyi"]);
define("programming", "Rust", ["rs"]);
define("programming", "Go", ["go"]);
define("programming", "Java", ["java"]);
define("programming", "Kotlin", ["kt", "kts"]);
define("programming", "Scala", ["scala"]);
define("programming", "C#", ["cs"]);
define("programming", "F#", ["fs", "fsx"]);
define("programming", "C", ["c", "h"]);
define("programming", "C++", ["cc", "cpp", "cxx", "hpp", "hh", "hxx"]);
define("programming", "Objective-C", ["m", "mm"]);
define("programming", "Swift", ["swift"]);
define("programming", "Ruby", ["rb"]);
define("programming", "PHP", ["php"]);
define("programming", "Elixir", ["ex", "exs"]);
define("programming", "Erlang", ["erl"]);
define("programming", "Haskell", ["hs"]);
define("programming", "OCaml", ["ml", "mli"]);
define("programming", "Clojure", ["clj", "cljs", "cljc"]);
define("programming", "Dart", ["dart"]);
define("programming", "Lua", ["lua"]);
define("programming", "Zig", ["zig"]);
define("programming", "Nim", ["nim"]);
define("programming", "Julia", ["jl"]);
define("programming", "R", ["r"]);
define("programming", "Shell", ["sh", "bash", "zsh", "fish"]);
define("programming", "PowerShell", ["ps1", "psm1"]);
define("programming", "SQL", ["sql"]);
define("programming", "Vue", ["vue"]);
define("programming", "Svelte", ["svelte"]);
define("programming", "Astro", ["astro"]);
define("programming", "Solidity", ["sol"]);
define("programming", "GLSL", ["glsl", "vert", "frag"]);
define("programming", "WGSL", ["wgsl"]);
define("markup", "HTML", ["html", "htm"]);
define("markup", "CSS", ["css"]);
define("markup", "SCSS", ["scss", "sass"]);
define("markup", "Less", ["less"]);
define("data", "JSON", ["json", "jsonc", "json5"]);
define("data", "YAML", ["yml", "yaml"]);
define("data", "TOML", ["toml"]);
define("data", "XML", ["xml"]);
define("prose", "Markdown", ["md", "mdx", "markdown"]);
define("prose", "reStructuredText", ["rst"]);

export function languageOf(path: string): LanguageInfo | undefined {
  const name = baseName(path);
  if (name === "Dockerfile" || name === "Makefile") return undefined;
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return undefined;
  const extension = name.slice(dot + 1);
  // Upper-case ".R" and ".C" are conventional; everything else is matched case-insensitively.
  return LANGUAGES[extension] ?? LANGUAGES[extension.toLowerCase()];
}

export function extensionOf(path: string): string {
  const name = baseName(path);
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot);
}

const SOURCE_ROOTS = new Set(["src", "lib", "app", "apps", "packages", "crates", "cmd", "internal", "pkg", "source", "sources", "modules", "services"]);

/**
 * A coarse "area of the codebase" for a path, used to relate commits that
 * touch the same part of a project. `src/git/log.ts` becomes `src/git`.
 */
export function areaOf(path: string): string {
  if (ciSystemOf(path) || path.startsWith(".github/")) return "ci";
  const segments = path.split("/");
  const [first, second] = segments;
  if (segments.length === 1 || first === undefined) {
    if (isDocumentation(path)) return "documentation";
    return "project root";
  }
  if (SOURCE_ROOTS.has(first.toLowerCase()) && segments.length >= 3 && second !== undefined) {
    return `${first}/${second}`;
  }
  return first;
}

export function baseName(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? path : path.slice(slash + 1);
}

export function directoryOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "" : path.slice(0, slash);
}
