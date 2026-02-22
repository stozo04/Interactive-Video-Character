import fs from "node:fs/promises";
import path from "node:path";

export interface MkdirExecutionResult {
  absolutePath: string;
  existedBefore: boolean;
  existsAfter: boolean;
}

export interface ReadFileExecutionResult {
  absolutePath: string;
  exists: boolean;
  isFile: boolean;
  sizeBytes: number;
  content: string;
  truncated: boolean;
}

export interface WriteFileExecutionResult {
  absolutePath: string;
  existedBefore: boolean;
  bytesWritten: number;
  existsAfter: boolean;
  mode: "overwrite" | "append";
}

export interface DeletePathExecutionResult {
  absolutePath: string;
  existedBefore: boolean;
  existsAfter: boolean;
  deletedType: "file" | "directory" | "none";
}

export interface SearchMatch {
  relativePath: string;
  lineNumber: number;
  lineText: string;
}

export interface SearchExecutionResult {
  rootAbsolutePath: string;
  filesScanned: number;
  matches: SearchMatch[];
  truncated: boolean;
}

const DEFAULT_MAX_READ_BYTES = 128 * 1024;
const MAX_SEARCH_FILES = 1000;
const MAX_SEARCH_MATCHES = 200;
const MAX_SEARCH_FILE_BYTES = 256 * 1024;

export async function createDirectoryWithVerification(
  absolutePath: string,
): Promise<MkdirExecutionResult> {
  const existedBefore = await directoryExists(absolutePath);

  if (!existedBefore) {
    await fs.mkdir(absolutePath, { recursive: true });
  }

  const existsAfter = await directoryExists(absolutePath);

  return {
    absolutePath,
    existedBefore,
    existsAfter,
  };
}

export async function readFileWithBounds(
  absolutePath: string,
  maxBytes = DEFAULT_MAX_READ_BYTES,
): Promise<ReadFileExecutionResult> {
  const stat = await safeStat(absolutePath);
  if (!stat || !stat.isFile()) {
    return {
      absolutePath,
      exists: Boolean(stat),
      isFile: false,
      sizeBytes: 0,
      content: "",
      truncated: false,
    };
  }

  const fullBuffer = await fs.readFile(absolutePath);
  const isBinary = fullBuffer.includes(0);
  const limitedBuffer = fullBuffer.subarray(0, Math.max(1, maxBytes));
  const content = isBinary
    ? `[binary file omitted: ${path.basename(absolutePath)}]`
    : limitedBuffer.toString("utf8");

  return {
    absolutePath,
    exists: true,
    isFile: true,
    sizeBytes: stat.size,
    content,
    truncated: !isBinary && fullBuffer.length > limitedBuffer.length,
  };
}

export async function writeFileWithVerification(options: {
  absolutePath: string;
  content: string;
  mode: "overwrite" | "append";
}): Promise<WriteFileExecutionResult> {
  const { absolutePath, content, mode } = options;
  const stat = await safeStat(absolutePath);
  const existedBefore = Boolean(stat?.isFile());

  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  if (mode === "append") {
    await fs.appendFile(absolutePath, content, "utf8");
  } else {
    await fs.writeFile(absolutePath, content, "utf8");
  }

  const afterStat = await safeStat(absolutePath);

  return {
    absolutePath,
    existedBefore,
    bytesWritten: Buffer.byteLength(content, "utf8"),
    existsAfter: Boolean(afterStat?.isFile()),
    mode,
  };
}

export async function deletePathWithVerification(options: {
  absolutePath: string;
  recursive: boolean;
}): Promise<DeletePathExecutionResult> {
  const { absolutePath, recursive } = options;
  const existingStat = await safeStat(absolutePath);

  if (!existingStat) {
    return {
      absolutePath,
      existedBefore: false,
      existsAfter: false,
      deletedType: "none",
    };
  }

  const deletedType: DeletePathExecutionResult["deletedType"] = existingStat.isDirectory()
    ? "directory"
    : "file";

  if (existingStat.isDirectory()) {
    await fs.rm(absolutePath, { recursive, force: false });
  } else {
    await fs.unlink(absolutePath);
  }

  const existsAfter = Boolean(await safeStat(absolutePath));

  return {
    absolutePath,
    existedBefore: true,
    existsAfter,
    deletedType,
  };
}

export async function searchContentInTree(options: {
  rootAbsolutePath: string;
  query: string;
  caseSensitive: boolean;
}): Promise<SearchExecutionResult> {
  const { rootAbsolutePath, query, caseSensitive } = options;
  const loweredQuery = caseSensitive ? query : query.toLowerCase();
  const matches: SearchMatch[] = [];
  let filesScanned = 0;
  let truncated = false;

  const queue: string[] = [rootAbsolutePath];

  while (queue.length > 0) {
    const currentPath = queue.shift();
    if (!currentPath) {
      continue;
    }

    const entries = await fs.readdir(currentPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === ".git" || entry.name === "node_modules") {
        continue;
      }

      const absoluteEntryPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        queue.push(absoluteEntryPath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      filesScanned += 1;
      if (filesScanned > MAX_SEARCH_FILES) {
        truncated = true;
        break;
      }

      const fileStat = await safeStat(absoluteEntryPath);
      if (!fileStat || fileStat.size > MAX_SEARCH_FILE_BYTES) {
        continue;
      }

      const fileBuffer = await fs.readFile(absoluteEntryPath);
      if (fileBuffer.includes(0)) {
        continue;
      }

      const fileContent = fileBuffer.toString("utf8");
      const lines = fileContent.split(/\r?\n/);
      for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
        const line = lines[lineIndex];
        const haystack = caseSensitive ? line : line.toLowerCase();
        if (!haystack.includes(loweredQuery)) {
          continue;
        }

        matches.push({
          relativePath: path.relative(rootAbsolutePath, absoluteEntryPath) || entry.name,
          lineNumber: lineIndex + 1,
          lineText: line.slice(0, 500),
        });

        if (matches.length >= MAX_SEARCH_MATCHES) {
          truncated = true;
          break;
        }
      }

      if (matches.length >= MAX_SEARCH_MATCHES) {
        break;
      }
    }

    if (truncated) {
      break;
    }
  }

  return {
    rootAbsolutePath,
    filesScanned,
    matches,
    truncated,
  };
}

async function directoryExists(absolutePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(absolutePath);
    return stat.isDirectory();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function safeStat(absolutePath: string): Promise<Awaited<ReturnType<typeof fs.stat>> | null> {
  try {
    return await fs.stat(absolutePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}
