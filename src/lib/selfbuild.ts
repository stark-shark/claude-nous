import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { createHash } from "node:crypto";

// Shared safety primitives for Nous' self-building surfaces (RULES.md and
// agent-authored skills) and self-maintaining memory. Every mutation is:
//   - path/symlink/junction hardened (can't escape its allowed dir),
//   - backed up before write (versioned, with rotation that actually deletes),
//   - drift-guarded (refuses to overwrite a file changed since the proposal),
//   - approval-gated via a pending-proposal queue (nothing writes unconfirmed).
// This is the anti-Hermes-self-rewrite design: propose -> confirm -> apply,
// with rollback, rather than the agent editing files freely.

export function nousDir(): string {
  return path.join(os.homedir(), ".claude", "nous");
}
export function stateDir(): string {
  return path.join(nousDir(), "state");
}

function ts(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

export function sha(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

// Resolve `target` and assert it stays within `base` after symlink resolution.
// Throws on escape. `base` must exist; `target` need not (we resolve its parent).
export function resolveWithin(base: string, target: string): string {
  const realBase = fs.realpathSync(base);
  const resolved = path.resolve(base, target);
  // Resolve the deepest existing ancestor to defeat symlink redirects.
  let probe = resolved;
  while (!fs.existsSync(probe)) {
    const parent = path.dirname(probe);
    if (parent === probe) break;
    probe = parent;
  }
  const realProbe = fs.existsSync(probe) ? fs.realpathSync(probe) : probe;
  const rel = path.relative(realBase, realProbe);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`path escapes allowed dir: ${target}`);
  }
  return resolved;
}

// Back up `file` into `backupDir` as `<base>.<ts>.bak`, then rotate so at most
// `maxBackups` remain (deletes the oldest — Hermes shipped a no-op pruner; ours
// is tested to actually delete).
export function backupFile(file: string, backupDir: string, maxBackups: number): string | null {
  if (!fs.existsSync(file)) return null;
  fs.mkdirSync(backupDir, { recursive: true });
  const base = path.basename(file);
  const dest = path.join(backupDir, `${base}.${ts()}.bak`);
  fs.copyFileSync(file, dest);
  rotateBackups(backupDir, base, maxBackups);
  return dest;
}

export function listBackups(backupDir: string, base: string): string[] {
  try {
    return fs
      .readdirSync(backupDir)
      .filter((f) => f.startsWith(base + ".") && f.endsWith(".bak"))
      .sort(); // ts is lexicographically sortable
  } catch {
    return [];
  }
}

function rotateBackups(backupDir: string, base: string, maxBackups: number): void {
  const backups = listBackups(backupDir, base);
  const excess = backups.length - Math.max(0, maxBackups);
  for (let i = 0; i < excess; i++) {
    try {
      fs.unlinkSync(path.join(backupDir, backups[i]));
    } catch {
      /* best effort */
    }
  }
}

// Restore the newest backup for `file`. Returns true if restored.
export function rollbackLatest(file: string, backupDir: string): boolean {
  const base = path.basename(file);
  const backups = listBackups(backupDir, base);
  if (backups.length === 0) return false;
  const newest = backups[backups.length - 1];
  try {
    // Back up the current (pre-rollback) state too, so rollback is reversible.
    if (fs.existsSync(file)) backupFile(file, backupDir, 999);
    fs.copyFileSync(path.join(backupDir, newest), file);
    return true;
  } catch {
    return false;
  }
}

// ─── pending-proposal queue ─────────────────────────────────────────────────

export interface Proposal {
  id: string;
  kind: "rules" | "skill" | "memory";
  target: string; // file path or memory name
  note: string; // one-line human description / diff
  payload: string; // proposed new content
  baseHash: string; // hash of the target at propose time (drift guard)
  created: string;
}

function pendingPath(): string {
  return path.join(stateDir(), "pending.json");
}

function readPending(): Proposal[] {
  try {
    return JSON.parse(fs.readFileSync(pendingPath(), "utf8")) as Proposal[];
  } catch {
    return [];
  }
}

function writePending(list: Proposal[]): void {
  fs.mkdirSync(stateDir(), { recursive: true });
  fs.writeFileSync(pendingPath(), JSON.stringify(list, null, 2), "utf8");
}

export function addProposal(p: Omit<Proposal, "id" | "created">): Proposal {
  const list = readPending();
  const id = `${p.kind}-${ts()}-${Math.abs(hashInt(p.target + p.note))}`;
  const full: Proposal = { ...p, id, created: new Date().toISOString() };
  list.push(full);
  writePending(list);
  return full;
}

export function listProposals(kind?: Proposal["kind"]): Proposal[] {
  return readPending().filter((p) => !kind || p.kind === kind);
}

export function getProposal(id: string): Proposal | undefined {
  return readPending().find((p) => p.id === id);
}

export function clearProposal(id: string): void {
  writePending(readPending().filter((p) => p.id !== id));
}

function hashInt(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

export interface ApplyResult {
  ok: boolean;
  message: string;
  backup?: string | null;
}

// Commit a staged proposal to disk with the full safety chain: optional
// containment check, drift guard (refuse if the target changed since propose),
// backup-before-write, then write. Leaves the proposal in place on failure so
// the user can inspect/retry.
export function applyProposal(
  id: string,
  opts: { backupDir: string; maxBackups: number; containBase?: string; validate?: (payload: string) => string | null }
): ApplyResult {
  const p = getProposal(id);
  if (!p) return { ok: false, message: `No pending proposal '${id}'.` };

  const target = p.target;
  if (opts.containBase) {
    try {
      resolveWithin(opts.containBase, target);
    } catch (e) {
      return { ok: false, message: `Refused: ${(e as Error).message}` };
    }
  }
  if (opts.validate) {
    const err = opts.validate(p.payload);
    if (err) return { ok: false, message: `Refused (invalid): ${err}` };
  }

  let current = "";
  try {
    current = fs.readFileSync(target, "utf8");
  } catch {
    current = "";
  }
  if (sha(current) !== p.baseHash) {
    return {
      ok: false,
      message:
        "Refused: target changed since this proposal (drift). Re-read and re-propose. Proposal kept for inspection.",
    };
  }

  let backup: string | null = null;
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    backup = backupFile(target, opts.backupDir, opts.maxBackups);
    fs.writeFileSync(target, p.payload, "utf8");
  } catch (e) {
    return { ok: false, message: `Write failed: ${(e as Error).message}` };
  }
  clearProposal(id);
  return { ok: true, message: `Applied '${id}' -> ${target}`, backup };
}
