import { baseName } from "./paths.ts";
import { isRecord, parseJsonc, stringField } from "./text.ts";

/**
 * Project metadata read from package manifests. Every field is optional:
 * manifests are repository-controlled input and may be malformed.
 */
export interface Manifest {
  path: string;
  ecosystem: "npm" | "cargo" | "python" | "go" | "dotnet" | "cmake" | "deno";
  name?: string;
  description?: string;
  version?: string;
  license?: string;
  homepage?: string;
  /** Script name to command, e.g. package.json "scripts". */
  scripts: Record<string, string>;
  dependencies: string[];
  devDependencies: string[];
  /** Executable names the package exposes. */
  binaries: string[];
  /** Ecosystem-specific notes such as a target framework or Go version. */
  details: Record<string, string>;
}

function emptyManifest(path: string, ecosystem: Manifest["ecosystem"]): Manifest {
  return { path, ecosystem, scripts: {}, dependencies: [], devDependencies: [], binaries: [], details: {} };
}

/** Returns true for manifest files Ledger knows how to read. */
export function isManifestPath(path: string): boolean {
  const name = baseName(path);
  return (
    ["package.json", "Cargo.toml", "pyproject.toml", "setup.cfg", "go.mod", "CMakeLists.txt", "deno.json", "deno.jsonc"].includes(name) ||
    /\.(csproj|fsproj)$/.test(name)
  );
}

export function parseManifest(path: string, text: string): Manifest | null {
  const name = baseName(path);
  try {
    if (name === "package.json") return parsePackageJson(path, text);
    if (name === "deno.json" || name === "deno.jsonc") return parseDenoJson(path, text);
    if (name === "Cargo.toml") return parseCargoToml(path, text);
    if (name === "pyproject.toml") return parsePyproject(path, text);
    if (name === "setup.cfg") return parseSetupCfg(path, text);
    if (name === "go.mod") return parseGoMod(path, text);
    if (name === "CMakeLists.txt") return parseCMake(path, text);
    if (/\.(csproj|fsproj)$/.test(name)) return parseDotnetProject(path, text);
  } catch {
    // Malformed metadata is not fatal: the file still counts as present.
  }
  return null;
}

function parsePackageJson(path: string, text: string): Manifest | null {
  const data: unknown = JSON.parse(text);
  if (!isRecord(data)) return null;
  const manifest = emptyManifest(path, "npm");
  assignCommon(manifest, data);

  const repository = data["repository"];
  const homepage = stringField(data, "homepage") ?? (typeof repository === "string" ? repository : isRecord(repository) ? stringField(repository, "url") : undefined);
  if (homepage) manifest.homepage = homepage;

  manifest.scripts = stringRecord(data["scripts"]);
  manifest.dependencies = [...Object.keys(stringRecord(data["dependencies"])), ...Object.keys(stringRecord(data["peerDependencies"]))];
  manifest.devDependencies = Object.keys(stringRecord(data["devDependencies"]));

  const bin = data["bin"];
  if (typeof bin === "string" && manifest.name) manifest.binaries = [manifest.name.replace(/^@[^/]+\//, "")];
  else manifest.binaries = Object.keys(stringRecord(bin));

  const packageManager = stringField(data, "packageManager");
  if (packageManager) manifest.details["packageManager"] = packageManager;
  if (isRecord(data["engines"])) {
    for (const [engine, range] of Object.entries(stringRecord(data["engines"]))) manifest.details[`engines.${engine}`] = range;
  }
  if (data["workspaces"] !== undefined) manifest.details["workspaces"] = "yes";
  if (data["type"] === "module") manifest.details["module"] = "ESM";
  return manifest;
}

function parseDenoJson(path: string, text: string): Manifest | null {
  const data = parseJsonc(text);
  if (!isRecord(data)) return null;
  const manifest = emptyManifest(path, "deno");
  assignCommon(manifest, data);
  manifest.scripts = stringRecord(data["tasks"]);
  manifest.dependencies = Object.keys(stringRecord(data["imports"]));
  return manifest;
}

function assignCommon(manifest: Manifest, data: Record<string, unknown>): void {
  const name = stringField(data, "name");
  const description = stringField(data, "description");
  const version = stringField(data, "version");
  const license = stringField(data, "license");
  if (name) manifest.name = name;
  if (description) manifest.description = description;
  if (version) manifest.version = version;
  if (license) manifest.license = license;
}

function stringRecord(value: unknown): Record<string, string> {
  const record: Record<string, string> = {};
  if (!isRecord(value)) return record;
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string") record[key] = entry;
  }
  return record;
}

function parseCargoToml(path: string, text: string): Manifest {
  const toml = parseTomlLite(text);
  const manifest = emptyManifest(path, "cargo");
  const pkg = toml.get("package");
  if (pkg) assignToml(manifest, pkg);
  const edition = pkg?.get("edition");
  if (typeof edition === "string") manifest.details["edition"] = edition;
  if (toml.has("workspace")) manifest.details["workspace"] = "yes";
  manifest.dependencies = tableKeys(toml, "dependencies");
  manifest.devDependencies = tableKeys(toml, "dev-dependencies");
  for (const [section, table] of toml) {
    if (section === "bin") {
      const binName = table.get("name");
      if (typeof binName === "string") manifest.binaries.push(binName);
    }
  }
  return manifest;
}

function parsePyproject(path: string, text: string): Manifest {
  const toml = parseTomlLite(text);
  const manifest = emptyManifest(path, "python");
  const project = toml.get("project") ?? toml.get("tool.poetry");
  if (project) assignToml(manifest, project);

  const declared = toml.get("project")?.get("dependencies");
  const requirementNames = Array.isArray(declared) ? declared.map(requirementName) : [];
  manifest.dependencies = [...requirementNames, ...tableKeys(toml, "tool.poetry.dependencies").filter((dep) => dep !== "python")];

  const optional = toml.get("project.optional-dependencies");
  const dev: string[] = [...tableKeys(toml, "tool.poetry.dev-dependencies"), ...tableKeys(toml, "tool.poetry.group.dev.dependencies")];
  if (optional) {
    for (const value of optional.values()) if (Array.isArray(value)) dev.push(...value.map(requirementName));
  }
  const groups = toml.get("dependency-groups");
  if (groups) {
    for (const value of groups.values()) if (Array.isArray(value)) dev.push(...value.map(requirementName));
  }
  manifest.devDependencies = dev;

  const scripts = toml.get("project.scripts");
  if (scripts) manifest.binaries = [...scripts.keys()];
  const backend = toml.get("build-system")?.get("build-backend");
  if (typeof backend === "string") manifest.details["buildBackend"] = backend;
  for (const tool of ["pytest.ini_options", "ruff", "mypy", "black", "pyright", "coverage.run", "isort", "hatch"]) {
    if ([...toml.keys()].some((section) => section === `tool.${tool}` || section.startsWith(`tool.${tool}.`))) {
      manifest.details[`tool.${tool}`] = "configured";
    }
  }
  return manifest;
}

/** setuptools' declarative configuration. `setup.py` is code and is never read. */
function parseSetupCfg(path: string, text: string): Manifest | null {
  const ini = parseIni(text);
  const metadata = ini.get("metadata");
  if (!metadata) return null;
  const manifest = emptyManifest(path, "python");
  // "attr:" and "file:" values point elsewhere; they are not the value itself.
  const literal = (key: string): string | undefined => {
    const value = metadata.get(key)?.trim();
    return value && !/^(attr|file):/.test(value) ? value : undefined;
  };
  const name = literal("name");
  const description = literal("description") ?? literal("summary");
  const version = literal("version");
  const license = literal("license");
  const homepage = literal("url") ?? literal("home_page");
  if (name) manifest.name = name;
  if (description) manifest.description = description;
  if (version) manifest.version = version;
  if (license) manifest.license = license;
  if (homepage) manifest.homepage = homepage;
  manifest.dependencies = listValue(ini.get("options")?.get("install_requires")).map(requirementName);
  manifest.binaries = listValue(ini.get("options.entry_points")?.get("console_scripts")).map((entry) => entry.split("=")[0]?.trim() ?? "").filter(Boolean);
  for (const tool of ["tool:pytest", "mypy", "flake8", "isort"]) {
    if (ini.has(tool)) manifest.details[`tool.${tool.replace("tool:", "")}`] = "configured";
  }
  return manifest;
}

function listValue(value: string | undefined): string[] {
  return (value ?? "")
    .split("\n")
    // Drop environment markers such as `; python_version < "3.8"`.
    .map((line) => line.split(";")[0]?.trim() ?? "")
    .filter((line) => line !== "" && !line.startsWith("#"));
}

/** INI sections to key/value maps; indented lines continue the previous value. */
export function parseIni(text: string): Map<string, Map<string, string>> {
  const sections = new Map<string, Map<string, string>>();
  let section: Map<string, string> | undefined;
  let key: string | undefined;
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*[#;]/.test(line) || line.trim() === "") continue;
    const header = /^\[([^\]]+)\]\s*$/.exec(line);
    if (header?.[1]) {
      section = new Map();
      sections.set(header[1].trim(), section);
      key = undefined;
    } else if (/^\s/.test(line) && section && key !== undefined) {
      section.set(key, `${section.get(key) ?? ""}\n${line.trim()}`);
    } else {
      const assignment = /^([^=:]+?)\s*[=:]\s*(.*)$/.exec(line);
      if (section && assignment?.[1] !== undefined) {
        key = assignment[1].trim().toLowerCase().replace(/-/g, "_");
        section.set(key, assignment[2] ?? "");
      }
    }
  }
  return sections;
}

function requirementName(requirement: string): string {
  return (/^\s*([A-Za-z0-9_.-]+)/.exec(requirement)?.[1] ?? requirement).toLowerCase();
}

function parseGoMod(path: string, text: string): Manifest {
  const manifest = emptyManifest(path, "go");
  const module = /^module\s+(\S+)/m.exec(text)?.[1];
  if (module) {
    manifest.name = module;
    manifest.details["module"] = module;
  }
  const goVersion = /^go\s+(\S+)/m.exec(text)?.[1];
  if (goVersion) manifest.details["go"] = goVersion;
  const requires = new Set<string>();
  let inBlock = false;
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.replace(/\/\/.*$/, "").trim();
    if (/^require\s*\($/.test(trimmed)) inBlock = true;
    else if (inBlock && trimmed === ")") inBlock = false;
    else if (inBlock && trimmed !== "") requires.add(trimmed.split(/\s+/)[0] ?? "");
    else {
      const single = /^require\s+(\S+)\s/.exec(trimmed)?.[1];
      if (single) requires.add(single);
    }
  }
  requires.delete("");
  manifest.dependencies = [...requires];
  return manifest;
}

function parseCMake(path: string, text: string): Manifest {
  const manifest = emptyManifest(path, "cmake");
  const project = /^\s*project\s*\(\s*([A-Za-z0-9_.+-]+)/im.exec(text)?.[1];
  if (project) manifest.name = project;
  const packages = [...text.matchAll(/find_package\s*\(\s*([A-Za-z0-9_]+)/gi)].map((match) => match[1] ?? "");
  manifest.dependencies = [...new Set(packages.filter(Boolean))];
  if (/\benable_testing\s*\(|\badd_test\s*\(/i.test(text)) manifest.details["ctest"] = "yes";
  const standard = /CMAKE_CXX_STANDARD\s+(\d+)/.exec(text)?.[1];
  if (standard) manifest.details["cxxStandard"] = standard;
  return manifest;
}

function parseDotnetProject(path: string, text: string): Manifest {
  const manifest = emptyManifest(path, "dotnet");
  manifest.name = baseName(path).replace(/\.(csproj|fsproj)$/, "");
  const frameworks = /<TargetFrameworks?>([^<]+)<\/TargetFrameworks?>/.exec(text)?.[1];
  if (frameworks) manifest.details["targetFramework"] = frameworks.trim();
  manifest.dependencies = [...text.matchAll(/<PackageReference\s+Include="([^"]+)"/g)].map((match) => match[1] ?? "").filter(Boolean);
  const description = /<Description>([^<]+)<\/Description>/.exec(text)?.[1];
  if (description) manifest.description = description.trim();
  return manifest;
}

function assignToml(manifest: Manifest, table: Map<string, TomlValue>): void {
  for (const key of ["name", "description", "version", "license", "homepage"] as const) {
    const value = table.get(key);
    if (typeof value === "string" && value.trim() !== "") manifest[key] = value.trim();
  }
  if (!manifest.homepage) {
    const repository = table.get("repository");
    if (typeof repository === "string") manifest.homepage = repository;
  }
}

function tableKeys(toml: TomlDocument, section: string): string[] {
  const keys = new Set(toml.get(section)?.keys() ?? []);
  // Dotted tables such as [dependencies.serde] declare a dependency too.
  for (const name of toml.keys()) {
    if (name.startsWith(`${section}.`)) keys.add(name.slice(section.length + 1).split(".")[0] ?? "");
  }
  keys.delete("");
  return [...keys];
}

export type TomlValue = string | number | boolean | string[] | { table: true };
export type TomlDocument = Map<string, Map<string, TomlValue>>;

/**
 * Reads the subset of TOML found in project manifests: tables, strings,
 * numbers, booleans, string arrays (including multi-line), and inline tables
 * (recorded as present, not parsed). Anything else is skipped.
 */
export function parseTomlLite(text: string): TomlDocument {
  const document: TomlDocument = new Map([["", new Map()]]);
  let table = document.get("") ?? new Map<string, TomlValue>();
  const lines = text.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = stripTomlComment(lines[i] ?? "").trim();
    if (line === "") continue;

    const header = /^\[\[?\s*([^\]]+?)\s*\]\]?$/.exec(line);
    if (header?.[1]) {
      const name = header[1].replace(/\s*\.\s*/g, ".").replace(/"/g, "");
      table = document.get(name) ?? new Map();
      document.set(name, table);
      continue;
    }

    const assignment = /^("[^"]+"|'[^']+'|[A-Za-z0-9_.-]+)\s*=\s*(.*)$/.exec(line);
    if (!assignment?.[1] || assignment[2] === undefined) continue;
    const key = assignment[1].replace(/^["']|["']$/g, "");
    let raw = assignment[2];

    if (raw.startsWith("[")) {
      while (!balanced(raw) && i + 1 < lines.length) raw += ` ${stripTomlComment(lines[++i] ?? "").trim()}`;
      table.set(key, [...raw.matchAll(/"((?:[^"\\]|\\.)*)"|'([^']*)'/g)].map((match) => match[1] ?? match[2] ?? ""));
    } else if (raw.startsWith("{")) {
      table.set(key, { table: true });
    } else if (raw.startsWith('"""') || raw.startsWith("'''")) {
      const quote = raw.slice(0, 3);
      let value = raw.slice(3);
      while (!value.includes(quote) && i + 1 < lines.length) value += `\n${lines[++i] ?? ""}`;
      table.set(key, value.slice(0, value.indexOf(quote)).trim());
    } else if (/^"/.test(raw)) {
      table.set(key, (/^"((?:[^"\\]|\\.)*)"/.exec(raw)?.[1] ?? "").replace(/\\(.)/g, "$1"));
    } else if (/^'/.test(raw)) {
      table.set(key, /^'([^']*)'/.exec(raw)?.[1] ?? "");
    } else if (raw === "true" || raw === "false") {
      table.set(key, raw === "true");
    } else if (/^[+-]?\d[\d_]*(\.\d+)?$/.test(raw)) {
      table.set(key, Number(raw.replace(/_/g, "")));
    }
  }
  return document;
}

function stripTomlComment(line: string): string {
  let quote: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (quote) {
      if (char === "\\" && quote === '"') i++;
      else if (char === quote) quote = null;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === "#") {
      return line.slice(0, i);
    }
  }
  return line;
}

function balanced(raw: string): boolean {
  let depth = 0;
  for (const char of raw.replace(/"(?:[^"\\]|\\.)*"|'[^']*'/g, "")) {
    if (char === "[") depth++;
    else if (char === "]") depth--;
  }
  return depth <= 0;
}
