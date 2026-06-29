import { sql } from "drizzle-orm";
import { graphEdges, graphEntities, graphFacts, knowledgeSources, knowledgeTools, resourceVersions, searchChunks } from "./schema.js";
import type { KnowledgeGraphStore } from "./store.js";

export function graphStats(store: KnowledgeGraphStore): Record<string, number> {
  return {
    sources: countRows(store, knowledgeSources),
    tools: countRows(store, knowledgeTools),
    versions: countRows(store, resourceVersions),
    entities: countRows(store, graphEntities),
    facts: countRows(store, graphFacts),
    edges: countRows(store, graphEdges),
    search_chunks: countRows(store, searchChunks),
  };
}

function countRows(store: KnowledgeGraphStore, table: typeof knowledgeSources): number;
function countRows(store: KnowledgeGraphStore, table: typeof knowledgeTools): number;
function countRows(store: KnowledgeGraphStore, table: typeof resourceVersions): number;
function countRows(store: KnowledgeGraphStore, table: typeof graphEntities): number;
function countRows(store: KnowledgeGraphStore, table: typeof graphFacts): number;
function countRows(store: KnowledgeGraphStore, table: typeof graphEdges): number;
function countRows(store: KnowledgeGraphStore, table: typeof searchChunks): number;
function countRows(
  store: KnowledgeGraphStore,
  table:
    | typeof knowledgeSources
    | typeof knowledgeTools
    | typeof resourceVersions
    | typeof graphEntities
    | typeof graphFacts
    | typeof graphEdges
    | typeof searchChunks,
): number {
  const row = store.orm.select({ count: sql<number>`COUNT(*)` }).from(table).get();
  return Number(row?.count ?? 0);
}
