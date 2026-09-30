import { code } from "../domain/statement.ts";
import type { EvidenceLog, NewEvidence } from "../domain/evidence.ts";
import type { EvidenceLevel, LanguageShare, Technology, TrackedFile } from "../domain/model.ts";
import type { Manifest } from "./manifests.ts";
import { baseName, CI_SYSTEMS, languageOf, isVendoredOrGenerated, extensionOf } from "./paths.ts";

type Kind = Technology["kind"];

export interface Marker {
  name: string;
  kind: Kind;
  test: (path: string) => boolean;
  /** Markers in the same group are alternatives; used to spot migrations. */
  group?: string;
}

const configFile = (...stems: string[]) => (path: string): boolean => {
  const name = baseName(path);
  return stems.some((stem) => name === stem || name.startsWith(`${stem}.`));
};
const rootFile = (...names: string[]) => (path: string): boolean => names.includes(path);
const anyFile = (...names: string[]) => (path: string): boolean => names.includes(baseName(path));

/** Files whose presence identifies a tool. Presence is observed; that the tool is used is the natural reading. */
export const MARKERS: readonly Marker[] = [
  { name: "Bun", kind: "runtime", test: anyFile("bun.lock", "bun.lockb", "bunfig.toml"), group: "js-package-manager" },
  { name: "pnpm", kind: "package-manager", test: anyFile("pnpm-lock.yaml", "pnpm-workspace.yaml"), group: "js-package-manager" },
  { name: "Yarn", kind: "package-manager", test: anyFile("yarn.lock", ".yarnrc.yml"), group: "js-package-manager" },
  { name: "npm", kind: "package-manager", test: anyFile("package-lock.json", "npm-shrinkwrap.json"), group: "js-package-manager" },
  { name: "Deno", kind: "runtime", test: anyFile("deno.json", "deno.jsonc", "deno.lock") },
  { name: "Node.js", kind: "runtime", test: rootFile(".nvmrc", ".node-version") },
  { name: "TypeScript", kind: "language", test: (path) => /^tsconfig(\.[\w-]+)?\.json$/.test(baseName(path)) },
  { name: "Cargo", kind: "build-system", test: anyFile("Cargo.toml") },
  { name: "Go modules", kind: "build-system", test: anyFile("go.mod") },
  { name: "Poetry", kind: "package-manager", test: anyFile("poetry.lock"), group: "py-package-manager" },
  { name: "uv", kind: "package-manager", test: anyFile("uv.lock"), group: "py-package-manager" },
  { name: "Pipenv", kind: "package-manager", test: anyFile("Pipfile", "Pipfile.lock"), group: "py-package-manager" },
  { name: "pip requirements", kind: "package-manager", test: (path) => /^requirements([-.\w]*)?\.txt$/.test(baseName(path)), group: "py-package-manager" },
  { name: "setuptools", kind: "build-system", test: anyFile("setup.py", "setup.cfg") },
  { name: ".NET", kind: "platform", test: (path) => /\.(csproj|fsproj|vbproj|sln)$/.test(path) },
  { name: "CMake", kind: "build-system", test: anyFile("CMakeLists.txt") },
  { name: "Make", kind: "build-system", test: rootFile("Makefile", "makefile", "GNUmakefile") },
  { name: "Meson", kind: "build-system", test: anyFile("meson.build") },
  { name: "Bazel", kind: "build-system", test: anyFile("BUILD.bazel", "WORKSPACE", "WORKSPACE.bazel", "MODULE.bazel") },
  { name: "Gradle", kind: "build-system", test: anyFile("build.gradle", "build.gradle.kts", "settings.gradle", "settings.gradle.kts") },
  { name: "Maven", kind: "build-system", test: anyFile("pom.xml") },
  { name: "Bundler", kind: "package-manager", test: anyFile("Gemfile") },
  { name: "Composer", kind: "package-manager", test: anyFile("composer.json") },
  { name: "Mix", kind: "build-system", test: anyFile("mix.exs") },
  { name: "Swift Package Manager", kind: "build-system", test: anyFile("Package.swift") },
  { name: "Dart pub", kind: "package-manager", test: anyFile("pubspec.yaml") },
  { name: "Nix", kind: "tool", test: rootFile("flake.nix", "default.nix", "shell.nix") },
  { name: "Docker", kind: "platform", test: (path) => /^(Dockerfile|Containerfile)(\..+)?$|\.dockerfile$|^(docker-)?compose\.ya?ml$/.test(baseName(path)) },
  { name: "Terraform", kind: "tool", test: (path) => path.endsWith(".tf") },
  { name: "Helm", kind: "tool", test: anyFile("Chart.yaml") },
  { name: "Vite", kind: "tool", test: configFile("vite.config"), group: "js-bundler" },
  { name: "Webpack", kind: "tool", test: configFile("webpack.config"), group: "js-bundler" },
  { name: "Rollup", kind: "tool", test: configFile("rollup.config"), group: "js-bundler" },
  { name: "Next.js", kind: "framework", test: configFile("next.config") },
  { name: "Nuxt", kind: "framework", test: configFile("nuxt.config") },
  { name: "SvelteKit", kind: "framework", test: configFile("svelte.config") },
  { name: "Astro", kind: "framework", test: configFile("astro.config") },
  { name: "Tailwind CSS", kind: "library", test: configFile("tailwind.config") },
  { name: "Vitest", kind: "tool", test: configFile("vitest.config", "vitest.workspace"), group: "js-test-runner" },
  { name: "Jest", kind: "tool", test: configFile("jest.config"), group: "js-test-runner" },
  { name: "Playwright", kind: "tool", test: configFile("playwright.config") },
  { name: "Cypress", kind: "tool", test: configFile("cypress.config") },
  { name: "pytest", kind: "tool", test: anyFile("pytest.ini", "conftest.py") },
  { name: "tox", kind: "tool", test: anyFile("tox.ini") },
  { name: "ESLint", kind: "tool", test: (path) => /^(eslint\.config\.[cm]?[jt]s|\.eslintrc(\.[a-z]+)?)$/.test(baseName(path)), group: "js-linter" },
  { name: "Biome", kind: "tool", test: anyFile("biome.json", "biome.jsonc"), group: "js-linter" },
  { name: "Prettier", kind: "tool", test: (path) => /^(\.prettierrc(\.[a-z]+)?|prettier\.config\.[cm]?js)$/.test(baseName(path)) },
  { name: "Ruff", kind: "tool", test: anyFile("ruff.toml", ".ruff.toml") },
  { name: "golangci-lint", kind: "tool", test: (path) => /^\.golangci\.(ya?ml|toml|json)$/.test(baseName(path)) },
  { name: "rustfmt", kind: "tool", test: anyFile("rustfmt.toml", ".rustfmt.toml") },
  { name: "Clippy", kind: "tool", test: anyFile("clippy.toml", ".clippy.toml") },
  { name: "EditorConfig", kind: "tool", test: rootFile(".editorconfig") },
  { name: "pre-commit", kind: "tool", test: rootFile(".pre-commit-config.yaml") },
  { name: "Husky", kind: "tool", test: (path) => path.startsWith(".husky/") },
  { name: "Renovate", kind: "tool", test: (path) => /^(\.github\/)?renovate\.json5?$/.test(path) },
  { name: "Dependabot", kind: "tool", test: rootFile(".github/dependabot.yml", ".github/dependabot.yaml") },
  { name: "Storybook", kind: "tool", test: (path) => path.startsWith(".storybook/") },
  { name: "Prisma", kind: "library", test: (path) => path.endsWith("schema.prisma") },
  ...CI_SYSTEMS.map((system): Marker => ({ name: system.name, kind: "platform", test: (path) => system.pattern.test(path), group: "ci" })),
];

interface DependencyRule {
  match: string | RegExp;
  name: string;
  kind: Kind;
}

const DEPENDENCIES: Record<Manifest["ecosystem"], DependencyRule[]> = {
  npm: [
    { match: "react", name: "React", kind: "framework" },
    { match: "next", name: "Next.js", kind: "framework" },
    { match: "vue", name: "Vue", kind: "framework" },
    { match: "nuxt", name: "Nuxt", kind: "framework" },
    { match: "svelte", name: "Svelte", kind: "framework" },
    { match: "@sveltejs/kit", name: "SvelteKit", kind: "framework" },
    { match: "solid-js", name: "SolidJS", kind: "framework" },
    { match: "@angular/core", name: "Angular", kind: "framework" },
    { match: "astro", name: "Astro", kind: "framework" },
    { match: /^@remix-run\//, name: "Remix", kind: "framework" },
    { match: "react-native", name: "React Native", kind: "framework" },
    { match: "expo", name: "Expo", kind: "platform" },
    { match: "electron", name: "Electron", kind: "platform" },
    { match: "express", name: "Express", kind: "framework" },
    { match: "fastify", name: "Fastify", kind: "framework" },
    { match: "hono", name: "Hono", kind: "framework" },
    { match: "koa", name: "Koa", kind: "framework" },
    { match: "elysia", name: "Elysia", kind: "framework" },
    { match: "@nestjs/core", name: "NestJS", kind: "framework" },
    { match: "typescript", name: "TypeScript", kind: "language" },
    { match: "@types/bun", name: "Bun", kind: "runtime" },
    { match: "bun-types", name: "Bun", kind: "runtime" },
    { match: "vite", name: "Vite", kind: "tool" },
    { match: "webpack", name: "Webpack", kind: "tool" },
    { match: "esbuild", name: "esbuild", kind: "tool" },
    { match: "rollup", name: "Rollup", kind: "tool" },
    { match: "tsup", name: "tsup", kind: "tool" },
    { match: "turbo", name: "Turborepo", kind: "tool" },
    { match: "nx", name: "Nx", kind: "tool" },
    { match: "tailwindcss", name: "Tailwind CSS", kind: "library" },
    { match: "vitest", name: "Vitest", kind: "tool" },
    { match: "jest", name: "Jest", kind: "tool" },
    { match: "mocha", name: "Mocha", kind: "tool" },
    { match: "@playwright/test", name: "Playwright", kind: "tool" },
    { match: "cypress", name: "Cypress", kind: "tool" },
    { match: /^@testing-library\//, name: "Testing Library", kind: "tool" },
    { match: "eslint", name: "ESLint", kind: "tool" },
    { match: "prettier", name: "Prettier", kind: "tool" },
    { match: "@biomejs/biome", name: "Biome", kind: "tool" },
    { match: "@prisma/client", name: "Prisma", kind: "library" },
    { match: "prisma", name: "Prisma", kind: "library" },
    { match: "drizzle-orm", name: "Drizzle ORM", kind: "library" },
    { match: "mongoose", name: "Mongoose", kind: "library" },
    { match: "zod", name: "Zod", kind: "library" },
    { match: "graphql", name: "GraphQL", kind: "library" },
    { match: "@trpc/server", name: "tRPC", kind: "library" },
    { match: "three", name: "three.js", kind: "library" },
    { match: "d3", name: "D3", kind: "library" },
    { match: "socket.io", name: "Socket.IO", kind: "library" },
    { match: "@tanstack/react-query", name: "TanStack Query", kind: "library" },
    { match: "@reduxjs/toolkit", name: "Redux", kind: "library" },
    { match: "redux", name: "Redux", kind: "library" },
  ],
  deno: [],
  cargo: [
    { match: "tokio", name: "Tokio", kind: "library" },
    { match: "serde", name: "Serde", kind: "library" },
    { match: "axum", name: "Axum", kind: "framework" },
    { match: "actix-web", name: "Actix Web", kind: "framework" },
    { match: "rocket", name: "Rocket", kind: "framework" },
    { match: "clap", name: "clap", kind: "library" },
    { match: "bevy", name: "Bevy", kind: "framework" },
    { match: "tauri", name: "Tauri", kind: "framework" },
    { match: "wasm-bindgen", name: "wasm-bindgen", kind: "library" },
    { match: "reqwest", name: "reqwest", kind: "library" },
    { match: "sqlx", name: "SQLx", kind: "library" },
    { match: "diesel", name: "Diesel", kind: "library" },
    { match: "criterion", name: "Criterion", kind: "tool" },
    { match: "proptest", name: "proptest", kind: "tool" },
  ],
  python: [
    { match: "django", name: "Django", kind: "framework" },
    { match: "flask", name: "Flask", kind: "framework" },
    { match: "fastapi", name: "FastAPI", kind: "framework" },
    { match: "numpy", name: "NumPy", kind: "library" },
    { match: "pandas", name: "pandas", kind: "library" },
    { match: "torch", name: "PyTorch", kind: "library" },
    { match: "tensorflow", name: "TensorFlow", kind: "library" },
    { match: "scikit-learn", name: "scikit-learn", kind: "library" },
    { match: "pydantic", name: "Pydantic", kind: "library" },
    { match: "sqlalchemy", name: "SQLAlchemy", kind: "library" },
    { match: "click", name: "Click", kind: "library" },
    { match: "typer", name: "Typer", kind: "library" },
    { match: "streamlit", name: "Streamlit", kind: "framework" },
    { match: "pytest", name: "pytest", kind: "tool" },
    { match: "mypy", name: "mypy", kind: "tool" },
    { match: "ruff", name: "Ruff", kind: "tool" },
    { match: "black", name: "Black", kind: "tool" },
  ],
  go: [
    { match: "github.com/gin-gonic/gin", name: "Gin", kind: "framework" },
    { match: /^github\.com\/labstack\/echo/, name: "Echo", kind: "framework" },
    { match: /^github\.com\/gofiber\/fiber/, name: "Fiber", kind: "framework" },
    { match: /^github\.com\/go-chi\/chi/, name: "chi", kind: "library" },
    { match: "github.com/spf13/cobra", name: "Cobra", kind: "library" },
    { match: "gorm.io/gorm", name: "GORM", kind: "library" },
    { match: "google.golang.org/grpc", name: "gRPC", kind: "library" },
    { match: "github.com/stretchr/testify", name: "Testify", kind: "tool" },
  ],
  dotnet: [
    { match: /^Microsoft\.AspNetCore/, name: "ASP.NET Core", kind: "framework" },
    { match: /^Microsoft\.EntityFrameworkCore/, name: "Entity Framework Core", kind: "library" },
    { match: /^xunit/, name: "xUnit", kind: "tool" },
    { match: /^NUnit/, name: "NUnit", kind: "tool" },
    { match: /^MSTest/, name: "MSTest", kind: "tool" },
  ],
  cmake: [
    { match: "GTest", name: "GoogleTest", kind: "tool" },
    { match: "Catch2", name: "Catch2", kind: "tool" },
    { match: /^Qt[56]$/, name: "Qt", kind: "framework" },
    { match: "Boost", name: "Boost", kind: "library" },
    { match: "SDL2", name: "SDL2", kind: "library" },
    { match: "OpenGL", name: "OpenGL", kind: "library" },
    { match: "Vulkan", name: "Vulkan", kind: "library" },
  ],
};

const KIND_ORDER: Kind[] = ["language", "runtime", "framework", "library", "package-manager", "build-system", "tool", "platform"];
const LEVEL_STRENGTH: Record<EvidenceLevel, number> = { observed: 0, documented: 1, inferred: 2 };

interface Signal {
  name: string;
  kind: Kind;
  level: EvidenceLevel;
  basis: string;
  evidence: NewEvidence;
}

export interface TechnologyReport {
  technologies: Technology[];
  languages: LanguageShare[];
}

export function detectTechnologies(files: readonly TrackedFile[], manifests: readonly Manifest[], log: EvidenceLog): TechnologyReport {
  const signals: Signal[] = [];
  const languages = languageShares(files);

  for (const [rank, language] of languages.slice(0, 6).entries()) {
    if (language.share < 0.02 && rank > 0) continue;
    const extensions = [...new Set(files.filter((file) => languageOf(file.path)?.name === language.language).map((file) => extensionOf(file.path)))].sort();
    const percent = Math.round(language.share * 100);
    const basis = `${language.files} ${extensions.map((extension) => `${code(extension)}`).join("/")} file${language.files === 1 ? "" : "s"} (${percent < 1 ? "<1" : percent}% of source bytes), classified by file extension`;
    signals.push({
      name: language.language,
      kind: "language",
      level: "inferred",
      basis,
      evidence: {
        level: "inferred",
        category: "technology",
        statement: `${language.language} accounts for about ${percent < 1 ? "<1" : percent}% of tracked source bytes.`,
        basis: "Classified by file extension; vendored, generated, data, and documentation files are excluded.",
        source: {
          kind: "file-set",
          description: `Tracked ${language.language} files at HEAD`,
          total: language.files,
          paths: files.filter((file) => languageOf(file.path)?.name === language.language).slice(0, 5).map((file) => file.path),
        },
      },
    });
  }

  for (const marker of MARKERS) {
    const paths = files.map((file) => file.path).filter((path) => !isVendoredOrGenerated(path) && marker.test(path));
    if (paths.length === 0) continue;
    const only = paths.length === 1 ? paths[0] : undefined;
    const shown = paths.slice(0, 3).map((path) => `${code(path)}`).join(", ");
    signals.push({
      name: marker.name,
      kind: marker.kind,
      level: "observed",
      basis: `${shown}${paths.length > 3 ? ` and ${paths.length - 3} more` : ""} tracked`,
      evidence: {
        level: "observed",
        category: "technology",
        statement: only !== undefined ? `${code(only)} is tracked in the repository.` : `${paths.length} ${marker.name} files are tracked in the repository.`,
        source: only !== undefined ? { kind: "file", path: only } : { kind: "file-set", description: `${marker.name} files`, total: paths.length, paths: paths.slice(0, 10) },
      },
    });
  }

  for (const manifest of manifests) {
    const rules = DEPENDENCIES[manifest.ecosystem];
    const declared: [string, string][] = [
      ...manifest.dependencies.map((dep): [string, string] => [dep, "dependencies"]),
      ...manifest.devDependencies.map((dep): [string, string] => [dep, "development dependencies"]),
    ];
    for (const [dependency, section] of declared) {
      const rule = rules.find((candidate) => (typeof candidate.match === "string" ? candidate.match === dependency : candidate.match.test(dependency)));
      if (!rule) continue;
      signals.push({
        name: rule.name,
        kind: rule.kind,
        level: "observed",
        basis: `${code(dependency)} in ${code(manifest.path)} ${section}`,
        evidence: {
          level: "observed",
          category: "technology",
          statement: `${code(manifest.path)} declares ${code(dependency)} in its ${section}.`,
          source: { kind: "file", path: manifest.path, section },
        },
      });
    }
    const target = manifest.details["targetFramework"];
    if (target) {
      signals.push({
        name: ".NET",
        kind: "platform",
        level: "observed",
        basis: `targets ${code(target)} in ${code(manifest.path)}`,
        evidence: { level: "observed", category: "technology", statement: `${code(manifest.path)} targets ${code(target)}.`, source: { kind: "file", path: manifest.path } },
      });
    }
  }

  return { technologies: mergeSignals(signals, log), languages };
}

function mergeSignals(signals: readonly Signal[], log: EvidenceLog): Technology[] {
  const byName = new Map<string, Technology>();
  for (const signal of signals) {
    const id = log.add(signal.evidence);
    const existing = byName.get(signal.name);
    if (!existing) {
      byName.set(signal.name, { name: signal.name, kind: signal.kind, level: signal.level, basis: signal.basis, evidence: [id] });
      continue;
    }
    if (!existing.evidence.includes(id)) existing.evidence.push(id);
    if (!existing.basis.includes(signal.basis)) existing.basis = `${existing.basis}; ${signal.basis}`;
    if (LEVEL_STRENGTH[signal.level] < LEVEL_STRENGTH[existing.level]) existing.level = signal.level;
    if (KIND_ORDER.indexOf(signal.kind) < KIND_ORDER.indexOf(existing.kind)) existing.kind = signal.kind;
  }
  return [...byName.values()].sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
}

/** Language mix by bytes of programming and markup files, excluding vendored and generated paths. */
export function languageShares(files: readonly TrackedFile[]): LanguageShare[] {
  const totals = new Map<string, { files: number; bytes: number }>();
  for (const file of files) {
    if (file.kind === "symlink" || isVendoredOrGenerated(file.path)) continue;
    const language = languageOf(file.path);
    if (!language || (language.type !== "programming" && language.type !== "markup")) continue;
    const entry = totals.get(language.name) ?? { files: 0, bytes: 0 };
    entry.files++;
    entry.bytes += file.size;
    totals.set(language.name, entry);
  }
  const totalBytes = [...totals.values()].reduce((sum, entry) => sum + entry.bytes, 0);
  return [...totals.entries()]
    .map(([language, entry]) => ({ language, files: entry.files, bytes: entry.bytes, share: totalBytes === 0 ? 0 : entry.bytes / totalBytes }))
    .sort((a, b) => b.bytes - a.bytes || a.language.localeCompare(b.language));
}
