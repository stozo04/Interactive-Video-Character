import fs from "node:fs/promises";
import path from "node:path";
import { executeRunInBackground } from "../executor";
import type { WorkspaceRun, WorkspaceRunStore } from "../runStore";
import { MultiAgentEventLogger } from "./eventLogger";
import { log } from "./runtimeLogger";
import type {
  EngineeringArtifact,
  EngineeringTicket,
  EngineeringTicketStore,
} from "./types";

const LOG_PREFIX = "[MultiAgentArtifactService]";
const runtimeLog = log.fromContext({ source: "artifactService" });
const DEFAULT_TEMPLATE_PATH = path.resolve(
  process.cwd(),
  "server",
  "docs",
  "skill_template.md",
);
const DEFAULT_FEATURE_TEMPLATE_PATH = path.resolve(
  process.cwd(),
  "server",
  "docs",
  "feature_template.md",
);
const DEFAULT_BUG_TEMPLATE_PATH = path.resolve(
  process.cwd(),
  "server",
  "docs",
  "bug_template.md",
);

interface ArtifactServiceOptions {
  ticketStore: EngineeringTicketStore;
  runStore: WorkspaceRunStore;
  eventLogger?: MultiAgentEventLogger;
  templatePath?: string;
  featureTemplatePath?: string;
  bugTemplatePath?: string;
}

interface SkillScaffoldOptions {
  createScriptFile?: boolean;
}

// MultiAgentArtifactService creates placeholder docs (skills/features/bugs)
// using the workspace agent (mkdir/write actions) so everything is audited.
export class MultiAgentArtifactService {
  private readonly ticketStore: EngineeringTicketStore;
  private readonly runStore: WorkspaceRunStore;
  private readonly eventLogger: MultiAgentEventLogger;
  private readonly templatePath: string;
  private readonly featureTemplatePath: string;
  private readonly bugTemplatePath: string;

  public constructor(options: ArtifactServiceOptions) {
    // Store dependencies.
    this.ticketStore = options.ticketStore;
    this.runStore = options.runStore;
    this.eventLogger =
      options.eventLogger ?? new MultiAgentEventLogger(this.ticketStore);
    this.templatePath = options.templatePath ?? DEFAULT_TEMPLATE_PATH;
    this.featureTemplatePath =
      options.featureTemplatePath ?? DEFAULT_FEATURE_TEMPLATE_PATH;
    this.bugTemplatePath =
      options.bugTemplatePath ?? DEFAULT_BUG_TEMPLATE_PATH;
  }

  // Creates skills/<name>/SKILL.md (and optionally a script stub).
  public async scaffoldSkillArtifacts(
    ticket: EngineeringTicket,
    worktreeRoot: string,
    options: SkillScaffoldOptions = {},
  ): Promise<EngineeringArtifact[]> {
    const skillName = toSkillSlug(ticket.title || ticket.requestSummary || ticket.id);
    const skillRoot = `skills/${skillName}`;
    const skillScripts = `${skillRoot}/scripts`;
    const skillMdPath = `${skillRoot}/SKILL.md`;
    const scriptFilePath = `${skillScripts}/${skillName}.ts`;

    runtimeLog.info(`${LOG_PREFIX} scaffoldSkillArtifacts`, {
      ticketId: ticket.id,
      skillName,
      worktreeRoot,
    });

    await this.eventLogger.logEvent({
      ticketId: ticket.id,
      eventType: "artifact_scaffold_started",
      actorType: "system",
      actorName: "orchestrator",
      summary: "Skill scaffold creation started.",
      payload: {
        skillName,
        worktreeRoot,
      },
    });

    // Read template and inject name/description.
    const template = await this.readSkillTemplate();
    const hydratedTemplate = hydrateSkillTemplate(
      template,
      skillName,
      ticket.requestSummary || ticket.title,
    );

    // Create folders + files via workspace actions (so runs are tracked).
    await this.executeWorkspaceAction(worktreeRoot, "mkdir", {
      path: "skills",
    });
    const skillFolderRun = await this.executeWorkspaceAction(worktreeRoot, "mkdir", {
      path: skillRoot,
    });
    await this.executeWorkspaceAction(worktreeRoot, "mkdir", {
      path: skillScripts,
    });

    const skillMdRun = await this.executeWorkspaceAction(worktreeRoot, "write", {
      path: skillMdPath,
      content: hydratedTemplate,
    });

    const artifacts: EngineeringArtifact[] = [];
    artifacts.push(
      await this.ticketStore.createArtifact({
        ticketId: ticket.id,
        artifactType: "skill_folder",
        path: skillRoot,
        status: "generated",
        createdByAgent: "system",
        workspaceRunId: skillFolderRun.id,
      }),
    );
    artifacts.push(
      await this.ticketStore.createArtifact({
        ticketId: ticket.id,
        artifactType: "skill_md",
        path: skillMdPath,
        status: "generated",
        createdByAgent: "system",
        workspaceRunId: skillMdRun.id,
      }),
    );

    if (options.createScriptFile) {
      const scriptRun = await this.executeWorkspaceAction(worktreeRoot, "write", {
        path: scriptFilePath,
        content: buildScriptStub(skillName),
      });
      artifacts.push(
        await this.ticketStore.createArtifact({
          ticketId: ticket.id,
          artifactType: "script",
          path: scriptFilePath,
          status: "generated",
          createdByAgent: "system",
          workspaceRunId: scriptRun.id,
        }),
      );
    }

    await this.eventLogger.logEvent({
      ticketId: ticket.id,
      eventType: "artifact_scaffold_completed",
      actorType: "system",
      actorName: "orchestrator",
      summary: "Skill scaffold creation completed.",
      payload: {
        skillName,
        artifacts: artifacts.map((artifact) => ({
          id: artifact.id,
          type: artifact.artifactType,
          path: artifact.path,
        })),
      },
    });

    return artifacts;
  }

  // Creates features/<name>/FEATURE.md.
  public async scaffoldFeatureArtifacts(
    ticket: EngineeringTicket,
    worktreeRoot: string,
  ): Promise<EngineeringArtifact[]> {
    const featureName = toSkillSlug(ticket.title || ticket.requestSummary || ticket.id);
    const featureRoot = `features/${featureName}`;
    const featureDocPath = `${featureRoot}/FEATURE.md`;

    runtimeLog.info(`${LOG_PREFIX} scaffoldFeatureArtifacts`, {
      ticketId: ticket.id,
      featureName,
      worktreeRoot,
    });

    await this.eventLogger.logEvent({
      ticketId: ticket.id,
      eventType: "artifact_scaffold_started",
      actorType: "system",
      actorName: "orchestrator",
      summary: "Feature scaffold creation started.",
      payload: {
        featureName,
        worktreeRoot,
      },
    });

    const template = await this.readTemplate(this.featureTemplatePath);
    const hydratedTemplate = hydrateSkillTemplate(
      template,
      featureName,
      ticket.requestSummary || ticket.title,
    );

    await this.executeWorkspaceAction(worktreeRoot, "mkdir", {
      path: "features",
    });
    const featureFolderRun = await this.executeWorkspaceAction(
      worktreeRoot,
      "mkdir",
      {
        path: featureRoot,
      },
    );

    const featureDocRun = await this.executeWorkspaceAction(
      worktreeRoot,
      "write",
      {
        path: featureDocPath,
        content: hydratedTemplate,
      },
    );

    const artifacts: EngineeringArtifact[] = [];
    artifacts.push(
      await this.ticketStore.createArtifact({
        ticketId: ticket.id,
        artifactType: "feature_folder",
        path: featureRoot,
        status: "generated",
        createdByAgent: "system",
        workspaceRunId: featureFolderRun.id,
      }),
    );
    artifacts.push(
      await this.ticketStore.createArtifact({
        ticketId: ticket.id,
        artifactType: "feature_md",
        path: featureDocPath,
        status: "generated",
        createdByAgent: "system",
        workspaceRunId: featureDocRun.id,
      }),
    );

    await this.eventLogger.logEvent({
      ticketId: ticket.id,
      eventType: "artifact_scaffold_completed",
      actorType: "system",
      actorName: "orchestrator",
      summary: "Feature scaffold creation completed.",
      payload: {
        featureName,
        artifacts: artifacts.map((artifact) => ({
          id: artifact.id,
          type: artifact.artifactType,
          path: artifact.path,
        })),
      },
    });

    return artifacts;
  }

  // Creates bugs/<name>/BUG.md.
  public async scaffoldBugArtifacts(
    ticket: EngineeringTicket,
    worktreeRoot: string,
  ): Promise<EngineeringArtifact[]> {
    const bugName = toSkillSlug(ticket.title || ticket.requestSummary || ticket.id);
    const bugRoot = `bugs/${bugName}`;
    const bugDocPath = `${bugRoot}/BUG.md`;

    runtimeLog.info(`${LOG_PREFIX} scaffoldBugArtifacts`, {
      ticketId: ticket.id,
      bugName,
      worktreeRoot,
    });

    await this.eventLogger.logEvent({
      ticketId: ticket.id,
      eventType: "artifact_scaffold_started",
      actorType: "system",
      actorName: "orchestrator",
      summary: "Bug scaffold creation started.",
      payload: {
        bugName,
        worktreeRoot,
      },
    });

    const template = await this.readTemplate(this.bugTemplatePath);
    const hydratedTemplate = hydrateBugTemplate(template, bugName, ticket);

    await this.executeWorkspaceAction(worktreeRoot, "mkdir", {
      path: "bugs",
    });
    const bugFolderRun = await this.executeWorkspaceAction(
      worktreeRoot,
      "mkdir",
      {
        path: bugRoot,
      },
    );

    const bugDocRun = await this.executeWorkspaceAction(
      worktreeRoot,
      "write",
      {
        path: bugDocPath,
        content: hydratedTemplate,
      },
    );

    const artifacts: EngineeringArtifact[] = [];
    artifacts.push(
      await this.ticketStore.createArtifact({
        ticketId: ticket.id,
        artifactType: "bug_folder",
        path: bugRoot,
        status: "generated",
        createdByAgent: "system",
        workspaceRunId: bugFolderRun.id,
      }),
    );
    artifacts.push(
      await this.ticketStore.createArtifact({
        ticketId: ticket.id,
        artifactType: "bug_md",
        path: bugDocPath,
        status: "generated",
        createdByAgent: "system",
        workspaceRunId: bugDocRun.id,
      }),
    );

    await this.eventLogger.logEvent({
      ticketId: ticket.id,
      eventType: "artifact_scaffold_completed",
      actorType: "system",
      actorName: "orchestrator",
      summary: "Bug scaffold creation completed.",
      payload: {
        bugName,
        artifacts: artifacts.map((artifact) => ({
          id: artifact.id,
          type: artifact.artifactType,
          path: artifact.path,
        })),
      },
    });

    return artifacts;
  }

  // Read the default skill template file from disk.
  private async readSkillTemplate(): Promise<string> {
    try {
      return await fs.readFile(this.templatePath, "utf-8");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to read skill template.";
      throw new Error(`${LOG_PREFIX} ${message}`);
    }
  }

  // Read a template file from disk.
  private async readTemplate(templatePath: string): Promise<string> {
    try {
      return await fs.readFile(templatePath, "utf-8");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to read template.";
      throw new Error(`${LOG_PREFIX} ${message}`);
    }
  }

  // Execute a workspace action and wait for success.
  private async executeWorkspaceAction(
    worktreeRoot: string,
    action: "mkdir" | "write",
    args: Record<string, unknown>,
  ): Promise<WorkspaceRun> {
    const run = await this.runStore.createRun(
      {
        action,
        args,
      },
      worktreeRoot,
    );

    // Runs are executed asynchronously by the workspace agent.
    await executeRunInBackground({
      runStore: this.runStore,
      runId: run.id,
      workspaceRoot: worktreeRoot,
    });

    const updatedRun = await this.runStore.getRun(run.id);
    if (!updatedRun) {
      throw new Error(`${LOG_PREFIX} Missing run record after execution.`);
    }

    if (updatedRun.status !== "success") {
      throw new Error(
        `${LOG_PREFIX} Workspace action failed: ${action} (${updatedRun.status}).`,
      );
    }

    return updatedRun;
  }
}

// Replace name/description fields inside the template.
function hydrateSkillTemplate(
  template: string,
  skillName: string,
  description?: string,
): string {
  const lines = template.split(/\r?\n/);
  const updatedLines = lines.map((line) => {
    if (line.startsWith("name:")) {
      return `name: ${skillName}`;
    }
    if (line.startsWith("description:")) {
      return `description: ${description || "Skill description pending."}`;
    }
    return line;
  });

  return updatedLines.join("\n");
}

function hydrateBugTemplate(
  template: string,
  bugName: string,
  ticket: EngineeringTicket,
): string {
  let hydrated = hydrateSkillTemplate(
    template,
    bugName,
    ticket.requestSummary || ticket.title || "Bug description pending.",
  );

  const summary = buildBugSummaryText(ticket);
  const reproSteps = buildBugReproStepsText(ticket);
  const expectedBehavior = buildBugExpectedBehaviorText(ticket);
  const actualBehavior = buildBugActualBehaviorText(ticket);
  const notes = buildBugNotesText(ticket);

  hydrated = hydrated.replace(
    "Describe the observed issue and impact.",
    summary,
  );
  hydrated = hydrated.replace(
    "1. Step 1\n2. Step 2",
    reproSteps,
  );
  hydrated = hydrated.replace(
    "- What should happen.",
    expectedBehavior,
  );
  hydrated = hydrated.replace(
    "- What actually happens.",
    actualBehavior,
  );
  hydrated = hydrated.replace(
    "- Add any logs, screenshots, or references.",
    notes,
  );

  return hydrated;
}

function buildBugSummaryText(ticket: EngineeringTicket): string {
  const summary = firstNonEmpty(ticket.requestSummary, ticket.title);
  if (!summary) {
    return "Bug report intake received. Summary details were not provided.";
  }
  return summary;
}

function buildBugReproStepsText(ticket: EngineeringTicket): string {
  const extracted = extractOrderedLines(ticket.additionalDetails);
  if (extracted.length > 0) {
    return extracted.map((step, index) => `${index + 1}. ${step}`).join("\n");
  }

  const target = inferAffectedSurface(ticket);
  return [
    `1. Open ${target}.`,
    "2. Navigate to the UI element or flow mentioned in the bug summary.",
    "3. Observe the reported issue in the current behavior.",
  ].join("\n");
}

function buildBugExpectedBehaviorText(ticket: EngineeringTicket): string {
  const text = `${ticket.title} ${ticket.requestSummary}`.toLowerCase();
  if (text.includes("typo") || text.includes("misspell")) {
    return "- The displayed text should be spelled correctly with no extra or missing characters.";
  }
  return "- The affected behavior should match the intended product behavior described in the bug report.";
}

function buildBugActualBehaviorText(ticket: EngineeringTicket): string {
  const parts: string[] = [];
  if (ticket.requestSummary.trim()) {
    parts.push(ticket.requestSummary.trim());
  }
  if (ticket.additionalDetails.trim()) {
    parts.push(ticket.additionalDetails.trim());
  }

  if (parts.length === 0) {
    return "- Actual behavior not provided in intake.";
  }

  return `- ${parts.join(" | ")}`;
}

function buildBugNotesText(ticket: EngineeringTicket): string {
  const notes: string[] = [];
  notes.push(`- Ticket ID: ${ticket.id}`);
  notes.push(`- Source: ${ticket.source || "unknown"}`);
  if (ticket.additionalDetails.trim()) {
    notes.push("- Additional intake details were included above and may contain extra repro context.");
  } else {
    notes.push("- No additional intake details were provided.");
  }
  return notes.join("\n");
}

function inferAffectedSurface(ticket: EngineeringTicket): string {
  const text = `${ticket.title} ${ticket.requestSummary}`;
  if (/admin dashboard/i.test(text)) {
    return "the Admin Dashboard page";
  }
  if (/dashboard/i.test(text)) {
    return "the affected dashboard page";
  }
  if (/settings/i.test(text)) {
    return "the Settings page";
  }
  return "the affected screen/page";
}

function extractOrderedLines(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => /^(\d+[\.)]\s+|[-*]\s+)/.test(line))
    .map((line) => line.replace(/^(\d+[\.)]\s+|[-*]\s+)/, "").trim())
    .filter(Boolean);
}

function firstNonEmpty(...values: Array<string | undefined>): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

// Turn any title into a safe folder name.
function toSkillSlug(raw: string): string {
  const normalized = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || `skill-${Date.now()}`;
}

// Minimal placeholder script stub.
function buildScriptStub(skillName: string): string {
  return `export function ${toScriptExportName(skillName)}(): void {\n  console.log("TODO: implement ${skillName}");\n}\n`;
}

// Convert "my skill name" into a camelCase function name.
function toScriptExportName(skillName: string): string {
  const cleaned = skillName
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .map((segment, index) => {
      const lower = segment.toLowerCase();
      if (index === 0) {
        return lower;
      }
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join("");
  return cleaned || "runSkill";
}
