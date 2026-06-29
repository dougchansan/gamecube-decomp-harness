import type { ResolvedProject } from "./resolver.js";

export interface ProjectRuntimeContext {
  project: ResolvedProject | null;
  repoRoot: string;
  stateDir: string;
  graphDbPath: string;
  usePathOverrides: boolean;
}
