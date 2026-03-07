import { beforeEach, describe, expect, it, vi } from "vitest";

const { sendEmailMock, archiveEmailMock, sendReplyMock } = vi.hoisted(() => ({
  sendEmailMock: vi.fn(),
  archiveEmailMock: vi.fn(),
  sendReplyMock: vi.fn(),
}));

vi.mock("../supabaseClient", () => ({
  supabase: {
    from: vi.fn(),
  },
}));

vi.mock("../clientLogger", () => ({
  clientLogger: {
    scoped: () => ({
      info: vi.fn(),
      warning: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  },
}));

vi.mock("../../../server/services/gogService", () => ({
  sendEmail: sendEmailMock,
  archiveEmail: archiveEmailMock,
  sendReply: sendReplyMock,
}));

import { __resetEmailSendDraftsForTest } from "../emailSendConfirmation";
import { executeMemoryTool } from "../memoryService";

function extractDraftId(preview: string): string {
  const match = preview.match(/Draft ID:\s*([a-f0-9-]{16,})/i);
  if (!match?.[1]) {
    throw new Error(`Could not extract draft id from preview:\n${preview}`);
  }
  return match[1];
}

describe("memoryService email_action send confirmation flow", () => {
  beforeEach(() => {
    __resetEmailSendDraftsForTest();
    sendEmailMock.mockReset();
    archiveEmailMock.mockReset();
    sendReplyMock.mockReset();
  });

  it("requires preview first, then explicit approval + draft_id before sending", async () => {
    sendEmailMock.mockResolvedValue(true);

    const preview = await executeMemoryTool(
      "email_action",
      {
        action: "send",
        to: "steven@example.com",
        subject: "Status update",
        reply_body: "All done.",
      },
      { userMessage: "can you draft this?" },
    );

    expect(preview).toContain("Draft ready to send:");
    expect(preview).toContain("NOT SENT");

    const draftId = extractDraftId(preview);

    const sent = await executeMemoryTool(
      "email_action",
      {
        action: "send",
        to: "steven@example.com",
        subject: "Status update",
        reply_body: "All done.",
        confirmed: true,
        draft_id: draftId,
      },
      { userMessage: "yes send it" },
    );

    expect(sent).toContain("Sent email to steven@example.com");
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    expect(sendEmailMock).toHaveBeenCalledWith(
      "steven@example.com",
      "Status update",
      "All done.",
    );
  });

  it("blocks confirmed send when explicit approval is missing", async () => {
    sendEmailMock.mockResolvedValue(true);

    const preview = await executeMemoryTool(
      "email_action",
      {
        action: "send",
        to: "steven@example.com",
        subject: "Status update",
        reply_body: "All done.",
      },
      { userMessage: "draft this" },
    );
    const draftId = extractDraftId(preview);

    const blocked = await executeMemoryTool(
      "email_action",
      {
        action: "send",
        to: "steven@example.com",
        subject: "Status update",
        reply_body: "All done.",
        confirmed: true,
        draft_id: draftId,
      },
      { userMessage: "thanks" },
    );

    expect(blocked).toContain("TOOL_FAILED:");
    expect(blocked).toContain("Missing explicit approval");
    expect(sendEmailMock).not.toHaveBeenCalled();
  });
});

