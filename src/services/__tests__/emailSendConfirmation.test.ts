import { beforeEach, describe, expect, it } from "vitest";
import {
  __resetEmailSendDraftsForTest,
  createEmailSendDraftPreview,
  hasExplicitSendApproval,
  validateConfirmedEmailSend,
} from "../emailSendConfirmation";

describe("emailSendConfirmation", () => {
  beforeEach(() => {
    __resetEmailSendDraftsForTest();
  });

  it("does not treat initial send requests as explicit approval", () => {
    expect(hasExplicitSendApproval("send an email to mom saying I'll be late")).toBe(false);
    expect(hasExplicitSendApproval("yes, send it")).toBe(true);
  });

  it("requires matching draft + explicit approval before allowing send", () => {
    const { draftId } = createEmailSendDraftPreview(
      "mom@example.com",
      "Late pickup",
      "Running 15 min late."
    );

    const noApproval = validateConfirmedEmailSend({
      draftId,
      to: "mom@example.com",
      subject: "Late pickup",
      body: "Running 15 min late.",
      userMessage: "can you draft that",
    });
    expect(noApproval).toEqual({
      ok: false,
      reason:
        "Missing explicit approval from Steven. Wait for a clear confirmation like 'yes', 'send it', or 'go ahead'.",
    });

    const approved = validateConfirmedEmailSend({
      draftId,
      to: "mom@example.com",
      subject: "Late pickup",
      body: "Running 15 min late.",
      userMessage: "yes send it",
    });
    expect(approved).toEqual({ ok: true });

    const replay = validateConfirmedEmailSend({
      draftId,
      to: "mom@example.com",
      subject: "Late pickup",
      body: "Running 15 min late.",
      userMessage: "yes send it",
    });
    expect(replay).toEqual({
      ok: false,
      reason: "Draft not found or expired. Create a fresh preview before sending.",
    });
  });

  it("rejects changed content after preview", () => {
    const { draftId } = createEmailSendDraftPreview(
      "mom@example.com",
      "Late pickup",
      "Running 15 min late."
    );

    const changed = validateConfirmedEmailSend({
      draftId,
      to: "mom@example.com",
      subject: "Late pickup",
      body: "Actually 45 min late.",
      userMessage: "go ahead",
    });

    expect(changed).toEqual({
      ok: false,
      reason: "Draft content changed after preview. Generate a new preview before sending.",
    });
  });
});

