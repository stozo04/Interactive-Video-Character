import React, { useState, useEffect, useRef } from 'react';
import LoadingSpinner from './LoadingSpinner';

interface ManagedAction {
  id: string;
  name: string;
  phrases: string[];
  videoUrl: string | null;
  previewAssetUrl: string | null;
}

const parsePhraseInput = (value: string): string[] =>
  value
    .split(/[\n,;]+/)
    .map((phrase) => phrase.trim())
    .filter((phrase) => phrase.length > 0);

const ActionManager: React.FC<{
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
  isCreating: boolean;
  updatingActionId: string | null;
  deletingActionId: string | null;
}> = ({
  actions,
  onCreateAction,
  onUpdateAction,
  onDeleteAction,
  isCreating,
  updatingActionId,
  deletingActionId,
}) => {
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

  return (
    <div className="bg-gray-800/70 rounded-lg h-full flex flex-col border border-gray-700 shadow-lg">
      <div className="p-4 border-b border-gray-700">
        <h3 className="text-lg font-semibold text-white">Manage Actions</h3>
        <p className="text-xs text-gray-400 mt-1">
          Create, edit, or delete action videos for this character.
        </p>
      </div>

      <div className="p-4 space-y-6 overflow-y-auto">
        <form onSubmit={handleCreateSubmit} className="space-y-3">
          <h4 className="text-sm font-semibold text-gray-200 uppercase tracking-wide">
            Add New Action
          </h4>
          <input
            type="text"
            placeholder="Action name (e.g., Wave)"
            value={newActionName}
            onChange={(event) => setNewActionName(event.target.value)}
            className="w-full rounded-md bg-gray-700 text-white px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500"
            disabled={isCreating}
          />
          <textarea
            placeholder='Command phrases (one per line, e.g., "Wave to the camera")'
            value={newActionPhrases}
            onChange={(event) => setNewActionPhrases(event.target.value)}
            className="w-full rounded-md bg-gray-700 text-white px-3 py-2 h-20 resize-y focus:outline-none focus:ring-2 focus:ring-purple-500"
            disabled={isCreating}
          />
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
          {createError && (
            <p className="text-sm text-red-400">{createError}</p>
          )}
          <button
            type="submit"
            className="w-full inline-flex items-center justify-center gap-2 bg-purple-600 text-white font-semibold py-2 rounded-md hover:bg-purple-500 disabled:bg-gray-600 transition-colors"
            disabled={isCreating}
          >
            {isCreating ? (
              <>
                <LoadingSpinner size="h-4 w-4" /> Saving...
              </>
            ) : (
              'Add Action'
            )}
          </button>
        </form>

        <div className="space-y-4">
          <h4 className="text-sm font-semibold text-gray-200 uppercase tracking-wide">
            Existing Actions
          </h4>
          {actions.length === 0 ? (
            <p className="text-sm text-gray-400">
              No actions saved yet. Create your first action above.
            </p>
          ) : (
            actions.map((action) => {
              const isEditing = editingActionId === action.id;
              const isUpdating = updatingActionId === action.id;
              const isDeleting = deletingActionId === action.id;

              return (
                <div
                  key={action.id}
                  className="rounded-lg border border-gray-700 bg-gray-900/60 p-4 space-y-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h5 className="text-base font-semibold text-white">
                        {action.name}
                      </h5>
                      <p className="text-xs text-gray-400 mt-1">
                        {action.phrases.length > 0
                          ? action.phrases.join(', ')
                          : 'No command phrases yet.'}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        className="px-3 py-1 text-xs font-semibold rounded-md bg-gray-700 text-white hover:bg-gray-600 transition-colors"
                        onClick={() => handleStartEditing(action)}
                        disabled={isUpdating || isDeleting}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="px-3 py-1 text-xs font-semibold rounded-md bg-red-600/90 text-white hover:bg-red-500 transition-colors disabled:opacity-60"
                        onClick={() => handleDelete(action.id)}
                        disabled={isUpdating || isDeleting}
                      >
                        {isDeleting ? 'Deleting…' : 'Delete'}
                      </button>
                    </div>
                  </div>

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
                      className="w-full rounded-md border border-gray-800"
                    />
                  ) : (
                    <p className="text-xs text-gray-500">
                      Video preview unavailable.
                    </p>
                  )}

                  {isEditing && (
                    <form
                      onSubmit={handleUpdateSubmit}
                      className="space-y-3 border-t border-gray-700 pt-3"
                    >
                      <input
                        type="text"
                        value={editName}
                        onChange={(event) => setEditName(event.target.value)}
                        className="w-full rounded-md bg-gray-700 text-white px-3 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500"
                        disabled={isUpdating}
                      />
                      <textarea
                        value={editPhrases}
                        onChange={(event) => setEditPhrases(event.target.value)}
                        className="w-full rounded-md bg-gray-700 text-white px-3 py-2 h-20 resize-y focus:outline-none focus:ring-2 focus:ring-purple-500"
                        disabled={isUpdating}
                      />
                      <input
                        type="file"
                        accept="video/mp4,video/webm"
                        ref={editVideoInputRef}
                        onChange={(event) => {
                          const file = event.target.files?.[0] ?? null;
                          setEditVideo(file);
                        }}
                        className="w-full text-sm text-gray-300"
                        disabled={isUpdating}
                      />
                      {editError && (
                        <p className="text-sm text-red-400">{editError}</p>
                      )}
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          className="px-3 py-1 rounded-md text-sm text-gray-300 hover:text-white transition-colors"
                          onClick={() => {
                            setEditingActionId(null);
                            setEditName('');
                            setEditPhrases('');
                            setEditVideo(null);
                            if (editVideoInputRef.current) {
                              editVideoInputRef.current.value = '';
                            }
                          }}
                          disabled={isUpdating}
                        >
                          Cancel
                        </button>
                        <button
                          type="submit"
                          className="inline-flex items-center gap-2 px-3 py-1 rounded-md bg-purple-600 text-white text-sm font-semibold hover:bg-purple-500 transition-colors disabled:bg-gray-600"
                          disabled={isUpdating}
                        >
                          {isUpdating ? (
                            <>
                              <LoadingSpinner size="h-4 w-4" /> Saving...
                            </>
                          ) : (
                            'Save Changes'
                          )}
                        </button>
                      </div>
                    </form>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};

export default ActionManager;

