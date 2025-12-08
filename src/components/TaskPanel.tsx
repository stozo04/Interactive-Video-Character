// src/components/TaskPanel.tsx
import React, { useState } from 'react';
import { Task } from '../types';
import { TaskItem } from './TaskItem';

interface TaskPanelProps {
  tasks: Task[];
  isOpen: boolean;
  onToggle: () => void;
  onTaskToggle: (taskId: string) => void;
  onTaskDelete: (taskId: string) => void;
  onTaskCreate: (text: string, priority?: 'low' | 'medium' | 'high') => void;
}

type FilterType = 'all' | 'active' | 'completed';

export const TaskPanel: React.FC<TaskPanelProps> = ({
  tasks,
  isOpen,
  onToggle,
  onTaskToggle,
  onTaskDelete,
  onTaskCreate
}) => {
  const [newTaskText, setNewTaskText] = useState('');
  const [filter, setFilter] = useState<FilterType>('all');
  const [selectedPriority, setSelectedPriority] = useState<'low' | 'medium' | 'high' | undefined>(undefined);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (newTaskText.trim()) {
      onTaskCreate(newTaskText.trim(), selectedPriority);
      setNewTaskText('');
      setSelectedPriority(undefined);
    }
  };

  // Filter tasks based on selected filter
  const filteredTasks = tasks.filter(task => {
    if (filter === 'active') return !task.completed;
    if (filter === 'completed') return task.completed;
    return true;
  });

  // Calculate stats
  const incompleteTasks = tasks.filter(t => !t.completed);
  const completedTasks = tasks.filter(t => t.completed);
  const completionRate = tasks.length > 0 
    ? Math.round((completedTasks.length / tasks.length) * 100) 
    : 0;

  return (
    <>
      {/* Side Panel */}
      <div
        className={`fixed top-0 right-0 h-full w-full md:w-96 bg-gray-900/95 backdrop-blur-lg shadow-2xl transform transition-transform duration-300 z-30 border-l border-gray-700 ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="flex flex-col h-full">
          {/* Header */}
          <div className="flex-shrink-0 p-4 border-b border-gray-700">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-purple-400 to-indigo-600">
                Daily Checklist
              </h2>
              <button
                onClick={onToggle}
                className="text-gray-400 hover:text-white transition-colors"
                aria-label="Close panel"
              >
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Stats */}
            {tasks.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-400">
                    {completedTasks.length} of {tasks.length} complete
                  </span>
                  <span className="text-purple-400 font-semibold">{completionRate}%</span>
                </div>
                {/* Progress Bar */}
                <div className="w-full bg-gray-700 rounded-full h-2 overflow-hidden">
                  <div
                    className="bg-gradient-to-r from-purple-500 to-indigo-600 h-full transition-all duration-500"
                    style={{ width: `${completionRate}%` }}
                  />
                </div>
              </div>
            )}

            {/* Quick Add Form */}
            <form onSubmit={handleSubmit} className="mt-4">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newTaskText}
                  onChange={(e) => setNewTaskText(e.target.value)}
                  placeholder="Add a new task..."
                  className="flex-grow bg-gray-800 text-gray-100 border border-gray-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-purple-500 transition-colors"
                />
                <button
                  type="submit"
                  disabled={!newTaskText.trim()}
                  className="bg-gradient-to-br from-purple-500 to-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
                >
                  Add
                </button>
              </div>

              {/* Priority Selector */}
              <div className="flex gap-2 mt-2">
                <span className="text-xs text-gray-400 self-center">Priority:</span>
                {(['low', 'medium', 'high'] as const).map((priority) => (
                  <button
                    key={priority}
                    type="button"
                    onClick={() => setSelectedPriority(selectedPriority === priority ? undefined : priority)}
                    className={`text-xs px-2 py-1 rounded transition-colors ${
                      selectedPriority === priority
                        ? priority === 'high'
                          ? 'bg-red-500 text-white'
                          : priority === 'medium'
                          ? 'bg-yellow-500 text-white'
                          : 'bg-gray-500 text-white'
                        : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
                    }`}
                  >
                    {priority.charAt(0).toUpperCase() + priority.slice(1)}
                  </button>
                ))}
              </div>
            </form>

            {/* Filter Tabs */}
            <div className="flex gap-2 mt-4">
              {(['all', 'active', 'completed'] as const).map((filterType) => (
                <button
                  key={filterType}
                  onClick={() => setFilter(filterType)}
                  className={`flex-1 text-xs py-2 rounded transition-colors ${
                    filter === filterType
                      ? 'bg-gradient-to-br from-purple-500 to-indigo-600 text-white'
                      : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                  }`}
                >
                  {filterType.charAt(0).toUpperCase() + filterType.slice(1)}
                  {filterType === 'active' && incompleteTasks.length > 0 && (
                    <span className="ml-1 text-purple-300">({incompleteTasks.length})</span>
                  )}
                  {filterType === 'completed' && completedTasks.length > 0 && (
                    <span className="ml-1 text-gray-500">({completedTasks.length})</span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Task List */}
          <div className="flex-grow overflow-y-auto p-4">
            {filteredTasks.length === 0 ? (
              <div className="text-center py-12">
                <div className="text-gray-600 mb-2">
                  {filter === 'completed' ? (
                    <svg className="w-16 h-16 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  ) : (
                    <svg className="w-16 h-16 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                    </svg>
                  )}
                </div>
                <p className="text-gray-500 text-sm">
                  {tasks.length === 0
                    ? 'No tasks yet. Add one above!'
                    : filter === 'completed'
                    ? 'No completed tasks.'
                    : 'No active tasks. Great job! ✨'}
                </p>
              </div>
            ) : (
              <div className="space-y-1">
                {filteredTasks.map((task) => (
                  <TaskItem
                    key={task.id}
                    task={task}
                    onToggle={onTaskToggle}
                    onDelete={onTaskDelete}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Footer Tip */}
          <div className="flex-shrink-0 p-4 border-t border-gray-700 bg-gray-900/50">
            <p className="text-xs text-gray-500 text-center">
              💡 Try saying "Add [task] to my checklist" or "Mark [task] as done"
            </p>
          </div>
        </div>
      </div>

      {/* Backdrop Overlay (mobile) */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-20 md:hidden"
          onClick={onToggle}
        />
      )}
    </>
  );
};

export default TaskPanel;

