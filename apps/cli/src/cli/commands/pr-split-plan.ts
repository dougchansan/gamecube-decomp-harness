import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { readRegressionReport } from "@decomp-orchestrator/core/objdiff/report";
import { runCommand } from "@decomp-orchestrator/core/shell";
import { booleanArg, numberArg, stringArg, type GlobalArgs } from "../args.js";

type ChangeSource = "branch" | "worktree";
type GroupMode = "melee-subsystem" | "top-dir";
type IndependenceKind = "independent" | "shared-prep" | "stacked" | "needs-merge";
type PrLane = "match" | "local";

export interface PrLaneSets {
  matchPaths: string[];
  improvementPaths: string[];
}

// The ship-set verification verdict (ship_status.json): which match-lane
// files survived the survivor loop and which were dropped, with reasons.
export interface PrShipFilter {
  shippedPaths: string[];
  droppedReasons: Record<string, string[]>;
}

export interface PrChangedFile {
  path: string;
  oldPath?: string;
  statuses: string[];
  sources: ChangeSource[];
}

interface RawChangedFile {
  path: string;
  oldPath?: string;
  status: string;
  source: ChangeSource;
}

interface ChangeGroup {
  id: string;
  displayName: string;
  scope: string;
  category: "shared" | "subsystem" | "support";
  lane?: PrLane | null;
  laneWarnings?: string[];
  files: PrChangedFile[];
}

interface PrSliceIndependence {
  kind: IndependenceKind;
  verified: boolean;
  confidence: "medium" | "low";
  reasons: string[];
  requiredChecks: string[];
  possibleDependencies: string[];
}

export interface PrSplitSlice {
  id: string;
  displayName: string;
  title: string;
  branchName: string;
  lane: PrLane | null;
  scope: string;
  directories: string[];
  fileCount: number;
  files: PrChangedFile[];
  pathspecs: string[];
  statusCounts: Record<string, number>;
  sources: ChangeSource[];
  independence: PrSliceIndependence;
  commands: string[];
  isolationCommands: string[];
  warnings: string[];
}

export interface PrSplitPlan {
  repoRoot: string;
  baseRef: string;
  headRef: string;
  currentBranch: string;
  groupMode: GroupMode;
  maxFilesPerPr: number;
  lanesApplied: boolean;
  shipFilterApplied: boolean;
  totalFiles: number;
  slices: PrSplitSlice[];
  warnings: string[];
}

interface BuildPlanOptions {
  repoRoot: string;
  baseRef: string;
  headRef: string;
  currentBranch: string;
  groupMode: GroupMode;
  maxFilesPerPr: number;
  /** Match slices below this size merge together (1 disables merging). */
  minFilesPerPr?: number;
  branchPrefix: string;
  titlePrefix: string;
  sliceCheckCommand: string;
  lanes?: PrLaneSets | null;
  shipFilter?: PrShipFilter | null;
  warnings?: string[];
}

function splitZ(output: string): string[] {
  const parts = output.split("\0");
  if (parts.at(-1) === "") parts.pop();
  return parts;
}

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//, "");
}

// decomp-permuter scratch copies (.permute-<id>.c, .permute-pch-<id>.mch)
// that escape cleanup and land in the worktree, index, or a commit.
const SCRATCH_FILE_PATTERN = /(^|\/)\.permute-/;

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:=,@%+-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

function sanitizeId(value: string): string {
  return value
    .trim()
    .replaceAll("\\", "/")
    .replace(/([a-z])([A-Z])/g, "$1-$2")
    .toLowerCase()
    .replace(/[^a-z0-9._/-]+/g, "-")
    .replace(/^[-/]+|[-/]+$/g, "")
    .replace(/\/+/g, "-")
    .replace(/-+/g, "-");
}

function displayNameFor(id: string): string {
  if (/^[a-z]{2}$/.test(id)) return id.toUpperCase();
  if (id === "sysdolphin") return "SysDolphin";
  if (id === "runtime") return "Runtime";
  if (id === "msl") return "MSL";
  if (id === "metrotrk") return "MetroTRK";
  return id
    .split("-")
    .filter(Boolean)
    .map((part) => (/^[a-z]{2}$/.test(part) ? part.toUpperCase() : part.slice(0, 1).toUpperCase() + part.slice(1)))
    .join(" ");
}

function titleFor(prefix: string, displayName: string): string {
  return prefix ? `${prefix}: ${displayName}` : displayName;
}

function directoryForPath(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "." : path.slice(0, slash);
}

function extensionForPath(path: string): string {
  const basename = path.split("/").at(-1) ?? "";
  const dot = basename.lastIndexOf(".");
  return dot === -1 ? "" : basename.slice(dot + 1).toLowerCase();
}

function isBuildOrGeneratedPath(path: string): boolean {
  const normalized = normalizePath(path);
  const basename = normalized.split("/").at(-1) ?? "";
  return (
    normalized.startsWith("build/") ||
    normalized.startsWith(".github/") ||
    normalized.startsWith("config/") ||
    normalized.startsWith("tools/") ||
    basename === "objdiff.json" ||
    basename === "report.json" ||
    basename === "report_changes.json" ||
    basename === "configure.py" ||
    basename === "Makefile" ||
    basename.endsWith(".ld") ||
    basename.endsWith(".lcf") ||
    basename.endsWith(".lds") ||
    basename.includes("symbols") ||
    basename.includes("splits")
  );
}

function isScopedToMeleeSubsystem(path: string, sliceId: string): boolean {
  const parts = normalizePath(path).split("/").filter(Boolean);
  const meleeIndex = parts.indexOf("melee");
  return meleeIndex >= 0 && sanitizeId(parts[meleeIndex + 1] ?? "") === sliceId;
}

function isReviewableSourceLikePath(path: string): boolean {
  const extension = extensionForPath(path);
  return extension === "c" || extension === "h" || extension === "s" || extension === "inc";
}

function groupForPath(path: string, groupMode: GroupMode): Omit<ChangeGroup, "files"> {
  const parts = normalizePath(path).split("/").filter(Boolean);
  if (groupMode === "top-dir") {
    const id = sanitizeId(parts[0] ?? "root") || "root";
    return {
      id,
      displayName: displayNameFor(id),
      scope: parts[0] ?? ".",
      category: id === "root" ? "shared" : "support",
    };
  }

  const meleeIndex = parts.indexOf("melee");
  if (meleeIndex >= 0 && parts[meleeIndex + 1]) {
    const subsystem = parts[meleeIndex + 1];
    const id = sanitizeId(subsystem);
    return {
      id,
      displayName: displayNameFor(id),
      scope: `melee/${subsystem}`,
      category: "subsystem",
    };
  }

  const supportRoots = ["sysdolphin", "Runtime", "MSL", "MetroTRK"];
  for (const root of supportRoots) {
    const index = parts.findIndex((part) => part.toLowerCase() === root.toLowerCase());
    if (index >= 0) {
      const id = sanitizeId(root);
      return {
        id,
        displayName: displayNameFor(id),
        scope: parts.slice(0, index + 1).join("/"),
        category: "support",
      };
    }
  }

  const id = sanitizeId(parts[0] ?? "shared") || "shared";
  return {
    id,
    displayName: displayNameFor(id),
    scope: parts[0] ?? ".",
    category: "shared",
  };
}

function refinementId(path: string, group: ChangeGroup): string {
  const parts = normalizePath(path).split("/").filter(Boolean);
  const scopeParts = group.scope.split("/").filter(Boolean);
  const anchor = scopeParts.length >= 2 ? parts.findIndex((part, index) => part === scopeParts[0] && parts[index + 1] === scopeParts[1]) : -1;
  const afterScope = anchor >= 0 ? parts.slice(anchor + scopeParts.length) : parts.slice(1);
  const directories = afterScope.filter((part) => !part.includes("."));
  if (directories.length === 0) return `${group.id}-root`;
  if (directories[0] === "chara" && directories[1]) return `${group.id}-chara-${sanitizeId(directories[1])}`;
  return `${group.id}-${sanitizeId(directories[0])}`;
}

function mergeChanges(changes: RawChangedFile[]): PrChangedFile[] {
  const byPath = new Map<string, PrChangedFile>();
  for (const change of changes) {
    const path = normalizePath(change.path);
    if (!path || path.startsWith(".git/")) continue;
    const existing = byPath.get(path);
    if (existing) {
      if (!existing.statuses.includes(change.status)) existing.statuses.push(change.status);
      if (!existing.sources.includes(change.source)) existing.sources.push(change.source);
      if (!existing.oldPath && change.oldPath) existing.oldPath = normalizePath(change.oldPath);
    } else {
      byPath.set(path, {
        path,
        oldPath: change.oldPath ? normalizePath(change.oldPath) : undefined,
        statuses: [change.status],
        sources: [change.source],
      });
    }
  }
  return Array.from(byPath.values()).sort((left, right) => left.path.localeCompare(right.path));
}

function statusCounts(files: PrChangedFile[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const file of files) {
    for (const status of file.statuses) counts[status] = (counts[status] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

function sliceSources(files: PrChangedFile[]): ChangeSource[] {
  const sources = new Set<ChangeSource>();
  for (const file of files) for (const source of file.sources) sources.add(source);
  return Array.from(sources).sort();
}

function sortGroups(left: ChangeGroup, right: ChangeGroup): number {
  const categoryOrder = { shared: 0, subsystem: 1, support: 2 };
  return categoryOrder[left.category] - categoryOrder[right.category] || left.id.localeCompare(right.id);
}

// Subsystem grouping is a starting proposal, not the PR boundary: a slice
// only earns its own PR when it is big enough to justify one. Small
// match-lane subsystem slices pack together (first-fit decreasing, capped by
// maxFilesPerPr) so reviewers get the fewest comfortable PRs instead of a
// pile of one-file ones. Shared/support slices never merge — their risk
// class is the reason they are separate.
function mergeSmallMatchGroups(groups: ChangeGroup[], minFilesPerPr: number, maxFilesPerPr: number): ChangeGroup[] {
  if (minFilesPerPr <= 1) return groups;
  const small = groups.filter((group) => group.lane === "match" && group.category === "subsystem" && group.files.length < minFilesPerPr);
  if (small.length < 2) return groups;
  const rest = groups.filter((group) => !small.includes(group));
  const bins: ChangeGroup[][] = [];
  for (const group of [...small].sort((left, right) => right.files.length - left.files.length)) {
    const bin = bins.find((candidate) => candidate.reduce((total, member) => total + member.files.length, 0) + group.files.length <= maxFilesPerPr);
    if (bin) bin.push(group);
    else bins.push([group]);
  }
  const merged = bins.map((bin) => {
    if (bin.length === 1) return bin[0];
    const ordered = [...bin].sort(sortGroups);
    return {
      id: ordered.map((member) => member.id).join("-"),
      displayName: ordered.map((member) => member.displayName).join(" + "),
      scope: ordered.map((member) => member.scope).join(", "),
      category: "subsystem" as const,
      lane: "match" as const,
      laneWarnings: [
        `Merged ${ordered.length} small subsystem slices (${ordered.map((member) => `${member.displayName}: ${member.files.length} file${member.files.length === 1 ? "" : "s"}`).join(", ")}) — each was below --min-files-per-pr=${minFilesPerPr}.`,
        ...new Set(ordered.flatMap((member) => member.laneWarnings ?? [])),
      ],
      files: ordered.flatMap((member) => member.files),
    };
  });
  return [...rest, ...merged];
}

function maybeSplitLargeGroup(group: ChangeGroup, maxFilesPerPr: number): ChangeGroup[] {
  if (group.files.length <= maxFilesPerPr) return [group];
  const buckets = new Map<string, PrChangedFile[]>();
  for (const file of group.files) {
    const id = refinementId(file.path, group);
    const bucket = buckets.get(id) ?? [];
    bucket.push(file);
    buckets.set(id, bucket);
  }
  if (buckets.size <= 1) return [group];
  return Array.from(buckets.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([id, files]) => ({
      ...group,
      id,
      displayName: displayNameFor(id),
      scope: `${group.scope}/${id.replace(`${group.id}-`, "")}`,
      files,
    }));
}

function commandsForSlice(slice: Omit<PrSplitSlice, "commands" | "isolationCommands">, baseRef: string, headRef: string): string[] {
  const pathspecs = slice.pathspecs.map(shellQuote).join(" ");
  return [
    `git switch -c ${shellQuote(slice.branchName)} ${shellQuote(baseRef)}`,
    `git diff --binary ${shellQuote(`${baseRef}...${headRef}`)} -- ${pathspecs} | git apply --index`,
    `git commit -m ${shellQuote(slice.title)}`,
  ];
}

function checkCommandForSlice(slice: Omit<PrSplitSlice, "commands" | "isolationCommands">, repoRoot: string, sliceCheckCommand: string): string {
  return sliceCheckCommand
    .replaceAll("{slice_dir}", "$SLICE_DIR")
    .replaceAll("{slice_id}", slice.id)
    .replaceAll("{repo_root}", shellQuote(repoRoot));
}

function isolationCommandsForSlice(
  slice: Omit<PrSplitSlice, "commands" | "isolationCommands">,
  options: Pick<BuildPlanOptions, "baseRef" | "headRef" | "repoRoot" | "sliceCheckCommand">,
): string[] {
  const pathspecs = slice.pathspecs.map(shellQuote).join(" ");
  const tempPrefix = `melee-pr-${sanitizeId(slice.id) || "slice"}-XXXXXX`;
  return [
    `SLICE_DIR="$(mktemp -d "\${TMPDIR:-/tmp}/${tempPrefix}")"`,
    `git worktree add --detach "$SLICE_DIR" ${shellQuote(options.baseRef)}`,
    `git diff --binary ${shellQuote(`${options.baseRef}...${options.headRef}`)} -- ${pathspecs} | git -C "$SLICE_DIR" apply --index`,
    `(cd "$SLICE_DIR" && ${checkCommandForSlice(slice, options.repoRoot, options.sliceCheckCommand)})`,
    `git worktree remove "$SLICE_DIR"`,
  ];
}

function classifyIndependence(group: ChangeGroup, files: PrChangedFile[], maxFilesPerPr: number): PrSliceIndependence {
  const reasons: string[] = [];
  const requiredChecks = [
    "apply this slice to a fresh branch or worktree based on the selected base ref",
    "run configure/build for that isolated slice",
    "run the saved-baseline regression gate or equivalent local PR check",
    "promote to a true independent PR only if the isolated slice passes",
  ];
  const hasGeneratedOrBuildPath = files.some((file) => isBuildOrGeneratedPath(file.path));
  const hasUntracked = files.some((file) => file.statuses.some((status) => status.startsWith("??")));
  const hasWorktree = files.some((file) => file.sources.includes("worktree"));
  const hasDeletionOrRename = files.some((file) => file.statuses.some((status) => status.includes("D") || status.includes("R")));
  const subsystemId =
    group.category === "subsystem" ? sanitizeId(group.scope.split("/").filter(Boolean)[1] ?? "") || group.id : group.id;
  const allScopedSourceLike =
    group.category === "subsystem" &&
    files.every((file) => isScopedToMeleeSubsystem(file.path, subsystemId) && isReviewableSourceLikePath(file.path));
  const hasCrossCuttingHeader = files.some((file) => extensionForPath(file.path) === "h" && !isScopedToMeleeSubsystem(file.path, subsystemId));

  if (files.length > maxFilesPerPr) {
    reasons.push(`slice has ${files.length} files, above --max-files-per-pr=${maxFilesPerPr}`);
    return { kind: "needs-merge", verified: false, confidence: "low", reasons, requiredChecks, possibleDependencies: [] };
  }

  if (hasGeneratedOrBuildPath) {
    reasons.push("contains build, generated, config, symbol, split, or CI-adjacent files");
    return { kind: "shared-prep", verified: false, confidence: "low", reasons, requiredChecks, possibleDependencies: [] };
  }

  if (group.category === "shared") {
    reasons.push("changes are outside a Melee subsystem directory");
    return { kind: "shared-prep", verified: false, confidence: "low", reasons, requiredChecks, possibleDependencies: [] };
  }

  if (group.category === "support") {
    reasons.push("support-library changes may affect multiple Melee subsystem slices");
    return { kind: "shared-prep", verified: false, confidence: "low", reasons, requiredChecks, possibleDependencies: [] };
  }

  if (hasCrossCuttingHeader) {
    reasons.push("contains headers or declarations outside this slice's Melee subsystem");
    return { kind: "stacked", verified: false, confidence: "low", reasons, requiredChecks, possibleDependencies: [] };
  }

  if (hasDeletionOrRename) {
    reasons.push("contains deletes or renames that may affect references outside the directory slice");
    return { kind: "stacked", verified: false, confidence: "low", reasons, requiredChecks, possibleDependencies: [] };
  }

  if (allScopedSourceLike) {
    reasons.push(`all files are source/header-like paths scoped to ${group.scope}`);
    if (hasWorktree) reasons.push("worktree changes still need to be committed or stashed before final isolation validation");
    if (hasUntracked) reasons.push("untracked files must be intentionally added before final isolation validation");
    return { kind: "independent", verified: false, confidence: "medium", reasons, requiredChecks, possibleDependencies: [] };
  }

  reasons.push("slice is subsystem-scoped but includes files outside the normal source/header isolation pattern");
  return { kind: "stacked", verified: false, confidence: "low", reasons, requiredChecks, possibleDependencies: [] };
}

function lanePathMatcher(paths: string[]): (changedPath: string) => boolean {
  const candidates = new Set(paths.map(normalizePath).filter(Boolean));
  return (changedPath) => {
    const path = normalizePath(changedPath);
    if (candidates.has(path)) return true;
    // Checkpoint source paths and git paths can differ by a repo-root prefix
    // (e.g. "melee/mn/mnnamenew.c" vs "src/melee/mn/mnnamenew.c").
    for (const candidate of candidates) {
      if (path.endsWith(`/${candidate}`) || candidate.endsWith(`/${path}`)) return true;
    }
    return false;
  };
}

// Splits one subsystem group into a match-lane group (what ships) and a
// local-only group (what stays on the branch). Only matches ship; support
// files (headers, declarations, build glue) ride the match lane when one
// exists because the matches need them to build, and otherwise stay local.
// When a ship filter is present (the survivor-loop verdict), files the
// verification dropped are demoted to the local lane with their drop reasons.
function splitGroupByLane(group: ChangeGroup, lanes: PrLaneSets, shipFilter: PrShipFilter | null): ChangeGroup[] {
  const isMatch = lanePathMatcher(lanes.matchPaths);
  const isImprovement = lanePathMatcher(lanes.improvementPaths);
  const matchFiles: PrChangedFile[] = [];
  const localFiles: PrChangedFile[] = [];
  const supportFiles: PrChangedFile[] = [];
  let mixedCount = 0;
  for (const file of group.files) {
    if (isMatch(file.path)) {
      matchFiles.push(file);
      if (isImprovement(file.path)) mixedCount += 1;
    } else if (isImprovement(file.path)) {
      localFiles.push(file);
    } else {
      supportFiles.push(file);
    }
  }

  // The ship filter is the verified survivor set: anything the survivor loop
  // dropped (or never verified) moves to the local lane instead of a PR.
  const droppedFromShip: string[] = [];
  if (shipFilter) {
    const isShipped = lanePathMatcher(shipFilter.shippedPaths);
    const isDropped = lanePathMatcher(Object.keys(shipFilter.droppedReasons));
    const keepShipped = (files: PrChangedFile[]): PrChangedFile[] =>
      files.filter((file) => {
        if (isShipped(file.path)) return true;
        if (isDropped(file.path)) {
          const reasonKey = Object.keys(shipFilter.droppedReasons).find(
            (dropped) => normalizePath(dropped) === normalizePath(file.path) || normalizePath(file.path).endsWith(`/${normalizePath(dropped)}`) || normalizePath(dropped).endsWith(`/${normalizePath(file.path)}`),
          );
          const reasons = reasonKey ? shipFilter.droppedReasons[reasonKey] ?? [] : [];
          droppedFromShip.push(`${file.path}${reasons.length > 0 ? ` (${reasons.join("; ")})` : ""}`);
          localFiles.push(file);
          return false;
        }
        droppedFromShip.push(`${file.path} (not in the verified ship set)`);
        localFiles.push(file);
        return false;
      });
    const survivedMatches = keepShipped(matchFiles);
    const survivedSupport = keepShipped(supportFiles);
    matchFiles.length = 0;
    matchFiles.push(...survivedMatches);
    supportFiles.length = 0;
    supportFiles.push(...survivedSupport);
  }

  const groups: ChangeGroup[] = [];
  if (matchFiles.length > 0) {
    const laneWarnings: string[] = [];
    if (mixedCount > 0) {
      laneWarnings.push(`${mixedCount} file(s) in this match slice also carry unshipped fuzzy improvements in other functions; call that out in the PR body.`);
    }
    if (supportFiles.length > 0) {
      laneWarnings.push(`${supportFiles.length} supporting file(s) are not checkpoint candidates; confirm each is required for the matches to build.`);
    }
    if (droppedFromShip.length > 0) {
      laneWarnings.push(`${droppedFromShip.length} file(s) dropped by ship-set verification moved to the local lane: ${droppedFromShip.join(", ")}`);
    }
    groups.push({ ...group, lane: "match", laneWarnings, files: [...matchFiles, ...supportFiles] });
  }
  if (localFiles.length > 0 || (matchFiles.length === 0 && supportFiles.length > 0)) {
    const files = matchFiles.length > 0 ? localFiles : [...localFiles, ...supportFiles];
    const laneWarnings = ["Local-only: improvements and support files that do not ship. They stay on the branch until the work becomes an exact match."];
    if (matchFiles.length === 0 && droppedFromShip.length > 0) {
      laneWarnings.push(`${droppedFromShip.length} file(s) dropped by ship-set verification: ${droppedFromShip.join(", ")}`);
    }
    groups.push({
      ...group,
      id: `local-${group.id}`,
      displayName: `${group.displayName} (local only)`,
      lane: "local",
      laneWarnings,
      files,
    });
  }
  if (groups.length === 0) {
    groups.push({ ...group, lane: null, laneWarnings: ["No files in this slice are checkpoint candidates; it likely predates the checkpoint or is shared prep."] });
  }
  return groups;
}

export function buildPrSplitPlanFromChanges(changes: RawChangedFile[], options: BuildPlanOptions): PrSplitPlan {
  const files = mergeChanges(changes);
  const groups = new Map<string, ChangeGroup>();
  for (const file of files) {
    const groupKey = groupForPath(file.path, options.groupMode);
    const existing = groups.get(groupKey.id);
    if (existing) {
      existing.files.push(file);
    } else {
      groups.set(groupKey.id, { ...groupKey, files: [file] });
    }
  }

  const warnings = [...(options.warnings ?? [])];
  const lanes = options.lanes ?? null;
  const shipFilter = options.shipFilter ?? null;
  const splitGroups = lanes ? Array.from(groups.values()).flatMap((group) => splitGroupByLane(group, lanes, shipFilter)) : Array.from(groups.values());
  const laneGroups = lanes ? mergeSmallMatchGroups(splitGroups, options.minFilesPerPr ?? 1, options.maxFilesPerPr) : splitGroups;
  const slicesWithoutCommands: Array<Omit<PrSplitSlice, "commands" | "isolationCommands">> = laneGroups
    .sort(sortGroups)
    .flatMap((group) => maybeSplitLargeGroup(group, options.maxFilesPerPr))
    .map((group) => {
      const groupWarnings: string[] = [...(group.laneWarnings ?? [])];
      if (group.files.length > options.maxFilesPerPr) {
        groupWarnings.push(`This slice has ${group.files.length} files, above --max-files-per-pr=${options.maxFilesPerPr}; split it manually if review still feels heavy.`);
      }
      if (group.files.some((file) => file.sources.includes("worktree"))) {
        groupWarnings.push("This slice includes worktree changes; commit or stash them before using the patch workflow from HEAD.");
      }
      if (group.files.some((file) => file.statuses.some((status) => status.startsWith("??")))) {
        groupWarnings.push("This slice includes untracked files; add them intentionally before opening a PR.");
      }
      const directories = Array.from(new Set(group.files.map((file) => directoryForPath(file.path)))).sort();
      const pathspecs = group.files.map((file) => file.path).sort();
      const branchPart = sanitizeId(group.id) || "shared";
      const independence = classifyIndependence(group, group.files, options.maxFilesPerPr);
      return {
        id: group.id,
        displayName: group.displayName,
        title: titleFor(options.titlePrefix, group.displayName),
        branchName: `${options.branchPrefix.replace(/\/+$/g, "")}/${branchPart}`,
        lane: group.lane ?? null,
        scope: group.scope,
        directories,
        fileCount: group.files.length,
        files: group.files,
        pathspecs,
        statusCounts: statusCounts(group.files),
        sources: sliceSources(group.files),
        independence,
        warnings: groupWarnings,
      };
    });

  const slices = slicesWithoutCommands.map((slice) => ({
    ...slice,
    commands: commandsForSlice(slice, options.baseRef, options.headRef),
    isolationCommands: isolationCommandsForSlice(slice, options),
  }));

  if (files.some((file) => file.sources.includes("worktree"))) {
    warnings.push("Worktree changes are included in the plan, but generated patch commands only replay committed branch changes from HEAD.");
  }
  const sharedPrepIds = slices.filter((slice) => slice.independence.kind === "shared-prep").map((slice) => slice.id);
  for (const slice of slices) {
    if (slice.independence.kind === "stacked" && sharedPrepIds.length > 0) {
      slice.independence.possibleDependencies = sharedPrepIds;
    }
  }
  if (sharedPrepIds.length > 0) {
    warnings.push(`Shared-prep slices detected (${sharedPrepIds.join(", ")}); validate subsystem slices standalone first, then stack them only if they require shared-prep changes.`);
  }

  return {
    repoRoot: options.repoRoot,
    baseRef: options.baseRef,
    headRef: options.headRef,
    currentBranch: options.currentBranch,
    groupMode: options.groupMode,
    maxFilesPerPr: options.maxFilesPerPr,
    lanesApplied: Boolean(lanes),
    shipFilterApplied: Boolean(lanes && shipFilter),
    totalFiles: files.length,
    slices,
    warnings,
  };
}

function parseNameStatus(output: string): RawChangedFile[] {
  const fields = splitZ(output);
  const changes: RawChangedFile[] = [];
  for (let index = 0; index < fields.length; ) {
    const status = fields[index++] ?? "";
    if (!status) continue;
    if (status.startsWith("R") || status.startsWith("C")) {
      const oldPath = fields[index++] ?? "";
      const path = fields[index++] ?? "";
      changes.push({ path, oldPath, status, source: "branch" });
    } else {
      const path = fields[index++] ?? "";
      changes.push({ path, status, source: "branch" });
    }
  }
  return changes;
}

function parsePorcelainStatus(output: string, includeUntracked: boolean): RawChangedFile[] {
  const fields = splitZ(output);
  const changes: RawChangedFile[] = [];
  for (let index = 0; index < fields.length; ) {
    const entry = fields[index++] ?? "";
    if (entry.length < 4) continue;
    const status = entry.slice(0, 2);
    const path = entry.slice(3);
    if (status === "??" && !includeUntracked) continue;
    if (status.includes("R") || status.includes("C")) {
      const oldPath = fields[index++] ?? "";
      changes.push({ path, oldPath, status, source: "worktree" });
    } else {
      changes.push({ path, status, source: "worktree" });
    }
  }
  return changes;
}

async function git(repoRoot: string, args: string[], failureHint: string): Promise<string> {
  const result = await runCommand(repoRoot, ["git", ...args]);
  if (result.exitCode !== 0) {
    throw new Error(`${failureHint}\nCommand: git ${args.join(" ")}\n${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

async function collectChanges(options: {
  repoRoot: string;
  baseRef: string;
  includeBranchDiff: boolean;
  includeWorktree: boolean;
  includeUntracked: boolean;
}): Promise<{ changes: RawChangedFile[]; currentBranch: string; headRef: string; warnings: string[] }> {
  const currentBranch = (await git(options.repoRoot, ["branch", "--show-current"], "Unable to read the current branch.")).trim() || "(detached)";
  const headRef = (await git(options.repoRoot, ["rev-parse", "--verify", "HEAD"], "Unable to read HEAD.")).trim();
  const changes: RawChangedFile[] = [];
  const warnings: string[] = [];

  if (options.includeBranchDiff) {
    const diff = await git(
      options.repoRoot,
      ["diff", "--name-status", "-z", "--find-renames", `${options.baseRef}...HEAD`],
      `Unable to diff against ${options.baseRef}. Fetch or pass --base-ref <ref>.`,
    );
    changes.push(...parseNameStatus(diff));
  }

  if (options.includeWorktree) {
    const status = await git(
      options.repoRoot,
      ["status", "--porcelain=v1", "-z", options.includeUntracked ? "--untracked-files=all" : "--untracked-files=no"],
      "Unable to inspect worktree status.",
    );
    changes.push(...parsePorcelainStatus(status, options.includeUntracked));
  }

  if (!options.includeBranchDiff) warnings.push("Branch diff was skipped; the plan only reflects worktree status.");
  if (!options.includeWorktree) warnings.push("Worktree status was skipped; the plan only reflects committed branch changes.");

  // Tooling scratch files (decomp-permuter work copies) are never plan
  // content, even when they leak into the index or a commit.
  const scratch = changes.filter((change) => SCRATCH_FILE_PATTERN.test(change.path));
  if (scratch.length > 0) {
    warnings.push(`Excluded ${scratch.length} permuter scratch file(s) (.permute-*) from the plan: ${scratch.map((change) => change.path).join(", ")}`);
  }
  return { changes: changes.filter((change) => !SCRATCH_FILE_PATTERN.test(change.path)), currentBranch, headRef, warnings };
}

function renderFileLine(file: PrChangedFile): string {
  const status = file.statuses.join("+");
  const rename = file.oldPath ? ` (from ${file.oldPath})` : "";
  const sources = file.sources.length > 1 ? ` [${file.sources.join(", ")}]` : "";
  return `- ${status} ${file.path}${rename}${sources}`;
}

export function renderPrSplitPlan(plan: PrSplitPlan): string {
  const lines: string[] = [
    "# PR Split Plan",
    "",
    `Repo: ${plan.repoRoot}`,
    `Base: ${plan.baseRef}`,
    `Source: ${plan.currentBranch} @ ${plan.headRef}`,
    `Grouping: ${plan.groupMode}`,
    `Files: ${plan.totalFiles}`,
    `Slices: ${plan.slices.length}`,
    `Max files per PR: ${plan.maxFilesPerPr} (hard ceiling, not a target — pack slices for easy review without producing a pile of PRs)`,
  ];

  if (plan.lanesApplied) {
    const matchSlices = plan.slices.filter((slice) => slice.lane === "match").length;
    const localSlices = plan.slices.filter((slice) => slice.lane === "local").length;
    lines.push(
      `Lanes: ${matchSlices} match slice(s) ship, ${localSlices} local-only slice(s) stay on the branch. Only exact matches that survived the full build and regression gate go into PRs; improvements and other local work ship later, when they become matches.`,
    );
    if (plan.shipFilterApplied) {
      lines.push("Ship filter: match slices contain only files that survived ship-set verification; files the survivor loop dropped ride the local lane.");
    }
  }

  if (plan.warnings.length > 0) {
    lines.push("", "Warnings:");
    for (const warning of plan.warnings) lines.push(`- ${warning}`);
  }

  if (plan.slices.length === 0) {
    lines.push("", "No changed files were found for the selected branch/worktree scope.");
    return lines.join("\n");
  }

  lines.push(
    "",
    "Patch workflow assumes the full source branch is committed at the Source SHA above. Run each slice from a fresh branch based on Base.",
  );

  plan.slices.forEach((slice, index) => {
    lines.push(
      "",
      `## ${index + 1}. ${slice.displayName} (${slice.fileCount} ${slice.fileCount === 1 ? "file" : "files"})`,
      "",
      `Scope: ${slice.scope}`,
      ...(slice.lane ? [`Lane: ${slice.lane}`] : []),
      `Branch: ${slice.branchName}`,
      `Title: ${slice.title}`,
      `Directories: ${slice.directories.join(", ")}`,
      `Sources: ${slice.sources.join(", ")}`,
      `Statuses: ${Object.entries(slice.statusCounts)
        .map(([status, count]) => `${status}:${count}`)
        .join(", ")}`,
      `Independence: ${slice.independence.kind} (${slice.independence.verified ? "verified" : "unverified"}, confidence: ${slice.independence.confidence})`,
    );
    lines.push("Independence reasons:");
    for (const reason of slice.independence.reasons) lines.push(`- ${reason}`);
    if (slice.independence.possibleDependencies.length > 0) {
      lines.push(`Possible dependencies: ${slice.independence.possibleDependencies.join(", ")}`);
    }
    lines.push("Required checks:");
    for (const check of slice.independence.requiredChecks) lines.push(`- ${check}`);
    if (slice.warnings.length > 0) {
      lines.push("Warnings:");
      for (const warning of slice.warnings) lines.push(`- ${warning}`);
    }
    lines.push("Files:");
    for (const file of slice.files) lines.push(renderFileLine(file));
    lines.push("Commands:");
    for (const command of slice.commands) lines.push(`  ${command}`);
    lines.push("Isolation check:");
    for (const command of slice.isolationCommands) lines.push(`  ${command}`);
  });

  return lines.join("\n");
}

async function laneSetsFromCheckpoint(path: string): Promise<PrLaneSets> {
  const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
  const payload = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  const matchPaths: string[] = [];
  const improvementPaths: string[] = [];
  for (const value of Array.isArray(payload.items) ? payload.items : []) {
    const item = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
    const sourcePath = typeof item.sourcePath === "string" ? item.sourcePath : typeof item.source_path === "string" ? item.source_path : "";
    if (!sourcePath) continue;
    if (item.disposition === "pr_candidate") matchPaths.push(sourcePath);
    else if (item.disposition === "improvement_candidate") improvementPaths.push(sourcePath);
  }
  return { matchPaths, improvementPaths };
}

export async function prSplitPlan(globals: GlobalArgs, args: Map<string, string | true>): Promise<void> {
  const baseRef = stringArg(args, "--base-ref", globals.project?.baseRef ?? "origin/master");
  const maxFilesPerPr = numberArg(args, "--max-files-per-pr", globals.project?.pr.maxFilesPerPr ?? 30);
  if (!Number.isInteger(maxFilesPerPr) || maxFilesPerPr < 1) {
    throw new Error("--max-files-per-pr must be a positive integer");
  }
  const minFilesPerPr = numberArg(args, "--min-files-per-pr", 4);
  if (!Number.isInteger(minFilesPerPr) || minFilesPerPr < 1 || minFilesPerPr > maxFilesPerPr) {
    throw new Error("--min-files-per-pr must be a positive integer no larger than --max-files-per-pr");
  }
  const groupMode = stringArg(args, "--group-mode", globals.project?.pr.groupMode ?? "melee-subsystem");
  if (groupMode !== "melee-subsystem" && groupMode !== "top-dir") {
    throw new Error("--group-mode must be melee-subsystem or top-dir");
  }

  const branchPrefix = stringArg(args, "--branch-prefix", globals.project?.pr.branchPrefix ?? "pr-split");
  const titlePrefix = stringArg(args, "--title-prefix", globals.project?.pr.titlePrefix ?? "Melee decomp");
  const sliceCheckCommand = stringArg(args, "--slice-check-command", "python configure.py --require-protos && ninja changes_all");
  const includeBranchDiff = !booleanArg(args, "--worktree-only");
  const includeWorktree = !booleanArg(args, "--committed-only");
  const includeUntracked = !booleanArg(args, "--no-untracked");
  const checkpointPath = stringArg(args, "--checkpoint", "");
  let lanes = checkpointPath ? await laneSetsFromCheckpoint(resolve(checkpointPath)) : null;

  // The regression report is the build-level truth for what the branch ships:
  // every new exact match belongs in the match lane even when this run's
  // worker reports don't cover it (work from earlier sessions, manual fixes).
  // Improvements above the promotion floors are tagged so the local-only lane
  // can name them, but they never ship.
  // The ship-set verification verdict: when present, match slices are
  // restricted to the files that survived the survivor loop; dropped files
  // are demoted to the local lane with their drop reasons.
  const shipStatusArg = stringArg(args, "--ship-status", "");
  let shipFilter: PrShipFilter | null = null;
  if (shipStatusArg) {
    const parsed = JSON.parse(await readFile(resolve(globals.repoRoot, shipStatusArg), "utf8")) as unknown;
    const payload = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
    const shippedPaths = (Array.isArray(payload.shippedFiles) ? payload.shippedFiles : []).filter((value): value is string => typeof value === "string");
    const droppedRaw = payload.droppedFiles && typeof payload.droppedFiles === "object" && !Array.isArray(payload.droppedFiles) ? (payload.droppedFiles as Record<string, unknown>) : {};
    const droppedReasons: Record<string, string[]> = {};
    for (const [path, reasons] of Object.entries(droppedRaw)) {
      droppedReasons[path] = (Array.isArray(reasons) ? reasons : []).filter((value): value is string => typeof value === "string");
    }
    if (shippedPaths.length === 0 && Object.keys(droppedReasons).length === 0) {
      throw new Error(`--ship-status ${shipStatusArg} has no shippedFiles or droppedFiles; run ship-set verification first or drop the flag.`);
    }
    shipFilter = { shippedPaths, droppedReasons };
  }

  const reportChangesArg = stringArg(args, "--report-changes", "");
  if (reportChangesArg) {
    const report = await readRegressionReport(resolve(globals.repoRoot, reportChangesArg), "pr split plan lanes", 0);
    const minGainPoints = globals.project?.pr.improvementMinGainPoints ?? 2;
    const minMatchedBytes = globals.project?.pr.improvementMinMatchedBytes ?? 64;
    const merged = lanes ?? { matchPaths: [], improvementPaths: [] };
    for (const entry of report.newMatches) {
      if (entry.sourcePath) merged.matchPaths.push(entry.sourcePath);
    }
    for (const entry of report.improvements) {
      if (!entry.sourcePath) continue;
      if (entry.toPercent - entry.fromPercent >= minGainPoints && entry.bytesDelta >= minMatchedBytes) {
        merged.improvementPaths.push(entry.sourcePath);
      }
    }
    lanes = merged;
  }

  const collected = await collectChanges({
    repoRoot: globals.repoRoot,
    baseRef,
    includeBranchDiff,
    includeWorktree,
    includeUntracked,
  });
  const plan = buildPrSplitPlanFromChanges(collected.changes, {
    repoRoot: globals.repoRoot,
    baseRef,
    headRef: collected.headRef,
    currentBranch: collected.currentBranch,
    groupMode,
    maxFilesPerPr,
    minFilesPerPr,
    branchPrefix,
    titlePrefix,
    sliceCheckCommand,
    lanes,
    shipFilter,
    warnings: collected.warnings,
  });
  // The output file is always the human-readable plan; --json only changes
  // what stdout carries so callers can parse slice/lane data.
  const outputPath = args.get("--output");
  if (typeof outputPath === "string") {
    await writeFile(resolve(globals.repoRoot, outputPath), `${renderPrSplitPlan(plan)}\n`);
  }
  console.log(booleanArg(args, "--json") ? JSON.stringify(plan, null, 2) : renderPrSplitPlan(plan));
}
