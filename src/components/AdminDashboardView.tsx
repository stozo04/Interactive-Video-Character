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
  listEngineeringTicketTurns,
  listEngineeringTickets,
  transitionEngineeringTicket,
  listChatSessions,
  createChatSession,
  listChatMessages,
  postChatMessage,
  type EngineeringTicket,
  type EngineeringTicketEvent,
  type EngineeringAgentTurn,
  type EngineeringTicketStatus,
  type EngineeringChatSession,
  type EngineeringChatMessage,
} from '../services/multiAgentService';
import DataTable from './DataTable';
import FactEditModal from './FactEditModal';
import AnthropicTab from './AnthropicTab';
import GoogleTab from './GoogleTab';

interface AdminDashboardViewProps {
  onBack: () => void;
}

const USER_CATEGORIES = ['all', 'identity', 'preference', 'relationship', 'context'];
const CHARACTER_CATEGORIES = ['all', 'quirk', 'relationship', 'experience', 'preference', 'detail', 'other'];
const AGENT_RUN_LIMIT = 50;
type AdminDashboardMode = 'facts' | 'agent' | 'cron' | 'multi_agent';
type AgentTab = 'anthropic' | 'openai' | 'google';

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
const MULTI_AGENT_TURN_LIMIT = 100;
const MULTI_AGENT_CHAT_LIMIT = 50;
const MULTI_AGENT_CHAT_MESSAGE_LIMIT = 120;
const MULTI_AGENT_STATUSES: EngineeringTicketStatus[] = [
  'created',
  'intake_acknowledged',
  'needs_clarification',
  'requirements_ready',
  'planning',
  'implementing',
  'ready_for_qa',
  'qa_testing',
  'qa_changes_requested',
  'qa_approved',
  'pr_preparing',
  'pr_ready',
  'completed',
  'failed',
  'escalated_human',
  'cancelled',
];
type MultiAgentTab = 'tickets' | 'chats';

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
  const [multiAgentTurns, setMultiAgentTurns] = useState<EngineeringAgentTurn[]>([]);
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [multiAgentError, setMultiAgentError] = useState<string | null>(null);
  const [isMultiAgentLoading, setIsMultiAgentLoading] = useState(false);
  const [transitionStatus, setTransitionStatus] = useState<EngineeringTicketStatus>('planning');
  const [transitionSummary, setTransitionSummary] = useState('');
  const [multiAgentTab, setMultiAgentTab] = useState<MultiAgentTab>('tickets');
  const [chatSessions, setChatSessions] = useState<EngineeringChatSession[]>([]);
  const [chatMessages, setChatMessages] = useState<EngineeringChatMessage[]>([]);
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [chatTitle, setChatTitle] = useState('');
  const [chatMode, setChatMode] = useState<'direct_agent' | 'team_room'>('direct_agent');
  const [chatTicketId, setChatTicketId] = useState('');
  const [chatMessageText, setChatMessageText] = useState('');

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

  const loadChatSessions = useCallback(async () => {
    setIsMultiAgentLoading(true);
    setMultiAgentError(null);
    try {
      const result = await listChatSessions(MULTI_AGENT_CHAT_LIMIT);
      if (!result.ok) {
        setChatSessions([]);
        setMultiAgentError(result.error || 'Failed to load chat sessions.');
      } else {
        setChatSessions(result.sessions);
      }
    } catch (err) {
      console.error('[AdminDashboard] Chat session load failed', err);
      setMultiAgentError('Failed to load chat sessions.');
    } finally {
      setIsMultiAgentLoading(false);
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
    if (mode !== 'cron') {
      return;
    }

    void loadCronData();
  }, [mode, loadCronData]);

  useEffect(() => {
    if (mode !== 'multi_agent') {
      return;
    }

    void loadMultiAgentData();
  }, [mode, loadMultiAgentData]);

  useEffect(() => {
    if (mode !== 'multi_agent') {
      return;
    }

    void loadChatSessions();
  }, [mode, loadChatSessions]);

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
    if (chatSessions.length === 0) {
      setSelectedChatId(null);
      return;
    }

    const exists = selectedChatId
      ? chatSessions.some((session) => session.id === selectedChatId)
      : false;

    if (!exists) {
      setSelectedChatId(chatSessions[0].id);
    }
  }, [chatSessions, selectedChatId]);

  useEffect(() => {
    if (!selectedTicketId || mode !== 'multi_agent') {
      setMultiAgentEvents([]);
      setMultiAgentTurns([]);
      return;
    }

    let cancelled = false;
    const loadDetails = async () => {
      const [eventsResult, turnsResult] = await Promise.all([
        listEngineeringTicketEvents(selectedTicketId, MULTI_AGENT_EVENT_LIMIT),
        listEngineeringTicketTurns(selectedTicketId, MULTI_AGENT_TURN_LIMIT),
      ]);

      if (cancelled) {
        return;
      }

      setMultiAgentEvents(eventsResult.ok ? eventsResult.events : []);
      setMultiAgentTurns(turnsResult.ok ? turnsResult.turns : []);
      if (!eventsResult.ok || !turnsResult.ok) {
        setMultiAgentError(
          eventsResult.error || turnsResult.error || 'Failed to load ticket details.',
        );
      }
    };

    void loadDetails();
    return () => {
      cancelled = true;
    };
  }, [selectedTicketId, mode]);

  useEffect(() => {
    if (!selectedChatId || mode !== 'multi_agent') {
      setChatMessages([]);
      return;
    }

    let cancelled = false;
    const loadMessages = async () => {
      const result = await listChatMessages(selectedChatId, MULTI_AGENT_CHAT_MESSAGE_LIMIT);
      if (cancelled) {
        return;
      }

      if (!result.ok) {
        setChatMessages([]);
        setMultiAgentError(result.error || 'Failed to load chat messages.');
        return;
      }

      setChatMessages(result.messages);
    };

    void loadMessages();
    return () => {
      cancelled = true;
    };
  }, [selectedChatId, mode]);

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
          oneTimeAt: cronForm.scheduleType === CronScheduleType.OneTime ? cronForm.oneTimeAt : undefined,
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
          oneTimeAt: cronForm.scheduleType === CronScheduleType.OneTime ? cronForm.oneTimeAt : undefined,
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

  const handleCreateChatSession = async () => {
    if (!chatTitle.trim()) {
      setMultiAgentError('Chat title is required.');
      return;
    }

    setIsMultiAgentLoading(true);
    try {
      const result = await createChatSession({
        title: chatTitle.trim(),
        mode: chatMode,
        ticketId: chatTicketId.trim() || undefined,
        createdBy: 'admin_ui',
      });

      if (!result.ok || !result.session) {
        setMultiAgentError(result.error || 'Failed to create chat session.');
        return;
      }

      setChatSessions((current) => [result.session!, ...current]);
      setSelectedChatId(result.session!.id);
      setChatTitle('');
      setChatTicketId('');
    } catch (err) {
      console.error('[AdminDashboard] Create chat session failed', err);
      setMultiAgentError('Failed to create chat session.');
    } finally {
      setIsMultiAgentLoading(false);
    }
  };

  const handlePostChatMessage = async () => {
    if (!selectedChatId) {
      return;
    }

    if (!chatMessageText.trim()) {
      setMultiAgentError('Message text is required.');
      return;
    }

    setIsMultiAgentLoading(true);
    try {
      const result = await postChatMessage({
        sessionId: selectedChatId,
        role: 'human',
        messageText: chatMessageText.trim(),
      });

      if (!result.ok) {
        setMultiAgentError(result.error || 'Failed to post chat message.');
        return;
      }

      setChatMessages(result.messages);
      setChatMessageText('');
    } catch (err) {
      console.error('[AdminDashboard] Post chat message failed', err);
      setMultiAgentError('Failed to post chat message.');
    } finally {
      setIsMultiAgentLoading(false);
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
            <h1 className="text-2xl font-bold tracking-tight">Admin Dashboardd</h1>
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
            <button
              onClick={() => setMode('cron')}
              className={`px-4 py-1.5 rounded-lg text-sm font-bold transition-all ${
                mode === 'cron' ? 'bg-purple-600 text-white shadow-lg' : 'text-gray-400 hover:text-white'
              }`}
            >
              Cron Jobs
            </button>
            <button
              onClick={() => setMode('multi_agent')}
              className={`px-4 py-1.5 rounded-lg text-sm font-bold transition-all ${
                mode === 'multi_agent' ? 'bg-purple-600 text-white shadow-lg' : 'text-gray-400 hover:text-white'
              }`}
            >
              Multi-Agent
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

          {mode === 'cron' && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => void loadCronData()}
                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors text-sm"
                disabled={isCronLoading}
              >
                {isCronLoading ? 'Refreshing...' : 'Refresh'}
              </button>
              <button
                onClick={resetCronForm}
                className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded-lg transition-colors text-sm border border-gray-700"
              >
                New Job
              </button>
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
              <GoogleTab />
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
                        <label className="text-xs text-gray-400 block mb-1">One-Time At</label>
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
              <span className="text-xs text-gray-500">
                {multiAgentTickets.length} tickets
              </span>
              <div className="ml-auto flex bg-gray-800 p-1 rounded-xl border border-gray-700">
                {(['tickets', 'chats'] as MultiAgentTab[]).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setMultiAgentTab(tab)}
                    className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                      multiAgentTab === tab ? 'bg-purple-600 text-white shadow-lg' : 'text-gray-400 hover:text-white'
                    }`}
                  >
                    {tab === 'tickets' ? 'Tickets' : 'Chats'}
                  </button>
                ))}
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
                          {multiAgentTurns.length === 0 && (
                            <div className="text-xs text-gray-500">No turns recorded.</div>
                          )}
                          {multiAgentTurns.map((turn) => (
                            <div key={turn.id} className="border border-gray-700 rounded-lg p-3 bg-gray-800/20">
                              <div className="flex items-center justify-between gap-2 mb-1">
                                <span className="text-[10px] uppercase px-2 py-0.5 rounded-full border bg-gray-800 border-gray-600 text-gray-300">
                                  {turn.agentRole} · {turn.purpose}
                                </span>
                                <span className="text-xs text-gray-500">{formatTimestamp(turn.createdAt)}</span>
                              </div>
                              <p className="text-xs text-gray-400">
                                {turn.responseExcerpt || 'No response excerpt.'}
                              </p>
                            </div>
                          ))}
                        </div>
                      </div>
                    </>
                  )}
                </section>
              </div>
            )}

            {multiAgentTab === 'chats' && (
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] min-h-0">
                <section className="min-h-0 border border-gray-700 rounded-xl bg-gray-900/50 overflow-hidden">
                  <header className="px-4 py-3 border-b border-gray-700 text-sm text-gray-300 font-semibold flex items-center justify-between">
                    <span>Chat Sessions</span>
                    <span className="text-xs text-gray-500">
                      {isMultiAgentLoading ? 'Loading...' : 'Updated'}
                    </span>
                  </header>
                  <div className="p-4 border-b border-gray-800 space-y-2">
                    <input
                      type="text"
                      value={chatTitle}
                      onChange={(event) => setChatTitle(event.target.value)}
                      placeholder="Chat title"
                      className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-xs text-white"
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <select
                        value={chatMode}
                        onChange={(event) => setChatMode(event.target.value as 'direct_agent' | 'team_room')}
                        className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-xs text-white"
                      >
                        <option value="direct_agent">Direct Agent</option>
                        <option value="team_room">Team Room</option>
                      </select>
                      <input
                        type="text"
                        value={chatTicketId}
                        onChange={(event) => setChatTicketId(event.target.value)}
                        placeholder="Optional ticket id"
                        className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-xs text-white"
                      />
                    </div>
                    <button
                      onClick={handleCreateChatSession}
                      className="px-3 py-2 rounded bg-blue-700/80 hover:bg-blue-700 text-xs text-white"
                      disabled={isMultiAgentLoading}
                    >
                      Create Chat
                    </button>
                  </div>
                  <div className="max-h-full overflow-y-auto">
                    {chatSessions.length === 0 && (
                      <div className="p-4 text-sm text-gray-500">No chat sessions yet.</div>
                    )}
                    {chatSessions.map((session) => (
                      <button
                        key={session.id}
                        onClick={() => setSelectedChatId(session.id)}
                        className={`w-full text-left px-4 py-3 border-b border-gray-800 transition-colors ${
                          session.id === selectedChatId ? 'bg-gray-800/50' : 'hover:bg-gray-800/30'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <p className="text-sm text-gray-200 font-medium">{session.title}</p>
                          <span className="text-[10px] uppercase px-2 py-0.5 rounded-full border bg-gray-800 border-gray-600 text-gray-300">
                            {session.mode.replaceAll('_', ' ')}
                          </span>
                        </div>
                        <p className="text-xs text-gray-500">
                          {session.id} {session.ticketId ? `· ticket ${session.ticketId}` : ''}
                        </p>
                      </button>
                    ))}
                  </div>
                </section>

                <section className="min-h-0 border border-gray-700 rounded-xl bg-gray-900/50 p-4 overflow-y-auto space-y-4">
                  {!selectedChatId && (
                    <div className="text-sm text-gray-500">Select a chat to view messages.</div>
                  )}

                  {selectedChatId && (
                    <>
                      <div className="flex flex-col gap-2">
                        <textarea
                          value={chatMessageText}
                          onChange={(event) => setChatMessageText(event.target.value)}
                          placeholder="Send a message..."
                          className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-xs text-white min-h-[72px]"
                        />
                        <button
                          onClick={handlePostChatMessage}
                          className="px-3 py-2 rounded bg-blue-700/80 hover:bg-blue-700 text-xs text-white"
                          disabled={isMultiAgentLoading}
                        >
                          Send Message
                        </button>
                      </div>

                      <div className="space-y-2 max-h-[420px] overflow-y-auto">
                        {chatMessages.length === 0 && (
                          <div className="text-xs text-gray-500">No messages yet.</div>
                        )}
                        {chatMessages.map((message) => (
                          <div key={message.id} className="border border-gray-700 rounded-lg p-3 bg-gray-800/20">
                            <div className="flex items-center justify-between gap-2 mb-1">
                              <span className="text-[10px] uppercase px-2 py-0.5 rounded-full border bg-gray-800 border-gray-600 text-gray-300">
                                {message.role}
                              </span>
                              <span className="text-xs text-gray-500">{formatTimestamp(message.createdAt)}</span>
                            </div>
                            <p className="text-xs text-gray-300 whitespace-pre-wrap">{message.messageText}</p>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </section>
              </div>
            )}
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

function getTicketStatusClasses(status: EngineeringTicketStatus): string {
  switch (status) {
    case 'qa_approved':
    case 'pr_ready':
    case 'completed':
      return 'bg-emerald-900/30 border-emerald-600/40 text-emerald-300';
    case 'qa_changes_requested':
    case 'needs_clarification':
      return 'bg-amber-900/30 border-amber-600/40 text-amber-300';
    case 'failed':
    case 'escalated_human':
    case 'cancelled':
      return 'bg-red-900/30 border-red-600/40 text-red-300';
    case 'implementing':
    case 'qa_testing':
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
