import * as fs from "node:fs";
import * as path from "node:path";
import type { NousConfig } from "../lib/config.js";
import {
  nousDir,
  sha,
  addProposal,
  applyProposal,
  listProposals,
  rollbackLatest,
} from "../lib/selfbuild.js";

// nous_rules — the editable, approval-gated save-rules (RULES.md).
// propose -> (user confirms) -> apply, with versioned backups + rollback.

export interface RulesInput {
  action: "get" | "propose" | "apply" | "rollback";
  content?: string; // proposed full RULES.md (propose)
  note?: string; // one-line description of the change (propose)
  id?: string; // proposal id (apply)
}

function rulesPath(): string {
  return path.join(nousDir(), "RULES.md");
}
function backupDir(): string {
  return path.join(nousDir(), "rules-backups");
}

function readRules(): string {
  try {
    return fs.readFileSync(rulesPath(), "utf8");
  } catch {
    return "";
  }
}

export function handleRules(input: RulesInput, config: NousConfig): { text: string; isError?: boolean } {
  const file = rulesPath();

  switch (input.action) {
    case "get": {
      const body = readRules();
      return { text: body || "(no RULES.md yet — will be seeded from the default template on next session start)" };
    }

    case "propose": {
      if (!input.content) return { text: "propose requires `content` (the full new RULES.md).", isError: true };
      const current = readRules();
      const note = input.note || "update save rules";
      if (!config.rules.approvalGate) {
        // gate off — apply immediately via a transient proposal
        const p = addProposal({ kind: "rules", target: file, note, payload: input.content, baseHash: sha(current) });
        const r = applyProposal(p.id, { backupDir: backupDir(), maxBackups: config.rules.maxBackups });
        return { text: r.message, isError: !r.ok };
      }
      const p = addProposal({ kind: "rules", target: file, note, payload: input.content, baseHash: sha(current) });
      return {
        text: `Proposed RULES.md change (id ${p.id}):\n  ${note}\nConfirm with nous_rules action:"apply" id:"${p.id}".`,
      };
    }

    case "apply": {
      if (!input.id) {
        const pend = listProposals("rules");
        return {
          text: pend.length ? `apply requires an id. Pending: ${pend.map((p) => p.id).join(", ")}` : "No pending rules proposals.",
          isError: true,
        };
      }
      const r = applyProposal(input.id, { backupDir: backupDir(), maxBackups: config.rules.maxBackups });
      return { text: r.message, isError: !r.ok };
    }

    case "rollback": {
      const ok = rollbackLatest(file, backupDir());
      return { text: ok ? "Rolled back RULES.md to the previous backup." : "No backup to roll back to.", isError: !ok };
    }

    default:
      return { text: `Unknown action '${(input as { action: string }).action}'.`, isError: true };
  }
}
