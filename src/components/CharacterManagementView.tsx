import React, { useState } from 'react';
import { CharacterProfile } from '../types';

interface ManagementAction {
  id: string;
  name: string;
  phrases: string[];
  videoUrl: string | null;
  previewAssetUrl: string | null;
}

interface ManagementIdleVideo {
  id: string;
  videoUrl: string;
  isLocal: boolean;
}

interface CharacterManagementViewProps {
  character: CharacterProfile;
  actions: ManagementAction[];
  idleVideos: ManagementIdleVideo[];
  onBack: () => void;
  onUpdateImage: () => void;
  onDeleteCharacter: () => void;
  onCreateAction: (input: { name: string; phrases: string[]; videoFile: File }) => Promise<void>;
  onUpdateAction: (actionId: string, input: any) => Promise<void>;
  onDeleteAction: (actionId: string) => Promise<void>;
  onAddIdleVideo: (videoFile: File) => Promise<void>;
  onDeleteIdleVideo: (videoId: string) => Promise<void>;
  isCreatingAction: boolean;
  updatingActionId: string | null;
  deletingActionId: string | null;
  isAddingIdleVideo: boolean;
  deletingIdleVideoId: string | null;
}

const CharacterManagementView: React.FC<CharacterManagementViewProps> = ({
  character,
  actions,
  idleVideos,
  onBack,
  onUpdateImage,
  onDeleteCharacter,
  onCreateAction,
  onUpdateAction,
  onDeleteAction,
  onAddIdleVideo,
  onDeleteIdleVideo,
  isCreatingAction,
  updatingActionId,
  deletingActionId,
  isAddingIdleVideo,
  deletingIdleVideoId,
}) => {
  const [idleVideoPage, setIdleVideoPage] = useState(0);
  const [actionPage, setActionPage] = useState(0);
  const [isCreating, setIsCreating] = useState(false);
  const [isEditing, setIsEditing] = useState<string | null>(null);
  const [formData, setFormData] = useState({ name: '', phrases: '', videoFile: null as File | null });

  const ITEMS_PER_PAGE = 3;
  const idleVideoPages = Math.ceil(idleVideos.length / ITEMS_PER_PAGE);
  const actionPages = Math.ceil(actions.length / ITEMS_PER_PAGE);

  const visibleIdleVideos = idleVideos.slice(
    idleVideoPage * ITEMS_PER_PAGE,
    (idleVideoPage + 1) * ITEMS_PER_PAGE
  );

  const visibleActions = actions.slice(
    actionPage * ITEMS_PER_PAGE,
    (actionPage + 1) * ITEMS_PER_PAGE
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.videoFile) return;

    const phrases = formData.phrases
      .split('\n')
      .map(p => p.trim())
      .filter(p => p.length > 0);

    if (isEditing) {
      await onUpdateAction(isEditing, {
        name: formData.name,
        phrases,
        videoFile: formData.videoFile,
      });
      setIsEditing(null);
    } else {
      await onCreateAction({
        name: formData.name,
        phrases,
        videoFile: formData.videoFile,
      });
      setIsCreating(false);
    }
    setFormData({ name: '', phrases: '', videoFile: null });
  };

  const handleEditAction = (action: ManagementAction) => {
    setIsEditing(action.id);
    setFormData({
      name: action.name,
      phrases: action.phrases.join('\n'),
      videoFile: null,
    });
  };

  const handleFileInput = (accept: string, callback: (file: File) => void) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) callback(file);
    };
    input.click();
  };

  return (
    <div className="flex flex-col h-full bg-gray-800 rounded-lg overflow-hidden">
      {/* Header */}
      <div className="bg-gray-900 p-4 flex items-center justify-between border-b border-gray-700">
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-gray-300 hover:text-white transition-colors"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back
        </button>
        <h2 className="text-xl font-bold text-white">Manage Character</h2>
        <div className="w-20"></div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Main Photo Section */}
        <div className="bg-gray-900 rounded-lg p-6 border-2 border-red-500/30">
          <h3 className="text-lg font-semibold text-white mb-4">Main Photo</h3>
          <div className="flex items-start gap-4">
            <div className="w-32 h-48 rounded-lg overflow-hidden border-2 border-red-500 flex-shrink-0">
              <img
                src={`data:${character.image.mimeType};base64,${character.image.base64}`}
                alt="Character"
                className="w-full h-full object-cover"
              />
            </div>
            <div className="flex flex-col gap-2">
              <button
                onClick={onUpdateImage}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors font-semibold"
              >
                EDIT
              </button>
              <button
                onClick={() => {
                  if (window.confirm('Delete this character? This cannot be undone.')) {
                    onDeleteCharacter();
                  }
                }}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors font-semibold"
              >
                DELETE
              </button>
            </div>
          </div>
        </div>

        {/* Idle Videos Section */}
        <div className="bg-gray-900 rounded-lg p-6 border-2 border-purple-500/30">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-white">Idle</h3>
            <button
              onClick={() => handleFileInput('video/*', onAddIdleVideo)}
              disabled={isAddingIdleVideo}
              className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors font-semibold disabled:opacity-50"
            >
              {isAddingIdleVideo ? 'Adding...' : 'ADD'}
            </button>
          </div>
          
          <div className="flex items-center gap-4">
            <button
              onClick={() => setIdleVideoPage(Math.max(0, idleVideoPage - 1))}
              disabled={idleVideoPage === 0}
              className="p-2 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M15 19l-7-7 7-7" />
              </svg>
            </button>

            <div className="flex-1 grid grid-cols-3 gap-4">
              {visibleIdleVideos.map((video) => (
                <div key={video.id} className="relative aspect-[9/16] rounded-lg overflow-hidden border-2 border-purple-500 group">
                  <video
                    src={video.videoUrl}
                    className="w-full h-full object-cover"
                    muted
                    loop
                    playsInline
                    onMouseEnter={(e) => e.currentTarget.play()}
                    onMouseLeave={(e) => {
                      e.currentTarget.pause();
                      e.currentTarget.currentTime = 0;
                    }}
                  />
                  <button
                    onClick={() => onDeleteIdleVideo(video.id)}
                    disabled={deletingIdleVideoId === video.id}
                    className="absolute top-2 right-2 bg-red-600/80 hover:bg-red-500 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-50"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}
              {/* Empty slots */}
              {Array.from({ length: ITEMS_PER_PAGE - visibleIdleVideos.length }).map((_, i) => (
                <div key={`empty-${i}`} className="aspect-[9/16] rounded-lg border-2 border-purple-500/30 border-dashed"></div>
              ))}
            </div>

            <button
              onClick={() => setIdleVideoPage(Math.min(idleVideoPages - 1, idleVideoPage + 1))}
              disabled={idleVideoPage >= idleVideoPages - 1 || idleVideos.length === 0}
              className="p-2 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        </div>

        {/* Actions Section */}
        <div className="bg-gray-900 rounded-lg p-6 border-2 border-red-500/30">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-white">Actions</h3>
            <button
              onClick={() => {
                setIsCreating(true);
                setFormData({ name: '', phrases: '', videoFile: null });
              }}
              disabled={isCreating || isEditing !== null}
              className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors font-semibold disabled:opacity-50"
            >
              ADD
            </button>
          </div>

          {(isCreating || isEditing) && (
            <form onSubmit={handleSubmit} className="mb-4 p-4 bg-gray-800 rounded-lg border border-gray-700">
              <h4 className="font-semibold mb-2">{isEditing ? 'Edit Action' : 'New Action'}</h4>
              <input
                type="text"
                placeholder="Action name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full p-2 mb-2 bg-gray-700 rounded text-white"
                required
              />
              <textarea
                placeholder="Phrases (one per line)"
                value={formData.phrases}
                onChange={(e) => setFormData({ ...formData, phrases: e.target.value })}
                className="w-full p-2 mb-2 bg-gray-700 rounded text-white h-24"
                required
              />
              <input
                type="file"
                accept="video/*"
                onChange={(e) => setFormData({ ...formData, videoFile: e.target.files?.[0] || null })}
                className="w-full mb-2 text-sm text-gray-300"
                required={!isEditing}
              />
              <div className="flex gap-2">
                <button type="submit" className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded">
                  {isEditing ? 'Update' : 'Create'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsCreating(false);
                    setIsEditing(null);
                    setFormData({ name: '', phrases: '', videoFile: null });
                  }}
                  className="px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
          
          <div className="flex items-center gap-4">
            <button
              onClick={() => setActionPage(Math.max(0, actionPage - 1))}
              disabled={actionPage === 0}
              className="p-2 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M15 19l-7-7 7-7" />
              </svg>
            </button>

            <div className="flex-1 grid grid-cols-3 gap-4">
              {visibleActions.map((action) => (
                <div key={action.id} className="relative">
                  <div className="aspect-[3/4] rounded-lg overflow-hidden border-2 border-red-500 group">
                    {action.previewAssetUrl && (
                      <video
                        src={action.previewAssetUrl}
                        className="w-full h-full object-cover"
                        muted
                        loop
                        playsInline
                        onMouseEnter={(e) => e.currentTarget.play()}
                        onMouseLeave={(e) => {
                          e.currentTarget.pause();
                          e.currentTarget.currentTime = 0;
                        }}
                      />
                    )}
                    <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                      <button
                        onClick={() => handleEditAction(action)}
                        className="p-2 bg-blue-600 hover:bg-blue-700 rounded-full"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                        </svg>
                      </button>
                      <button
                        onClick={() => onDeleteAction(action.id)}
                        disabled={deletingActionId === action.id}
                        className="p-2 bg-red-600 hover:bg-red-700 rounded-full disabled:opacity-50"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </div>
                  <p className="text-sm text-white mt-1 truncate">{action.name}</p>
                </div>
              ))}
              {/* Empty slots */}
              {Array.from({ length: ITEMS_PER_PAGE - visibleActions.length }).map((_, i) => (
                <div key={`empty-${i}`} className="aspect-[3/4] rounded-lg border-2 border-red-500/30 border-dashed"></div>
              ))}
            </div>

            <button
              onClick={() => setActionPage(Math.min(actionPages - 1, actionPage + 1))}
              disabled={actionPage >= actionPages - 1 || actions.length === 0}
              className="p-2 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CharacterManagementView;

