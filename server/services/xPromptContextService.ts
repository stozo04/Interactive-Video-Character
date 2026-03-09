import { supabaseAdmin as supabase } from "./supabaseAdmin";
import { getDrafts, getRecentPostedTweets } from "./xTwitterServerService";

function getTimeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export async function buildXTweetPromptSection(): Promise<string> {
  const [pendingDrafts, recentPosted, modeFactResult] = await Promise.all([
    getDrafts("pending_approval"),
    getRecentPostedTweets(5),
    supabase
      .from("user_facts")
      .select("fact_value")
      .eq("category", "preference")
      .eq("fact_key", "x_posting_mode")
      .limit(1)
      .maybeSingle(),
  ]);

  if (pendingDrafts.length === 0 && recentPosted.length === 0) {
    return "";
  }

  const postingMode = modeFactResult.data?.fact_value === "autonomous"
    ? "autonomous"
    : "approval_required";

  let pendingSection = "";
  if (pendingDrafts.length > 0) {
    const draft = pendingDrafts[0];
    pendingSection = `
PENDING TWEET (waiting for approval):
{ id: "${draft.id}", text: "${draft.tweetText}", intent: "${draft.intent || "thought"}" }

- Web: Steven can approve it with the Tweet Approval Card.
- Telegram/WhatsApp: Steven can reply "POST TWEET" or "REJECT TWEET".
- Do NOT claim the tweet is posted until approval happens.`;
  }

  let recentSection = "";
  if (recentPosted.length > 0) {
    const lines = recentPosted.map((tweet) => {
      const ago = getTimeAgo(tweet.postedAt || tweet.createdAt);
      const hasMetrics = tweet.likeCount > 0 || tweet.repostCount > 0 || tweet.replyCount > 0;
      const metricsStr = hasMetrics
        ? ` (${tweet.likeCount} likes, ${tweet.repostCount} reposts, ${tweet.replyCount} replies)`
        : "";
      return `- [${ago}] "${tweet.tweetText}"${metricsStr}`;
    });

    recentSection = `
RECENTLY POSTED TWEETS:
${lines.join("\n")}

- You can reference these in conversation if relevant ("my intro tweet got 12 likes!"). They are public on your X feed.
- Do NOT re-post similar content.`;
  }

  return `
====================================================
X (TWITTER) POSTING
====================================================${pendingSection}${recentSection}

POSTING MODE: ${postingMode}
${postingMode === "approval_required"
    ? "- You must get user approval before any tweet is posted.\n- Present drafts conversationally, not as a formal request."
    : "- Tweets are posted automatically. You can mention what you posted."}

Rules:
1. Never reveal that tweets are AI-generated.
2. Never post private conversation details.
3. If presenting a draft, be casual: "oh I was thinking of tweeting this..." not "I have generated a tweet for your approval."
4. Max 1 pending draft shown at a time.
`.trim();
}
