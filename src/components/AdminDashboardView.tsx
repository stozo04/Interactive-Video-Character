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
import {
  approveWorkspaceRun,
  getWorkspaceAgentHealth,
  listWorkspaceAgentRuns,
  rejectWorkspaceRun,
  subscribeWorkspaceAgentEvents,
  type WorkspaceAgentHealth,
  type WorkspaceAgentRun,
} from '../services/projectAgentService';
import DataTable from './DataTable';
import FactEditModal from './FactEditModal';
import AnthropicTab from './AnthropicTab';

interface AdminDashboardViewProps {
  onBack: () => void;
}

const USER_CATEGORIES = ['all', 'identity', 'preference', 'relationship', 'context'];
const CHARACTER_CATEGORIES = ['all', 'quirk', 'relationship', 'experience', 'preference', 'detail', 'other'];
const AGENT_RUN_LIMIT = 50;
type AdminDashboardMode = 'facts' | 'agent';
type AgentTab = 'anthropic' | 'openai' | 'google';

export default function AdminDashboardView({ onBack }: AdminDashboardViewProps) {
  const [mode, setMode] = useState<AdminDashboardMode>('facts');

  // Facts mode state
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

  // Agent mode state
  const [agentTab, setAgentTab] = useState<AgentTab>('google');
  const [agentHealth, setAgentHealth] = useState<WorkspaceAgentHealth | null>(null);
  const [agentRuns, setAgentRuns] = useState<WorkspaceAgentRun[]>([]);
  const [agentError, setAgentError] = useState<string | null>(null);
  const [isAgentLoading, setIsAgentLoading] = useState(false);
  const [isAgentLiveConnected, setIsAgentLiveConnected] = useState(false);
  const [lastHeartbeatAt, setLastHeartbeatAt] = useState<string | null>(null);
  const [heartbeatMessage, setHeartbeatMessage] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [approvalRunIdInFlight, setApprovalRunIdInFlight] = useState<string | null>(null);

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

  const loadWorkspaceAgentData = useCallback(async () => {
    setIsAgentLoading(true);
    setAgentError(null);
    try {
      const [healthResult, runsResult] = await Promise.all([
        getWorkspaceAgentHealth(),
        listWorkspaceAgentRuns(AGENT_RUN_LIMIT),
      ]);

      if (!healthResult.ok || !healthResult.health) {
        setAgentHealth(null);
        setAgentError(healthResult.error || 'Failed to load workspace agent health.');
      } else {
        setAgentHealth(healthResult.health);
      }

      if (!runsResult.ok) {
        setAgentRuns([]);
        setAgentError((current) => current || runsResult.error || 'Failed to load workspace runs.');
      } else {
        setAgentRuns(sortRunsByTime(runsResult.runs));
      }
    } catch (err) {
      console.error('[AdminDashboard] Workspace agent load failed', err);
      setAgentError('Workspace agent load failed.');
    } finally {
      setIsAgentLoading(false);
    }
  }, []);

  useEffect(() => {
    if (mode !== 'facts') {
      return;
    }

    void loadData();
  }, [mode, loadData]);

  useEffect(() => {
    if (mode !== 'agent' || agentTab !== 'google') {
      return;
    }

    void loadWorkspaceAgentData();
  }, [mode, agentTab, loadWorkspaceAgentData]);

  useEffect(() => {
    if (mode !== 'agent' || agentTab !== 'google') {
      return;
    }

    const unsubscribe = subscribeWorkspaceAgentEvents({
      onEvent: (event) => {
        if (event.type === 'connected') {
          setIsAgentLiveConnected(true);
          return;
        }

        if (event.type === 'heartbeat') {
          setLastHeartbeatAt(event.timestamp || new Date().toISOString());
          setHeartbeatMessage(event.message || 'Still working...');
          setAgentHealth((currentHealth) =>
            currentHealth
              ? {
                  ...currentHealth,
                  activeRunId: event.activeRunId ?? currentHealth.activeRunId,
                  pendingQueueCount:
                    event.pendingCount ?? currentHealth.pendingQueueCount,
                  timestamp: event.timestamp || currentHealth.timestamp,
                }
              : currentHealth,
          );
          return;
        }

        if (!event.run) {
          return;
        }

        setAgentRuns((currentRuns) => sortRunsByTime(mergeRun(currentRuns, event.run!)));
        setAgentHealth((currentHealth) =>
          currentHealth
            ? {
                ...currentHealth,
                runCount: Math.max(currentHealth.runCount, 1),
                timestamp: event.timestamp || currentHealth.timestamp,
              }
            : currentHealth,
        );
      },
      onError: () => {
        setIsAgentLiveConnected(false);
      },
    });

    return () => {
      unsubscribe();
      setIsAgentLiveConnected(false);
    };
  }, [mode, agentTab]);

  // Reset filter and pagination when switching tables
  useEffect(() => {
    setFilter({ category: 'all', search: '' });
    setPagination({ page: 1, pageSize: 10 });
  }, [activeTable]);

  useEffect(() => {
    if (agentRuns.length === 0) {
      setSelectedRunId(null);
      return;
    }

    const runStillExists = selectedRunId
      ? agentRuns.some((run) => run.id === selectedRunId)
      : false;

    if (!runStillExists) {
      setSelectedRunId(agentRuns[0].id);
    }
  }, [agentRuns, selectedRunId]);

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
          void loadData();
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
          void loadData();
        } else {
          alert('Failed to update fact');
        }
      } else {
        const newFact = await createFactAdmin(activeTable, formData);
        if (newFact) {
          setIsModalOpen(false);
          void loadData();
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

  const selectedRun = selectedRunId
    ? agentRuns.find((run) => run.id === selectedRunId) || null
    : agentRuns[0] || null;

  const handleApproveRun = async () => {
    if (!selectedRun || selectedRun.status !== 'requires_approval') {
      return;
    }

    setApprovalRunIdInFlight(selectedRun.id);
    try {
      const result = await approveWorkspaceRun(selectedRun.id);
      if (!result.ok || !result.run) {
        setAgentError(result.error || 'Failed to approve run.');
        return;
      }
      setAgentRuns((currentRuns) => sortRunsByTime(mergeRun(currentRuns, result.run!)));
    } catch (err) {
      console.error('[AdminDashboard] Approve run failed', err);
      setAgentError('Failed to approve run.');
    } finally {
      setApprovalRunIdInFlight(null);
    }
  };

  const handleRejectRun = async () => {
    if (!selectedRun || selectedRun.status !== 'requires_approval') {
      return;
    }

    setApprovalRunIdInFlight(selectedRun.id);
    try {
      const result = await rejectWorkspaceRun(selectedRun.id);
      if (!result.ok || !result.run) {
        setAgentError(result.error || 'Failed to reject run.');
        return;
      }
      setAgentRuns((currentRuns) => sortRunsByTime(mergeRun(currentRuns, result.run!)));
    } catch (err) {
      console.error('[AdminDashboard] Reject run failed', err);
      setAgentError('Failed to reject run.');
    } finally {
      setApprovalRunIdInFlight(null);
    }
  };

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
              onClick={() => setMode('facts')}
              className={`px-4 py-1.5 rounded-lg text-sm font-bold transition-all ${
                mode === 'facts' ? 'bg-purple-600 text-white shadow-lg' : 'text-gray-400 hover:text-white'
              }`}
            >
              Facts
            </button>
            <button
              onClick={() => setMode('agent')}
              className={`px-4 py-1.5 rounded-lg text-sm font-bold transition-all ${
                mode === 'agent' ? 'bg-purple-600 text-white shadow-lg' : 'text-gray-400 hover:text-white'
              }`}
            >
              Agent
            </button>
          </div>

          {mode === 'facts' && (
            <>
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
            </>
          )}

          {mode === 'agent' && (
            <div className="flex items-center gap-4">
              <div className="flex bg-gray-800 p-1 rounded-xl border border-gray-700">
                {(['anthropic', 'openai', 'google'] as AgentTab[]).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setAgentTab(tab)}
                    className={`px-4 py-1.5 rounded-lg text-sm font-bold transition-all ${
                      agentTab === tab ? 'bg-purple-600 text-white shadow-lg' : 'text-gray-400 hover:text-white'
                    }`}
                  >
                    {tab === 'anthropic' ? 'Anthropic' : tab === 'openai' ? 'OpenAI' : 'Google'}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </header>

      {mode === 'facts' && (
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
      )}

      {/* Content */}
      <main className="flex-1 overflow-y-auto p-8">
        {mode === 'facts' && (
          <>
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
                  onClick={() => void loadData()}
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
          </>
        )}

        {mode === 'agent' && agentTab === 'anthropic' && (
          <AnthropicTab />
        )}

        {mode === 'agent' && agentTab === 'openai' && (
          <div className="h-full flex items-center justify-center text-gray-500 text-sm">
            <span>OpenAI tools - coming soon</span>
          </div>
        )}

        {mode === 'agent' && agentTab === 'google' && (
          <div className="h-full flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3 border border-gray-700 rounded-xl bg-gray-900/50 px-4 py-3">
              <div className="flex items-center gap-3">
                <span className={`inline-flex items-center gap-2 px-3 py-1 rounded-full border text-sm ${
                  agentHealth
                    ? 'bg-emerald-900/30 border-emerald-600/30 text-emerald-300'
                    : 'bg-red-900/30 border-red-600/30 text-red-300'
                }`}>
                  <span className={`h-2.5 w-2.5 rounded-full ${agentHealth ? 'bg-emerald-400' : 'bg-red-400'}`} />
                  {agentHealth ? 'Agent Online' : 'Agent Offline'}
                </span>
                <span className={`inline-flex items-center gap-2 px-3 py-1 rounded-full border text-sm ${
                  isAgentLiveConnected
                    ? 'bg-blue-900/30 border-blue-600/30 text-blue-300'
                    : 'bg-amber-900/30 border-amber-600/30 text-amber-300'
                }`}>
                  <span className={`h-2.5 w-2.5 rounded-full ${isAgentLiveConnected ? 'bg-blue-400' : 'bg-amber-400'}`} />
                  {isAgentLiveConnected ? 'Live Updates Connected' : 'Live Updates Reconnecting'}
                </span>
                <span className="text-sm text-gray-400">
                  Runs: {Math.max(agentHealth?.runCount ?? 0, agentRuns.length)}
                </span>
                {agentHealth?.pendingQueueCount !== undefined && (
                  <span className="text-sm text-gray-400">
                    Queue: {agentHealth.pendingQueueCount}
                  </span>
                )}
                {agentHealth?.activeRunId && (
                  <span className="text-sm text-gray-400">
                    Active: {agentHealth.activeRunId}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {agentHealth && (
                  <span className="text-xs text-gray-500">
                    Workspace: {agentHealth.workspaceRoot}
                  </span>
                )}
                <button
                  onClick={() => void loadWorkspaceAgentData()}
                  className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors text-sm"
                  disabled={isAgentLoading}
                >
                  {isAgentLoading ? 'Refreshing...' : 'Refresh'}
                </button>
              </div>
            </div>

            {agentError && (
              <div className="px-4 py-3 border border-red-700/40 bg-red-900/20 rounded-lg text-sm text-red-200">
                {agentError}
              </div>
            )}

            {heartbeatMessage && (
              <div className="px-4 py-3 border border-blue-700/40 bg-blue-900/20 rounded-lg text-sm text-blue-200">
                {heartbeatMessage}
                {lastHeartbeatAt ? ` (${formatTimestamp(lastHeartbeatAt)})` : ''}
              </div>
            )}

            <div className="grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)] min-h-0 flex-1">
              <section className="min-h-0 border border-gray-700 rounded-xl bg-gray-900/50 overflow-hidden">
                <header className="px-4 py-3 border-b border-gray-700 text-sm text-gray-300 font-semibold">
                  Recent Runs
                </header>
                <div className="max-h-full overflow-y-auto">
                  {agentRuns.length === 0 ? (
                    <div className="p-4 text-sm text-gray-500">
                      No runs yet.
                    </div>
                  ) : (
                    agentRuns.map((run) => (
                      <button
                        key={run.id}
                        onClick={() => setSelectedRunId(run.id)}
                        className={`w-full text-left px-4 py-3 border-b border-gray-800 hover:bg-gray-800/50 ${
                          selectedRun?.id === run.id ? 'bg-gray-800/70' : ''
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <span className="text-xs text-gray-400">{run.id}</span>
                          <span className={`text-[10px] uppercase px-2 py-0.5 rounded-full border ${getRunStatusClasses(run.status)}`}>
                            {run.status}
                          </span>
                        </div>
                        <p className="text-sm text-gray-200 truncate">{run.summary}</p>
                        <p className="text-xs text-gray-500 mt-1">{formatTimestamp(run.updatedAt)}</p>
                      </button>
                    ))
                  )}
                </div>
              </section>

              <section className="min-h-0 border border-gray-700 rounded-xl bg-gray-900/50 p-4 overflow-y-auto">
                {!selectedRun ? (
                  <div className="h-full flex items-center justify-center text-gray-500 text-sm">
                    Select a run to inspect details.
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs text-gray-400">{selectedRun.id}</span>
                      <span className={`text-[10px] uppercase px-2 py-0.5 rounded-full border ${getRunStatusClasses(selectedRun.status)}`}>
                        {selectedRun.status}
                      </span>
                      <span className="text-xs text-gray-500">{formatTimestamp(selectedRun.updatedAt)}</span>
                    </div>

                    <div className="border border-gray-700 rounded-lg p-3 bg-gray-800/30">
                      <p className="text-xs text-gray-400 mb-1">Summary</p>
                      <p className="text-sm text-gray-200">{selectedRun.summary}</p>
                      <p className="text-xs text-gray-500 mt-2">Action: {selectedRun.request.action}</p>
                      {selectedRun.approval.required && (
                        <p className="text-xs text-gray-500">
                          Approval: {selectedRun.approval.status}
                          {selectedRun.approval.reason ? ` - ${selectedRun.approval.reason}` : ''}
                        </p>
                      )}
                    </div>

                    {selectedRun.status === 'requires_approval' && (
                      <div className="border border-amber-600/30 rounded-lg p-3 bg-amber-900/20">
                        <p className="text-sm text-amber-200 mb-3">This run requires approval before execution.</p>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={handleApproveRun}
                            disabled={approvalRunIdInFlight === selectedRun.id}
                            className="px-3 py-2 rounded-lg bg-emerald-700/80 hover:bg-emerald-700 text-white text-sm disabled:opacity-60"
                          >
                            Approve
                          </button>
                          <button
                            onClick={handleRejectRun}
                            disabled={approvalRunIdInFlight === selectedRun.id}
                            className="px-3 py-2 rounded-lg bg-red-700/80 hover:bg-red-700 text-white text-sm disabled:opacity-60"
                          >
                            Reject
                          </button>
                        </div>
                      </div>
                    )}

                    <div className="space-y-3">
                      <h4 className="text-sm font-semibold text-gray-300">Steps</h4>
                      {selectedRun.steps.length === 0 && (
                        <div className="text-sm text-gray-500">No steps yet.</div>
                      )}
                      {selectedRun.steps.map((step) => (
                        <div key={step.stepId} className="border border-gray-700 rounded-lg p-3 bg-gray-800/20">
                          <div className="flex items-center justify-between gap-2 mb-2">
                            <p className="text-sm text-gray-200">{step.stepId} - {step.type}</p>
                            <span className={`text-[10px] uppercase px-2 py-0.5 rounded-full border ${getStepStatusClasses(step.status)}`}>
                              {step.status}
                            </span>
                          </div>
                          {step.error && (
                            <p className="text-xs text-red-300 mb-2">{step.error}</p>
                          )}
                          <ul className="space-y-1">
                            {step.evidence.map((line, index) => (
                              <li key={`${step.stepId}-${index}`} className="text-xs text-gray-400">- {line}</li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </section>
            </div>
          </div>
        )}
      </main>

      {/* Modals */}
      {mode === 'facts' && isModalOpen && (
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

function mergeRun(runs: WorkspaceAgentRun[], incomingRun: WorkspaceAgentRun): WorkspaceAgentRun[] {
  const existingIndex = runs.findIndex((run) => run.id === incomingRun.id);
  if (existingIndex === -1) {
    return [incomingRun, ...runs];
  }

  const updated = [...runs];
  updated[existingIndex] = incomingRun;
  return updated;
}

function sortRunsByTime(runs: WorkspaceAgentRun[]): WorkspaceAgentRun[] {
  return [...runs].sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt),
  );
}

function getRunStatusClasses(status: string): string {
  switch (status) {
    case 'success':
      return 'bg-emerald-900/30 border-emerald-600/40 text-emerald-300';
    case 'failed':
    case 'verification_failed':
    case 'rejected':
      return 'bg-red-900/30 border-red-600/40 text-red-300';
    case 'requires_approval':
      return 'bg-amber-900/30 border-amber-600/40 text-amber-300';
    case 'running':
      return 'bg-blue-900/30 border-blue-600/40 text-blue-300';
    default:
      return 'bg-gray-800 border-gray-600 text-gray-300';
  }
}

function getStepStatusClasses(status: string): string {
  switch (status) {
    case 'success':
      return 'bg-emerald-900/30 border-emerald-600/40 text-emerald-300';
    case 'failed':
    case 'verification_failed':
      return 'bg-red-900/30 border-red-600/40 text-red-300';
    case 'running':
      return 'bg-blue-900/30 border-blue-600/40 text-blue-300';
    case 'pending':
      return 'bg-amber-900/30 border-amber-600/40 text-amber-300';
    default:
      return 'bg-gray-800 border-gray-600 text-gray-300';
  }
}

function formatTimestamp(isoTimestamp: string): string {
  const parsed = new Date(isoTimestamp);
  if (Number.isNaN(parsed.getTime())) {
    return isoTimestamp;
  }

  return parsed.toLocaleString();
}
