import path from "node:path";

export interface ResolvedWorkspacePath {
  workspaceRoot: string;
  absolutePath: string;
  relativePath: string;
}

export function resolvePathInWorkspace(
  workspaceRoot: string,
  requestedPath: string,
): ResolvedWorkspacePath {
  const normalizedRoot = path.resolve(workspaceRoot);
  const trimmedPath = requestedPath.trim();

  if (!trimmedPath) {
    throw new Error("Path is required.");
  }

  if (trimmedPath.includes("\0")) {
    throw new Error("Path contains an invalid null byte.");
  }

  const absoluteTarget = path.isAbsolute(trimmedPath)
    ? path.resolve(trimmedPath)
    : path.resolve(normalizedRoot, trimmedPath);

  if (!isPathInsideWorkspace(normalizedRoot, absoluteTarget)) {
    throw new Error("Requested path is outside the workspace root.");
  }

  const relativePath = path.relative(normalizedRoot, absoluteTarget);

  return {
    workspaceRoot: normalizedRoot,
    absolutePath: absoluteTarget,
    relativePath,
  };
}

function isPathInsideWorkspace(workspaceRoot: string, targetPath: string): boolean {
  const normalizedRoot = workspaceRoot.endsWith(path.sep)
    ? workspaceRoot
    : `${workspaceRoot}${path.sep}`;

  return targetPath === workspaceRoot || targetPath.startsWith(normalizedRoot);
}
