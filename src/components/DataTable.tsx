import React from 'react';

interface Column<T> {
  header: string;
  key: keyof T | string;
  render?: (item: T) => React.ReactNode;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  isLoading: boolean;
  onEdit?: (item: T) => void;
  onDelete?: (item: T) => void;
  pagination: {
    page: number;
    pageSize: number;
    total: number;
  };
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
}

export default function DataTable<T extends { id: string }>({
  columns,
  data,
  isLoading,
  onEdit,
  onDelete,
  pagination,
  onPageChange,
  onPageSizeChange,
}: DataTableProps<T>) {
  const totalPages = Math.ceil(pagination.total / pagination.pageSize);

  return (
    <div className="w-full bg-gray-800/30 border border-gray-700/50 rounded-2xl overflow-hidden backdrop-blur-md">
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-gray-900/50 border-b border-gray-700">
              {columns.map((col, idx) => (
                <th key={idx} className="px-6 py-4 text-xs font-bold text-gray-400 uppercase tracking-wider">
                  {col.header}
                </th>
              ))}
              {(onEdit || onDelete) && (
                <th className="px-6 py-4 text-xs font-bold text-gray-400 uppercase tracking-wider text-right">
                  Actions
                </th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-700/50">
            {isLoading ? (
              [...Array(5)].map((_, i) => (
                <tr key={i} className="animate-pulse">
                  {columns.map((_, j) => (
                    <td key={j} className="px-6 py-4">
                      <div className="h-4 bg-gray-700/50 rounded w-full"></div>
                    </td>
                  ))}
                  {(onEdit || onDelete) && (
                    <td className="px-6 py-4">
                      <div className="h-4 bg-gray-700/50 rounded w-16 ml-auto"></div>
                    </td>
                  )}
                </tr>
              ))
            ) : data.length === 0 ? (
              <tr>
                <td colSpan={columns.length + (onEdit || onDelete ? 1 : 0)} className="px-6 py-12 text-center text-gray-500">
                  No records found
                </td>
              </tr>
            ) : (
              data.map((item) => (
                <tr key={item.id} className="hover:bg-gray-700/20 transition-colors group">
                  {columns.map((col, idx) => (
                    <td key={idx} className="px-6 py-4 text-sm text-gray-300">
                      {col.render ? col.render(item) : (item[col.key as keyof T] as any)}
                    </td>
                  ))}
                  {(onEdit || onDelete) && (
                    <td className="px-6 py-4 text-right">
                      <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        {onEdit && (
                          <button
                            onClick={() => onEdit(item)}
                            className="p-1.5 text-blue-400 hover:text-blue-300 hover:bg-blue-400/10 rounded-lg transition-all"
                            title="Edit"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                            </svg>
                          </button>
                        )}
                        {onDelete && (
                          <button
                            onClick={() => onDelete(item)}
                            className="p-1.5 text-red-400 hover:text-red-300 hover:bg-red-400/10 rounded-lg transition-all"
                            title="Delete"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Controls */}
      <div className="px-6 py-4 bg-gray-900/30 border-t border-gray-700 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-400">
            Show:
          </span>
          <select
            value={pagination.pageSize}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
            className="bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-300 px-2 py-1 focus:outline-none focus:ring-1 focus:ring-purple-500/50"
          >
            {[10, 25, 50, 100].map(size => (
              <option key={size} value={size}>{size}</option>
            ))}
          </select>
          <span className="text-sm text-gray-500">
            Total: {pagination.total} records
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            disabled={pagination.page <= 1 || isLoading}
            onClick={() => onPageChange(pagination.page - 1)}
            className="p-2 text-gray-400 hover:text-white disabled:text-gray-600 disabled:cursor-not-allowed transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          
          <div className="flex items-center gap-1">
            <span className="text-sm font-medium text-white px-3 py-1 bg-purple-600/20 border border-purple-500/30 rounded-lg">
              {pagination.page}
            </span>
            <span className="text-sm text-gray-500 px-1">of</span>
            <span className="text-sm font-medium text-gray-400 px-3 py-1 bg-gray-800/50 border border-gray-700 rounded-lg">
              {totalPages || 1}
            </span>
          </div>

          <button
            disabled={pagination.page >= totalPages || isLoading}
            onClick={() => onPageChange(pagination.page + 1)}
            className="p-2 text-gray-400 hover:text-white disabled:text-gray-600 disabled:cursor-not-allowed transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
