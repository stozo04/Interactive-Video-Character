import React, { useState } from 'react';
import type { PendingTweetDraft } from '../handlers/messageActions/types';

interface TweetApprovalCardProps {
  draft: PendingTweetDraft;
  onResolve: (action: 'post' | 'reject') => Promise<{ success: boolean; error?: string }>;
}

const TweetApprovalCard: React.FC<TweetApprovalCardProps> = ({ draft, onResolve }) => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleResolve = async (action: 'post' | 'reject') => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    setError(null);
    const result = await onResolve(action);
    if (!result.success) {
      setError(result.error || 'Failed to resolve tweet draft.');
    }
    setIsSubmitting(false);
  };

  return (
    <div className="mt-3 rounded-2xl border border-slate-700 bg-slate-900/80 p-4 shadow-lg">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-200">
          <span className="inline-flex h-2 w-2 rounded-full bg-sky-400" />
          Tweet Approval
        </div>
        <span className="text-xs text-slate-400">Pending</span>
      </div>

      <div className="mt-3 rounded-xl border border-slate-700/80 bg-slate-950/60 px-3 py-2 text-sm text-slate-100 whitespace-pre-wrap">
        {draft.tweetText}
      </div>

      {draft.includeSelfie && (
        <div className="mt-2 text-xs text-slate-400">
          Selfie requested{draft.selfieScene ? `: ${draft.selfieScene}` : ''}
        </div>
      )}

      {error && (
        <div className="mt-2 text-xs text-red-300">
          {error}
        </div>
      )}

      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={() => handleResolve('post')}
          disabled={isSubmitting}
          className="flex-1 rounded-lg bg-sky-500/90 px-3 py-2 text-sm font-semibold text-white hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSubmitting ? 'Posting...' : 'Post it'}
        </button>
        <button
          type="button"
          onClick={() => handleResolve('reject')}
          disabled={isSubmitting}
          className="flex-1 rounded-lg border border-slate-600 bg-slate-800/70 px-3 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSubmitting ? 'Working...' : 'Discard'}
        </button>
      </div>
    </div>
  );
};

export default TweetApprovalCard;
