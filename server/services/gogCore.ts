// server/services/gogCore.ts
//
// Shared gogcli execution primitives used by Gmail/Calendar/Tasks services.

import { execFile } from 'node:child_process';
import { log } from '../runtimeLogger';

const runtimeLog = log.fromContext({ source: 'gogCliCore', route: 'server/gog' });

// Default timeout for CLI commands (15 seconds - most complete in < 3s)
export const DEFAULT_TIMEOUT_MS = 15_000;
// Longer timeout for send/modify operations
export const WRITE_TIMEOUT_MS = 30_000;

// GOG_ACCOUNT env var should be set, or pass --account to commands
const GOG_ACCOUNT = process.env.GOG_ACCOUNT || '';

export interface GogExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export class GogError extends Error {
  exitCode: number;
  stderr: string;

  constructor(message: string, exitCode: number, stderr: string) {
    super(message);
    this.name = 'GogError';
    this.exitCode = exitCode;
    this.stderr = stderr;
  }
}

/**
 * Execute a gog CLI command and return raw stdout/stderr.
 * Throws on non-zero exit code or timeout.
 */
export function execGogRaw(
  args: string[],
  timeoutMs = DEFAULT_TIMEOUT_MS,
  caller = 'unknown',
): Promise<GogExecResult> {
  return new Promise((resolve, reject) => {
    // Always request JSON output and inject account if configured
    const fullArgs = ['--json', ...args];
    if (GOG_ACCOUNT && !args.includes('--account')) {
      fullArgs.unshift('--account', GOG_ACCOUNT);
    }

    runtimeLog.info('Executing gog command', {
      source: 'gogCliCore',
      caller,
      args: fullArgs.join(' '),
    });

    const startMs = Date.now();

    execFile('gog', fullArgs, { timeout: timeoutMs, windowsHide: true }, (error, stdout, stderr) => {
      const durationMs = Date.now() - startMs;

      if (error) {
        runtimeLog.error('gog command failed', {
          source: 'gogCliCore',
          caller,
          args: fullArgs.join(' '),
          exitCode: (error as any).code ?? null,
          stderr: stderr?.substring(0, 500) || '',
          durationMs,
        });
        reject(new GogError(
          `gog ${args[0]} failed: ${stderr || error.message}`,
          (error as any).code ?? 1,
          stderr,
        ));
        return;
      }

      runtimeLog.info('gog command completed', {
        source: 'gogCliCore',
        caller,
        args: fullArgs.join(' '),
        durationMs,
        stdoutLength: stdout?.length ?? 0,
      });

      resolve({
        stdout: stdout || '',
        stderr: stderr || '',
        exitCode: 0,
      });
    });
  });
}

/**
 * Execute a gog command and parse JSON output.
 */
export async function execGogJson<T = unknown>(
  args: string[],
  timeoutMs = DEFAULT_TIMEOUT_MS,
  caller = 'unknown',
): Promise<T> {
  const result = await execGogRaw(args, timeoutMs, caller);
  try {
    return JSON.parse(result.stdout) as T;
  } catch {
    runtimeLog.error('Failed to parse gog JSON output', {
      source: 'gogCliCore',
      caller,
      args: args.join(' '),
      stdout: result.stdout.substring(0, 500),
    });
    throw new GogError(`Failed to parse JSON from gog ${args[0]}`, 0, result.stdout);
  }
}

