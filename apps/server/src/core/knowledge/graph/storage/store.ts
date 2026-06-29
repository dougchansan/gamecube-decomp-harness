import { existsSync } from "node:fs";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { resourceGraphDbPath } from "../../paths.js";
import { ensureParentDir } from "../util.js";
import { ensureKnowledgeGraphSqlSchema } from "./ddl.js";
import { knowledgeGraphSchema } from "./schema.js";

export type KnowledgeGraphOrm = ReturnType<typeof createKnowledgeGraphOrm>;

export interface KnowledgeGraphStore {
  path: string;
  db: Database;
  orm: KnowledgeGraphOrm;
  hasFts: boolean;
}

function createKnowledgeGraphOrm(db: Database) {
  return drizzle(db, { schema: knowledgeGraphSchema });
}

export function openKnowledgeGraph(path = resourceGraphDbPath()): KnowledgeGraphStore {
  ensureParentDir(path);
  const db = new Database(path);
  configureKnowledgeGraphConnection(db);
  const store: KnowledgeGraphStore = {
    path,
    db,
    orm: createKnowledgeGraphOrm(db),
    hasFts: false,
  };
  ensureKnowledgeGraphSchema(store);
  return store;
}

export function graphDbExists(path = resourceGraphDbPath()): boolean {
  return existsSync(path);
}

export function configureKnowledgeGraphConnection(db: Database): void {
  db.run("PRAGMA busy_timeout = 30000");
  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA synchronous = NORMAL");
  db.run("PRAGMA foreign_keys = ON");
}

export function ensureKnowledgeGraphSchema(store: KnowledgeGraphStore): void {
  store.hasFts = ensureKnowledgeGraphSqlSchema(store.db);
}
