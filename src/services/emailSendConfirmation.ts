// src/services/emailSendConfirmation.ts
//
// Safety guardrails for outbound `email_action send`.
// Enforces preview-first flow + explicit user approval before dispatch.

const DRAFT_TTL_MS = 30 * 60 * 1000;

interface PendingEmailDraft {
  id: string;
  to: string;
  subject: string;
  body: string;
  createdAtMs: number;
}

const pendingEmailDrafts = new Map<string, PendingEmailDraft>();

function normalize(value: string): string {
  return value.trim().replace(/\r\n/g, "\n");
}

function pruneExpiredDrafts(nowMs = Date.now()): void {
  for (const [id, draft] of pendingEmailDrafts.entries()) {
    if (nowMs - draft.createdAtMs > DRAFT_TTL_MS) {
      pendingEmailDrafts.delete(id);
    }
  }
}

const APPROVAL_RE =
  /\b(?:yes|send it|go ahead|looks good|approved|approve it|do it|ship it|send now)\b/i;

export function hasExplicitSendApproval(userMessage?: string): boolean {
  const message = typeof userMessage === "string" ? userMessage.trim() : "";
  if (!message) return false;
  return APPROVAL_RE.test(message);
}

export function createEmailSendDraftPreview(
  to: string,
  subject: string,
  body: string,
): { draftId: string; previewText: string } {
  pruneExpiredDrafts();

  const draftId = crypto.randomUUID();
  const normalizedTo = normalize(to);
  const normalizedSubject = normalize(subject);
  const normalizedBody = normalize(body);

  pendingEmailDrafts.set(draftId, {
    id: draftId,
    to: normalizedTo,
    subject: normalizedSubject,
    body: normalizedBody,
    createdAtMs: Date.now(),
  });

  const previewText = [
    "Draft ready to send:",
    `Draft ID: ${draftId}`,
    `To: ${normalizedTo}`,
    `Subject: ${normalizedSubject}`,
    "---",
    normalizedBody,
    "---",
    "NOT SENT. Show this preview to Steven.",
    'Only call email_action send again with confirmed=true, this draft_id, and the same to/subject/reply_body after explicit approval.',
  ].join("\n");

  return { draftId, previewText };
}

export function validateConfirmedEmailSend(input: {
  draftId?: string;
  to: string;
  subject: string;
  body: string;
  userMessage?: string;
}): { ok: true } | { ok: false; reason: string } {
  pruneExpiredDrafts();

  const draftId = (input.draftId || "").trim();
  if (!draftId) {
    return {
      ok: false,
      reason:
        "email_action send confirmation requires draft_id from the preview response.",
    };
  }

  const draft = pendingEmailDrafts.get(draftId);
  if (!draft) {
    return {
      ok: false,
      reason:
        "Draft not found or expired. Create a fresh preview before sending.",
    };
  }

  const normalizedTo = normalize(input.to);
  const normalizedSubject = normalize(input.subject);
  const normalizedBody = normalize(input.body);

  if (
    draft.to !== normalizedTo ||
    draft.subject !== normalizedSubject ||
    draft.body !== normalizedBody
  ) {
    return {
      ok: false,
      reason:
        "Draft content changed after preview. Generate a new preview before sending.",
    };
  }

  if (!hasExplicitSendApproval(input.userMessage)) {
    return {
      ok: false,
      reason:
        "Missing explicit approval from Steven. Wait for a clear confirmation like 'yes', 'send it', or 'go ahead'.",
    };
  }

  pendingEmailDrafts.delete(draftId);
  return { ok: true };
}

// Test-only reset hook to keep unit tests isolated.
export function __resetEmailSendDraftsForTest(): void {
  pendingEmailDrafts.clear();
}

