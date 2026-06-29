import { describe, expect, test } from "bun:test";
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

type PackageJson = {
  name?: string;
  workspaces?: string[];
  exports?: Record<string, string> | string;
  compilerOptions?: {
    paths?: Record<string, string[]>;
  };
};

const repoRoot = fileURLToPath(new URL("../../../../..", import.meta.url));
const selfPath = fileURLToPath(import.meta.url);
const chosenKernelRoot = join(repoRoot, "packages", "agent-kernel");
const docsKernelRoot = join(repoRoot, "ai_docs", "agent-kernel");
const chosenWorkspaceGlob = "packages/agent-kernel/packages/*";

const expectedKernelPackages = [
  "@codecaine-ai/prompt-kit",
  "@agent-kernel/db",
  "@agent-kernel/kernel",
  "@agent-kernel/protocol",
  "@agent-kernel/tailer",
  "@agent-kernel/viewer-core",
  "@agent-kernel/viewer-shell",
  "@agent-kernel/viewer-ui",
] as const;

function repoRelative(path: string): string {
  const rel = relative(repoRoot, path);
  return rel || ".";
}

function readJson(path: string): PackageJson {
  return JSON.parse(readFileSync(path, "utf8")) as PackageJson;
}

function isIgnoredDir(path: string): boolean {
  const rel = repoRelative(path);
  const parts = rel.split(sep);
  if (parts.includes("node_modules") || parts.includes(".git") || parts.includes("dist")) return true;
  if (parts.includes("references") && parts.includes("gc-decomp-harness")) return true;
  if (parts[0] === "projects" && parts.includes("checkout")) return true;
  if (parts[0] === ".decomp-orchestrator-state" || parts[0] === ".pi-sessions" || parts[0] === ".pi-agent") return true;
  return false;
}

function walkSourceFiles(start: string, results: string[] = [], seenRealDirs = new Set<string>()): string[] {
  if (!existsSync(start) || isIgnoredDir(start) || start === selfPath) return results;

  const lst = lstatSync(start);
  if (lst.isSymbolicLink()) {
    const followed = statSync(start);
    if (followed.isFile()) {
      if (/\.(?:ts|tsx|mts|cts)$/.test(start)) results.push(start);
      return results;
    }
    if (!followed.isDirectory()) return results;
    const real = realpathSync(start);
    if (seenRealDirs.has(real)) return results;
    seenRealDirs.add(real);
    for (const entry of readdirSync(start)) {
      if (entry === "node_modules" || entry === ".git" || entry === "dist") continue;
      walkSourceFiles(join(start, entry), results, seenRealDirs);
    }
    return results;
  }

  if (lst.isFile()) {
    if (/\.(?:ts|tsx|mts|cts)$/.test(start)) results.push(start);
    return results;
  }

  if (!lst.isDirectory()) return results;
  const real = realpathSync(start);
  if (seenRealDirs.has(real)) return results;
  seenRealDirs.add(real);
  for (const entry of readdirSync(start)) {
    if (entry === "node_modules" || entry === ".git" || entry === "dist") continue;
    walkSourceFiles(join(start, entry), results, seenRealDirs);
  }
  return results;
}

function exportedSpecifiers(packageJsonPath: string): Set<string> {
  const pkg = readJson(packageJsonPath);
  const specifiers = new Set<string>();
  if (!pkg.name?.startsWith("@agent-kernel/") && pkg.name !== "@codecaine-ai/prompt-kit") return specifiers;

  if (!pkg.exports || typeof pkg.exports === "string") {
    specifiers.add(pkg.name);
    return specifiers;
  }

  for (const key of Object.keys(pkg.exports)) {
    if (key === ".") {
      specifiers.add(pkg.name);
    } else if (key.startsWith("./")) {
      specifiers.add(`${pkg.name}/${key.slice(2)}`);
    }
  }
  return specifiers;
}

function collectBoundaryFailures(): string[] {
  const failures: string[] = [];
  const fail = (message: string) => failures.push(message);
  const assert = (condition: unknown, message: string) => {
    if (!condition) fail(message);
  };

  const rootPackage = readJson(join(repoRoot, "package.json"));
  assert(rootPackage.workspaces?.includes(chosenWorkspaceGlob), `root package.json must include workspace ${chosenWorkspaceGlob}`);
  assert(
    !rootPackage.workspaces?.some((workspace) => workspace.startsWith("ai_docs/agent-kernel")),
    "ai_docs/agent-kernel must remain a reference path, not a workspace package source",
  );

  const tsconfig = readJson(join(repoRoot, "tsconfig.base.json"));
  const paths = tsconfig.compilerOptions?.paths ?? {};
  for (const [alias, targets] of Object.entries(paths)) {
    if (!alias.startsWith("@agent-kernel/") && !alias.startsWith("@codecaine-ai/prompt-kit")) continue;
    for (const target of targets) {
      assert(target.startsWith("packages/agent-kernel/packages/"), `${alias} must resolve through packages/agent-kernel/packages, got ${target}`);
    }
  }

  assert(existsSync(chosenKernelRoot), "packages/agent-kernel must exist");
  assert(existsSync(join(chosenKernelRoot, "packages")), "packages/agent-kernel/packages must exist");

  const chosenRealRoot = existsSync(chosenKernelRoot) ? realpathSync(chosenKernelRoot) : "";
  if (existsSync(docsKernelRoot) && chosenRealRoot) {
    assert(
      realpathSync(docsKernelRoot) === chosenRealRoot,
      "ai_docs/agent-kernel may remain only as a reference alias to the chosen packages/agent-kernel source",
    );
  }

  const chosenPackageDirs = new Map<string, string>();
  const packageRoot = join(chosenKernelRoot, "packages");

  for (const entry of existsSync(packageRoot) ? readdirSync(packageRoot) : []) {
    const manifest = join(packageRoot, entry, "package.json");
    if (!existsSync(manifest)) continue;
    const pkg = readJson(manifest);
    if (!pkg.name?.startsWith("@agent-kernel/") && pkg.name !== "@codecaine-ai/prompt-kit") continue;
    assert(expectedKernelPackages.includes(pkg.name as (typeof expectedKernelPackages)[number]), `unexpected kernel package ${pkg.name}`);
    const realDir = realpathSync(dirname(manifest));
    if (chosenRealRoot && !realDir.startsWith(`${chosenRealRoot}${sep}packages${sep}`)) {
      fail(`${pkg.name} is outside the chosen kernel source: ${repoRelative(manifest)} -> ${realDir}`);
      continue;
    }
    chosenPackageDirs.set(pkg.name, dirname(manifest));
  }

  for (const packageName of expectedKernelPackages) {
    assert(chosenPackageDirs.has(packageName), `${packageName} must be present under packages/agent-kernel/packages`);
  }

  const harnessNeedles = ["@decomp-orchestrator/", "gamecube-decomp-harness", "apps/frontend", "apps/server"];
  for (const file of walkSourceFiles(join(chosenKernelRoot, "packages"))) {
    const text = readFileSync(file, "utf8");
    for (const needle of harnessNeedles) {
      if (text.includes(needle)) fail(`kernel source must not import or reference harness path ${needle}: ${repoRelative(file)}`);
    }
  }

  const allowedSpecifiers = new Set<string>();
  for (const manifestPath of chosenPackageDirs.values()) {
    for (const specifier of exportedSpecifiers(join(manifestPath, "package.json"))) {
      allowedSpecifiers.add(specifier);
    }
  }

  const importPattern = /(?:from\s+|import\s*\(|require\s*\()\s*["']((?:@agent-kernel\/[^"']+)|(?:@codecaine-ai\/prompt-kit(?:\/[^"']+)?))["']/g;
  const directPathImportPattern =
    /(?:from\s+|import\s*\(|require\s*\()\s*["'][^"']*(?:ai_docs\/agent-kernel|vendor\/agent-kernel\/packages\/|packages\/agent-kernel\/packages\/)[^"']*["']/;
  const appRoots = ["apps", "tests"].map((root) => join(repoRoot, root));

  for (const root of appRoots) {
    for (const file of walkSourceFiles(root)) {
      const text = readFileSync(file, "utf8");
      if (directPathImportPattern.test(text)) {
        fail(`app code must use @agent-kernel/* package exports instead of direct kernel paths: ${repoRelative(file)}`);
      }

      let match: RegExpExecArray | null;
      while ((match = importPattern.exec(text))) {
        const specifier = match[1];
        assert(allowedSpecifiers.has(specifier), `unknown or unexported @agent-kernel import ${specifier} in ${repoRelative(file)}`);
      }
    }
  }

  return failures;
}

describe("agent-kernel package boundaries", () => {
  test("keeps the harness on package exports and the kernel source isolated", () => {
    expect(collectBoundaryFailures()).toEqual([]);
  });
});
