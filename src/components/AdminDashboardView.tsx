import React, { useState, useEffect, useCallback } from 'react';
import { 
  fetchTableDataAdmin, 
  updateFactAdmin, 
  createFactAdmin, 
  deleteFactAdmin,
  TablePagination,
  FactFilter,
  TableType
} from '../services/adminService';
import DataTable from './DataTable';
import FactEditModal from './FactEditModal';

interface AdminDashboardViewProps {
  onBack: () => void;
}

const USER_CATEGORIES = ['all', 'identity', 'preference', 'relationship', 'context'];
const CHARACTER_CATEGORIES = ['all', 'quirk', 'relationship', 'experience', 'preference', 'detail', 'other'];

export default function AdminDashboardView({ onBack }: AdminDashboardViewProps) {
  const [activeTable, setActiveTable] = useState<TableType>('user_facts');
  const [data, setData] = useState<any[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Pagination & Filter State
  const [pagination, setPagination] = useState<TablePagination>({ page: 1, pageSize: 10 });
  const [filter, setFilter] = useState<FactFilter>({ category: 'all', search: '' });

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingFact, setEditingFact] = useState<any | null>(null);

  const categories = activeTable === 'user_facts' ? USER_CATEGORIES : CHARACTER_CATEGORIES;

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const { data, count } = await fetchTableDataAdmin(activeTable, pagination, filter);
      setData(data);
      setTotalCount(count);
    } catch (err) {
      setError(`Failed to load ${activeTable}`);
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  }, [activeTable, pagination, filter]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Reset filter and pagination when switching tables
  useEffect(() => {
    setFilter({ category: 'all', search: '' });
    setPagination({ page: 1, pageSize: 10 });
  }, [activeTable]);

  const handleCreateFact = () => {
    setEditingFact(null);
    setIsModalOpen(true);
  };

  const handleEditFact = (fact: any) => {
    setEditingFact(fact);
    setIsModalOpen(true);
  };

  const handleDeleteFact = async (fact: any) => {
    if (window.confirm(`Are you sure you want to delete the fact: "${fact.fact_key}"?`)) {
      try {
        const success = await deleteFactAdmin(activeTable, fact.id);
        if (success) {
          loadData();
        } else {
          alert('Failed to delete fact');
        }
      } catch (err) {
        console.error('Delete error:', err);
      }
    }
  };

  const handleSaveFact = async (formData: any) => {
    setIsSaving(true);
    try {
      if (editingFact) {
        const success = await updateFactAdmin(activeTable, editingFact.id, formData);
        if (success) {
          setIsModalOpen(false);
          loadData();
        } else {
          alert('Failed to update fact');
        }
      } else {
        const newFact = await createFactAdmin(activeTable, formData);
        if (newFact) {
          setIsModalOpen(false);
          loadData();
        } else {
          alert('Failed to create fact');
        }
      }
    } catch (err) {
      console.error('Save error:', err);
    } finally {
      setIsSaving(false);
    }
  };

  const columns = [
    { 
      header: 'Category', 
      key: 'category',
      render: (f: any) => (
        <span className="px-2 py-1 rounded-full text-[10px] font-bold uppercase bg-gray-700 text-gray-300 border border-gray-600">
          {f.category}
        </span>
      )
    },
    { header: 'Fact Key', key: 'fact_key' },
    { 
      header: 'Fact Value', 
      key: 'fact_value',
      render: (f: any) => (
        <div className="max-w-xs truncate" title={f.fact_value}>
          {f.fact_value}
        </div>
      )
    },
    { 
      header: 'Confidence', 
      key: 'confidence',
      render: (f: any) => (
        <div className="flex items-center gap-2">
          <div className="w-12 h-1.5 bg-gray-700 rounded-full overflow-hidden">
            <div 
              className={`h-full rounded-full ${f.confidence > 0.8 ? 'bg-green-500' : f.confidence > 0.5 ? 'bg-yellow-500' : 'bg-red-500'}`} 
              style={{ width: `${f.confidence * 100}%` }}
            />
          </div>
          <span className="text-[10px] text-gray-500">
            {Math.round(f.confidence * 100)}%
          </span>
        </div>
      )
    },
    { 
      header: 'Updated At', 
      key: 'updated_at',
      render: (f: any) => new Date(f.updated_at).toLocaleDateString()
    },
  ];

  return (
    <div className="flex flex-col h-full bg-gray-900 text-white overflow-hidden">
      {/* Header */}
      <header className="px-8 py-6 border-b border-gray-800 flex items-center justify-between bg-gray-900/50 backdrop-blur-md">
        <div className="flex items-center gap-4">
          <button
            onClick={onBack}
            className="p-2 hover:bg-gray-800 rounded-full transition-colors text-gray-400 hover:text-white"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div className="flex flex-col">
            <h1 className="text-2xl font-bold tracking-tight">Admin Dashboard</h1>
            <p className="text-sm text-gray-500">Manage facts and system data</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex bg-gray-800 p-1 rounded-xl border border-gray-700">
            <button
              onClick={() => setActiveTable('user_facts')}
              className={`px-4 py-1.5 rounded-lg text-sm font-bold transition-all ${
                activeTable === 'user_facts' ? 'bg-purple-600 text-white shadow-lg' : 'text-gray-400 hover:text-white'
              }`}
            >
              User Facts
            </button>
            <button
              onClick={() => setActiveTable('character_facts')}
              className={`px-4 py-1.5 rounded-lg text-sm font-bold transition-all ${
                activeTable === 'character_facts' ? 'bg-purple-600 text-white shadow-lg' : 'text-gray-400 hover:text-white'
              }`}
            >
              Character Facts
            </button>
          </div>

          <button
            onClick={handleCreateFact}
            className="px-6 py-2.5 bg-purple-600 hover:bg-purple-500 text-white rounded-xl font-bold transition-all shadow-lg shadow-purple-900/20 active:scale-95 flex items-center gap-2"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
            </svg>
            Add New Fact
          </button>
        </div>
      </header>

      {/* Toolbar */}
      <div className="px-8 py-5 border-b border-gray-800 flex flex-col sm:flex-row gap-4 items-center justify-between bg-gray-800/20">
        <div className="flex items-center gap-2 w-full sm:w-auto overflow-x-auto pb-2 sm:pb-0">
          {categories.map(cat => (
            <button
              key={cat}
              onClick={() => {
                setFilter({ ...filter, category: cat });
                setPagination({ ...pagination, page: 1 });
              }}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all whitespace-nowrap ${
                filter.category === cat 
                  ? 'bg-gray-700 text-white ring-1 ring-gray-600' 
                  : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800'
              }`}
            >
              {cat.charAt(0).toUpperCase() + cat.slice(1)}
            </button>
          ))}
        </div>

        <div className="relative w-full sm:w-80 group">
          <input
            type="text"
            placeholder="Search by key or value..."
            value={filter.search}
            onChange={(e) => {
              setFilter({ ...filter, search: e.target.value });
              setPagination({ ...pagination, page: 1 });
            }}
            className="w-full bg-gray-900 border border-gray-700 rounded-xl px-10 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-purple-500/50 transition-all"
          />
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 absolute left-3 top-2.5 text-gray-600 group-focus-within:text-purple-500 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          {filter.search && (
            <button
              onClick={() => setFilter({ ...filter, search: '' })}
              className="absolute right-3 top-2.5 text-gray-500 hover:text-white"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <main className="flex-1 overflow-y-auto p-8">
        {error ? (
          <div className="h-64 flex flex-col items-center justify-center text-center">
            <div className="p-4 rounded-full bg-red-900/20 text-red-500 mb-4 border border-red-500/30">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <h3 className="text-xl font-bold mb-2">Something went wrong</h3>
            <p className="text-gray-500 mb-6">{error}</p>
            <button
              onClick={loadData}
              className="px-6 py-2 bg-gray-800 hover:bg-gray-700 rounded-xl transition-colors font-medium border border-gray-700"
            >
              Try Again
            </button>
          </div>
        ) : (
          <DataTable
            columns={columns}
            data={data}
            isLoading={isLoading}
            onEdit={handleEditFact}
            onDelete={handleDeleteFact}
            pagination={{
              page: pagination.page,
              pageSize: pagination.pageSize,
              total: totalCount
            }}
            onPageChange={(page) => setPagination({ ...pagination, page })}
            onPageSizeChange={(pageSize) => setPagination({ ...pagination, page: 1, pageSize })}
          />
        )}
      </main>

      {/* Modals */}
      {isModalOpen && (
        <FactEditModal
          tableName={activeTable}
          fact={editingFact}
          isSaving={isSaving}
          onClose={() => setIsModalOpen(false)}
          onSave={handleSaveFact}
        />
      )}
    </div>
  );
}
