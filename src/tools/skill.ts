import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { RecallConfig } from "../lib/config.js";
import {
  nousDir,
  sha,
  resolveWithin,
  addProposal,
  applyProposal,
  listProposals,
  rollbackLatest,
} from "../lib/selfbuild.js";

// nous_skill — the agent's procedural memory: author/evolve skills the agent
// then invokes. Written to Claude Code's personal-skills dir so they're
// auto-discovered. Approval-gated, path-hardened, frontmatter-validated,
// versioned. The plugin's own governing `nous` skill is out of bounds.

export interface SkillInput {
  action: "list" | "get" | "create" | "patch" | "apply" | "rollback";
  name?: string;
  content?: string; // full SKILL.md (create/patch)
  note?: string;
  id?: string; // proposal id (apply)
}

const RESERVED = new Set(["nous", "recall"]);

function expandHome(p: string): string {
  return p.startsWith("~") ? path.join(os.homedir(), p.slice(1).replace(/^[\\/]/, "")) : p;
}
function skillsRoot(config: RecallConfig): string {
  return expandHome(config.skills.dir);
}
function skillFile(config: RecallConfig, name: string): string {
  return path.join(skillsRoot(config), name, "SKILL.md");
}
function backupDir(name: string): string {
  return path.join(nousDir(), "skill-backups", name);
}

// Validate the SKILL.md frontmatter + body (Hermes: name + description required).
export function validateSkill(content: string): string | null {
  const m = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return "missing YAML frontmatter (--- name/description ---)";
  const front = m[1];
  const body = m[2].trim();
  if (!/^name:\s*\S+/m.test(front)) return "frontmatter missing `name`";
  const desc = front.match(/^description:\s*(.+)$/m);
  if (!desc) return "frontmatter missing `description`";
  if (desc[1].trim().length > 1024) return "description exceeds 1024 chars";
  if (!body) return "empty skill body";
  return null;
}

function validName(name: string): string | null {
  if (!name) return "name required";
  if (RESERVED.has(name.toLowerCase())) return `'${name}' is reserved (the core nous skill is read-only)`;
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) return "name must be kebab-case ([a-z0-9-])";
  return null;
}

export function handleSkill(input: SkillInput, config: RecallConfig): { text: string; isError?: boolean } {
  const root = skillsRoot(config);

  switch (input.action) {
    case "list": {
      let names: string[] = [];
      try {
        names = fs
          .readdirSync(root, { withFileTypes: true })
          .filter((d) => d.isDirectory() && fs.existsSync(path.join(root, d.name, "SKILL.md")))
          .map((d) => d.name);
      } catch {
        /* none */
      }
      return { text: names.length ? `Authored skills:\n- ${names.join("\n- ")}` : "No authored skills yet." };
    }

    case "get": {
      if (!input.name) return { text: "get requires `name`.", isError: true };
      try {
        return { text: fs.readFileSync(skillFile(config, input.name), "utf8") };
      } catch {
        return { text: `No skill '${input.name}'.`, isError: true };
      }
    }

    case "create":
    case "patch": {
      const nameErr = validName(input.name || "");
      if (nameErr) return { text: nameErr, isError: true };
      if (!input.content) return { text: `${input.action} requires content (full SKILL.md).`, isError: true };
      const vErr = validateSkill(input.content);
      if (vErr) return { text: `Invalid skill: ${vErr}`, isError: true };

      const name = input.name as string;
      const target = skillFile(config, name);
      // The skills root may not exist yet (no personal skill ever created).
      // resolveWithin realpath's the base, so ensure it exists first.
      try {
        fs.mkdirSync(root, { recursive: true });
      } catch {
        /* ignore */
      }
      // Path-harden: target must stay within the skills root.
      try {
        resolveWithin(root, path.join(name, "SKILL.md"));
      } catch (e) {
        return { text: `Refused: ${(e as Error).message}`, isError: true };
      }
      let current = "";
      try {
        current = fs.readFileSync(target, "utf8");
      } catch {
        current = "";
      }
      const note = input.note || `${input.action} skill ${name}`;
      const p = addProposal({ kind: "skill", target, note, payload: input.content, baseHash: sha(current) });
      if (!config.skills.approvalGate) {
        const r = applyProposal(p.id, {
          backupDir: backupDir(name),
          maxBackups: config.skills.maxBackups,
          containBase: root,
          validate: validateSkill,
        });
        return { text: r.message, isError: !r.ok };
      }
      return {
        text: `Proposed skill '${name}' (id ${p.id}):\n  ${note}\nConfirm with nous_skill action:"apply" id:"${p.id}".`,
      };
    }

    case "apply": {
      if (!input.id) {
        const pend = listProposals("skill");
        return {
          text: pend.length ? `apply requires an id. Pending: ${pend.map((p) => p.id).join(", ")}` : "No pending skill proposals.",
          isError: true,
        };
      }
      // find the proposal's skill name from its target for the right backup dir
      const p = listProposals("skill").find((x) => x.id === input.id);
      const name = p ? path.basename(path.dirname(p.target)) : "unknown";
      try {
        fs.mkdirSync(root, { recursive: true }); // containment check realpaths root
      } catch {
        /* ignore */
      }
      const r = applyProposal(input.id, {
        backupDir: backupDir(name),
        maxBackups: config.skills.maxBackups,
        containBase: root,
        validate: validateSkill,
      });
      return { text: r.message, isError: !r.ok };
    }

    case "rollback": {
      if (!input.name) return { text: "rollback requires `name`.", isError: true };
      const ok = rollbackLatest(skillFile(config, input.name), backupDir(input.name));
      return { text: ok ? `Rolled back skill '${input.name}'.` : "No backup to roll back to.", isError: !ok };
    }

    default:
      return { text: `Unknown action.`, isError: true };
  }
}
