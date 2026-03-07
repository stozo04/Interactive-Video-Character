import { beforeEach, describe, expect, it, vi } from "vitest";

const { execGogRawMock, execGogJsonMock } = vi.hoisted(() => ({
  execGogRawMock: vi.fn(),
  execGogJsonMock: vi.fn(),
}));

vi.mock("../gogCore", () => {
  class MockGogError extends Error {
    exitCode: number;
    stderr: string;

    constructor(message: string, exitCode = 1, stderr = "") {
      super(message);
      this.name = "GogError";
      this.exitCode = exitCode;
      this.stderr = stderr;
    }
  }

  return {
    DEFAULT_TIMEOUT_MS: 5000,
    WRITE_TIMEOUT_MS: 5000,
    GogError: MockGogError,
    execGogRaw: execGogRawMock,
    execGogJson: execGogJsonMock,
  };
});

vi.mock("../googleTasksIndexService", () => ({
  deleteTaskIndex: vi.fn(),
  findOpenIndexedTaskByTitle: vi.fn().mockResolvedValue(null),
  markTaskIndexStatus: vi.fn(),
  upsertTaskIndex: vi.fn(),
  upsertTaskIndexBatch: vi.fn(),
}));

vi.mock("../../runtimeLogger", () => ({
  log: {
    fromContext: () => ({
      info: vi.fn(),
      warning: vi.fn(),
      error: vi.fn(),
      critical: vi.fn(),
    }),
  },
}));

import { execGeneralCommand } from "../gogService";

describe("gogService.execGeneralCommand gmail safeguards", () => {
  beforeEach(() => {
    execGogRawMock.mockReset();
    execGogJsonMock.mockReset();
  });

  it("blocks gmail send through google_cli", async () => {
    await expect(
      execGeneralCommand('gmail send --to user@example.com --subject "Hi" --body "Hello"')
    ).rejects.toThrow(/Write operation "send" is not allowed for gmail/i);

    expect(execGogRawMock).not.toHaveBeenCalled();
  });

  it("still allows gmail archive operations", async () => {
    execGogRawMock.mockResolvedValue({
      stdout: '{"ok":true}',
      stderr: "",
      exitCode: 0,
    });

    const result = await execGeneralCommand("gmail batch modify msg123 --remove INBOX");

    expect(result).toContain('"ok":true');
    expect(execGogRawMock).toHaveBeenCalledTimes(1);
    expect(execGogRawMock).toHaveBeenCalledWith(
      ["gmail", "batch", "modify", "msg123", "--remove", "INBOX"],
      5000,
      "gogService",
    );
  });
});
