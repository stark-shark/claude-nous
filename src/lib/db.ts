import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { createRequire } from "node:module";

// SQLite layer for Nous' cold tier (session capture + FTS5 recall).
//
// Uses the built-in `node:sqlite` (DatabaseSync), so Nous keeps its
// zero-runtime-deps promise. node:sqlite is available on Node >= 22.5; on older
// runtimes openDb() returns null and callers fall back to the brute-scan cold
// tier in sessions.ts.
//
// FTS5 design: a STANDALONE fts5 table (its own content storage), NOT
// external-content — Hermes migrated away from external-content over
// rowid-alignment bugs on UPDATE/DELETE (hermes_state.py, issue #16751).
// messages.content is duplicated into the index; triggers keep them in sync
// with fts.rowid = messages.id so deletes stay aligned. snippet() works because
// the index holds its own content.

const nodeRequire = createRequire(import.meta.url);

// Minimal structural types so we don't depend on @types/node shipping node:sqlite.
interface SqliteStmt {
  run(...params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint };
  get(...params: unknown[]): Record<string, unknown> | undefined;
  all(...params: unknown[]): Record<string, unknown>[];
}
interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqliteStmt;
  close(): void;
}
interface SqliteModule {
  DatabaseSync: new (filename: string, opts?: Record<string, unknown>) => SqliteDatabase;
}

export interface Db {
  raw: SqliteDatabase;
  ftsAvailable: boolean;
  path: string;
  close(): void;
}

export const SCHEMA_VERSION = 1;

let sqliteMod: SqliteModule | null | undefined;
function loadSqlite(): SqliteModule | null {
  if (sqliteMod !== undefined) return sqliteMod;
  try {
    sqliteMod = nodeRequire("node:sqlite") as SqliteModule;
  } catch {
    sqliteMod = null; // Node < 22.5 or built without sqlite
  }
  return sqliteMod;
}

export function sqliteAvailable(): boolean {
  return loadSqlite() !== null;
}

export function getDefaultDbPath(): string {
  return path.join(os.homedir(), ".claude", "nous", "nous.db");
}

// ─── pragmas ────────────────────────────────────────────────────────────────

function applyPragmas(db: SqliteDatabase): void {
  // WAL lets the Stop-hook writer and the MCP-server reader coexist. On
  // WAL-incompatible filesystems (NFS/SMB/FUSE) SQLite falls back on its own;
  // we just don't force it and never downgrade an existing WAL header.
  try {
    const row = db.prepare("PRAGMA journal_mode=WAL").get();
    const mode = row && typeof row.journal_mode === "string" ? row.journal_mode : "";
    if (mode.toLowerCase() !== "wal") {
      try {
        db.exec("PRAGMA journal_mode=DELETE");
      } catch {
        /* leave whatever mode stuck */
      }
    }
  } catch {
    /* pragma unsupported — ignore */
  }
  try {
    db.exec("PRAGMA busy_timeout=5000");
    db.exec("PRAGMA synchronous=NORMAL");
  } catch {
    /* ignore */
  }
}

// ─── FTS5 capability probe ───────────────────────────────────────────────────

function probeFts5(db: SqliteDatabase): boolean {
  try {
    db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS temp._nous_fts5_probe USING fts5(x)");
    db.exec("DROP TABLE IF EXISTS temp._nous_fts5_probe");
    return true;
  } catch {
    return false; // SQLite compiled without FTS5 — separate from the Node gate
  }
}

// ─── schema ──────────────────────────────────────────────────────────────────

const BASE_SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);

CREATE TABLE IF NOT EXISTS files (
  path TEXT PRIMARY KEY,
  mtime INTEGER,
  size INTEGER,
  last_offset INTEGER
);

CREATE TABLE IF NOT EXISTS sessions (
  session_id TEXT PRIMARY KEY,
  project TEXT,
  cwd TEXT,
  source TEXT,
  parent_session_id TEXT,
  started TEXT,
  ended TEXT,
  turns INTEGER DEFAULT 0,
  summary TEXT,
  decisions TEXT,
  open_threads TEXT,
  summarized_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project);
CREATE INDEX IF NOT EXISTS idx_sessions_ended ON sessions(ended);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT,
  project TEXT,
  role TEXT,
  ts TEXT,
  turn_idx INTEGER,
  content TEXT,
  redacted INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, id);
`;

const FTS_SCHEMA = `
CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
  content,
  session_id UNINDEXED,
  message_id UNINDEXED,
  tokenize='unicode61'
);
CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts(rowid, content, session_id, message_id)
  VALUES (new.id, new.content, new.session_id, new.id);
END;
CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
  DELETE FROM messages_fts WHERE rowid = old.id;
END;
CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE ON messages BEGIN
  DELETE FROM messages_fts WHERE rowid = old.id;
  INSERT INTO messages_fts(rowid, content, session_id, message_id)
  VALUES (new.id, new.content, new.session_id, new.id);
END;
`;

// Declarative column reconciliation: additive columns can be ALTER-ed in with no
// version gate, so future releases just extend this map (Hermes' two-tier
// pattern, hermes_state.py L1407-1462). Types are the column DDL fragment.
const EXPECTED_COLUMNS: Record<string, Record<string, string>> = {
  sessions: {
    session_id: "TEXT",
    project: "TEXT",
    cwd: "TEXT",
    source: "TEXT",
    parent_session_id: "TEXT",
    started: "TEXT",
    ended: "TEXT",
    turns: "INTEGER DEFAULT 0",
    summary: "TEXT",
    decisions: "TEXT",
    open_threads: "TEXT",
    summarized_at: "TEXT",
  },
  messages: {
    session_id: "TEXT",
    project: "TEXT",
    role: "TEXT",
    ts: "TEXT",
    turn_idx: "INTEGER",
    content: "TEXT",
    redacted: "INTEGER DEFAULT 0",
  },
};

function reconcileColumns(db: SqliteDatabase): void {
  for (const [table, cols] of Object.entries(EXPECTED_COLUMNS)) {
    let existing: Set<string>;
    try {
      const rows = db.prepare(`PRAGMA table_info(${table})`).all();
      if (rows.length === 0) continue; // table absent — BASE_SCHEMA creates it
      existing = new Set(rows.map((r) => String(r.name)));
    } catch {
      continue;
    }
    for (const [name, ddl] of Object.entries(cols)) {
      if (!existing.has(name)) {
        try {
          db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${ddl}`);
        } catch {
          /* best effort */
        }
      }
    }
  }
}

function getSchemaVersion(db: SqliteDatabase): number {
  try {
    const row = db.prepare("SELECT value FROM meta WHERE key='schema_version'").get();
    const v = row && typeof row.value === "string" ? parseInt(row.value, 10) : 0;
    return Number.isFinite(v) ? v : 0;
  } catch {
    return 0;
  }
}

function setSchemaVersion(db: SqliteDatabase, v: number): void {
  db.prepare("INSERT INTO meta(key,value) VALUES('schema_version',?) " +
    "ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(String(v));
}

// Rebuild the FTS index from messages — used after corruption or when the FTS
// table is (re)created for a DB that already has messages.
export function rebuildFts(db: SqliteDatabase): void {
  db.exec("DELETE FROM messages_fts");
  db.exec(
    "INSERT INTO messages_fts(rowid, content, session_id, message_id) " +
      "SELECT id, content, session_id, id FROM messages"
  );
}

function installFts(db: SqliteDatabase): boolean {
  try {
    db.exec(FTS_SCHEMA);
    return true;
  } catch {
    // Possible corrupt/duplicate FTS schema — drop and rebuild once.
    try {
      db.exec("DROP TABLE IF EXISTS messages_fts");
      db.exec("DROP TRIGGER IF EXISTS messages_ai");
      db.exec("DROP TRIGGER IF EXISTS messages_ad");
      db.exec("DROP TRIGGER IF EXISTS messages_au");
      db.exec(FTS_SCHEMA);
      rebuildFts(db);
      return true;
    } catch {
      return false;
    }
  }
}

function migrate(db: SqliteDatabase, ftsAvailable: boolean): boolean {
  db.exec(BASE_SCHEMA);
  reconcileColumns(db);

  let ftsOk = false;
  if (ftsAvailable) ftsOk = installFts(db);

  // Version-gated block: bump only after success so a failed migration retries.
  const current = getSchemaVersion(db);
  if (current < SCHEMA_VERSION) {
    // (no data migrations yet for v1 — additive columns handled above)
    setSchemaVersion(db, SCHEMA_VERSION);
  }
  return ftsOk;
}

// ─── open ─────────────────────────────────────────────────────────────────────

// Open (creating if needed) the Nous DB. Returns null when node:sqlite is
// unavailable or the DB can't be opened — callers must fall back gracefully.
export function openDb(dbPath: string = getDefaultDbPath()): Db | null {
  const mod = loadSqlite();
  if (!mod) return null;

  try {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  } catch {
    /* dir may already exist */
  }

  let raw: SqliteDatabase;
  try {
    raw = new mod.DatabaseSync(dbPath);
  } catch {
    return null;
  }

  applyPragmas(raw);
  const ftsProbed = probeFts5(raw);

  let ftsAvailable = false;
  try {
    ftsAvailable = migrate(raw, ftsProbed);
  } catch {
    // migration hard-failed — DB unusable for our purposes
    try {
      raw.close();
    } catch {
      /* ignore */
    }
    return null;
  }

  return {
    raw,
    ftsAvailable,
    path: dbPath,
    close() {
      try {
        raw.close();
      } catch {
        /* ignore */
      }
    },
  };
}

export interface DbStats {
  sessions: number;
  messages: number;
  unsummarized: number;
  redacted: number;
  sizeBytes: number;
  ftsAvailable: boolean;
  lastIndex: string | null;
}

export function dbStats(db: Db): DbStats {
  const num = (sql: string): number => {
    try {
      const row = db.raw.prepare(sql).get();
      const v = row ? Object.values(row)[0] : 0;
      return typeof v === "number" ? v : Number(v ?? 0);
    } catch {
      return 0;
    }
  };
  let sizeBytes = 0;
  try {
    sizeBytes = fs.statSync(db.path).size;
  } catch {
    /* ignore */
  }
  let lastIndex: string | null = null;
  try {
    const row = db.raw.prepare("SELECT value FROM meta WHERE key='last_index'").get();
    lastIndex = row && typeof row.value === "string" ? row.value : null;
  } catch {
    /* ignore */
  }
  return {
    sessions: num("SELECT COUNT(*) FROM sessions"),
    messages: num("SELECT COUNT(*) FROM messages"),
    unsummarized: num("SELECT COUNT(*) FROM sessions WHERE summarized_at IS NULL"),
    redacted: num("SELECT COALESCE(SUM(redacted),0) FROM messages"),
    sizeBytes,
    ftsAvailable: db.ftsAvailable,
    lastIndex,
  };
}

export function setMeta(db: Db, key: string, value: string): void {
  try {
    db.raw
      .prepare("INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
      .run(key, value);
  } catch {
    /* ignore */
  }
}
