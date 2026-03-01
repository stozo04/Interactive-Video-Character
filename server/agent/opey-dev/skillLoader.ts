import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export interface SkillRequirements {
  bins: string[];
  anyBins: string[];
  env: string[];
  config: string[];
}

export interface SkillRequirementStatus {
  required: SkillRequirements;
  missingBins: string[];
  missingAnyBins: string[];
  missingEnv: string[];
  configKeys: string[];
}

export interface SkillDocument {
  name?: string;
  description?: string;
  metadata?: Record<string, unknown>;
  body: string;
  raw: string;
  source: "ticket" | "file";
  path?: string;
  requirements: SkillRequirementStatus;
}

export interface SkillContext {
  primary?: SkillDocument;
  referenced: SkillDocument[];
  warnings: string[];
}

const FRONTMATTER_DELIMITER = "---";
const SKILL_REFERENCE_REGEX =
  /skills[\\/](?<name>[^\\/\s]+)[\\/]SKILL\.md/gi;

export function loadSkillContext(options: {
  ticketType?: string;
  details?: string;
  workPath: string;
}): SkillContext {
  const ticketType = (options.ticketType || "").toLowerCase();
  const details = options.details || "";
  const warnings: string[] = [];

  let primary: SkillDocument | undefined;
  if (ticketType === "skill" && details.trim().length > 0) {
    primary = parseSkillText(details, { source: "ticket" });
  }

  const referenced = loadReferencedSkills(details, options.workPath, warnings);

  return {
    primary,
    referenced,
    warnings,
  };
}

export function formatSkillContext(context: SkillContext): string | null {
  const sections: string[] = [];

  if (context.primary) {
    sections.push(renderSkillBlock("Primary Skill Input", context.primary));
  }

  if (context.referenced.length > 0) {
    const blocks = context.referenced.map((skill, index) =>
      renderSkillBlock(`Referenced Skill ${index + 1}`, skill),
    );
    sections.push(blocks.join("\n\n"));
  }

  if (context.warnings.length > 0) {
    sections.push(
      ["## Skill Load Warnings", ...context.warnings.map((item) => `- ${item}`)]
        .join("\n"),
    );
  }

  if (sections.length === 0) {
    return null;
  }

  return ["## Skills", sections.join("\n\n")].join("\n\n");
}

function loadReferencedSkills(
  details: string,
  workPath: string,
  warnings: string[],
): SkillDocument[] {
  const references = findSkillReferences(details);
  const uniqueRefs = Array.from(new Set(references));

  const skills: SkillDocument[] = [];

  for (const ref of uniqueRefs) {
    const absolutePath = path.resolve(workPath, ref);
    if (!isPathWithin(workPath, absolutePath)) {
      warnings.push(`Skipped skill reference outside workspace: ${ref}`);
      continue;
    }

    if (!fs.existsSync(absolutePath)) {
      warnings.push(`Referenced skill not found: ${ref}`);
      continue;
    }

    const raw = fs.readFileSync(absolutePath, "utf-8");
    skills.push(
      parseSkillText(raw, {
        source: "file",
        path: absolutePath,
      }),
    );
  }

  return skills;
}

function findSkillReferences(details: string): string[] {
  const references: string[] = [];
  if (!details) return references;

  let match: RegExpExecArray | null;
  while ((match = SKILL_REFERENCE_REGEX.exec(details)) !== null) {
    const fullMatch = match[0];
    references.push(fullMatch);
  }
  return references;
}

function parseSkillText(
  raw: string,
  options: { source: "ticket" | "file"; path?: string },
): SkillDocument {
  const parsed = parseFrontmatter(raw);
  const metadata = parsed.metadata ?? undefined;
  const name = parsed.name || guessSkillName(options.path);
  const description = parsed.description;
  const requirements = evaluateRequirements(metadata);

  return {
    name,
    description,
    metadata,
    body: parsed.body.trim(),
    raw,
    source: options.source,
    path: options.path,
    requirements,
  };
}

function parseFrontmatter(raw: string): {
  name?: string;
  description?: string;
  metadata?: Record<string, unknown>;
  body: string;
} {
  const lines = raw.split(/\r?\n/);
  const firstLine = lines[0]?.trim();

  if (firstLine !== FRONTMATTER_DELIMITER) {
    return {
      body: raw,
    };
  }

  let endIndex = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].trim() === FRONTMATTER_DELIMITER) {
      endIndex = i;
      break;
    }
  }

  if (endIndex === -1) {
    return {
      body: raw,
    };
  }

  const frontmatterLines = lines.slice(1, endIndex);
  const bodyLines = lines.slice(endIndex + 1);

  let name: string | undefined;
  let description: string | undefined;
  let metadata: Record<string, unknown> | undefined;

  for (const line of frontmatterLines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const colonIndex = trimmed.indexOf(":");
    if (colonIndex === -1) continue;

    const key = trimmed.slice(0, colonIndex).trim();
    const value = trimmed.slice(colonIndex + 1).trim();

    if (key === "name") {
      name = value;
    } else if (key === "description") {
      description = value;
    } else if (key === "metadata") {
      metadata = tryParseJson(value) as Record<string, unknown> | undefined;
    }
  }

  return {
    name,
    description,
    metadata,
    body: bodyLines.join("\n"),
  };
}

function tryParseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function evaluateRequirements(
  metadata: Record<string, unknown> | undefined,
): SkillRequirementStatus {
  const requires = extractRequirements(metadata);
  const missingBins = requires.bins.filter((bin) => !binExists(bin));
  const missingEnv = requires.env.filter((envKey) => !process.env[envKey]);

  let missingAnyBins: string[] = [];
  if (requires.anyBins.length > 0) {
    const hasAny = requires.anyBins.some((bin) => binExists(bin));
    missingAnyBins = hasAny ? [] : [...requires.anyBins];
  }

  return {
    required: requires,
    missingBins,
    missingAnyBins,
    missingEnv,
    configKeys: [...requires.config],
  };
}

function extractRequirements(
  metadata: Record<string, unknown> | undefined,
): SkillRequirements {
  const root =
    (metadata?.openclaw as Record<string, unknown> | undefined) ||
    (metadata?.clawdbot as Record<string, unknown> | undefined);
  const requires = (root?.requires as Record<string, unknown> | undefined) || {};

  return {
    bins: toStringArray(requires.bins),
    anyBins: toStringArray(requires.anyBins),
    env: toStringArray(requires.env),
    config: toStringArray(requires.config),
  };
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item)).filter((item) => item.length > 0);
  }
  if (typeof value === "string" && value.trim().length > 0) {
    return [value.trim()];
  }
  return [];
}

function binExists(bin: string): boolean {
  try {
    const command = process.platform === "win32" ? `where ${bin}` : `command -v ${bin}`;
    execSync(command, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function guessSkillName(filePath?: string): string | undefined {
  if (!filePath) return undefined;
  const normalized = filePath.replace(/\\/g, "/");
  const match = normalized.match(/skills\/([^/]+)\/SKILL\.md$/i);
  return match ? match[1] : undefined;
}

function isPathWithin(root: string, candidate: string): boolean {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  if (resolvedRoot === resolvedCandidate) return true;
  const rootWithSep = resolvedRoot.endsWith(path.sep)
    ? resolvedRoot
    : resolvedRoot + path.sep;
  return resolvedCandidate.startsWith(rootWithSep);
}

function renderSkillBlock(title: string, skill: SkillDocument): string {
  const lines: string[] = [`### ${title}`];
  if (skill.name) lines.push(`Name: ${skill.name}`);
  if (skill.description) lines.push(`Description: ${skill.description}`);
  if (skill.path) lines.push(`Source: ${skill.path}`);
  if (skill.source === "ticket" && !skill.path) lines.push("Source: ticket text");

  const requirementLines = describeRequirements(skill.requirements);
  if (requirementLines.length > 0) {
    lines.push("Requirements:");
    lines.push(...requirementLines.map((line) => `- ${line}`));
  }

  if (skill.body.trim().length > 0) {
    lines.push("");
    lines.push("Instructions:");
    lines.push(skill.body.trim());
  }

  return lines.join("\n");
}

function describeRequirements(status: SkillRequirementStatus): string[] {
  const lines: string[] = [];
  if (status.required.bins.length > 0) {
    lines.push(
      `bins: ${status.required.bins.join(", ")}${
        status.missingBins.length > 0
          ? ` (missing: ${status.missingBins.join(", ")})`
          : ""
      }`,
    );
  }
  if (status.required.anyBins.length > 0) {
    lines.push(
      `anyBins: ${status.required.anyBins.join(", ")}${
        status.missingAnyBins.length > 0
          ? ` (missing: ${status.missingAnyBins.join(", ")})`
          : ""
      }`,
    );
  }
  if (status.required.env.length > 0) {
    lines.push(
      `env: ${status.required.env.join(", ")}${
        status.missingEnv.length > 0
          ? ` (missing: ${status.missingEnv.join(", ")})`
          : ""
      }`,
    );
  }
  if (status.required.config.length > 0) {
    lines.push(`config keys: ${status.required.config.join(", ")} (not auto-validated)`);
  }
  return lines;
}
