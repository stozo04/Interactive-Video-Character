import React from 'react';

interface TweetCardProps {
  tweetUrl: string;
}

/** Styled card that renders an X/Twitter link as a visual embed. */
const TweetCard: React.FC<TweetCardProps> = ({ tweetUrl }) => {
  // Extract username and tweet ID from URL
  const match = tweetUrl.match(/x\.com\/([^/]+)\/status\/(\d+)/);
  const username = match?.[1] ?? 'unknown';

  return (
    <a
      href={tweetUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="block mt-2 rounded-xl border border-gray-600 bg-gray-900/60 hover:bg-gray-900/80 transition-colors overflow-hidden"
    >
      <div className="px-3 py-2 flex items-center gap-2">
        {/* X logo */}
        <svg className="h-4 w-4 text-gray-400 flex-shrink-0" viewBox="0 0 24 24" fill="currentColor">
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
        </svg>
        <span className="text-xs text-gray-400">@{username}</span>
        <span className="ml-auto text-xs text-indigo-400">View on X</span>
      </div>
    </a>
  );
};

/** Regex to find X tweet URLs in text. */
export const TWEET_URL_REGEX = /https?:\/\/(?:www\.)?x\.com\/[^/]+\/status\/\d+/g;

/** Extract all tweet URLs from a string. */
export function extractTweetUrls(text: string): string[] {
  return text.match(TWEET_URL_REGEX) ?? [];
}

export default TweetCard;
