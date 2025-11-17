import React, { useState, useRef, useEffect } from 'react';
import { CharacterProfile } from '../types';
import LoadingSpinner from './LoadingSpinner';

interface ManagedAction {
  id: string;
  name: string;
  phrases: string[];
  videoUrl: string | null;
  previewAssetUrl: string | null;
}

interface ActionManagementViewProps {
  character: CharacterProfile;
  actions: ManagedAction[];
  onCreateAction: (input: {
    name: string;
    phrases: string[];
    videoFile: File;
  }) => Promise<void>;
  onUpdateAction: (
    actionId: string,
    input: {
      name: string;
      phrases: string[];
      videoFile?: File;
    }
  ) => Promise<void>;
  onDeleteAction: (actionId: string) => Promise<void>;
  onBack: () => void;
  isCreating: boolean;
  updatingActionId: string | null;
  deletingActionId: string | null;
}

const parsePhraseInput = (value: string): string[] =>
  value
    .split(/[\n,;]+/)
    .map((phrase) => phrase.trim())
    .filter((phrase) => phrase.length > 0);

const ActionManagementView: React.FC<ActionManagementViewProps> = ({
  character,
  actions,
  onCreateAction,
  onUpdateAction,
  onDeleteAction,
  onBack,
  isCreating,
  updatingActionId,
  deletingActionId,
}) => {
  const [showAddForm, setShowAddForm] = useState(false);
  const [newActionName, setNewActionName] = useState('');
  const [newActionPhrases, setNewActionPhrases] = useState('');
  const [newActionVideo, setNewActionVideo] = useState<File | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);

  const [editingActionId, setEditingActionId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editPhrases, setEditPhrases] = useState('');
  const [editVideo, setEditVideo] = useState<File | null>(null);
  const [editError, setEditError] = useState<string | null>(null);

  const createVideoInputRef = useRef<HTMLInputElement>(null);
  const editVideoInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editingActionId) return;
    const actionExists = actions.some((action) => action.id === editingActionId);
    if (!actionExists) {
      setEditingActionId(null);
      setEditName('');
      setEditPhrases('');
      setEditVideo(null);
      setEditError(null);
    }
  }, [actions, editingActionId]);

  const handleCreateSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setCreateError(null);

    if (!newActionName.trim()) {
      setCreateError('Action name is required.');
      return;
    }

    if (!newActionVideo) {
      setCreateError('Select a video for this action.');
      return;
    }

    const phrases = parsePhraseInput(newActionPhrases);

    try {
      await onCreateAction({
        name: newActionName.trim(),
        phrases,
        videoFile: newActionVideo,
      });
      setNewActionName('');
      setNewActionPhrases('');
      setNewActionVideo(null);
      setShowAddForm(false);
      if (createVideoInputRef.current) {
        createVideoInputRef.current.value = '';
      }
    } catch (error) {
      console.error('Failed to create action:', error);
      setCreateError('Failed to create action. Please try again.');
    }
  };

  const handleStartEditing = (action: ManagedAction) => {
    setEditingActionId(action.id);
    setEditName(action.name);
    setEditPhrases(action.phrases.join('\n'));
    setEditVideo(null);
    setEditError(null);
    if (editVideoInputRef.current) {
      editVideoInputRef.current.value = '';
    }
  };

  const handleUpdateSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editingActionId) return;
    setEditError(null);

    const trimmedName = editName.trim();
    if (!trimmedName) {
      setEditError('Action name is required.');
      return;
    }

    const phrases = parsePhraseInput(editPhrases);

    try {
      await onUpdateAction(editingActionId, {
        name: trimmedName,
        phrases,
        videoFile: editVideo ?? undefined,
      });
      setEditingActionId(null);
      setEditName('');
      setEditPhrases('');
      setEditVideo(null);
      if (editVideoInputRef.current) {
        editVideoInputRef.current.value = '';
      }
    } catch (error) {
      console.error('Failed to update action:', error);
      setEditError('Failed to update action. Please try again.');
    }
  };

  const handleDelete = async (actionId: string) => {
    const confirmed = window.confirm(
      'Are you sure you want to delete this action? This cannot be undone.'
    );
    if (!confirmed) return;

    try {
      await onDeleteAction(actionId);
      if (editingActionId === actionId) {
        setEditingActionId(null);
      }
    } catch (error) {
      console.error('Failed to delete action:', error);
      alert('Failed to delete action. Please try again.');
    }
  };

  const handleCancelEdit = () => {
    setEditingActionId(null);
    setEditName('');
    setEditPhrases('');
    setEditVideo(null);
    setEditError(null);
    if (editVideoInputRef.current) {
      editVideoInputRef.current.value = '';
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
            <h2 className="text-3xl font-bold">Manage Actions</h2>
            <p className="text-gray-400 mt-1">{character.displayName || character.name}</p>
          </div>
        </div>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="bg-purple-600 hover:bg-purple-500 text-white rounded-full px-6 py-2 font-semibold transition-colors flex items-center gap-2"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          {showAddForm ? 'Cancel' : 'Add New Action'}
        </button>
      </div>

      {/* Add New Action Form */}
      {showAddForm && (
        <div className="bg-gray-800/70 rounded-lg p-6 mb-6 border border-gray-700">
          <h3 className="text-xl font-semibold mb-4">Add New Action</h3>
          <form onSubmit={handleCreateSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Action Name
              </label>
              <input
                type="text"
                placeholder="e.g., Wave, Kiss, Dance"
                value={newActionName}
                onChange={(event) => setNewActionName(event.target.value)}
                className="w-full rounded-md bg-gray-700 text-white px-4 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500"
                disabled={isCreating}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Command Phrases (one per line)
              </label>
              <textarea
                placeholder='e.g., "Wave to the camera"\n"Say hello"\n"Greet me"'
                value={newActionPhrases}
                onChange={(event) => setNewActionPhrases(event.target.value)}
                className="w-full rounded-md bg-gray-700 text-white px-4 py-2 h-24 resize-y focus:outline-none focus:ring-2 focus:ring-purple-500"
                disabled={isCreating}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Video File
              </label>
              <input
                type="file"
                accept="video/mp4,video/webm"
                ref={createVideoInputRef}
                onChange={(event) => {
                  const file = event.target.files?.[0] ?? null;
                  setNewActionVideo(file);
                }}
                className="w-full text-sm text-gray-300"
                disabled={isCreating}
              />
            </div>
            {createError && (
              <p className="text-sm text-red-400">{createError}</p>
            )}
            <button
              type="submit"
              className="w-full inline-flex items-center justify-center gap-2 bg-purple-600 text-white font-semibold py-3 rounded-md hover:bg-purple-500 disabled:bg-gray-600 transition-colors"
              disabled={isCreating}
            >
              {isCreating ? (
                <>
                  <LoadingSpinner size="h-5 w-5" /> Creating...
                </>
              ) : (
                'Create Action'
              )}
            </button>
          </form>
        </div>
      )}

      {/* Actions Grid */}
      <div className="flex-1 overflow-y-auto">
        {actions.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-24 w-24 text-gray-600 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-gray-400 text-lg">No actions yet. Create your first action!</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 md:gap-6 pb-4">
            {actions.map((action) => {
              const isEditing = editingActionId === action.id;
              const isUpdating = updatingActionId === action.id;
              const isDeleting = deletingActionId === action.id;

              return (
                <div
                  key={action.id}
                  className="bg-gray-800/70 rounded-lg overflow-hidden border border-gray-700 flex flex-col"
                >
                  {/* Video Preview */}
                  <div className="relative aspect-[9/16] bg-black group">
                    {action.videoUrl || action.previewAssetUrl ? (
                      <video
                        key={`${action.id}-${action.videoUrl ?? action.previewAssetUrl}`}
                        src={action.videoUrl ?? action.previewAssetUrl ?? undefined}
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
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-gray-500">
                        <p className="text-xs">No preview</p>
                      </div>
                    )}
                  </div>

                  {/* Action Info */}
                  <div className="p-3 flex-1 flex flex-col">
                    <h3 className="text-sm font-semibold text-white mb-1 truncate">
                      {action.name}
                    </h3>
                    <p className="text-xs text-gray-400 mb-3 line-clamp-2">
                      {action.phrases.length > 0
                        ? action.phrases.join(', ')
                        : 'No command phrases'}
                    </p>

                    {/* Action Buttons */}
                    {!isEditing && (
                      <div className="flex gap-2 mt-auto">
                        <button
                          type="button"
                          className="flex-1 px-3 py-1.5 text-xs font-semibold rounded-md bg-gray-700 text-white hover:bg-gray-600 transition-colors"
                          onClick={() => handleStartEditing(action)}
                          disabled={isUpdating || isDeleting}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="flex-1 px-3 py-1.5 text-xs font-semibold rounded-md bg-red-600/90 text-white hover:bg-red-500 transition-colors disabled:opacity-60"
                          onClick={() => handleDelete(action.id)}
                          disabled={isUpdating || isDeleting}
                        >
                          {isDeleting ? 'Deleting…' : 'Delete'}
                        </button>
                      </div>
                    )}

                    {/* Edit Form */}
                    {isEditing && (
                      <form
                        onSubmit={handleUpdateSubmit}
                        className="space-y-2 mt-2 border-t border-gray-700 pt-3"
                      >
                        <input
                          type="text"
                          value={editName}
                          onChange={(event) => setEditName(event.target.value)}
                          className="w-full rounded-md bg-gray-700 text-white px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-purple-500"
                          disabled={isUpdating}
                          placeholder="Action name"
                        />
                        <textarea
                          value={editPhrases}
                          onChange={(event) => setEditPhrases(event.target.value)}
                          className="w-full rounded-md bg-gray-700 text-white px-2 py-1.5 text-xs h-16 resize-y focus:outline-none focus:ring-2 focus:ring-purple-500"
                          disabled={isUpdating}
                          placeholder="Command phrases"
                        />
                        <input
                          type="file"
                          accept="video/mp4,video/webm"
                          ref={editVideoInputRef}
                          onChange={(event) => {
                            const file = event.target.files?.[0] ?? null;
                            setEditVideo(file);
                          }}
                          className="w-full text-xs text-gray-300"
                          disabled={isUpdating}
                        />
                        {editError && (
                          <p className="text-xs text-red-400">{editError}</p>
                        )}
                        <div className="flex gap-2">
                          <button
                            type="button"
                            className="flex-1 px-2 py-1.5 rounded-md text-xs text-gray-300 hover:text-white transition-colors bg-gray-700/50"
                            onClick={handleCancelEdit}
                            disabled={isUpdating}
                          >
                            Cancel
                          </button>
                          <button
                            type="submit"
                            className="flex-1 inline-flex items-center justify-center gap-1 px-2 py-1.5 rounded-md bg-purple-600 text-white text-xs font-semibold hover:bg-purple-500 transition-colors disabled:bg-gray-600"
                            disabled={isUpdating}
                          >
                            {isUpdating ? (
                              <>
                                <LoadingSpinner size="h-3 w-3" /> Saving...
                              </>
                            ) : (
                              'Save'
                            )}
                          </button>
                        </div>
                      </form>
                    )}
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

export default ActionManagementView;

