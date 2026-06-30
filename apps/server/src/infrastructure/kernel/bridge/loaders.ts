import {
  createDefaultCatalog,
  hashContent,
  type CreateDefaultCatalogOptions,
  type Loader,
  type LoaderCatalog,
  type LoaderResolveContext,
} from "@agent-kernel/kernel/context/loaders";

export const COLOSSEUM_SESSION_CONTEXT_LOADER_KIND = "colosseum-session-context";
export const COLOSSEUM_INLINE_CONTEXT_LOADER_KINDS = [
  "worker-packet",
  "knowledge-graph-file-card",
  "integration-conflict-item",
  "integration-queue-summary",
  "pr-index-context",
  "pr-slice-diff",
  "review-lint-findings",
  "pr-fixer-context",
  "standard-examples",
  "pr-split-context",
  "curator-context",
  "reconcile-context",
  "qa-repair-item",
  "qa-repair-queue-summary",
] as const;

export interface ColosseumSessionContextLoaderDeclaration {
  kind: typeof COLOSSEUM_SESSION_CONTEXT_LOADER_KIND;
  label?: string;
  [key: string]: unknown;
}

export type ColosseumInlineContextLoaderKind = (typeof COLOSSEUM_INLINE_CONTEXT_LOADER_KINDS)[number];

export interface ColosseumInlineContextLoaderDeclaration {
  kind: ColosseumInlineContextLoaderKind;
  ref?: string;
  label?: string;
  content?: string;
  [key: string]: unknown;
}

export interface CreateColosseumLoaderCatalogOptions extends CreateDefaultCatalogOptions {
  includeSessionContextLoader?: boolean;
  includeInlineContextLoaders?: boolean;
}

function renderSessionContext(ctx: LoaderResolveContext): string {
  return JSON.stringify(
    {
      appSessionId: ctx.appSessionId ?? null,
      activeSessionDir: ctx.activeSessionDir ?? null,
      sessionData: ctx.sessionData ?? null,
    },
    null,
    2,
  );
}

export function createColosseumSessionContextLoader(): Loader<ColosseumSessionContextLoaderDeclaration> {
  return {
    kind: COLOSSEUM_SESSION_CONTEXT_LOADER_KIND,
    async resolve(_decl, ctx) {
      const content = renderSessionContext(ctx);
      return {
        status: content === "{}" ? "empty" : "ok",
        content,
        bytes: Buffer.byteLength(content, "utf8"),
        hash: hashContent(content),
      };
    },
  };
}

export function createColosseumInlineContextLoader(
  kind: ColosseumInlineContextLoaderKind,
): Loader<ColosseumInlineContextLoaderDeclaration> {
  return {
    kind,
    async resolve(decl) {
      const content = typeof decl.content === "string" ? decl.content : "";
      return {
        status: content ? "ok" : "empty",
        content,
        bytes: Buffer.byteLength(content, "utf8"),
        hash: hashContent(content),
      };
    },
  };
}

export function registerColosseumLoaders(catalog: LoaderCatalog): LoaderCatalog {
  if (!catalog.has(COLOSSEUM_SESSION_CONTEXT_LOADER_KIND)) {
    catalog.register(createColosseumSessionContextLoader());
  }
  for (const kind of COLOSSEUM_INLINE_CONTEXT_LOADER_KINDS) {
    if (!catalog.has(kind)) catalog.register(createColosseumInlineContextLoader(kind));
  }
  return catalog;
}

export function createColosseumLoaderCatalog(
  options: CreateColosseumLoaderCatalogOptions = {},
): LoaderCatalog {
  const catalog = createDefaultCatalog(options);
  if ((options.includeSessionContextLoader ?? true) || (options.includeInlineContextLoaders ?? true)) {
    registerColosseumLoaders(catalog);
  }
  return catalog;
}
