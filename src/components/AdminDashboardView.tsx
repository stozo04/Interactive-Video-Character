import React, { useState, useEffect, useCallback } from 'react';
import {
  fetchTableDataAdmin,
  updateFactAdmin,
  createFactAdmin,
  deleteFactAdmin,
  listServerRuntimeLogsAdmin,
  TablePagination,
  FactFilter,
  TableType,
  type RuntimeLogCategory,
  type RuntimeLogSeverity,
  type ServerRuntimeLogRow,
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
import {
  createCronJob,
  deleteCronJob,
  listCronJobEvents,
  listCronJobRuns,
  listCronJobs,
  runCronJobNow,
  setCronJobStatus,
  updateCronJob,
  type CronJobEvent,
  type CronJob,
  type CronJobRun,
  CronJobStatus,
  CronScheduleType,
} from '../services/cronJobService';
import {
  listEngineeringTicketEvents,
  listEngineeringTickets,
  transitionEngineeringTicket,
  getMultiAgentHealth,
  getWhatsAppHealth,
  getTelegramHealth,
  getOpeyHealth,
  getTidyHealth,
  restartServer,
  restartWhatsApp,
  restartOpey,
  restartTidy,
  type EngineeringTicket,
  type EngineeringTicketEvent,
  type EngineeringTicketStatus,
} from '../services/multiAgentService';
import DataTable from './DataTable';
import FactEditModal from './FactEditModal';
import AnthropicTab from './AnthropicTab';
import OpenAITab from './OpenAITab';
import { getXAuthStatus, initXAuth, revokeXAuth } from '../services/xClient';

interface AdminDashboardViewProps {
  onBack: () => void;
}

const USER_CATEGORIES = ['all', 'identity', 'preference', 'relationship', 'context'];
const CHARACTER_CATEGORIES = ['all', 'quirk', 'relationship', 'experience', 'preference', 'detail', 'other'];
const AGENT_RUN_LIMIT = 50;
const SERVER_RUNTIME_LOG_LIMIT_OPTIONS = [50, 100, 200, 500] as const;
const SERVER_RUNTIME_LOG_SEVERITIES = ['all', 'info', 'warning', 'error', 'critical'] as const;
const RUNTIME_LOG_CATEGORIES: RuntimeLogCategory[] = ['server', 'web', 'telegram', 'opey', 'tidy', 'all'];
type AdminDashboardMode =
  | 'dashboard'
  | 'facts'
  | 'agent'
  | 'cron'
  | 'multi_agent'
  | 'runtime_logs';
type AgentTab = 'anthropic' | 'openai' | 'google';
type RuntimeLogSeverityFilter = (typeof SERVER_RUNTIME_LOG_SEVERITIES)[number];

interface CronFormState {
  title: string;
  searchQuery: string;
  summaryInstruction: string;
  scheduleType: CronScheduleType;
  timezone: string;
  hour: number;
  minute: number;
  oneTimeAt: string;
}

const DEFAULT_CRON_FORM: CronFormState = {
  title: 'Daily World News',
  searchQuery: 'top world news today',
  summaryInstruction: 'Summarize what is going on in the world in clear, practical language.',
  scheduleType: CronScheduleType.Daily,
  timezone: 'America/Chicago',
  hour: 12,
  minute: 0,
  oneTimeAt: '',
};
type GoogleSubTab = 'api' | 'agent_status';
const MULTI_AGENT_TICKET_LIMIT = 50;
const MULTI_AGENT_EVENT_LIMIT = 100;
const MULTI_AGENT_STATUSES: EngineeringTicketStatus[] = [
  'created',
  'intake_acknowledged',
  'needs_clarification',
  'requirements_ready',
  'planning',
  'implementing',
  'pr_preparing',
  'pr_ready',
  'completed',
  'failed',
  'escalated_human',
  'cancelled',
];
type MultiAgentTab = 'tickets' | 'chats';

export default function AdminDashboardView({ onBack }: AdminDashboardViewProps) {
  const [mode, setMode] = useState<AdminDashboardMode>('dashboard');

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
  const [googleSubTab, setGoogleSubTab] = useState<GoogleSubTab>('api');
  const [agentHealth, setAgentHealth] = useState<WorkspaceAgentHealth | null>(null);
  const [agentRuns, setAgentRuns] = useState<WorkspaceAgentRun[]>([]);
  const [agentError, setAgentError] = useState<string | null>(null);
  const [isAgentLoading, setIsAgentLoading] = useState(false);
  const [isAgentLiveConnected, setIsAgentLiveConnected] = useState(false);
  const [lastHeartbeatAt, setLastHeartbeatAt] = useState<string | null>(null);
  const [heartbeatMessage, setHeartbeatMessage] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [approvalRunIdInFlight, setApprovalRunIdInFlight] = useState<string | null>(null);

  // Cron mode state
  const [cronJobs, setCronJobs] = useState<CronJob[]>([]);
  const [cronRuns, setCronRuns] = useState<CronJobRun[]>([]);
  const [cronEvents, setCronEvents] = useState<CronJobEvent[]>([]);
  const [isCronLoading, setIsCronLoading] = useState(false);
  const [cronError, setCronError] = useState<string | null>(null);
  const [editingCronJobId, setEditingCronJobId] = useState<string | null>(null);
  const [cronForm, setCronForm] = useState<CronFormState>({ ...DEFAULT_CRON_FORM });

  // Multi-agent mode state
  const [multiAgentTickets, setMultiAgentTickets] = useState<EngineeringTicket[]>([]);
  const [multiAgentEvents, setMultiAgentEvents] = useState<EngineeringTicketEvent[]>([]);
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [multiAgentError, setMultiAgentError] = useState<string | null>(null);
  const [isMultiAgentLoading, setIsMultiAgentLoading] = useState(false);
  const [transitionStatus, setTransitionStatus] = useState<EngineeringTicketStatus>('planning');
  const [transitionSummary, setTransitionSummary] = useState('');
  const [multiAgentTab, setMultiAgentTab] = useState<MultiAgentTab>('tickets');
  const [multiAgentHealthStatus, setMultiAgentHealthStatus] = useState<string | null>(null);
  const [multiAgentHealthLatencyMs, setMultiAgentHealthLatencyMs] = useState<number | null>(null);
  const [waHealthStatus, setWaHealthStatus] = useState<'ok' | 'unreachable' | null>(null);
  const [waHealthLatencyMs, setWaHealthLatencyMs] = useState<number | null>(null);
  const [telegramHealthStatus, setTelegramHealthStatus] = useState<'ok' | 'unreachable' | null>(null);
  const [telegramHealthLatencyMs, setTelegramHealthLatencyMs] = useState<number | null>(null);
  const [opeyHealthStatus, setOpeyHealthStatus] = useState<'ok' | 'busy' | 'unreachable' | null>(null);
  const [opeyCurrentTicketId, setOpeyCurrentTicketId] = useState<string | undefined>(undefined);
  const [opeyHealthLatencyMs, setOpeyHealthLatencyMs] = useState<number | null>(null);
  const [tidyHealthStatus, setTidyHealthStatus] = useState<'ok' | 'busy' | 'unreachable' | null>(null);
  const [tidyHealthLatencyMs, setTidyHealthLatencyMs] = useState<number | null>(null);
  const [isMultiAgentHealthLoading, setIsMultiAgentHealthLoading] = useState(false);
  const [isServerRestarting, setIsServerRestarting] = useState(false);
  const [isWhatsAppRestarting, setIsWhatsAppRestarting] = useState(false);
  const [isOpeyRestarting, setIsOpeyRestarting] = useState(false);
  const [isTidyRestarting, setIsTidyRestarting] = useState(false);
  const [xConnected, setXConnected] = useState<boolean | null>(null);
  const [xHealthLatencyMs, setXHealthLatencyMs] = useState<number | null>(null);
  const [isXLoading, setIsXLoading] = useState(false);

  // Runtime logs mode state
  const [runtimeLogs, setRuntimeLogs] = useState<ServerRuntimeLogRow[]>([]);
  const [runtimeLogSeverityFilter, setRuntimeLogSeverityFilter] =
    useState<RuntimeLogSeverityFilter>('all');
  const [runtimeLogLimit, setRuntimeLogLimit] = useState<number>(200);
  const [runtimeLogCategory, setRuntimeLogCategory] = useState<RuntimeLogCategory>('server');
  const [isRuntimeLogsLoading, setIsRuntimeLogsLoading] = useState(false);
  const [runtimeLogsError, setRuntimeLogsError] = useState<string | null>(null);

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

  const loadCronData = useCallback(async () => {
    setIsCronLoading(true);
    setCronError(null);
    try {
      const [jobs, runs, events] = await Promise.all([
        listCronJobs(),
        listCronJobRuns(40),
        listCronJobEvents(80),
      ]);
      setCronJobs(jobs);
      setCronRuns(runs);
      setCronEvents(events);
    } catch (err) {
      console.error('[AdminDashboard] Cron load failed', err);
      setCronError('Failed to load cron jobs.');
    } finally {
      setIsCronLoading(false);
    }
  }, []);

  const loadMultiAgentData = useCallback(async () => {
    setIsMultiAgentLoading(true);
    setMultiAgentError(null);
    try {
      const ticketsResult = await listEngineeringTickets(MULTI_AGENT_TICKET_LIMIT);
      if (!ticketsResult.ok) {
        setMultiAgentTickets([]);
        setMultiAgentError(ticketsResult.error || 'Failed to load engineering tickets.');
      } else {
        setMultiAgentTickets(ticketsResult.tickets);
      }
    } catch (err) {
      console.error('[AdminDashboard] Multi-agent load failed', err);
      setMultiAgentError('Failed to load engineering tickets.');
    } finally {
      setIsMultiAgentLoading(false);
    }
  }, []);

  const handleCheckMultiAgentHealth = async () => {
    setIsMultiAgentHealthLoading(true);
    setMultiAgentError(null);
    try {
      const [multiAgent, whatsapp, telegram, opey, tidy] = await Promise.all([
        getMultiAgentHealth(), getWhatsAppHealth(), getTelegramHealth(), getOpeyHealth(), getTidyHealth(),
      ]);

      if (!multiAgent.ok) {
        setMultiAgentHealthStatus('unreachable');
        setMultiAgentHealthLatencyMs(null);
        setMultiAgentError(multiAgent.error || 'Multi-agent health check failed.');
      } else {
        setMultiAgentHealthStatus('ok');
        setMultiAgentHealthLatencyMs(typeof multiAgent.latencyMs === 'number' ? multiAgent.latencyMs : null);
      }

      setWaHealthStatus(whatsapp.ok && whatsapp.connected ? 'ok' : 'unreachable');
      setWaHealthLatencyMs(typeof whatsapp.latencyMs === 'number' ? whatsapp.latencyMs : null);
      setTelegramHealthStatus(telegram.ok && telegram.running ? 'ok' : 'unreachable');
      setTelegramHealthLatencyMs(typeof telegram.latencyMs === 'number' ? telegram.latencyMs : null);
      setOpeyHealthStatus(!opey.ok ? 'unreachable' : opey.currentTicketId ? 'busy' : 'ok');
      setOpeyCurrentTicketId(opey.currentTicketId);
      setOpeyHealthLatencyMs(typeof opey.latencyMs === 'number' ? opey.latencyMs : null);
      setTidyHealthStatus(!tidy.ok ? 'unreachable' : tidy.isProcessing ? 'busy' : 'ok');
      setTidyHealthLatencyMs(typeof tidy.latencyMs === 'number' ? tidy.latencyMs : null);
      await loadXStatus();
    } catch (err) {
      console.error('[AdminDashboard] Health check failed', err);
      setMultiAgentHealthStatus('unreachable');
      setMultiAgentHealthLatencyMs(null);
      setMultiAgentError('Health check failed.');
      setTelegramHealthLatencyMs(null);
      setOpeyHealthLatencyMs(null);
      setTidyHealthStatus('unreachable');
      setTidyHealthLatencyMs(null);
    } finally {
      setIsMultiAgentHealthLoading(false);
    }
  };

  const handleRestartServer = async () => {
    setIsServerRestarting(true);
    setMultiAgentError(null);
    try {
      const result = await restartServer();
      if (!result.ok) {
        setMultiAgentError(result.error || 'Server restart failed.');
        return;
      }
      // Server is restarting — health will go unreachable briefly
      setMultiAgentHealthStatus(null);
      setMultiAgentHealthLatencyMs(null);
      setWaHealthStatus(null);
      setWaHealthLatencyMs(null);
      setOpeyHealthStatus(null);
      setOpeyCurrentTicketId(undefined);
    } catch (err) {
      console.error('[AdminDashboard] Server restart failed', err);
      setMultiAgentError('Server restart request failed.');
    } finally {
      setIsServerRestarting(false);
    }
  };

  const handleRestartOpey = async () => {
    setIsOpeyRestarting(true);
    setMultiAgentError(null);
    try {
      const result = await restartOpey();
      if (!result.ok) {
        setMultiAgentError(result.error || 'Opey restart failed.');
      } else {
        setOpeyHealthStatus(null);
        setOpeyCurrentTicketId(undefined);
      }
    } catch (err) {
      console.error('[AdminDashboard] Opey restart failed', err);
      setMultiAgentError('Opey restart request failed.');
    } finally {
      setIsOpeyRestarting(false);
    }
  };

  const handleRestartTidy = async () => {
    setIsTidyRestarting(true);
    setMultiAgentError(null);
    try {
      const result = await restartTidy();
      if (!result.ok) {
        setMultiAgentError(result.error || 'Tidy restart failed.');
      } else {
        setTidyHealthStatus(null);
      }
    } catch (err) {
      console.error('[AdminDashboard] Tidy restart failed', err);
      setMultiAgentError('Tidy restart request failed.');
    } finally {
      setIsTidyRestarting(false);
    }
  };

  const handleConnectX = async () => {
    setIsXLoading(true);
    try {
      const authUrl = await initXAuth();
      window.location.href = authUrl;
    } catch (err) {
      console.error('[AdminDashboard] X connect failed', err);
      setMultiAgentError('Failed to start X OAuth.');
      setIsXLoading(false);
    }
  };

  const handleDisconnectX = async () => {
    setIsXLoading(true);
    try {
      await revokeXAuth();
      setXConnected(false);
      setXHealthLatencyMs(null);
    } catch (err) {
      console.error('[AdminDashboard] X disconnect failed', err);
      setMultiAgentError('Failed to disconnect X.');
    } finally {
      setIsXLoading(false);
    }
  };

  const handleRestartWhatsApp = async () => {
    setIsWhatsAppRestarting(true);
    setMultiAgentError(null);
    try {
      const result = await restartWhatsApp();
      if (!result.ok) {
        setMultiAgentError(result.error || 'WhatsApp restart failed.');
      }
    } catch (err) {
      console.error('[AdminDashboard] WhatsApp restart failed', err);
      setMultiAgentError('WhatsApp restart request failed.');
    } finally {
      setIsWhatsAppRestarting(false);
    }
  };

  const loadRuntimeLogs = useCallback(async () => {
    setIsRuntimeLogsLoading(true);
    setRuntimeLogsError(null);
    try {
      const rows = await listServerRuntimeLogsAdmin({
        severity: runtimeLogSeverityFilter,
        limit: runtimeLogLimit,
        category: runtimeLogCategory,
      });
      setRuntimeLogs(rows);
    } catch (err) {
      console.error('[AdminDashboard] Runtime logs load failed', err);
      setRuntimeLogs([]);
      setRuntimeLogsError('Failed to load runtime logs.');
    } finally {
      setIsRuntimeLogsLoading(false);
    }
  }, [runtimeLogSeverityFilter, runtimeLogLimit, runtimeLogCategory]);

  const loadXStatus = useCallback(async () => {
    const startedAt = Date.now();
    try {
      const status = await getXAuthStatus();
      setXConnected(status.connected);
      setXHealthLatencyMs(Date.now() - startedAt);
    } catch (err) {
      console.error('[AdminDashboard] X status load failed', err);
      setXConnected(false);
      setXHealthLatencyMs(null);
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
    if (mode !== 'dashboard') {
      return;
    }

    void loadXStatus();
  }, [mode, loadXStatus]);

  useEffect(() => {
    if (mode !== 'cron') {
      return;
    }

    void loadCronData();
  }, [mode, loadCronData]);

  useEffect(() => {
    if (mode !== 'runtime_logs') {
      return;
    }

    void loadRuntimeLogs();
  }, [mode, loadRuntimeLogs]);

  useEffect(() => {
    if (mode !== 'multi_agent' && mode !== 'dashboard') {
      return;
    }

    void loadMultiAgentData();
  }, [mode, loadMultiAgentData]);

  // Auto-poll health every 15s while on the Server tab
  useEffect(() => {
    if (mode !== 'multi_agent' && mode !== 'dashboard') return;

    const pollHealth = async () => {
      try {
        const [multiAgent, whatsapp, telegram, opey, tidy] = await Promise.all([
          getMultiAgentHealth(), getWhatsAppHealth(), getTelegramHealth(), getOpeyHealth(), getTidyHealth(),
        ]);
        setMultiAgentHealthStatus(multiAgent.ok ? 'ok' : 'unreachable');
        setMultiAgentHealthLatencyMs(typeof multiAgent.latencyMs === 'number' ? multiAgent.latencyMs : null);
        setWaHealthStatus(whatsapp.ok && whatsapp.connected ? 'ok' : 'unreachable');
        setWaHealthLatencyMs(typeof whatsapp.latencyMs === 'number' ? whatsapp.latencyMs : null);
        setTelegramHealthStatus(telegram.ok && telegram.running ? 'ok' : 'unreachable');
        setTelegramHealthLatencyMs(typeof telegram.latencyMs === 'number' ? telegram.latencyMs : null);
        setOpeyHealthStatus(!opey.ok ? 'unreachable' : opey.currentTicketId ? 'busy' : 'ok');
        setOpeyCurrentTicketId(opey.currentTicketId);
        setOpeyHealthLatencyMs(typeof opey.latencyMs === 'number' ? opey.latencyMs : null);
        setTidyHealthStatus(!tidy.ok ? 'unreachable' : tidy.isProcessing ? 'busy' : 'ok');
        setTidyHealthLatencyMs(typeof tidy.latencyMs === 'number' ? tidy.latencyMs : null);
        void loadXStatus();
      } catch {
        setMultiAgentHealthStatus('unreachable');
        setMultiAgentHealthLatencyMs(null);
        setWaHealthStatus('unreachable');
        setWaHealthLatencyMs(null);
        setTelegramHealthStatus('unreachable');
        setTelegramHealthLatencyMs(null);
        setOpeyHealthStatus('unreachable');
        setOpeyHealthLatencyMs(null);
        setTidyHealthStatus('unreachable');
        setTidyHealthLatencyMs(null);
      }
    };

    void pollHealth();
    const interval = setInterval(pollHealth, 15_000);
    return () => clearInterval(interval);
  }, [mode, loadXStatus]);

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

  useEffect(() => {
    if (multiAgentTickets.length === 0) {
      setSelectedTicketId(null);
      return;
    }

    const ticketExists = selectedTicketId
      ? multiAgentTickets.some((ticket) => ticket.id === selectedTicketId)
      : false;

    if (!ticketExists) {
      setSelectedTicketId(multiAgentTickets[0].id);
    }
  }, [multiAgentTickets, selectedTicketId]);

  useEffect(() => {
    if (!selectedTicketId || mode !== 'multi_agent') {
      setMultiAgentEvents([]);
      return;
    }

    let cancelled = false;
    const loadDetails = async () => {
      const eventsResult = await listEngineeringTicketEvents(
        selectedTicketId,
        MULTI_AGENT_EVENT_LIMIT,
      );

      if (cancelled) {
        return;
      }

      setMultiAgentEvents(eventsResult.ok ? eventsResult.events : []);
      if (!eventsResult.ok) {
        setMultiAgentError(eventsResult.error || 'Failed to load ticket events.');
      }
    };

    void loadDetails();
    return () => {
      cancelled = true;
    };
  }, [selectedTicketId, mode]);

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

  const selectedTicket = selectedTicketId
    ? multiAgentTickets.find((ticket) => ticket.id === selectedTicketId) || null
    : multiAgentTickets[0] || null;

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

  const resetCronForm = () => {
    setEditingCronJobId(null);
    setCronForm({ ...DEFAULT_CRON_FORM });
  };

  const handleEditCronJob = (job: CronJob) => {
    setEditingCronJobId(job.id);
    setCronForm({
      title: job.title,
      searchQuery: job.searchQuery,
      summaryInstruction: job.summaryInstruction || DEFAULT_CRON_FORM.summaryInstruction,
      scheduleType: job.scheduleType,
      timezone: job.timezone || DEFAULT_CRON_FORM.timezone,
      hour: job.scheduleHour ?? DEFAULT_CRON_FORM.hour,
      minute: job.scheduleMinute ?? DEFAULT_CRON_FORM.minute,
      oneTimeAt: toDateTimeLocalValue(job.oneTimeRunAt),
    });
  };

  const handleSaveCronJob = async (event: React.FormEvent) => {
    event.preventDefault();
    setCronError(null);

    if (!cronForm.searchQuery.trim()) {
      setCronError('Search query is required.');
      return;
    }

    if (cronForm.scheduleType === CronScheduleType.OneTime && !cronForm.oneTimeAt) {
      setCronError('One-time schedule requires a date/time.');
      return;
    }
    if (cronForm.scheduleType === CronScheduleType.Weekly && !cronForm.oneTimeAt) {
      setCronError('Weekly schedule requires an anchor date/time.');
      return;
    }
    if (cronForm.scheduleType === CronScheduleType.Monthly && !cronForm.oneTimeAt) {
      setCronError('Monthly schedule requires an anchor date/time.');
      return;
    }

    setIsCronLoading(true);
    try {
      if (editingCronJobId) {
        const updated = await updateCronJob(editingCronJobId, {
          title: cronForm.title.trim(),
          searchQuery: cronForm.searchQuery.trim(),
          summaryInstruction: cronForm.summaryInstruction.trim(),
          scheduleType: cronForm.scheduleType,
          timezone: cronForm.timezone.trim(),
          hour: cronForm.scheduleType === CronScheduleType.Daily ? cronForm.hour : undefined,
          minute: cronForm.scheduleType === CronScheduleType.Daily ? cronForm.minute : undefined,
          oneTimeAt:
            cronForm.scheduleType === CronScheduleType.OneTime ||
            cronForm.scheduleType === CronScheduleType.Monthly ||
            cronForm.scheduleType === CronScheduleType.Weekly
              ? cronForm.oneTimeAt
              : undefined,
        });

        if (!updated) {
          setCronError('Failed to update cron job.');
          return;
        }
      } else {
        const created = await createCronJob({
          title: cronForm.title.trim() || 'Scheduled News Digest',
          searchQuery: cronForm.searchQuery.trim(),
          summaryInstruction: cronForm.summaryInstruction.trim(),
          scheduleType: cronForm.scheduleType,
          timezone: cronForm.timezone.trim(),
          hour: cronForm.scheduleType === CronScheduleType.Daily ? cronForm.hour : undefined,
          minute: cronForm.scheduleType === CronScheduleType.Daily ? cronForm.minute : undefined,
          oneTimeAt:
            cronForm.scheduleType === CronScheduleType.OneTime ||
            cronForm.scheduleType === CronScheduleType.Monthly ||
            cronForm.scheduleType === CronScheduleType.Weekly
              ? cronForm.oneTimeAt
              : undefined,
          createdBy: 'admin_ui',
        });

        if (!created) {
          setCronError('Failed to create cron job.');
          return;
        }
      }

      resetCronForm();
      await loadCronData();
    } catch (err) {
      console.error('[AdminDashboard] Save cron job failed', err);
      setCronError('Failed to save cron job.');
    } finally {
      setIsCronLoading(false);
    }
  };

  const handleDeleteCronJob = async (job: CronJob) => {
    const confirmed = window.confirm(`Delete cron job "${job.title}"?`);
    if (!confirmed) {
      return;
    }

    setIsCronLoading(true);
    try {
      const deleted = await deleteCronJob(job.id);
      if (!deleted) {
        setCronError('Failed to delete cron job.');
        return;
      }
      if (editingCronJobId === job.id) {
        resetCronForm();
      }
      await loadCronData();
    } catch (err) {
      console.error('[AdminDashboard] Delete cron job failed', err);
      setCronError('Failed to delete cron job.');
    } finally {
      setIsCronLoading(false);
    }
  };

  const handleToggleCronPause = async (job: CronJob) => {
    setIsCronLoading(true);
    try {
      const nextStatus =
        job.status === CronJobStatus.Paused
          ? CronJobStatus.Active
          : CronJobStatus.Paused;
      const updated = await setCronJobStatus(job.id, nextStatus);
      if (!updated) {
        setCronError(`Failed to ${nextStatus === CronJobStatus.Active ? 'resume' : 'pause'} cron job.`);
        return;
      }
      await loadCronData();
    } catch (err) {
      console.error('[AdminDashboard] Toggle cron pause failed', err);
      setCronError('Failed to update cron status.');
    } finally {
      setIsCronLoading(false);
    }
  };

  const handleRunCronNow = async (job: CronJob) => {
    setIsCronLoading(true);
    try {
      const updated = await runCronJobNow(job.id);
      if (!updated) {
        setCronError('Failed to trigger cron job now.');
        return;
      }
      await loadCronData();
    } catch (err) {
      console.error('[AdminDashboard] Run cron now failed', err);
      setCronError('Failed to trigger cron job now.');
    } finally {
      setIsCronLoading(false);
    }
  };

  const handleTransitionTicket = async () => {
    if (!selectedTicketId) {
      return;
    }

    if (!transitionSummary.trim()) {
      setMultiAgentError('Transition summary is required.');
      return;
    }

    setIsMultiAgentLoading(true);
    try {
      const result = await transitionEngineeringTicket(
        selectedTicketId,
        transitionStatus,
        transitionSummary.trim(),
      );

      if (!result.ok || !result.ticket) {
        setMultiAgentError(result.error || 'Failed to transition ticket.');
        return;
      }

      setMultiAgentTickets((current) =>
        current.map((ticket) =>
          ticket.id === result.ticket!.id ? result.ticket! : ticket,
        ),
      );
      setTransitionSummary('');
    } catch (err) {
      console.error('[AdminDashboard] Transition ticket failed', err);
      setMultiAgentError('Failed to transition ticket.');
    } finally {
      setIsMultiAgentLoading(false);
    }
  };

  return (
    <div className="h-full overflow-hidden bg-[#06111f] text-white">
      <div className="flex h-full flex-col bg-[radial-gradient(circle_at_top,_rgba(76,124,255,0.18),_transparent_32%),linear-gradient(180deg,_rgba(9,18,36,0.98),_rgba(4,10,22,1))]">
        <header className="border-b border-white/10 px-6 py-5 backdrop-blur-xl md:px-8">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-4">
              <button
                onClick={onBack}
                className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-slate-300 transition hover:border-white/20 hover:bg-white/10 hover:text-white"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <div>
                <div className="mb-1 inline-flex items-center rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-cyan-200">
                  Control Center
                </div>
                <h1 className="text-3xl font-semibold tracking-tight text-white">Admin Dashboard</h1>
                <p className="mt-1 text-sm text-slate-400">
                  Monitor services, operate agents, and manage system data from one place.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {mode === 'facts' && (
                <>
                  <div className="flex rounded-2xl border border-white/10 bg-white/5 p-1.5">
                    <button
                      onClick={() => setActiveTable('user_facts')}
                      className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${
                        activeTable === 'user_facts'
                          ? 'bg-white text-slate-950 shadow-[0_10px_30px_rgba(255,255,255,0.2)]'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      User Facts
                    </button>
                    <button
                      onClick={() => setActiveTable('character_facts')}
                      className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${
                        activeTable === 'character_facts'
                          ? 'bg-white text-slate-950 shadow-[0_10px_30px_rgba(255,255,255,0.2)]'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      Character Facts
                    </button>
                  </div>

                  <button
                    onClick={handleCreateFact}
                    className="inline-flex items-center gap-2 rounded-2xl bg-cyan-400 px-5 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
                    </svg>
                    Add New Fact
                  </button>
                </>
              )}

              {mode === 'agent' && (
                <div className="flex rounded-2xl border border-white/10 bg-white/5 p-1.5">
                  {(['anthropic', 'openai', 'google'] as AgentTab[]).map((tab) => (
                    <button
                      key={tab}
                      onClick={() => setAgentTab(tab)}
                      className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${
                        agentTab === tab
                          ? 'bg-white text-slate-950 shadow-[0_10px_30px_rgba(255,255,255,0.2)]'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      {tab === 'anthropic' ? 'Anthropic' : tab === 'openai' ? 'OpenAI' : 'Google'}
                    </button>
                  ))}
                </div>
              )}

              {mode === 'cron' && (
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => void loadCronData()}
                    className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10"
                    disabled={isCronLoading}
                  >
                    {isCronLoading ? 'Refreshing...' : 'Refresh'}
                  </button>
                  <button
                    onClick={resetCronForm}
                    className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10"
                  >
                    New Job
                  </button>
                </div>
              )}

              {mode === 'runtime_logs' && (
                <button
                  onClick={() => void loadRuntimeLogs()}
                  className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10"
                  disabled={isRuntimeLogsLoading}
                >
                  {isRuntimeLogsLoading ? 'Refreshing...' : 'Refresh'}
                </button>
              )}
            </div>
          </div>
        </header>

        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          <aside className="w-full border-b border-white/10 bg-[linear-gradient(180deg,rgba(11,20,38,0.95),rgba(8,15,29,0.95))] p-4 lg:w-[280px] lg:border-b-0 lg:border-r lg:p-6">
            <div className="rounded-[28px] border border-white/10 bg-white/[0.03] p-3 shadow-[0_24px_80px_rgba(0,0,0,0.35)]">
              <div className="border-b border-white/10 px-3 pb-4 pt-2">
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Navigation</p>
                <p className="mt-2 text-sm text-slate-400">
                  Default view is live status and restart control for your services.
                </p>
              </div>

              <nav className="mt-3 space-y-2">
                {[
                  { id: 'dashboard', label: 'Admin Dashboard', description: 'Service overview' },
                  { id: 'runtime_logs', label: 'Logs', description: 'System visibility' },
                  { id: 'cron', label: 'Cron Jobs', description: 'Scheduled workflows' },
                  { id: 'agent', label: 'Agents', description: 'Workspace agents' },
                  { id: 'multi_agent', label: 'Server', description: 'Tickets and operations' },
                  { id: 'facts', label: 'Supabase', description: 'Facts and records' },
                ].map((item) => {
                  const isActive = mode === item.id;
                  return (
                    <button
                      key={item.id}
                      onClick={() => setMode(item.id as AdminDashboardMode)}
                      className={`w-full rounded-2xl border px-4 py-3 text-left transition ${
                        isActive
                          ? 'border-cyan-300/40 bg-[linear-gradient(135deg,rgba(120,236,255,0.18),rgba(255,255,255,0.08))] text-white shadow-[0_14px_40px_rgba(34,211,238,0.16)]'
                          : 'border-transparent bg-transparent text-slate-400 hover:border-white/10 hover:bg-white/[0.04] hover:text-white'
                      }`}
                    >
                      <div className="text-sm font-semibold">{item.label}</div>
                      <div className={`mt-1 text-xs ${isActive ? 'text-cyan-100/80' : 'text-slate-500'}`}>
                        {item.description}
                      </div>
                    </button>
                  );
                })}
              </nav>
            </div>
          </aside>

          <section className="min-h-0 flex-1 p-4 md:p-6 lg:p-8">
            <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-[32px] border border-white/10 bg-[linear-gradient(180deg,rgba(8,18,34,0.88),rgba(5,12,24,0.94))] shadow-[0_32px_120px_rgba(0,0,0,0.45)]">
              {mode === 'facts' && (
                <div className="border-b border-white/10 px-6 py-5">
                  <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                    <div className="flex items-center gap-2 overflow-x-auto pb-1">
                      {categories.map(cat => (
                        <button
                          key={cat}
                          onClick={() => {
                            setFilter({ ...filter, category: cat });
                            setPagination({ ...pagination, page: 1 });
                          }}
                          className={`whitespace-nowrap rounded-xl px-4 py-2 text-sm font-medium transition ${
                            filter.category === cat
                              ? 'bg-white text-slate-950'
                              : 'text-slate-400 hover:bg-white/5 hover:text-white'
                          }`}
                        >
                          {cat.charAt(0).toUpperCase() + cat.slice(1)}
                        </button>
                      ))}
                    </div>

                    <div className="relative w-full max-w-md group">
                      <input
                        type="text"
                        placeholder="Search by key or value..."
                        value={filter.search}
                        onChange={(e) => {
                          setFilter({ ...filter, search: e.target.value });
                          setPagination({ ...pagination, page: 1 });
                        }}
                        className="w-full rounded-2xl border border-white/10 bg-white/[0.04] px-10 py-3 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-400/40"
                      />
                      <svg xmlns="http://www.w3.org/2000/svg" className="absolute left-3 top-3.5 h-5 w-5 text-slate-500 group-focus-within:text-cyan-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                      </svg>
                      {filter.search && (
                        <button
                          onClick={() => setFilter({ ...filter, search: '' })}
                          className="absolute right-3 top-3 text-slate-500 transition hover:text-white"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )}

              <main className="flex-1 overflow-y-auto p-6">
                {mode === 'dashboard' && (
                  <div className="space-y-6">
                    {multiAgentError && (
                      <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                        {multiAgentError}
                      </div>
                    )}

                    <section className="overflow-hidden rounded-[28px] border border-cyan-300/15 bg-[linear-gradient(135deg,rgba(16,35,64,0.94),rgba(8,20,38,0.86))] p-6 shadow-[0_22px_80px_rgba(25,145,255,0.16)]">
                      <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
                        <div className="max-w-2xl">
                          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-200/80">
                            Live Overview
                          </p>
                          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-white">
                            All critical services, one clean surface.
                          </h2>
                          <p className="mt-3 text-sm leading-6 text-slate-300">
                            Keep this panel focused on health and control. No tickets, no logs, no noise.
                          </p>
                        </div>

                        <div className="flex flex-wrap items-center gap-3">
                          <button
                            onClick={handleCheckMultiAgentHealth}
                            className="rounded-2xl border border-cyan-300/30 bg-cyan-300/12 px-4 py-2.5 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-300/18"
                            disabled={isMultiAgentHealthLoading}
                          >
                            {isMultiAgentHealthLoading ? 'Checking...' : 'Refresh Health'}
                          </button>
                          <button
                            onClick={() => setMode('multi_agent')}
                            className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-white/10"
                          >
                            Open Server Panel
                          </button>
                        </div>
                      </div>
                    </section>

                    <section className="grid gap-4 xl:grid-cols-2">
                      <ServiceStatusCard
                        title="Server"
                        description="API, LLM, and Twitter calls."
                        status={multiAgentHealthStatus}
                        latencyMs={multiAgentHealthLatencyMs}
                        actionLabel={isServerRestarting ? 'Restarting...' : 'Restart Server'}
                        onAction={handleRestartServer}
                        disabled={isServerRestarting}
                      />
                      {/* <ServiceStatusCard
                        title="WhatsApp"
                        description="Bridge availability"
                        status={waHealthStatus}
                        latencyMs={waHealthLatencyMs}
                        actionLabel={isWhatsAppRestarting ? 'Restarting...' : 'Restart WhatsApp'}
                        onAction={handleRestartWhatsApp}
                        disabled={isWhatsAppRestarting}
                      /> */}
                      <ServiceStatusCard
                        title="Telegram"
                        description="How we talk."
                        status={telegramHealthStatus}
                        latencyMs={telegramHealthLatencyMs}
                        note="Restart control is not wired yet."
                      />
                      <ServiceStatusCard
                        title="Tidy"
                        description="Bug cleaner. Keeps things well, tidy."
                        status={tidyHealthStatus}
                        latencyMs={tidyHealthLatencyMs}
                        actionLabel={isTidyRestarting ? 'Restarting...' : 'Restart Tidy'}
                        onAction={handleRestartTidy}
                        disabled={isTidyRestarting}
                      />
                      <ServiceStatusCard
                        title="Opey"
                        description={
                          opeyHealthStatus === 'busy' && opeyCurrentTicketId
                            ? `Currently implementing ${opeyCurrentTicketId.slice(0, 8)}...`
                            : 'The brains. Implements features.'
                        }
                        status={opeyHealthStatus === 'busy' ? 'implementing' : opeyHealthStatus}
                        latencyMs={opeyHealthLatencyMs}
                        actionLabel={isOpeyRestarting ? 'Restarting...' : 'Restart Opey'}
                        onAction={handleRestartOpey}
                        disabled={isOpeyRestarting}
                      />
                      <ServiceStatusCard
                        title="X"
                        description="X (Twitter) integration."
                        status={xConnected === null ? 'unknown' : xConnected ? 'connected' : 'disconnected'}
                        latencyMs={xHealthLatencyMs}
                        actionLabel={
                          isXLoading
                            ? (xConnected ? 'Disconnecting...' : 'Connecting...')
                            : (xConnected ? 'Disconnect X' : 'Connect X')
                        }
                        onAction={xConnected ? handleDisconnectX : handleConnectX}
                        disabled={isXLoading}
                      />
                    </section>
                  </div>
                )}

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
          <OpenAITab />
        )}

        {mode === 'agent' && agentTab === 'google' && (
          <div className="h-full flex flex-col gap-4 min-h-0">
            {/* Google Sub-Tabs */}
            <div className="flex border-b border-gray-800 mb-2">
              <button
                onClick={() => setGoogleSubTab('api')}
                className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 ${
                  googleSubTab === 'api'
                    ? 'border-purple-500 text-purple-400'
                    : 'border-transparent text-gray-500 hover:text-gray-300'
                }`}
              >
                API Settings
              </button>
              <button
                onClick={() => setGoogleSubTab('agent_status')}
                className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 ${
                  googleSubTab === 'agent_status'
                    ? 'border-purple-500 text-purple-400'
                    : 'border-transparent text-gray-500 hover:text-gray-300'
                }`}
              >
                Agent Status
              </button>
            </div>

            {googleSubTab === 'api' ? (
              <div className="h-full flex items-center justify-center text-gray-500 text-sm">
                <span>Google API managed via gogcli (no browser OAuth needed)</span>
              </div>
            ) : (
              <>
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
              </>
            )}
          </div>
        )}

        {mode === 'cron' && (
          <div className="h-full flex flex-col gap-4">
            {cronError && (
              <div className="px-4 py-3 border border-red-700/40 bg-red-900/20 rounded-lg text-sm text-red-200">
                {cronError}
              </div>
            )}

            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] min-h-0">
              <section className="min-h-0 border border-gray-700 rounded-xl bg-gray-900/50 overflow-hidden">
                <header className="px-4 py-3 border-b border-gray-700 text-sm text-gray-300 font-semibold flex items-center justify-between">
                  <span>Cron Jobs</span>
                  <span className="text-xs text-gray-500">{cronJobs.length} total</span>
                </header>
                <div className="max-h-full overflow-y-auto">
                  {isCronLoading && cronJobs.length === 0 && (
                    <div className="p-4 text-sm text-gray-500">Loading cron jobs...</div>
                  )}

                  {!isCronLoading && cronJobs.length === 0 && (
                    <div className="p-4 text-sm text-gray-500">No cron jobs configured yet.</div>
                  )}

                  {cronJobs.map((job) => (
                    <div key={job.id} className="px-4 py-3 border-b border-gray-800">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <p className="text-sm text-gray-200 font-medium">{job.title}</p>
                        <span className={`text-[10px] uppercase px-2 py-0.5 rounded-full border ${getCronStatusClasses(job.status)}`}>
                          {job.status}
                        </span>
                      </div>
                      <p className="text-xs text-gray-400 mb-2">{formatCronSchedule(job)}</p>
                      <p className="text-xs text-gray-500 break-all mb-2">Query: {job.searchQuery}</p>
                      <p className="text-xs text-gray-500 mb-3">
                        Next run: {job.nextRunAt ? formatTimestamp(job.nextRunAt) : "none"}
                      </p>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          onClick={() => handleEditCronJob(job)}
                          className="px-2.5 py-1.5 rounded bg-gray-700 hover:bg-gray-600 text-xs text-white"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => void handleToggleCronPause(job)}
                          className="px-2.5 py-1.5 rounded bg-gray-700 hover:bg-gray-600 text-xs text-white"
                        >
                          {job.status === CronJobStatus.Paused ? 'Resume' : 'Pause'}
                        </button>
                        <button
                          onClick={() => void handleRunCronNow(job)}
                          className="px-2.5 py-1.5 rounded bg-blue-700/80 hover:bg-blue-700 text-xs text-white"
                        >
                          Run Now
                        </button>
                        <button
                          onClick={() => void handleDeleteCronJob(job)}
                          className="px-2.5 py-1.5 rounded bg-red-700/80 hover:bg-red-700 text-xs text-white"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <section className="min-h-0 border border-gray-700 rounded-xl bg-gray-900/50 p-4 overflow-y-auto space-y-4">
                <div>
                  <h3 className="text-sm font-semibold text-gray-300 mb-2">
                    {editingCronJobId ? 'Edit Cron Job' : 'Create Cron Job'}
                  </h3>
                  <form onSubmit={handleSaveCronJob} className="space-y-3">
                    <div>
                      <label className="text-xs text-gray-400 block mb-1">Title</label>
                      <input
                        type="text"
                        value={cronForm.title}
                        onChange={(event) => setCronForm((current) => ({ ...current, title: event.target.value }))}
                        className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white"
                      />
                    </div>

                      <div>
                      <label className="text-xs text-gray-400 block mb-1">Search Query</label>
                      <input
                        type="text"
                        value={cronForm.searchQuery}
                        onChange={(event) => setCronForm((current) => ({ ...current, searchQuery: event.target.value }))}
                        className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white"
                      />
                    </div>

                      <div>
                      <label className="text-xs text-gray-400 block mb-1">Summary Instruction</label>
                      <textarea
                        value={cronForm.summaryInstruction}
                        onChange={(event) => setCronForm((current) => ({ ...current, summaryInstruction: event.target.value }))}
                        className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white min-h-[72px]"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-xs text-gray-400 block mb-1">Schedule Type</label>
                        <select
                          value={cronForm.scheduleType}
                          onChange={(event) =>
                            setCronForm((current) => ({
                              ...current,
                              scheduleType: event.target.value as CronScheduleType,
                            }))
                          }
                          className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white"
                        >
                          <option value={CronScheduleType.Daily}>Daily</option>
                          <option value={CronScheduleType.OneTime}>One-Time</option>
                          <option value={CronScheduleType.Monthly}>Monthly</option>
                          <option value={CronScheduleType.Weekly}>Weekly</option>
                        </select>
                      </div>

                      <div>
                        <label className="text-xs text-gray-400 block mb-1">Timezone</label>
                        <input
                          type="text"
                          value={cronForm.timezone}
                          onChange={(event) => setCronForm((current) => ({ ...current, timezone: event.target.value }))}
                          className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white"
                        />
                      </div>
                    </div>

                    {cronForm.scheduleType === CronScheduleType.Daily ? (
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-xs text-gray-400 block mb-1">Hour (0-23)</label>
                          <input
                            type="number"
                            min={0}
                            max={23}
                            value={cronForm.hour}
                            onChange={(event) =>
                              setCronForm((current) => ({
                                ...current,
                                hour: Number(event.target.value),
                              }))
                            }
                            className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white"
                          />
                        </div>

                      <div>
                          <label className="text-xs text-gray-400 block mb-1">Minute (0-59)</label>
                          <input
                            type="number"
                            min={0}
                            max={59}
                            value={cronForm.minute}
                            onChange={(event) =>
                              setCronForm((current) => ({
                                ...current,
                                minute: Number(event.target.value),
                              }))
                            }
                            className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white"
                          />
                        </div>
                      </div>
                    ) : (
                      <div>
                        <label className="text-xs text-gray-400 block mb-1">
                          {cronForm.scheduleType === CronScheduleType.Monthly
                            ? 'Monthly Anchor'
                            : cronForm.scheduleType === CronScheduleType.Weekly
                              ? 'Weekly Anchor'
                              : 'One-Time At'}
                        </label>
                        {cronForm.scheduleType === CronScheduleType.Weekly && (
                          <p className="text-[11px] text-gray-500 mb-2">
                            Uses the weekday of this anchor date (e.g. Monday at the same time).
                          </p>
                        )}
                        <input
                          type="datetime-local"
                          value={cronForm.oneTimeAt}
                          onChange={(event) =>
                            setCronForm((current) => ({
                              ...current,
                              oneTimeAt: event.target.value,
                            }))
                          }
                          className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white"
                        />
                      </div>
                    )}

                    <div className="flex items-center gap-2 pt-1">
                      <button
                        type="submit"
                        className="px-4 py-2 rounded bg-purple-600 hover:bg-purple-500 text-sm font-medium text-white"
                        disabled={isCronLoading}
                      >
                        {editingCronJobId ? 'Update Job' : 'Create Job'}
                      </button>
                      {editingCronJobId && (
                        <button
                          type="button"
                          onClick={resetCronForm}
                          className="px-4 py-2 rounded bg-gray-700 hover:bg-gray-600 text-sm font-medium text-white"
                        >
                          Cancel Edit
                        </button>
                      )}
                    </div>
                  </form>
                </div>

                      <div>
                  <h3 className="text-sm font-semibold text-gray-300 mb-2">Recent Runs</h3>
                  <div className="space-y-2">
                    {cronRuns.length === 0 && (
                      <div className="text-xs text-gray-500">No cron runs yet.</div>
                    )}
                    {cronRuns.slice(0, 12).map((run) => (
                      <div key={run.id} className="border border-gray-700 rounded-lg p-3 bg-gray-800/20">
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <span className="text-xs text-gray-400">{run.id}</span>
                          <span className={`text-[10px] uppercase px-2 py-0.5 rounded-full border ${getCronRunStatusClasses(run.status)}`}>
                            {run.status}
                          </span>
                        </div>
                        <p className="text-xs text-gray-500 mb-1">
                          Scheduled: {formatTimestamp(run.scheduledFor)}
                        </p>
                        {run.summary && (
                          <p className="text-xs text-gray-300 whitespace-pre-wrap">{run.summary}</p>
                        )}
                        {run.error && (
                          <p className="text-xs text-red-300">{run.error}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

              </section>
            </div>

            <section className="border border-gray-700 rounded-xl bg-gray-900/50 p-4">
              <h3 className="text-sm font-semibold text-gray-300 mb-2">Activity Log</h3>
              <div className="space-y-2 max-h-[320px] overflow-y-auto">
                {cronEvents.length === 0 && (
                  <div className="text-xs text-gray-500">No cron activity logged yet.</div>
                )}
                {cronEvents.slice(0, 20).map((event) => (
                  <div key={event.id} className="border border-gray-700 rounded-lg p-3 bg-gray-800/20">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className={`text-[10px] uppercase px-2 py-0.5 rounded-full border ${getCronEventClasses(event.eventType)}`}>
                        {event.eventType.replaceAll('_', ' ')}
                      </span>
                      <span className="text-xs text-gray-500">{formatTimestamp(event.createdAt)}</span>
                    </div>
                    <p className="text-xs text-gray-300">{event.message}</p>
                    {event.actor && (
                      <p className="text-[11px] text-gray-500 mt-1">actor: {event.actor}</p>
                    )}
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}

        {mode === 'runtime_logs' && (
          <div className="h-full flex flex-col gap-4">
            {runtimeLogsError && (
              <div className="px-4 py-3 border border-red-700/40 bg-red-900/20 rounded-lg text-sm text-red-200">
                {runtimeLogsError}
              </div>
            )}

            <section className="border border-white/10 rounded-[28px] bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.02))] overflow-hidden">
              <div className="px-5 py-5 border-b border-white/10 bg-[linear-gradient(135deg,rgba(70,115,255,0.12),rgba(255,255,255,0.03))]">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-gray-100">
                      {getRuntimeLogCategoryTitle(runtimeLogCategory)}
                    </h3>
                    <p className="text-xs text-slate-400 mt-1">
                      Filter by severity and review entries sorted by `created_at` descending.
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <label className="text-xs text-slate-400">Severity</label>
                    <select
                      value={runtimeLogSeverityFilter}
                      onChange={(event) =>
                        setRuntimeLogSeverityFilter(event.target.value as RuntimeLogSeverityFilter)
                      }
                      className="bg-slate-950/70 border border-white/10 rounded-xl px-3 py-2 text-xs text-white"
                    >
                      {SERVER_RUNTIME_LOG_SEVERITIES.map((severity) => (
                        <option key={severity} value={severity}>
                          {severity === 'all' ? 'All severities' : severity}
                        </option>
                      ))}
                    </select>

                    <label className="text-xs text-slate-400">Rows</label>
                    <select
                      value={String(runtimeLogLimit)}
                      onChange={(event) => setRuntimeLogLimit(Number(event.target.value))}
                      className="bg-slate-950/70 border border-white/10 rounded-xl px-3 py-2 text-xs text-white"
                    >
                      {SERVER_RUNTIME_LOG_LIMIT_OPTIONS.map((limit) => (
                        <option key={limit} value={limit}>
                          {limit}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <span className="text-[11px] px-2.5 py-1 rounded-full border border-white/10 bg-white/5 text-slate-300">
                    {isRuntimeLogsLoading ? 'Loading...' : `${runtimeLogs.length} rows`}
                  </span>
                  <span className="text-[11px] px-2.5 py-1 rounded-full border border-white/10 bg-white/5 text-slate-400">
                    Tab: {getRuntimeLogCategoryLabel(runtimeLogCategory)}
                  </span>
                  <span className="text-[11px] px-2.5 py-1 rounded-full border border-white/10 bg-white/5 text-slate-400">
                    Filter: {runtimeLogSeverityFilter === 'all' ? 'all severities' : runtimeLogSeverityFilter}
                  </span>
                  <span className="text-[11px] px-2.5 py-1 rounded-full border border-white/10 bg-white/5 text-slate-400">
                    Sort: created_at desc
                  </span>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  {RUNTIME_LOG_CATEGORIES.map((category) => (
                    <button
                      key={category}
                      onClick={() => setRuntimeLogCategory(category)}
                      className={`rounded-2xl px-4 py-2 text-sm font-semibold transition ${
                        runtimeLogCategory === category
                          ? 'bg-white text-slate-950 shadow-[0_12px_30px_rgba(255,255,255,0.16)]'
                          : 'border border-white/10 bg-white/5 text-slate-300 hover:bg-white/10 hover:text-white'
                      }`}
                    >
                      {getRuntimeLogCategoryLabel(category)}
                    </button>
                  ))}
                </div>
              </div>

              <div className="max-h-[calc(100vh-270px)] overflow-y-auto">
                {isRuntimeLogsLoading && runtimeLogs.length === 0 && (
                  <div className="p-6 text-sm text-slate-400">Loading runtime logs...</div>
                )}

                {!isRuntimeLogsLoading && runtimeLogs.length === 0 && (
                  <div className="p-6 text-sm text-slate-400">
                    No logs found for the selected tab and severity.
                  </div>
                )}

                <div className="divide-y divide-gray-800/80">
                  {runtimeLogs.map((entry) => {
                    const detailsKeys = entry.details && typeof entry.details === 'object'
                      ? Object.keys(entry.details)
                      : [];

                    return (
                      <article key={entry.id} className="px-4 py-4 hover:bg-gray-800/20 transition-colors">
                        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2 mb-2">
                              <span
                                className={`text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full border font-semibold ${getRuntimeLogSeverityClasses(entry.severity)}`}
                              >
                                {entry.severity}
                              </span>
                              {entry.source && (
                                <span className="text-[10px] px-2 py-0.5 rounded-full border border-gray-700 bg-gray-800 text-gray-300">
                                  {entry.source}
                                </span>
                              )}
                              {entry.route && (
                                <span className="text-[10px] px-2 py-0.5 rounded-full border border-gray-700 bg-gray-800/60 text-gray-400">
                                  route: {entry.route}
                                </span>
                              )}
                              {entry.process_id != null && (
                                <span className="text-[10px] px-2 py-0.5 rounded-full border border-gray-700 bg-gray-800/60 text-gray-400">
                                  pid: {entry.process_id}
                                </span>
                              )}
                            </div>

                            <p className="text-sm text-gray-100 leading-relaxed break-words">
                              {entry.message}
                            </p>

                            <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
                              <span className="text-gray-500">
                                occurred: {formatTimestamp(entry.occurred_at || entry.created_at)}
                              </span>
                              <span className="text-gray-600">•</span>
                              <span className="text-gray-500">
                                created: {formatTimestamp(entry.created_at)}
                              </span>
                            </div>

                            <div className="mt-3 flex flex-wrap gap-2">
                              {entry.agent_name && (
                                <span className="text-[11px] px-2 py-1 rounded-md border border-blue-700/40 bg-blue-900/20 text-blue-200">
                                  agent: {entry.agent_name}
                                </span>
                              )}
                              {entry.ticket_id && (
                                <span className="text-[11px] px-2 py-1 rounded-md border border-emerald-700/40 bg-emerald-900/20 text-emerald-200 break-all">
                                  ticket: {entry.ticket_id}
                                </span>
                              )}
                              {entry.run_id && (
                                <span className="text-[11px] px-2 py-1 rounded-md border border-amber-700/40 bg-amber-900/20 text-amber-200 break-all">
                                  run: {entry.run_id}
                                </span>
                              )}
                              {entry.request_id && (
                                <span className="text-[11px] px-2 py-1 rounded-md border border-fuchsia-700/40 bg-fuchsia-900/20 text-fuchsia-200 break-all">
                                  request: {entry.request_id}
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="w-full lg:w-[28rem]">
                            <details className="group border border-gray-800 rounded-xl bg-gray-950/60">
                              <summary className="list-none cursor-pointer px-3 py-2 flex items-center justify-between gap-2">
                                <span className="text-xs text-gray-300">
                                  Details {detailsKeys.length > 0 ? `(${detailsKeys.length} keys)` : '(empty)'}
                                </span>
                                <span className="text-[11px] text-gray-500 group-open:hidden">Expand</span>
                                <span className="text-[11px] text-gray-500 hidden group-open:inline">Collapse</span>
                              </summary>
                              <div className="border-t border-gray-800 px-3 py-3">
                                <pre className="text-[11px] leading-5 text-gray-300 whitespace-pre-wrap break-words">
                                  {formatRuntimeLogDetails(entry.details)}
                                </pre>
                              </div>
                            </details>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </div>
            </section>
          </div>
        )}

        {mode === 'multi_agent' && (
          <div className="h-full flex flex-col gap-4">
            {multiAgentError && (
              <div className="px-4 py-3 border border-red-700/40 bg-red-900/20 rounded-lg text-sm text-red-200">
                {multiAgentError}
              </div>
            )}

            <div className="flex items-center gap-2">
              <button
                onClick={() => void loadMultiAgentData()}
                className="px-3 py-1.5 rounded bg-gray-700 hover:bg-gray-600 text-xs text-white"
              >
                Refresh
              </button>
              <button
                onClick={handleCheckMultiAgentHealth}
                className="px-3 py-1.5 rounded bg-emerald-700/80 hover:bg-emerald-700 text-xs text-white"
                disabled={isMultiAgentHealthLoading}
              >
                {isMultiAgentHealthLoading ? 'Checking...' : 'Check Health'}
              </button>
              <button
                onClick={handleRestartServer}
                className="px-3 py-1.5 rounded bg-red-700/80 hover:bg-red-700 text-xs text-white"
                disabled={isServerRestarting}
              >
                {isServerRestarting ? 'Restarting...' : 'Restart Server'}
              </button>
              <button
                onClick={handleRestartWhatsApp}
                className="px-3 py-1.5 rounded bg-red-700/80 hover:bg-red-700 text-xs text-white"
                disabled={isWhatsAppRestarting}
              >
                {isWhatsAppRestarting ? 'Restarting...' : 'Restart WhatsApp'}
              </button>
              <button
                onClick={handleRestartOpey}
                className="px-3 py-1.5 rounded bg-orange-700/80 hover:bg-orange-700 text-xs text-white"
                disabled={isOpeyRestarting}
              >
                {isOpeyRestarting ? 'Restarting...' : 'Restart Opey'}
              </button>
              <span className="inline-flex items-center gap-2 rounded-full bg-purple-600/80 px-3 py-1 text-xs font-semibold text-white">
                <span
                  className={`h-3 w-3 rounded-full ring-2 ring-white/70 ${
                    multiAgentHealthStatus === 'ok'
                      ? 'bg-emerald-300'
                      : multiAgentHealthStatus === 'unreachable'
                        ? 'bg-red-300'
                        : 'bg-amber-300'
                  }`}
                />
                {multiAgentHealthStatus
                  ? `Multi-agent: ${multiAgentHealthStatus}${
                      multiAgentHealthLatencyMs !== null
                        ? ` (${multiAgentHealthLatencyMs}ms)`
                        : ''
                    }`
                  : 'Multi-agent: unknown'}
              </span>
              <span className="inline-flex items-center gap-2 rounded-full bg-purple-600/80 px-3 py-1 text-xs font-semibold text-white">
                <span
                  className={`h-3 w-3 rounded-full ring-2 ring-white/70 ${
                    waHealthStatus === 'ok'
                      ? 'bg-emerald-300'
                      : waHealthStatus === 'unreachable'
                        ? 'bg-red-300'
                        : 'bg-amber-300'
                  }`}
                />
                {waHealthStatus
                  ? `WhatsApp: ${waHealthStatus}${waHealthLatencyMs !== null ? ` (${waHealthLatencyMs}ms)` : ''}`
                  : 'WhatsApp: unknown'}
              </span>
              <span className="inline-flex items-center gap-2 rounded-full bg-purple-600/80 px-3 py-1 text-xs font-semibold text-white">
                <span
                  className={`h-3 w-3 rounded-full ring-2 ring-white/70 ${
                    telegramHealthStatus === 'ok'
                      ? 'bg-emerald-300'
                      : telegramHealthStatus === 'unreachable'
                        ? 'bg-red-300'
                        : 'bg-amber-300'
                  }`}
                />
                {telegramHealthStatus ? `Telegram: ${telegramHealthStatus}` : 'Telegram: unknown'}
              </span>
              <span className="inline-flex items-center gap-2 rounded-full bg-purple-600/80 px-3 py-1 text-xs font-semibold text-white">
                <span
                  className={`h-3 w-3 rounded-full ring-2 ring-white/70 ${
                    opeyHealthStatus === 'ok'
                      ? 'bg-emerald-300'
                      : opeyHealthStatus === 'busy'
                        ? 'bg-blue-300'
                        : opeyHealthStatus === 'unreachable'
                          ? 'bg-red-300'
                          : 'bg-amber-300'
                  }`}
                />
                {opeyHealthStatus
                  ? opeyHealthStatus === 'busy' && opeyCurrentTicketId
                    ? `Opey: implementing ${opeyCurrentTicketId.slice(0, 8)}…`
                    : `Opey: ${opeyHealthStatus === 'busy' ? 'implementing' : opeyHealthStatus}`
                  : 'Opey: unknown'}
              </span>
              <span className="rounded-full bg-purple-600/80 px-3 py-1 text-xs font-semibold text-white">
                {multiAgentTickets.length} tickets
              </span>
              <div className="ml-auto flex items-center bg-gray-800 p-1 rounded-xl border border-gray-700">
                {(['tickets'] as MultiAgentTab[]).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setMultiAgentTab(tab)}
                    className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                      multiAgentTab === tab ? 'bg-purple-600 text-white shadow-lg' : 'text-gray-400 hover:text-white'
                    }`}
                  >
                    Tickets
                  </button>
                ))}
                <span className="px-3 py-1 rounded-lg text-[11px] font-semibold text-gray-500">
                  Chats (coming soon)
                </span>
              </div>
            </div>

            {multiAgentTab === 'tickets' && (
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] min-h-0">
                <section className="min-h-0 border border-gray-700 rounded-xl bg-gray-900/50 overflow-hidden">
                  <header className="px-4 py-3 border-b border-gray-700 text-sm text-gray-300 font-semibold flex items-center justify-between">
                    <span>Engineering Tickets</span>
                    <span className="text-xs text-gray-500">
                      {isMultiAgentLoading ? 'Loading...' : 'Updated'}
                    </span>
                  </header>
                  <div className="max-h-full overflow-y-auto">
                    {isMultiAgentLoading && multiAgentTickets.length === 0 && (
                      <div className="p-4 text-sm text-gray-500">Loading tickets...</div>
                    )}

                    {!isMultiAgentLoading && multiAgentTickets.length === 0 && (
                      <div className="p-4 text-sm text-gray-500">No engineering tickets yet.</div>
                    )}

                    {multiAgentTickets.map((ticket) => (
                      <button
                        key={ticket.id}
                        onClick={() => setSelectedTicketId(ticket.id)}
                        className={`w-full text-left px-4 py-3 border-b border-gray-800 transition-colors ${
                          ticket.id === selectedTicketId ? 'bg-gray-800/50' : 'hover:bg-gray-800/30'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <p className="text-sm text-gray-200 font-medium">
                            {ticket.title || '(untitled)'}
                          </p>
                          <span className={`text-[10px] uppercase px-2 py-0.5 rounded-full border ${getTicketStatusClasses(ticket.status)}`}>
                            {ticket.status.replaceAll('_', ' ')}
                          </span>
                        </div>
                        <p className="text-xs text-gray-500">
                          {ticket.requestType} · {ticket.id}
                        </p>
                        {ticket.requestSummary && (
                          <p className="text-xs text-gray-400 mt-1 line-clamp-2">
                            {ticket.requestSummary}
                          </p>
                        )}
                      </button>
                    ))}
                  </div>
                </section>

                <section className="min-h-0 border border-gray-700 rounded-xl bg-gray-900/50 p-4 overflow-y-auto space-y-4">
                  {!selectedTicket && (
                    <div className="text-sm text-gray-500">Select a ticket to view details.</div>
                  )}

                  {selectedTicket && (
                    <>
                      <div>
                        <div className="flex items-center justify-between gap-2 mb-2">
                          <h3 className="text-sm font-semibold text-gray-300">
                            {selectedTicket.title || '(untitled)'}
                          </h3>
                          <span className={`text-[10px] uppercase px-2 py-0.5 rounded-full border ${getTicketStatusClasses(selectedTicket.status)}`}>
                            {selectedTicket.status.replaceAll('_', ' ')}
                          </span>
                        </div>
                        <p className="text-xs text-gray-500 mb-2">
                          Ticket {selectedTicket.id} · {selectedTicket.requestType}
                        </p>
                        <p className="text-xs text-gray-400 whitespace-pre-wrap">
                          {selectedTicket.requestSummary || 'No summary provided.'}
                        </p>
                      </div>

                      <div className="border border-gray-700 rounded-lg p-3 bg-gray-800/20">
                        <h4 className="text-xs font-semibold text-gray-300 mb-2">Manual Transition</h4>
                        <div className="grid gap-2">
                          <select
                            value={transitionStatus}
                            onChange={(event) =>
                              setTransitionStatus(event.target.value as EngineeringTicketStatus)
                            }
                            className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-xs text-white"
                          >
                            {MULTI_AGENT_STATUSES.map((status) => (
                              <option key={status} value={status}>
                                {status.replaceAll('_', ' ')}
                              </option>
                            ))}
                          </select>
                          <textarea
                            value={transitionSummary}
                            onChange={(event) => setTransitionSummary(event.target.value)}
                            placeholder="Why are you changing status?"
                            className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-xs text-white min-h-[72px]"
                          />
                          <button
                            onClick={handleTransitionTicket}
                            className="px-3 py-2 rounded bg-blue-700/80 hover:bg-blue-700 text-xs text-white"
                            disabled={isMultiAgentLoading}
                          >
                            Apply Transition
                          </button>
                        </div>
                      </div>

                      <div>
                        <h4 className="text-xs font-semibold text-gray-300 mb-2">Recent Events</h4>
                        <div className="space-y-2 max-h-[260px] overflow-y-auto">
                          {multiAgentEvents.length === 0 && (
                            <div className="text-xs text-gray-500">No events recorded.</div>
                          )}
                          {multiAgentEvents.map((event) => (
                            <div key={event.id} className="border border-gray-700 rounded-lg p-3 bg-gray-800/20">
                              <div className="flex items-center justify-between gap-2 mb-1">
                                <span className="text-[10px] uppercase px-2 py-0.5 rounded-full border bg-gray-800 border-gray-600 text-gray-300">
                                  {event.eventType.replaceAll('_', ' ')}
                                </span>
                                <span className="text-xs text-gray-500">{formatTimestamp(event.createdAt)}</span>
                              </div>
                              <p className="text-xs text-gray-300">{event.summary || 'No summary.'}</p>
                              <p className="text-[11px] text-gray-500 mt-1">
                                {event.actorType} · {event.actorName}
                              </p>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div>
                        <h4 className="text-xs font-semibold text-gray-300 mb-2">Recent Turns</h4>
                        <div className="space-y-2 max-h-[260px] overflow-y-auto">
                          <div className="text-xs text-gray-500">Turns view coming soon.</div>
                        </div>
                      </div>
                    </>
                  )}
                </section>
              </div>
            )}
            {multiAgentTab === 'chats' && (
              <div className="border border-gray-700 rounded-xl bg-gray-900/50 p-4 text-sm text-gray-400">
                Chats view coming soon.
              </div>
            )}
          </div>
        )}
              </main>
            </div>
          </section>
        </div>

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
    </div>
  );
}

interface ServiceStatusCardProps {
  title: string;
  description: string;
  status: string | null;
  latencyMs?: number | null;
  note?: string;
  actionLabel?: string;
  onAction?: () => void;
  disabled?: boolean;
}

function ServiceStatusCard({
  title,
  description,
  status,
  latencyMs = null,
  note,
  actionLabel,
  onAction,
  disabled = false,
}: ServiceStatusCardProps) {
  const normalizedStatus = status ?? 'unknown';
  const isHealthy = normalizedStatus === 'ok' || normalizedStatus === 'connected';
  const isWarning = normalizedStatus === 'busy' || normalizedStatus === 'implementing' || normalizedStatus === 'unknown';
  const dotClass = isHealthy
    ? 'bg-emerald-400 shadow-[0_0_16px_rgba(52,211,153,0.8)]'
    : isWarning
      ? 'bg-amber-300 shadow-[0_0_16px_rgba(252,211,77,0.7)]'
      : 'bg-rose-400 shadow-[0_0_16px_rgba(251,113,133,0.75)]';
  const statusLabel = formatStatusLabel(normalizedStatus);

  return (
    <article className="rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.03))] p-5 shadow-[0_22px_70px_rgba(0,0,0,0.22)]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">{title}</p>
          <p className="mt-4 text-sm leading-6 text-slate-300">{description}</p>
        </div>
        <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-slate-200">
          <span className={`h-2.5 w-2.5 rounded-full ${dotClass}`} />
          <span>{statusLabel}</span>
          {latencyMs !== null && (
            <span className="border-l border-white/10 pl-2 text-slate-400">{latencyMs} ms</span>
          )}
        </span>
      </div>

      <div className="mt-5 flex flex-wrap gap-2 text-xs">
        {note && (
          <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-slate-400">
            {note}
          </span>
        )}
      </div>

      {actionLabel && onAction && (
        <button
          onClick={onAction}
          disabled={disabled}
          className="mt-6 flex w-full items-center justify-center rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <span>{actionLabel}</span>
        </button>
      )}
    </article>
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

function toDateTimeLocalValue(isoTimestamp: string | null): string {
  if (!isoTimestamp) {
    return '';
  }

  const parsed = new Date(isoTimestamp);
  if (Number.isNaN(parsed.getTime())) {
    return '';
  }

  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const day = String(parsed.getDate()).padStart(2, '0');
  const hour = String(parsed.getHours()).padStart(2, '0');
  const minute = String(parsed.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

function formatCronSchedule(job: CronJob): string {
  if (job.scheduleType === CronScheduleType.Daily) {
    const hour = job.scheduleHour ?? 12;
    const minute = job.scheduleMinute ?? 0;
    return `Daily ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} (${job.timezone})`;
  }
  if (job.scheduleType === CronScheduleType.Monthly) {
    const hour = job.scheduleHour ?? 12;
    const minute = job.scheduleMinute ?? 0;
    const anchorDate = job.oneTimeRunAt ? new Date(job.oneTimeRunAt) : null;
    const day = anchorDate ? anchorDate.getDate() : '?';
    return `Monthly day ${day} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} (${job.timezone})`;
  }
  if (job.scheduleType === CronScheduleType.Weekly) {
    const hour = job.scheduleHour ?? 12;
    const minute = job.scheduleMinute ?? 0;
    const anchorDate = job.oneTimeRunAt ? new Date(job.oneTimeRunAt) : null;
    const weekday = anchorDate
      ? anchorDate.toLocaleDateString('en-US', { weekday: 'long', timeZone: job.timezone })
      : '?';
    return `Weekly ${weekday} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} (${job.timezone})`;
  }

  return `One-time ${job.oneTimeRunAt ? new Date(job.oneTimeRunAt).toLocaleString() : 'unspecified'}`;
}

function getCronStatusClasses(status: CronJobStatus): string {
  switch (status) {
    case CronJobStatus.Active:
      return 'bg-emerald-900/30 border-emerald-600/40 text-emerald-300';
    case CronJobStatus.Paused:
      return 'bg-amber-900/30 border-amber-600/40 text-amber-300';
    case CronJobStatus.Running:
      return 'bg-blue-900/30 border-blue-600/40 text-blue-300';
    case CronJobStatus.Completed:
      return 'bg-gray-800 border-gray-600 text-gray-300';
    case CronJobStatus.Failed:
      return 'bg-red-900/30 border-red-600/40 text-red-300';
    default:
      return 'bg-gray-800 border-gray-600 text-gray-300';
  }
}

function getCronRunStatusClasses(status: CronJobRun['status']): string {
  switch (status) {
    case 'success':
      return 'bg-emerald-900/30 border-emerald-600/40 text-emerald-300';
    case 'running':
      return 'bg-blue-900/30 border-blue-600/40 text-blue-300';
    case 'failed':
      return 'bg-red-900/30 border-red-600/40 text-red-300';
    default:
      return 'bg-gray-800 border-gray-600 text-gray-300';
  }
}

function getCronEventClasses(eventType: string): string {
  if (eventType.includes('failed')) {
    return 'bg-red-900/30 border-red-600/40 text-red-300';
  }
  if (eventType.includes('success') || eventType === 'created' || eventType === 'resumed') {
    return 'bg-emerald-900/30 border-emerald-600/40 text-emerald-300';
  }
  if (eventType === 'paused') {
    return 'bg-amber-900/30 border-amber-600/40 text-amber-300';
  }
  if (eventType.includes('run_')) {
    return 'bg-blue-900/30 border-blue-600/40 text-blue-300';
  }
  return 'bg-gray-800 border-gray-600 text-gray-300';
}

function getRuntimeLogSeverityClasses(severity: RuntimeLogSeverity): string {
  switch (severity) {
    case 'info':
      return 'bg-sky-900/30 border-sky-600/40 text-sky-300';
    case 'warning':
      return 'bg-amber-900/30 border-amber-600/40 text-amber-300';
    case 'error':
      return 'bg-red-900/30 border-red-600/40 text-red-300';
    case 'critical':
      return 'bg-rose-900/40 border-rose-500/50 text-rose-200';
    default:
      return 'bg-gray-800 border-gray-600 text-gray-300';
  }
}

function formatRuntimeLogDetails(details: Record<string, unknown> | null | undefined): string {
  if (!details || typeof details !== 'object') {
    return '{}';
  }

  try {
    return JSON.stringify(details, null, 2) || '{}';
  } catch (error) {
    console.error('[AdminDashboard] Failed to stringify runtime log details', error);
    return '[unserializable details]';
  }
}

function getTicketStatusClasses(status: EngineeringTicketStatus): string {
  switch (status) {
    case 'pr_ready':
    case 'completed':
      return 'bg-emerald-900/30 border-emerald-600/40 text-emerald-300';
    case 'needs_clarification':
      return 'bg-amber-900/30 border-amber-600/40 text-amber-300';
    case 'failed':
    case 'escalated_human':
    case 'cancelled':
      return 'bg-red-900/30 border-red-600/40 text-red-300';
    case 'implementing':
    case 'pr_preparing':
      return 'bg-blue-900/30 border-blue-600/40 text-blue-300';
    default:
      return 'bg-gray-800 border-gray-600 text-gray-300';
  }
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

function getRuntimeLogCategoryLabel(category: RuntimeLogCategory): string {
  switch (category) {
    case 'server':
      return 'Server';
    case 'web':
      return 'Web';
    case 'telegram':
      return 'Telegram';
    case 'opey':
      return 'Opey';
    case 'tidy':
      return 'Tidy';
    default:
      return 'All';
  }
}

function getRuntimeLogCategoryTitle(category: RuntimeLogCategory): string {
  switch (category) {
    case 'server':
      return 'Server Logs';
    case 'web':
      return 'Web Logs';
    case 'telegram':
      return 'Telegram Logs';
    case 'opey':
      return 'Opey Logs';
    case 'tidy':
      return 'Tidy Logs';
    default:
      return 'All Logs';
  }
}

function formatStatusLabel(status: string): string {
  return status
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}




