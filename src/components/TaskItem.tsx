// src/components/TaskItem.tsx
import React from 'react';
import { Task } from '../types';

interface TaskItemProps {
  task: Task;
  onToggle: (taskId: string) => void;
  onDelete: (taskId: string) => void;
}

const getPriorityColor = (priority?: 'low' | 'medium' | 'high'): string => {
  switch (priority) {
    case 'high':
      return 'bg-red-500';
    case 'medium':
      return 'bg-yellow-500';
    case 'low':
      return 'bg-gray-500';
    default:
      return 'bg-gray-600';
  }
};

const getPriorityLabel = (priority?: 'low' | 'medium' | 'high'): string => {
  switch (priority) {
    case 'high':
      return '!';
    case 'medium':
      return '!!';
    case 'low':
      return '';
    default:
      return '';
  }
};

export const TaskItem: React.FC<TaskItemProps> = ({ task, onToggle, onDelete }) => {
  const formatTimestamp = (timestamp: number): string => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="group flex items-start gap-3 p-3 rounded-lg hover:bg-gray-700/30 transition-colors">
      {/* Checkbox */}
      <button
        onClick={() => onToggle(task.id)}
        className={`flex-shrink-0 mt-0.5 w-5 h-5 rounded border-2 transition-all ${
          task.completed
            ? 'bg-gradient-to-br from-purple-500 to-indigo-600 border-purple-500'
            : 'border-gray-500 hover:border-purple-400'
        }`}
        aria-label={task.completed ? 'Mark as incomplete' : 'Mark as complete'}
      >
        {task.completed && (
          <svg
            className="w-full h-full text-white p-0.5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={3}
              d="M5 13l4 4L19 7"
            />
          </svg>
        )}
      </button>

      {/* Task Content */}
      <div className="flex-grow min-w-0">
        <div className="flex items-start gap-2">
          {/* Priority Indicator */}
          {task.priority && (
            <span
              className={`flex-shrink-0 w-2 h-2 rounded-full mt-1.5 ${getPriorityColor(task.priority)}`}
              title={`Priority: ${task.priority}`}
            >
              {getPriorityLabel(task.priority) && (
                <span className="sr-only">{getPriorityLabel(task.priority)}</span>
              )}
            </span>
          )}

          {/* Task Text */}
          <p
            className={`text-sm flex-grow transition-all ${
              task.completed
                ? 'line-through text-gray-500'
                : 'text-gray-200'
            }`}
          >
            {task.text}
          </p>

          {/* Delete Button - Shows on hover */}
          <button
            onClick={() => onDelete(task.id)}
            className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-gray-500 hover:text-red-400"
            aria-label="Delete task"
            title="Delete task"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
              />
            </svg>
          </button>
        </div>

        {/* Category Tag */}
        {task.category && (
          <span className="inline-block mt-1 px-2 py-0.5 text-xs bg-gray-700/50 text-gray-400 rounded">
            {task.category}
          </span>
        )}

        {/* Timestamp for completed tasks */}
        {task.completed && task.completedAt && (
          <p className="text-xs text-gray-600 mt-1">
            Completed {formatTimestamp(task.completedAt)}
          </p>
        )}
      </div>
    </div>
  );
};

export default TaskItem;

