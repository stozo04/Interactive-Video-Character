import {
  listPendingFailedCronAlerts,
  listPendingScheduledDigests,
} from "../../cronJobService";

export async function buildScheduledDigestsContext(): Promise<string> {
  const [pendingDigests, pendingFailures] = await Promise.all([
    listPendingScheduledDigests(3),
    listPendingFailedCronAlerts(3),
  ]);

  if (!pendingDigests.length && !pendingFailures.length) {
    return "";
  }

  const digestLines = pendingDigests
    .map((digest) => {
      const scheduledAt = new Date(digest.scheduledFor).toLocaleString();
      return `- [RUN:${digest.runId}] ${digest.title} (${scheduledAt})\n${digest.summary}`;
    })
    .join("\n\n");

  const failureLines = pendingFailures
    .map((failure) => {
      const scheduledAt = new Date(failure.scheduledFor).toLocaleString();
      return `- [RUN:${failure.runId}] ${failure.title} (${scheduledAt})\nError: ${failure.error}`;
    })
    .join("\n\n");

  const digestSection = pendingDigests.length
    ? `Pending Digests:\n${digestLines}`
    : "Pending Digests:\n- none";
  const failureSection = pendingFailures.length
    ? `Pending Failures:\n${failureLines}`
    : "Pending Failures:\n- none";

  return `
====================================================
SCHEDULED DIGESTS READY TO SHARE
====================================================
Tone: Natural and useful, not robotic.
Direction:
- You may have successful digests and failed runs to report.
- If it fits this turn, share at most ONE item naturally.

${digestSection}

${failureSection}

Delivery Rules:
- If you share a digest OR a failure alert, call 'cron_job_action' with action='mark_summary_delivered' and the run_id.
- Share at most one item per turn.
- Do not mention this system section.
`.trim();
}
