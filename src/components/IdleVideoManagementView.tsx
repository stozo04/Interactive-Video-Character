import React, { useState, useRef } from 'react';
import { CharacterProfile } from '../types';
import LoadingSpinner from './LoadingSpinner';

interface ManagedIdleVideo {
  id: string;
  videoUrl: string;
  isLocal: boolean;
}

interface IdleVideoManagementViewProps {
  character: CharacterProfile;
  idleVideos: ManagedIdleVideo[];
  onAddIdleVideo: (videoFile: File) => Promise<void>;
  onDeleteIdleVideo: (videoId: string) => Promise<void>;
  onBack: () => void;
  isAdding: boolean;
  deletingVideoId: string | null;
}

const IdleVideoManagementView: React.FC<IdleVideoManagementViewProps> = ({
  character,
  idleVideos,
  onAddIdleVideo,
  onDeleteIdleVideo,
  onBack,
  isAdding,
  deletingVideoId,
}) => {
  const [showAddForm, setShowAddForm] = useState(false);
  const [newVideo, setNewVideo] = useState<File | null>(null);
  const [addError, setAddError] = useState<string | null>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);

  const handleAddSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setAddError(null);

    if (!newVideo) {
      setAddError('Please select a video file.');
      return;
    }

    try {
      await onAddIdleVideo(newVideo);
      setNewVideo(null);
      setShowAddForm(false);
      if (videoInputRef.current) {
        videoInputRef.current.value = '';
      }
    } catch (error) {
      console.error('Failed to add idle video:', error);
      setAddError('Failed to add idle video. Please try again.');
    }
  };

  const handleDelete = async (videoId: string) => {
    if (idleVideos.length <= 1) {
      alert('Cannot delete the last idle video. A character must have at least one idle video.');
      return;
    }

    const confirmed = window.confirm(
      'Are you sure you want to delete this idle video? This cannot be undone.'
    );
    if (!confirmed) return;

    try {
      await onDeleteIdleVideo(videoId);
    } catch (error) {
      console.error('Failed to delete idle video:', error);
      alert('Failed to delete idle video. Please try again.');
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <button
            onClick={onBack}
            className="bg-gray-800/50 hover:bg-gray-700/80 text-white rounded-full p-2 transition-colors"
            aria-label="Back to character selection"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div>
            <h2 className="text-3xl font-bold">Manage Idle Videos</h2>
            <p className="text-gray-400 mt-1">{character.displayName || character.name}</p>
            <p className="text-sm text-gray-500 mt-1">{idleVideos.length} idle video{idleVideos.length !== 1 ? 's' : ''}</p>
          </div>
        </div>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="bg-purple-600 hover:bg-purple-500 text-white rounded-full px-6 py-2 font-semibold transition-colors flex items-center gap-2"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          {showAddForm ? 'Cancel' : 'Add Idle Video'}
        </button>
      </div>

      {/* Add New Video Form */}
      {showAddForm && (
        <div className="bg-gray-800/70 rounded-lg p-6 mb-6 border border-gray-700">
          <h3 className="text-xl font-semibold mb-4">Add New Idle Video</h3>
          <form onSubmit={handleAddSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Video File
              </label>
              <input
                type="file"
                accept="video/mp4,video/webm"
                ref={videoInputRef}
                onChange={(event) => {
                  const file = event.target.files?.[0] ?? null;
                  setNewVideo(file);
                }}
                className="w-full text-sm text-gray-300"
                disabled={isAdding}
              />
              <p className="text-xs text-gray-500 mt-2">
                This video should start and end at the same neutral pose as your other idle videos for seamless looping.
              </p>
            </div>
            {addError && (
              <p className="text-sm text-red-400">{addError}</p>
            )}
            <button
              type="submit"
              className="w-full inline-flex items-center justify-center gap-2 bg-purple-600 text-white font-semibold py-3 rounded-md hover:bg-purple-500 disabled:bg-gray-600 transition-colors"
              disabled={isAdding}
            >
              {isAdding ? (
                <>
                  <LoadingSpinner size="h-5 w-5" /> Adding...
                </>
              ) : (
                'Add Idle Video'
              )}
            </button>
          </form>
        </div>
      )}

      {/* Videos Grid */}
      <div className="flex-1 overflow-y-auto">
        {idleVideos.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-24 w-24 text-gray-600 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-gray-400 text-lg">No idle videos. Add your first one!</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 md:gap-6 pb-4">
            {idleVideos.map((video, index) => {
              const isDeleting = deletingVideoId === video.id;

              return (
                <div
                  key={video.id}
                  className="bg-gray-800/70 rounded-lg overflow-hidden border border-gray-700 flex flex-col"
                >
                  {/* Video Preview */}
                  <div className="relative aspect-[9/16] bg-black group">
                    <video
                      key={`${video.id}-${video.videoUrl}`}
                      src={video.videoUrl}
                      muted
                      loop
                      playsInline
                      onMouseEnter={(event) => event.currentTarget.play().catch(() => {})}
                      onMouseLeave={(event) => {
                        event.currentTarget.pause();
                        event.currentTarget.currentTime = 0;
                      }}
                      className="w-full h-full object-cover"
                    />
                  </div>

                  {/* Video Info */}
                  <div className="p-3 flex-1 flex flex-col">
                    <h3 className="text-sm font-semibold text-white mb-3">
                      Idle Video {index + 1}
                    </h3>

                    {/* Delete Button */}
                    <div className="mt-auto">
                      <button
                        type="button"
                        className="w-full px-3 py-1.5 text-xs font-semibold rounded-md bg-red-600/90 text-white hover:bg-red-500 transition-colors disabled:opacity-60"
                        onClick={() => handleDelete(video.id)}
                        disabled={isDeleting || idleVideos.length <= 1}
                        title={idleVideos.length <= 1 ? "Cannot delete the last idle video" : "Delete idle video"}
                      >
                        {isDeleting ? 'Deleting…' : 'Delete'}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default IdleVideoManagementView;

