import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  BadgeCheck,
  BadgePoundSterling,
  Bell,
  Bot,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  Clock3,
  Download,
  ExternalLink,
  Eye,
  FileCheck2,
  FileText,
  Filter,
  Gauge,
  Headphones,
  Info,
  Layers3,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Search,
  Send,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Users,
  UsersRound,
  WandSparkles,
  X,
  Zap,
} from 'lucide-react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Sidebar } from '../components/Sidebar';
import { Topbar } from '../components/Topbar';
import {
  Dashboard,
  EventRecord,
  formatApiError,
  getTenantId,
  API_BASE_URL,
  Lead,
  money,
  Quote,
  request,
  requestHealth,
  SubscriptionContract,
  SubscriptionPlan,
  TenantSettings,
  UsageRecord,
  UsageSummary,
} from '../lib/api';

type ReviewDraft = {
  service_type: string;
  location: string;
  quantity: string;
  area: string;
  frequency: string;
  requested_time: string;
};

const reviewInputStyle = {
  width: '100%',
  padding: '9px 10px',
  border: '1px solid #dbe3ee',
  borderRadius: 7,
  background: '#fff',
  color: '#17243b',
};

const fmtDate = (v?: string | null) => {
  if (!v) return '—';
  try {
    return new Date(v).toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return String(v);
  }
};

const fmtUsd = (value: number, maximumFractionDigits = 2) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits,
  }).format(value);

function StatusBadge({ value }: { value: string }) {
  const map: Record<string, string> = {
    new: 'neutral',
    qualification_queued: 'blue',
    running: 'blue',
    queued: 'blue',
    needs_information: 'amber',
    qualified: 'green',
    completed: 'green',
    quote_draft: 'purple',
    quote_approved: 'green',
    sent: 'green',
    rejected: 'red',
    failed: 'red',
    escalated: 'amber',
    closed: 'neutral',
    draft: 'purple',
    approved: 'green',
    published: 'green',
  };
  const labels: Record<string, string> = {
    new: 'New enquiry',
    qualification_queued: 'Qualifying',
    running: 'Running',
    queued: 'Queued',
    needs_information: 'Needs details',
    qualified: 'Qualified',
    completed: 'Completed',
    quote_draft: 'Awaiting review',
    quote_approved: 'Approved',
    sent: 'Sent (Sandbox)',
    rejected: 'Rejected',
    failed: 'Failed',
    escalated: 'Escalated',
    closed: 'Closed',
    draft: 'Draft',
    approved: 'Approved',
    published: 'Published',
  };
  return (
    <span className={`status status-${map[value] || 'neutral'}`}>
      <i />
      {labels[value] || value.replaceAll('_', ' ')}
    </span>
  );
}

export function App() {
  const [active, setActive] = useState('Overview');
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [settings, setSettings] = useState<TenantSettings | null>(null);
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [contracts, setContracts] = useState<SubscriptionContract[]>([]);
  const [health, setHealth] = useState<any>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [channelFilter, setChannelFilter] = useState('all');
  const [actionFilter, setActionFilter] = useState('all');

  const [toast, setToast] = useState('');
  const [busy, setBusy] = useState(false);

  // Modals
  const [showNew, setShowNew] = useState(false);
  const [detail, setDetail] = useState<Lead | null>(null);
  const [reviewDraft, setReviewDraft] = useState<ReviewDraft>({
    service_type: '',
    location: '',
    quantity: '',
    area: '',
    frequency: '',
    requested_time: '',
  });
  const [quoteDetail, setQuoteDetail] = useState<Quote | null>(null);
  const [eventDetail, setEventDetail] = useState<EventRecord | null>(null);
  const [showPlanModal, setShowPlanModal] = useState(false);
  const [showContractModal, setShowContractModal] = useState(false);
  const [editingSettings, setEditingSettings] = useState(false);
  const [draftSettings, setDraftSettings] = useState<TenantSettings | null>(null);

  // Form states
  const [customer, setCustomer] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [leadChannel, setLeadChannel] = useState<'website' | 'whatsapp'>('website');
  const [message, setMessage] = useState(
    'We need a boiler service for our Manchester office. We have 3 units. Preferred date: next week.'
  );
  const [consent, setConsent] = useState(true);

  // Quote approval form
  const [approverId, setApproverId] = useState('demo-reviewer');

  // Plan publish form
  const [publishingPlan, setPublishingPlan] = useState<SubscriptionPlan | null>(null);
  const [planPreview, setPlanPreview] = useState<any>(null);
  const [planApproverId, setPlanApproverId] = useState('second-reviewer');
  const [effectiveDate, setEffectiveDate] = useState(
    new Date(Date.now() + 86400000).toISOString().slice(0, 16)
  );

  // Plan draft form
  const [planDraft, setPlanDraft] = useState({
    plan_id: 'standard-tier',
    plan_version: 'v1',
    name: 'Standard Facilities Care',
    currency: 'GBP',
    setup_fee: 500,
    recurring_fee: 199,
    metered_limits: { monthly_leads: 200 },
    feature_flags: { ai_qualification: true, crm_csv_export: true },
    support_sla: 'standard',
    pricing_visibility: 'public',
    overage_policy: 'pause_premium',
  });

  // Contract form
  const [contractDraft, setContractDraft] = useState({
    contract_id: `con_${Date.now().toString(36)}`,
    customer_ref: 'Acme Commercial Ltd',
    plan_id: 'standard-tier',
    plan_version: 'v1',
    recurring_fee: 199,
    currency: 'GBP',
  });

  const notify = (s: string) => {
    setToast(s);
    window.setTimeout(() => setToast(''), 5000);
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [d, l, q, u, ev, s, p, c, h] = await Promise.all([
        request<Dashboard>('/dashboard'),
        request<Lead[]>('/leads'),
        request<Quote[]>('/quotes'),
        request<UsageSummary>('/usage'),
        request<EventRecord[]>('/events'),
        request<TenantSettings>('/settings'),
        request<SubscriptionPlan[]>('/billing/plans'),
        request<SubscriptionContract[]>('/billing/contracts'),
        requestHealth<any>(),
      ]);
      setDashboard(d);
      setLeads(l);
      setQuotes(q);
      setUsage(u);
      setEvents(ev);
      setSettings(s);
      setPlans(p);
      setContracts(c);
      setHealth(h);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'API unavailable');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Lead CRUD
  const createLead = async () => {
    if (!message.trim() || message.trim().length < 8) {
      notify('Please enter a more detailed enquiry (at least 8 characters).');
      return;
    }
    if (!consent) {
      notify('Consent is required before lawful processing can proceed.');
      return;
    }
    setBusy(true);
    try {
      const idempotency = `web-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
      const currentTenant = getTenantId();
      const result = await request<{ lead_id: string }>('/leads', {
        method: 'POST',
        body: JSON.stringify({
          tenant_id: currentTenant,
          channel: leadChannel,
          message: message.trim(),
          consent,
          idempotency_key: idempotency,
          customer_name: customer.trim() || null,
          customer_email: customerEmail.trim() || null,
        }),
      });
      const leadId = result.lead_id;
      notify(`Lead created (${leadId}). Triggering qualification job...`);
      await request(`/leads/${leadId}/qualify`, { method: 'POST' });
      setShowNew(false);
      setCustomer('');
      setCustomerEmail('');
      await load();
      notify(`Lead ${leadId} queued for AI qualification.`);
    } catch (e) {
      notify(formatApiError(e));
    } finally {
      setBusy(false);
    }
  };

  // Qualification Workflow
  const qualify = async (lead: Lead) => {
    setBusy(true);
    try {
      const res = await request<{ job_id: string; state: string; dispatch_mode?: string }>(
        `/leads/${lead.id}/qualify`,
        { method: 'POST' }
      );
      notify(`Qualification queued (Job: ${res.job_id}). Polling status...`);
      let terminalState: 'completed' | 'failed' | null = null;
      for (let i = 0; i < 8; i++) {
        await new Promise((r) => setTimeout(r, 600));
        const job = await request<{ state: string }>(`/jobs/${res.job_id}`);
        if (job && (job.state === 'completed' || job.state === 'failed')) {
          terminalState = job.state;
          break;
        }
      }
      await load();
      if (detail && detail.id === lead.id) {
        const updated = await request<{ lead: Lead }>(`/leads/${lead.id}`);
        setDetail(updated.lead);
        const qualification =
          updated.lead.reviewed_qualification || updated.lead.qualification;
        setReviewDraft({
          service_type: qualification?.service_type || '',
          location: qualification?.location || '',
          quantity: qualification?.quantity?.toString() || '',
          area: qualification?.area || '',
          frequency: qualification?.frequency || '',
          requested_time: qualification?.requested_time || '',
        });
      }
      notify(
        terminalState === 'completed'
          ? `Qualification finished for ${lead.id}.`
          : terminalState === 'failed'
            ? `Qualification failed for ${lead.id}; the lead was escalated for review.`
            : `Qualification still processing in background (Job: ${res.job_id}).`
      );
    } catch (e) {
      notify(formatApiError(e));
    } finally {
      setBusy(false);
    }
  };

  const openLead = async (lead: Lead) => {
    try {
      const d = await request<{ lead: Lead; quotes: Quote[] }>(`/leads/${lead.id}`);
      setDetail(d.lead);
      const qualification = d.lead.reviewed_qualification || d.lead.qualification;
      setReviewDraft({
        service_type: qualification?.service_type || '',
        location: qualification?.location || '',
        quantity: qualification?.quantity?.toString() || '',
        area: qualification?.area || '',
        frequency: qualification?.frequency || '',
        requested_time: qualification?.requested_time || '',
      });
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Could not load lead');
    }
  };

  const saveReview = async () => {
    if (!detail?.qualification) {
      notify('Run qualification before saving a human review.');
      return;
    }
    let quantity: number | null = null;
    if (reviewDraft.quantity.trim()) {
      quantity = Number(reviewDraft.quantity);
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10000) {
        notify('Quantity must be a whole number between 1 and 10,000.');
        return;
      }
    }

    setBusy(true);
    try {
      const result = await request<{ lead: Lead; corrected_fields: string[] }>(
        `/leads/${detail.id}/review`,
        {
          method: 'POST',
          body: JSON.stringify({
            expected_generation: detail.generation,
            service_type: reviewDraft.service_type.trim() || null,
            location: reviewDraft.location.trim() || null,
            quantity,
            area: reviewDraft.area.trim() || null,
            frequency: reviewDraft.frequency.trim() || null,
            requested_time: reviewDraft.requested_time.trim() || null,
          }),
        }
      );
      setDetail(result.lead);
      const qualification =
        result.lead.reviewed_qualification || result.lead.qualification;
      setReviewDraft({
        service_type: qualification?.service_type || '',
        location: qualification?.location || '',
        quantity: qualification?.quantity?.toString() || '',
        area: qualification?.area || '',
        frequency: qualification?.frequency || '',
        requested_time: qualification?.requested_time || '',
      });
      await load();
      notify(`Human review saved. Corrected fields: ${result.corrected_fields.join(', ') || 'none'}. Evaluate policy to continue.`);
    } catch (e) {
      notify(formatApiError(e));
    } finally {
      setBusy(false);
    }
  };

  const evaluatePolicy = async () => {
    if (!detail?.reviewed_qualification) {
      notify('Save human corrections before evaluating policy.');
      return;
    }
    setBusy(true);
    try {
      const result = await request<{ lead: Lead; eligible: boolean; reasons: string[] }>(
        `/leads/${detail.id}/policy/evaluate`,
        { method: 'POST' }
      );
      setDetail(result.lead);
      await load();
      notify(
        result.eligible
          ? 'Deterministic policy passed. This lead is eligible for a quote.'
          : `Policy blocked this lead: ${result.reasons.join(', ')}`
      );
    } catch (e) {
      notify(formatApiError(e));
    } finally {
      setBusy(false);
    }
  };

  // Quote Workflow
  const createQuote = async (lead: Lead) => {
    const q = lead.reviewed_qualification || lead.qualification;
    if (!q?.service_type || !q.quantity || !settings?.service_catalogue?.[q.service_type]) {
      notify(
        'An eligible catalogue service code and quantity are required before creating a quote.'
      );
      return;
    }
    setBusy(true);
    try {
      const service = settings.service_catalogue[q.service_type];
      const quote = await request<Quote>(`/leads/${lead.id}/quotes`, {
        method: 'POST',
        body: JSON.stringify({
          catalogue_version: settings.catalogue_version,
          line_items: [
            {
              service_code: q.service_type,
              description: service.label,
              quantity: q.quantity,
              unit_price: service.unit_price,
            },
          ],
          vat_exempt: false,
          exclusions: [],
        }),
      });
      notify(`Draft quote created: ${money(quote.total)}. Human review is required.`);
      await load();
      setActive('Approvals');
      setDetail(null);
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Could not create quote');
    } finally {
      setBusy(false);
    }
  };

  // Approvals
  const approveQuote = async (q: Quote) => {
    setBusy(true);
    try {
      await request(`/quotes/${q.id}/approve`, {
        method: 'POST',
        headers: { 'X-Actor-ID': approverId.trim() || 'demo-reviewer' },
        body: JSON.stringify({
          expected_generation: q.generation,
          reviewer_id: approverId.trim() || 'demo-reviewer',
        }),
      });
      notify(`Quote ${q.id} approved by ${approverId.trim() || 'demo-reviewer'}. Audit event recorded.`);
      await load();
      if (quoteDetail && quoteDetail.id === q.id) {
        setQuoteDetail(null);
      }
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Approval failed');
    } finally {
      setBusy(false);
    }
  };

  const sendQuote = async (q: Quote) => {
    setBusy(true);
    try {
      const actorId = q.approved_by || approverId || 'demo-reviewer';
      const r = await request<{ notice?: string; status?: string }>(`/quotes/${q.id}/send`, {
        method: 'POST',
        headers: { 'X-Actor-ID': actorId },
        body: JSON.stringify({
          channel: 'website',
          approved_by: actorId,
        }),
      });
      notify(r.notice || r.status || 'Sandbox send recorded.');
      await load();
      if (quoteDetail && quoteDetail.id === q.id) {
        setQuoteDetail(null);
      }
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Send failed');
    } finally {
      setBusy(false);
    }
  };

  // Settings
  const saveSettings = async () => {
    if (!draftSettings) return;
    setBusy(true);
    try {
      const result = await request<TenantSettings>('/settings', {
        method: 'PUT',
        body: JSON.stringify(draftSettings),
      });
      setSettings(result);
      setEditingSettings(false);
      notify(`Settings persisted. Catalogue: ${result.catalogue_version}, Policy: ${result.policy_version}.`);
      await load();
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Could not save settings');
    } finally {
      setBusy(false);
    }
  };

  // Tariff Plans
  const createPlan = async () => {
    setBusy(true);
    try {
      const payload = {
        ...planDraft,
        metered_limits: { monthly_leads: Number(planDraft.metered_limits.monthly_leads) },
      };
      await request<SubscriptionPlan>('/billing/plans', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      setShowPlanModal(false);
      notify('Subscription tariff draft created. Inactive until two-person approved.');
      await load();
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Could not create tariff');
    } finally {
      setBusy(false);
    }
  };

  const openPublishPreview = async (plan: SubscriptionPlan) => {
    setBusy(true);
    try {
      const preview = await request<any>(`/billing/plans/${plan.plan_id}/${plan.plan_version}/preview`);
      setPlanPreview(preview);
      setPublishingPlan(plan);
      setPlanApproverId('second-reviewer');
      setEffectiveDate(new Date(Date.now() + 86400000).toISOString().slice(0, 16));
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Could not preview tariff');
    } finally {
      setBusy(false);
    }
  };

  const publishPlan = async () => {
    if (!publishingPlan || !planApproverId.trim()) {
      notify('A second approver identity is required.');
      return;
    }
    setBusy(true);
    try {
      await request(`/billing/plans/${publishingPlan.plan_id}/${publishingPlan.plan_version}/publish`, {
        method: 'POST',
        headers: { 'X-Actor-ID': planApproverId.trim() },
        body: JSON.stringify({
          expected_generation: publishingPlan.generation,
          approver_id: planApproverId.trim(),
          effective_from: new Date(effectiveDate).toISOString(),
        }),
      });
      setPublishingPlan(null);
      setPlanPreview(null);
      notify('Tariff published with future effective date. Existing contracts unchanged.');
      await load();
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Could not publish tariff');
    } finally {
      setBusy(false);
    }
  };

  const createContract = async () => {
    setBusy(true);
    try {
      await request('/billing/contracts', {
        method: 'POST',
        body: JSON.stringify({
          contract_id: contractDraft.contract_id,
          tenant_id: getTenantId(),
          customer_ref: contractDraft.customer_ref,
          plan_id: contractDraft.plan_id,
          plan_version: contractDraft.plan_version,
          status: 'active',
          recurring_fee: Number(contractDraft.recurring_fee),
          currency: contractDraft.currency,
          started_at: new Date().toISOString(),
        }),
      });
      setShowContractModal(false);
      notify(`Customer subscription contract imported: ${contractDraft.contract_id}`);
      await load();
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Could not import contract');
    } finally {
      setBusy(false);
    }
  };

  // Filtered Leads
  const filteredLeads = useMemo(() => {
    return leads.filter((l) => {
      const matchesSearch = [
        l.id,
        l.customer_name,
        l.customer_email,
        l.message,
        l.status,
        l.qualification?.service_type,
        l.qualification?.location,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(search.toLowerCase());

      const matchesStatus = statusFilter === 'all' || l.status === statusFilter;
      const matchesChannel = channelFilter === 'all' || l.channel === channelFilter;

      return matchesSearch && matchesStatus && matchesChannel;
    });
  }, [leads, search, statusFilter, channelFilter]);

  // Filtered Quotes
  const filteredQuotes = useMemo(() => {
    return quotes.filter((q) => {
      const matchesSearch = [q.id, q.lead_id, q.status, q.policy_version, q.catalogue_version]
        .join(' ')
        .toLowerCase()
        .includes(search.toLowerCase());
      const matchesStatus = statusFilter === 'all' || q.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [quotes, search, statusFilter]);

  // Filtered Events
  const filteredEvents = useMemo(() => {
    return events.filter((ev) => {
      const matchesSearch = [ev.event_id, ev.entity_id, ev.actor_id, ev.action, ev.result]
        .join(' ')
        .toLowerCase()
        .includes(search.toLowerCase());
      const matchesAction = actionFilter === 'all' || ev.action === actionFilter;
      return matchesSearch && matchesAction;
    });
  }, [events, search, actionFilter]);

  // Derived Customers
  const customerList = useMemo(() => {
    const map = new Map<string, { customer_name: string; customer_email?: string; leads: Lead[]; quoteCount: number; quoteTotal: number }>();
    leads.forEach((l) => {
      const key = l.customer_email || l.customer_name || l.id;
      if (!map.has(key)) {
        map.set(key, {
          customer_name: l.customer_name || `Enquiry ${l.id}`,
          customer_email: l.customer_email,
          leads: [],
          quoteCount: 0,
          quoteTotal: 0,
        });
      }
      const record = map.get(key)!;
      record.leads.push(l);
      const linkedQuotes = quotes.filter((q) => l.quote_ids?.includes(q.id));
      record.quoteCount += linkedQuotes.length;
      record.quoteTotal += linkedQuotes.reduce((acc, q) => acc + (q.total || 0), 0);
    });
    return Array.from(map.values()).filter((c) =>
      [c.customer_name, c.customer_email].filter(Boolean).join(' ').toLowerCase().includes(search.toLowerCase())
    );
  }, [leads, quotes, search]);

  const pendingQuotes = quotes.filter((q) => q.status === 'draft');
  const tenantBudget =
    usage?.ai_monthly_budget_usd ??
    dashboard?.ai_monthly_budget_usd ??
    settings?.ai_monthly_budget_usd ??
    null;
  const remainingBudget =
    usage?.remaining_budget_usd ?? dashboard?.remaining_budget_usd ?? null;
  const monthlySpend = usage?.monthly_spend_usd ?? dashboard?.monthly_spend_usd ?? 0;
  const budgetUsage =
    tenantBudget && tenantBudget > 0
      ? Math.min(100, Math.round((monthlySpend / tenantBudget) * 100))
      : 0;
  const chartData = useMemo(() => {
    const today = new Date();
    const utcToday = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
    );
    return Array.from({ length: 7 }, (_, index) => {
      const date = new Date(utcToday);
      date.setUTCDate(date.getUTCDate() - (6 - index));
      const dateKey = date.toISOString().slice(0, 10);
      const dailyLeads = leads.filter((lead) => lead.created_at.slice(0, 10) === dateKey);
      return {
        day: date.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' }),
        leads: dailyLeads.length,
        qualified: dailyLeads.filter((lead) =>
          ['qualified', 'quote_draft', 'quote_approved', 'sent'].includes(lead.status)
        ).length,
      };
    });
  }, [leads]);
  const hasChartActivity = chartData.some((day) => day.leads > 0);

  const titles: Record<string, { title: string; subtitle: string }> = {
    Overview: { title: 'Overview', subtitle: 'Live operations and pipeline snapshot' },
    Leads: { title: 'Lead Management', subtitle: 'Search, filter, and progress customer service enquiries' },
    Qualification: { title: 'AI Qualification Hub', subtitle: 'Dual-agent structured extraction with transparent model reporting' },
    Quotes: { title: 'Quote Management', subtitle: 'Tenant-governed quotations with deterministic VAT and rule versions' },
    Approvals: { title: 'Approval Review Queue', subtitle: 'Human-in-the-loop review before any quote can be sent' },
    Customers: { title: 'Customer Directory', subtitle: 'Tenant-scoped customer cases, service histories, and quote totals' },
    'AI Activity & Usage': {
      title: 'AI Activity & Usage',
      subtitle: tenantBudget == null
        ? 'Live model telemetry and token metrics; no monthly AI budget is configured'
        : `Live model telemetry and token metrics; ${new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(tenantBudget)} monthly budget`,
    },
    'Audit Logs': { title: 'Immutable Audit Trail', subtitle: 'Cryptographically hashed event ledger of all workflow actions' },
    Catalogue: { title: 'Service Catalogue & Tariffs', subtitle: 'Tenant service pricing and two-person subscription governance' },
    Settings: { title: 'Workspace Settings', subtitle: 'Tenant configuration, VAT rates, territories, and guardrails' },
    Help: { title: 'Help & Documentation', subtitle: 'Local-first architecture, API references, and operating guide' },
  };

  const currentView = titles[active] || { title: active, subtitle: '' };

  return (
    <div className="app-shell">
      <Sidebar
        active={active}
        onNavigate={setActive}
        counts={{
          pendingApprovals: pendingQuotes.length,
          totalLeads: leads.length,
        }}
      />

      <main className="main-area">
        <Topbar
          title={currentView.title}
          subtitle={currentView.subtitle}
          search={search}
          onSearchChange={setSearch}
        />

        <div className="page-content">
          {error ? (
            <div className="error-banner">
              <CircleAlert size={17} />
              <div>
                <strong>API connection warning</strong>
                <p>{error}. Verify the FastAPI service at <code>{API_BASE_URL}</code> and click Retry.</p>
              </div>
              <button onClick={() => void load()}>
                <RefreshCw size={14} /> Retry
              </button>
            </div>
          ) : (
          <>

          {/* 1. OVERVIEW */}
          {active === 'Overview' && (
            <>
              <section className="welcome-row">
                <div>
                  <div className="eyebrow">
                    <span className="eyebrow-line" />
                    NORTHSTAR OPERATIONS SNAPSHOT
                  </div>
                  <h1>
                    Good morning<span className="title-dot">.</span>
                  </h1>
                  <p className="welcome-copy">
                    Lead-to-order pipeline overview for tenant <code>{getTenantId()}</code>.
                  </p>
                </div>
                <div className="welcome-actions">
                  <button className="button button-secondary" onClick={() => void load()} disabled={loading}>
                    <RefreshCw size={15} className={loading ? 'spin' : ''} /> Refresh
                  </button>
                  <button className="button button-primary" onClick={() => setShowNew(true)}>
                    <Plus size={17} /> New enquiry
                  </button>
                </div>
              </section>

              <section className="stat-grid">
                <StatCard
                  label="Total enquiries"
                  value={dashboard?.lead_count ?? leads.length}
                  change="Live workspace records"
                  icon={<Layers3 size={18} />}
                  tone="blue"
                  footer="All captured leads"
                />
                <StatCard
                  label="Awaiting Approval"
                  value={pendingQuotes.length}
                  change="Human review required"
                  icon={<ShieldCheck size={18} />}
                  tone="violet"
                  footer="Quotes waiting for decision"
                />
                <StatCard
                  label="Qualified leads"
                  value={dashboard?.status_counts?.qualified ?? leads.filter((l) => l.status === 'qualified').length}
                  change="Policy-evaluated"
                  icon={<BadgeCheck size={18} />}
                  tone="green"
                  footer="Eligible for quotation"
                />
                <StatCard
                  label="AI Monthly Spend"
                  value={fmtUsd(monthlySpend, 4)}
                  change={`Budget: ${tenantBudget == null ? 'not configured' : fmtUsd(tenantBudget)}`}
                  icon={<Bot size={18} />}
                  tone="amber"
                  footer={`Remaining: ${remainingBudget == null ? '—' : fmtUsd(remainingBudget, 4)}`}
                />
              </section>

              <section className="overview-grid">
                <div className="panel chart-panel">
                  <div className="panel-heading">
                    <div>
                      <h2>Pipeline Activity Trend</h2>
                      <p>Lead qualification and conversion distribution</p>
                    </div>
                    <button className="range-select">
                      Weekly Trend <ChevronDown size={14} />
                    </button>
                  </div>
                  <div className="chart-legend">
                    <span>
                      <i className="legend-leads" /> Enquiries
                    </span>
                    <span>
                      <i className="legend-qualified" /> Qualified
                    </span>
                  </div>
                  <div className="chart-wrap">
                    <ResponsiveContainer width="100%" height="100%">
                      {hasChartActivity ? (
                      <AreaChart data={chartData} margin={{ top: 10, right: 4, left: -22, bottom: 0 }}>
                        <defs>
                          <linearGradient id="leadFill" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#5b7cff" stopOpacity={0.18} />
                            <stop offset="100%" stopColor="#5b7cff" stopOpacity={0.01} />
                          </linearGradient>
                          <linearGradient id="qualFill" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#42c6a5" stopOpacity={0.15} />
                            <stop offset="100%" stopColor="#42c6a5" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid stroke="#eef1f7" vertical={false} />
                        <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fill: '#9aa3b4', fontSize: 11 }} dy={10} />
                        <YAxis axisLine={false} tickLine={false} tick={{ fill: '#9aa3b4', fontSize: 11 }} />
                        <Tooltip
                          contentStyle={{
                            border: '1px solid #e7ebf3',
                            borderRadius: 12,
                            fontSize: 12,
                            boxShadow: '0 10px 30px #1b2c4a12',
                          }}
                        />
                        <Area type="monotone" dataKey="leads" name="Enquiries" stroke="#5b7cff" strokeWidth={2.5} fill="url(#leadFill)" />
                        <Area type="monotone" dataKey="qualified" name="Qualified" stroke="#42c6a5" strokeWidth={2.5} fill="url(#qualFill)" />
                      </AreaChart>
                      ) : (
                        <div style={{ padding: 28, textAlign: 'center', color: '#64748b', fontSize: 13 }}>
                          No lead activity recorded in the last seven days.
                        </div>
                      )}
                    </ResponsiveContainer>
                  </div>
                  <div className="chart-footnote">
                    <span className="tiny-pulse" /> Operational activity across tenant: {getTenantId()}
                  </div>
                </div>

                <div className="panel health-panel">
                  <div className="panel-heading">
                    <div>
                      <h2>Guardrails Posture</h2>
                      <p>Invariants &amp; runtime controls</p>
                    </div>
                    <span className="health-indicator">
                      <i /> LOCAL SANDBOX
                    </span>
                  </div>

                  <div className="health-score">
                    <div className="health-ring">
                      <div>
                        <strong>4/4</strong>
                        <small>controls</small>
                      </div>
                    </div>
                    <div>
                      <strong>Strict Security Enforced</strong>
                      <p>Local sandbox isolation</p>
                      <span className="healthy-text">
                        <CheckCircle2 size={13} /> No live outbound delivery
                      </span>
                    </div>
                  </div>

                  <div className="health-list">
                    <HealthItem label="Tenant Isolation" detail={`Scoped to ${getTenantId()}`} />
                    <HealthItem label="Quote Approval Gate" detail="Human Reviewer Required" />
                    <HealthItem
                      label="AI Spend Guardrail"
                      detail={tenantBudget == null ? 'No monthly limit configured' : `${fmtUsd(tenantBudget)} monthly limit`}
                    />
                    <HealthItem
                      label="Configured Model"
                      detail={health?.model_configured ? (health?.model_name || 'Configured model') : 'Deterministic Fallback'}
                    />
                  </div>
                  <button className="text-button" onClick={() => setActive('Settings')}>
                    View workspace settings <ArrowRight size={14} />
                  </button>
                </div>
              </section>

              <section className="panel leads-panel">
                <div className="panel-heading lead-heading">
                  <div>
                    <h2>
                      Recent Enquiries <span className="count-badge">{leads.length}</span>
                    </h2>
                    <p>Every customer message is preserved and traceably qualified.</p>
                  </div>
                  <button className="text-button" onClick={() => setActive('Leads')}>
                    View all leads <ArrowRight size={14} />
                  </button>
                </div>
                <LeadTable leads={leads.slice(0, 5)} onOpen={openLead} onQualify={qualify} busy={busy} />
              </section>

              <section className="bottom-grid">
                <div className="panel approval-panel">
                  <div className="panel-heading">
                    <div>
                      <h2>Approval Queue</h2>
                      <p>Mandatory human gate before send authorization</p>
                    </div>
                    <span className="queue-count">{pendingQuotes.length} pending</span>
                  </div>
                  {pendingQuotes.length === 0 ? (
                    <Empty title="You're all caught up" text="Draft quotes requiring human review will appear here." />
                  ) : (
                    pendingQuotes.slice(0, 3).map((q) => (
                      <div className="approval-row" key={q.id}>
                        <div className="quote-icon">
                          <FileCheck2 size={17} />
                        </div>
                        <div className="approval-info">
                          <strong>Quote {q.id}</strong>
                          <small>
                            {q.line_items?.[0]?.description || 'Service quote'} · {q.policy_version}
                          </small>
                        </div>
                        <div className="approval-price">{money(q.total)}</div>
                        <button
                          className="mini-action"
                          onClick={() => void approveQuote(q)}
                          disabled={busy}
                          title="Quick Approve"
                        >
                          <Check size={14} />
                        </button>
                      </div>
                    ))
                  )}
                  <button className="button button-light full-button" onClick={() => setActive('Approvals')}>
                    Open full approval queue <ArrowRight size={14} />
                  </button>
                </div>

                <div className="panel activity-panel">
                  <div className="panel-heading">
                    <div>
                      <h2>Architecture Principles</h2>
                      <p>Enforced by backend services</p>
                    </div>
                    <Sparkles size={17} className="sparkle-icon" />
                  </div>
                  <div className="activity-item">
                    <div className="activity-icon ai">
                      <Bot size={16} />
                    </div>
                    <div>
                      <strong>AI Suggests, Policy Decides</strong>
                      <p>Gemini extracts structured facts; deterministic policy evaluates catalogue and pricing.</p>
                    </div>
                  </div>
                  <div className="activity-item">
                    <div className="activity-icon human">
                      <Users size={16} />
                    </div>
                    <div>
                      <strong>Humans Approve External Actions</strong>
                      <p>Quote sends require a recorded reviewer identity and generation match.</p>
                    </div>
                  </div>
                  <div className="activity-item">
                    <div className="activity-icon log">
                      <Activity size={16} />
                    </div>
                    <div>
                      <strong>Append-Only Event Ledger</strong>
                      <p>All state transitions emit SHA-256 digested audit events with correlation tracking.</p>
                    </div>
                  </div>
                </div>
              </section>
            </>
          )}

          {/* 2. LEADS */}
          {active === 'Leads' && (
            <section className="panel full-list-panel">
              <div className="list-toolbar">
                <div>
                  <h2>Lead Management</h2>
                  <p>Search, filter, and progress incoming enquiries for tenant: {getTenantId()}.</p>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    className="button button-secondary"
                    onClick={() =>
                      window.open(`${API_BASE_URL}/v1/exports/leads.csv`, '_blank')
                    }
                  >
                    <Download size={15} /> Export CSV
                  </button>
                  <button className="button button-primary" onClick={() => setShowNew(true)}>
                    <Plus size={16} /> New enquiry
                  </button>
                </div>
              </div>

              <div className="filter-bar">
                <div className="table-search">
                  <Search size={15} />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search by ID, customer name, email, service, location..."
                  />
                </div>

                <select
                  className="select-input"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                >
                  <option value="all">All Statuses ({leads.length})</option>
                  <option value="new">New enquiries</option>
                  <option value="qualification_queued">Qualifying / Queued</option>
                  <option value="needs_information">Needs information</option>
                  <option value="qualified">Qualified</option>
                  <option value="quote_draft">Quote drafted</option>
                  <option value="quote_approved">Quote approved</option>
                  <option value="sent">Sent</option>
                  <option value="escalated">Escalated</option>
                </select>

                <select
                  className="select-input"
                  value={channelFilter}
                  onChange={(e) => setChannelFilter(e.target.value)}
                >
                  <option value="all">All Channels</option>
                  <option value="website">Website Form</option>
                  <option value="whatsapp">WhatsApp (Gated)</option>
                </select>

                <button className="button button-secondary" onClick={() => void load()} disabled={loading}>
                  <RefreshCw size={14} className={loading ? 'spin' : ''} /> Refresh
                </button>
              </div>

              <LeadTable leads={filteredLeads} onOpen={openLead} onQualify={qualify} busy={busy} />
            </section>
          )}

          {/* 3. QUALIFICATION */}
          {active === 'Qualification' && (
            <section className="panel full-list-panel">
              <div className="list-toolbar">
                <div>
                  <h2>AI Qualification Hub</h2>
                  <p>
                    Structured extraction with {health?.model_configured ? health.model_name : 'deterministic fallback'} and rule-based safeguards.
                  </p>
                </div>
                <button className="button button-secondary" onClick={() => void load()}>
                  <RefreshCw size={15} className={loading ? 'spin' : ''} /> Refresh Queue
                </button>
              </div>

              <div className="agent-cards" style={{ marginBottom: 20 }}>
                <AgentCard
                  n="01"
                  title="Lead Qualification Agent"
                  desc="Primary role: Analyzes untrusted customer messages and extracts service, location, and quantity using strict Pydantic schemas. Constrained to configured catalogue."
                  tag="Primary AI Agent"
                />
                <AgentCard
                  n="02"
                  title="Evidence Verification Agent"
                  desc="Conditional second role: Runs only when confidence < 70%, fields are missing, or safety flags exist. Validates candidate facts against verbatim evidence spans."
                  tag="Conditional Verifier"
                />
                <AgentCard
                  n="03"
                  title="Deterministic Policy Engine"
                  desc="Deterministic rule engine: Evaluates service eligibility, territory boundaries, and minimum information requirements before allowing quote creation."
                  tag="Deterministic Invariants"
                />
              </div>

              <div className="stat-grid" style={{ marginBottom: 20 }}>
                <StatCard
                  label="Awaiting Qualification"
                  value={leads.filter((l) => ['new', 'needs_information', 'qualification_queued'].includes(l.status)).length}
                  change="Pending processing"
                  icon={<Clock3 size={18} />}
                  tone="amber"
                  footer="Leads without final evaluation"
                />
                <StatCard
                  label="Successfully Qualified"
                  value={leads.filter((l) => l.status === 'qualified' || (l.quote_ids && l.quote_ids.length > 0)).length}
                  change="Passed policy rules"
                  icon={<BadgeCheck size={18} />}
                  tone="green"
                  footer="Eligible for quotation"
                />
                <StatCard
                  label="Safety Flags / Escalated"
                  value={leads.filter((l) => l.status === 'escalated' || l.qualification?.injection_detected).length}
                  change="Injection or policy flags"
                  icon={<ShieldAlert size={18} />}
                  tone="violet"
                  footer="Escalated for human triage"
                />
                <StatCard
                  label="Fallback Invocations"
                  value={leads.filter((l) => l.qualification?.model_used === 'deterministic_fallback').length}
                  change="Transparently marked"
                  icon={<CircleAlert size={18} />}
                  tone="blue"
                  footer="Never faked as Gemini AI"
                />
              </div>

              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Lead ID &amp; Customer</th>
                      <th>Message Snippet</th>
                      <th>Model Mode</th>
                      <th>Confidence</th>
                      <th>Extracted Service</th>
                      <th>Safety Flags</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leads.map((l) => (
                      <tr key={l.id} className="click-row" onClick={() => void openLead(l)}>
                        <td>
                          <strong>{l.customer_name || l.id}</strong>
                          <small style={{ display: 'block', color: '#9aa5b5' }}>{l.id}</small>
                        </td>
                        <td style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          “{l.message}”
                        </td>
                        <td>
                          {l.qualification?.model_used === 'deterministic_fallback' ? (
                            <span className="status status-amber" title="Rule-based heuristic fallback (not Gemini AI)">
                              <i /> Fallback (Rule-Based)
                            </span>
                          ) : l.qualification?.model_used ? (
                            <span className="status status-green" title={`Live Gemini model: ${l.qualification.model_used}`}>
                              <i /> {l.qualification.model_used}
                            </span>
                          ) : (
                            <span className="status status-neutral">Not Run</span>
                          )}
                        </td>
                        <td>
                          {l.qualification ? (
                            <div className="confidence-cell">
                              <div className="confidence-track">
                                <i style={{ width: `${Math.round(l.qualification.confidence * 100)}%` }} />
                              </div>
                              <span>{Math.round(l.qualification.confidence * 100)}%</span>
                            </div>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td>
                          <strong>{l.qualification?.service_type?.replaceAll('_', ' ') || 'Pending'}</strong>
                          <small style={{ display: 'block', color: '#9aa5b5' }}>
                            {l.qualification?.location || 'No location'}
                          </small>
                        </td>
                        <td>
                          {l.qualification?.safety_flags && l.qualification.safety_flags.length > 0 ? (
                            <span className="status status-red">{l.qualification.safety_flags.join(', ')}</span>
                          ) : l.qualification?.injection_detected ? (
                            <span className="status status-red">Injection Flagged</span>
                          ) : (
                            <span style={{ color: '#16a34a', fontSize: 10 }}>Clean</span>
                          )}
                        </td>
                        <td>
                          <button
                            className="button button-light"
                            style={{ padding: '6px 10px', fontSize: 10 }}
                            disabled={busy}
                            onClick={(e) => {
                              e.stopPropagation();
                              void qualify(l);
                            }}
                          >
                            <RefreshCw size={12} className={busy ? 'spin' : ''} /> Qualify
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* 4. QUOTES */}
          {active === 'Quotes' && (
            <section className="panel full-list-panel">
              <div className="list-toolbar">
                <div>
                  <h2>Quote Management</h2>
                  <p>All quotations issued for tenant: {getTenantId()} with authoritative server-side VAT calculation.</p>
                </div>
                <button className="button button-secondary" onClick={() => void load()}>
                  <RefreshCw size={15} className={loading ? 'spin' : ''} /> Refresh Quotes
                </button>
              </div>

              <div className="filter-bar">
                <div className="table-search">
                  <Search size={15} />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search by quote ID, lead ID, policy version..."
                  />
                </div>

                <select
                  className="select-input"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                >
                  <option value="all">All Quotes ({quotes.length})</option>
                  <option value="draft">Drafts Awaiting Review</option>
                  <option value="approved">Approved Quotes</option>
                  <option value="sent">Recorded Sandbox Sends</option>
                </select>
              </div>

              {filteredQuotes.length === 0 ? (
                <Empty
                  title="No quotations found"
                  text="Qualify an eligible enquiry in the Leads or Qualification view to draft a quote."
                />
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Quote ID</th>
                        <th>Lead ID</th>
                        <th>Service Line Item</th>
                        <th>Subtotal</th>
                        <th>VAT Amount</th>
                        <th>Total (GBP)</th>
                        <th>Status</th>
                        <th>Policy Version</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredQuotes.map((q) => (
                        <tr key={q.id}>
                          <td>
                            <strong>{q.id}</strong>
                            <small style={{ display: 'block', color: '#9aa5b5' }}>gen #{q.generation}</small>
                          </td>
                          <td>
                            <code>{q.lead_id}</code>
                          </td>
                          <td>
                            <strong>{q.line_items?.[0]?.description || 'Service Quotation'}</strong>
                            <small style={{ display: 'block', color: '#9aa5b5' }}>
                              qty: {q.line_items?.[0]?.quantity || 1} @ {money(q.line_items?.[0]?.unit_price || 0)}
                            </small>
                          </td>
                          <td>{money(q.subtotal)}</td>
                          <td>{money(q.vat_amount)}</td>
                          <td>
                            <strong style={{ fontSize: 12, color: '#1e293b' }}>{money(q.total)}</strong>
                          </td>
                          <td>
                            <StatusBadge value={q.status} />
                          </td>
                          <td>
                            <span className="badge-code">{q.policy_version}</span>
                          </td>
                          <td>
                            <div style={{ display: 'flex', gap: 6 }}>
                              <button
                                className="button button-light"
                                style={{ padding: '6px 9px', fontSize: 10 }}
                                onClick={() => setQuoteDetail(q)}
                              >
                                <Eye size={12} /> View
                              </button>
                              {q.status === 'draft' && (
                                <button
                                  className="button button-primary"
                                  style={{ padding: '6px 9px', fontSize: 10 }}
                                  disabled={busy}
                                  onClick={() => void approveQuote(q)}
                                >
                                  <Check size={12} /> Approve
                                </button>
                              )}
                              {q.status === 'approved' && (
                                <button
                                  className="button button-secondary"
                                  style={{ padding: '6px 9px', fontSize: 10 }}
                                  disabled={busy}
                                  onClick={() => void sendQuote(q)}
                                >
                                  <Send size={12} /> Sandbox Send
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          {/* 5. APPROVALS */}
          {active === 'Approvals' && (
            <section className="panel full-list-panel">
              <div className="list-toolbar">
                <div>
                  <h2>Quote Approval Review Queue</h2>
                  <p>Every quote requires explicit human reviewer approval before sandbox transmission.</p>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <label style={{ fontSize: 10, color: '#64748b', fontWeight: 600 }}>Reviewer Identity:</label>
                  <input
                    className="select-input"
                    value={approverId}
                    onChange={(e) => setApproverId(e.target.value)}
                    style={{ width: 140 }}
                  />
                  <span className="queue-count">{pendingQuotes.length} awaiting decision</span>
                </div>
              </div>

              <div className="info-banner" style={{ marginTop: 0, marginBottom: 18 }}>
                <ShieldCheck size={18} />
                <p>
                  <strong>Two-Person and Role Boundary:</strong> Approval verifies the expected generation count and catalogue pricing rules.
                  Outbound sending remains simulated in sandbox mode.
                </p>
              </div>

              {pendingQuotes.length === 0 ? (
                <Empty
                  title="Approval queue clear"
                  text="There are no draft quotes waiting for human review at this time."
                />
              ) : (
                <div style={{ display: 'grid', gap: 16 }}>
                  {pendingQuotes.map((q) => {
                    const lead = leads.find((l) => l.id === q.lead_id);
                    return (
                      <div
                        key={q.id}
                        className="panel"
                        style={{ padding: 18, border: '1px solid #e2e8f0', background: '#fafcff' }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                          <div>
                            <span className="eyebrow">DRAFT QUOTE DECISION REQUIRED</span>
                            <h3 style={{ fontSize: 15, margin: '6px 0 2px', color: '#1e293b' }}>
                              Quote {q.id} · Lead {q.lead_id}
                            </h3>
                            <p style={{ fontSize: 10, color: '#64748b', margin: 0 }}>
                              Created {fmtDate(q.approved_at || (q as any).created_at)} · Catalogue: {q.catalogue_version} · Policy: {q.policy_version}
                            </p>
                          </div>
                          <div style={{ textAlign: 'right' }}>
                            <div style={{ fontSize: 20, fontWeight: 800, color: '#1e293b' }}>{money(q.total)}</div>
                            <small style={{ fontSize: 10, color: '#64748b' }}>incl. 20% VAT ({money(q.vat_amount)})</small>
                          </div>
                        </div>

                        {lead && (
                          <div className="detail-message" style={{ margin: '12px 0 14px', fontSize: 11 }}>
                            <strong>Customer Enquiry:</strong> “{lead.message}”
                            {lead.customer_name && (
                              <div style={{ marginTop: 4, fontSize: 10, color: '#475569' }}>
                                Customer: <strong>{lead.customer_name}</strong> {lead.customer_email ? `(${lead.customer_email})` : ''}
                              </div>
                            )}
                          </div>
                        )}

                        <table className="quote-item-table">
                          <thead>
                            <tr>
                              <th>Service Code</th>
                              <th>Description</th>
                              <th>Qty</th>
                              <th>Unit Price</th>
                              <th>Line Total</th>
                            </tr>
                          </thead>
                          <tbody>
                            {q.line_items.map((item, idx) => (
                              <tr key={idx}>
                                <td>
                                  <code>{item.service_code}</code>
                                </td>
                                <td>{item.description}</td>
                                <td>{item.quantity}</td>
                                <td>{money(item.unit_price)}</td>
                                <td>
                                  <strong>{money(item.quantity * item.unit_price)}</strong>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>

                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 12 }}>
                          <button
                            className="button button-light"
                            onClick={() => setQuoteDetail(q)}
                          >
                            <Eye size={14} /> Full Breakdown
                          </button>
                          <button
                            className="button button-primary"
                            disabled={busy}
                            onClick={() => void approveQuote(q)}
                          >
                            <Check size={14} /> Approve Quote as {approverId.trim() || 'demo-reviewer'}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          )}

          {/* 6. CUSTOMERS */}
          {active === 'Customers' && (
            <section className="panel full-list-panel">
              <div className="list-toolbar">
                <div>
                  <h2>Customer Directory</h2>
                  <p>Customer cases and order histories scoped strictly to tenant: {getTenantId()}.</p>
                </div>
                <button className="button button-secondary" onClick={() => void load()}>
                  <RefreshCw size={15} className={loading ? 'spin' : ''} /> Refresh
                </button>
              </div>

              <div className="filter-bar">
                <div className="table-search">
                  <Search size={15} />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search by customer name, email..."
                  />
                </div>
                <span className="count-badge">{customerList.length} unique customers</span>
              </div>

              {customerList.length === 0 ? (
                <Empty title="No customers found" text="Enquiries with customer details will aggregate here." />
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Customer Name</th>
                        <th>Email</th>
                        <th>Total Enquiries</th>
                        <th>Quotes Generated</th>
                        <th>Quoted Total</th>
                        <th>Latest Status</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {customerList.map((c, idx) => (
                        <tr key={idx}>
                          <td>
                            <strong>{c.customer_name}</strong>
                          </td>
                          <td>{c.customer_email || '—'}</td>
                          <td>{c.leads.length} lead(s)</td>
                          <td>{c.quoteCount} quote(s)</td>
                          <td>
                            <strong>{money(c.quoteTotal)}</strong>
                          </td>
                          <td>
                            <StatusBadge value={c.leads[0]?.status || 'new'} />
                          </td>
                          <td>
                            <button
                              className="button button-light"
                              style={{ padding: '6px 10px', fontSize: 10 }}
                              onClick={() => void openLead(c.leads[0])}
                            >
                              View Latest Lead
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          {/* 7. AI ACTIVITY & USAGE */}
          {active === 'AI Activity & Usage' && (
            <section className="panel full-list-panel">
              <div className="list-toolbar">
                <div>
                  <h2>AI Activity, Telemetry &amp; Budget Guardrails</h2>
                  <p>Provider token accounting and tenant-configured AI budget enforcement.</p>
                </div>
                <button className="button button-secondary" onClick={() => void load()}>
                  <RefreshCw size={15} className={loading ? 'spin' : ''} /> Refresh Telemetry
                </button>
              </div>

              <div className="stat-grid" style={{ marginBottom: 20 }}>
                <StatCard
                  label="Monthly AI Spend"
                  value={fmtUsd(monthlySpend, 6)}
                  change="Measured token costs"
                  icon={<BadgePoundSterling size={18} />}
                  tone="amber"
                  footer={tenantBudget == null ? 'No budget cap configured' : `${fmtUsd(tenantBudget)} tenant budget cap`}
                />
                <StatCard
                  label="Monthly Tenant Budget"
                  value={tenantBudget == null ? 'Not configured' : fmtUsd(tenantBudget)}
                  change="Enforced before qualification"
                  icon={<ShieldCheck size={18} />}
                  tone="blue"
                  footer={tenantBudget == null ? 'No spend limit is active' : 'HTTP 429 when exhausted'}
                />
                <StatCard
                  label="Remaining Allowance"
                  value={remainingBudget == null ? '—' : fmtUsd(remainingBudget, 6)}
                  change={remainingBudget == null ? 'No configured budget' : 'Real-time balance'}
                  icon={<Gauge size={18} />}
                  tone="green"
                  footer={remainingBudget == null ? 'Unlimited by spend budget' : 'Available for Gemini calls'}
                />
                <StatCard
                  label="Active Model Identifier"
                  value={health?.model_configured ? health.model_name : 'Deterministic fallback'}
                  change="Configured provider model"
                  icon={<Bot size={18} />}
                  tone="violet"
                  footer="Google GenAI SDK"
                />
              </div>

              <div className="panel" style={{ padding: 16, marginBottom: 20, border: '1px solid #e2e8f0' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, fontWeight: 600 }}>
                  <span>Monthly Budget Consumption</span>
                  <span>
                    {tenantBudget == null ? 'No budget configured' : `${budgetUsage}% used (${fmtUsd(tenantBudget)} cap)`}
                  </span>
                </div>
                <div className="budget-meter">
                  <div
                    className={`budget-meter-fill ${
                      budgetUsage > 80 ? 'danger' : budgetUsage > 50 ? 'warning' : ''
                    }`}
                    style={{ width: `${budgetUsage}%` }}
                  />
                </div>
              </div>

              <div className="security-note">
                <ShieldCheck size={20} />
                <div>
                  <strong>Model Transparency Policy</strong>
                  <p>
                    The configured model is {health?.model_configured ? health.model_name : 'not configured'}. Successful model
                    token usage is recorded; provider failures use a clearly labelled deterministic fallback and are never
                    represented as Gemini output.
                  </p>
                </div>
              </div>

              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Timestamp</th>
                      <th>Job ID</th>
                      <th>Lead ID</th>
                      <th>Model Executed</th>
                      <th>Input Tokens</th>
                      <th>Output Tokens</th>
                      <th>Thinking Tokens</th>
                      <th>Estimated Cost (USD)</th>
                      <th>Verifier Used</th>
                      <th>Duration</th>
                    </tr>
                  </thead>
                  <tbody>
                    {usage?.records && usage.records.length > 0 ? (
                      usage.records.map((rec, i) => (
                        <tr key={i}>
                          <td>{fmtDate(rec.timestamp)}</td>
                          <td>
                            <code>{rec.job_id}</code>
                          </td>
                          <td>
                            <code>{rec.lead_id}</code>
                          </td>
                          <td>
                            {rec.model === 'deterministic_fallback' ? (
                              <span className="status status-amber">
                                <i /> Fallback (Rule-Based)
                              </span>
                            ) : (
                              <span className="status status-green">
                                <i /> {rec.model}
                              </span>
                            )}
                          </td>
                          <td>{rec.input_tokens ?? '—'}</td>
                          <td>{rec.output_tokens ?? '—'}</td>
                          <td>{rec.thinking_tokens ?? '0'}</td>
                          <td>
                            <strong>
                              {rec.estimated_cost_usd != null ? `$${rec.estimated_cost_usd.toFixed(6)}` : '—'}
                            </strong>
                          </td>
                          <td>{rec.verifier_used ? 'Yes' : 'No'}</td>
                          <td>
                            {rec.timing_ms?.total_duration_ms != null ? (
                              <span style={{ fontSize: 12, fontWeight: 500, color: '#334155' }}>
                                {rec.timing_ms.total_duration_ms} ms
                              </span>
                            ) : (
                              '—'
                            )}
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={10} style={{ textAlign: 'center', padding: 24, color: '#94a3b8' }}>
                          No usage records recorded yet this month.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* 8. AUDIT LOGS */}
          {active === 'Audit Logs' && (
            <section className="panel full-list-panel">
              <div className="list-toolbar">
                <div>
                  <h2>Immutable Audit Trail</h2>
                  <p>Append-only audit event log with cryptographic SHA-256 hashes for tenant: {getTenantId()}.</p>
                </div>
                <button className="button button-secondary" onClick={() => void load()}>
                  <RefreshCw size={15} className={loading ? 'spin' : ''} /> Refresh Events
                </button>
              </div>

              <div className="filter-bar">
                <div className="table-search">
                  <Search size={15} />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search by entity ID, actor, action, result..."
                  />
                </div>

                <select
                  className="select-input"
                  value={actionFilter}
                  onChange={(e) => setActionFilter(e.target.value)}
                >
                  <option value="all">All Actions ({events.length})</option>
                  <option value="lead.created">lead.created</option>
                  <option value="qualification.queued">qualification.queued</option>
                  <option value="lead.qualification_completed">lead.qualification_completed</option>
                  <option value="quote.drafted">quote.drafted</option>
                  <option value="quote.approved">quote.approved</option>
                  <option value="quote.send_authorized_sandbox">quote.send_authorized_sandbox</option>
                  <option value="tenant.settings_updated">tenant.settings_updated</option>
                  <option value="billing.plan_draft_created">billing.plan_draft_created</option>
                  <option value="billing.plan_published">billing.plan_published</option>
                </select>
              </div>

              {filteredEvents.length === 0 ? (
                <Empty title="No events match criteria" text="Workflow transitions emit audit events automatically." />
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Timestamp</th>
                        <th>Action</th>
                        <th>Entity ID</th>
                        <th>Actor ID</th>
                        <th>Policy Version</th>
                        <th>Result</th>
                        <th>SHA-256 Hash</th>
                        <th>Inspect</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredEvents.map((ev) => (
                        <tr key={ev.event_id}>
                          <td>{fmtDate(ev.timestamp)}</td>
                          <td>
                            <strong style={{ color: '#334155' }}>{ev.action}</strong>
                          </td>
                          <td>
                            <code>{ev.entity_id}</code>
                          </td>
                          <td>{ev.actor_id}</td>
                          <td>
                            <span className="badge-code">{ev.policy_version}</span>
                          </td>
                          <td>
                            <span
                              className={`status ${
                                ev.result === 'success'
                                  ? 'status-green'
                                  : ev.result === 'sandbox_only'
                                  ? 'status-blue'
                                  : 'status-red'
                              }`}
                            >
                              <i /> {ev.result}
                            </span>
                          </td>
                          <td style={{ fontFamily: 'monospace', fontSize: 9 }}>
                            {ev.content_hash?.slice(0, 12)}...
                          </td>
                          <td>
                            <button
                              className="button button-light"
                              style={{ padding: '4px 8px', fontSize: 9 }}
                              onClick={() => setEventDetail(ev)}
                            >
                              Inspect
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          {/* 9. CATALOGUE */}
          {active === 'Catalogue' && (
            <section className="panel full-list-panel">
              <div className="list-toolbar">
                <div>
                  <h2>Service Catalogue &amp; Subscription Tariffs</h2>
                  <p>Tenant-owned price schedule and two-person platform billing tariffs.</p>
                </div>
                <button
                  className="button button-secondary"
                  onClick={() => {
                    setDraftSettings(JSON.parse(JSON.stringify(settings)));
                    setEditingSettings(true);
                  }}
                >
                  <Settings2 size={15} /> Edit Catalogue
                </button>
              </div>

              <div className="pricing-intro">
                <div>
                  <span className="eyebrow">ACTIVE TENANT CATALOGUE</span>
                  <h3>{settings?.catalogue_version || 'catalogue-v1'}</h3>
                  <p>Policy Version: {settings?.policy_version || 'policy-v1.0.0'}</p>
                </div>
                <div className="vat-box">
                  <span>Standard VAT Rate</span>
                  <strong>{Math.round((settings?.vat_rate ?? 0.2) * 100)}%</strong>
                  <small>Deterministic UK Tax Basis</small>
                </div>
              </div>

              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Service Code</th>
                      <th>Customer-Facing Service</th>
                      <th>Unit Price (GBP)</th>
                      <th>Eligibility</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(settings?.service_catalogue || {}).map(([key, val]) => (
                      <tr key={key}>
                        <td>
                          <code>{key}</code>
                        </td>
                        <td>
                          <strong>{val.label}</strong>
                        </td>
                        <td>
                          <strong>{money(val.unit_price)}</strong>
                        </td>
                        <td>
                          <span className={`status ${val.eligible ? 'status-green' : 'status-red'}`}>
                            <i />
                            {val.eligible ? 'Eligible' : 'Excluded'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="subscription-heading">
                <div>
                  <h3>Platform Subscription Tariffs</h3>
                  <p>Two-person approval and future-dated publication for enterprise billing plans.</p>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="button button-secondary" onClick={() => setShowContractModal(true)}>
                    <Plus size={15} /> Import Contract
                  </button>
                  <button className="button button-primary" onClick={() => setShowPlanModal(true)}>
                    <Plus size={15} /> New Tariff Draft
                  </button>
                </div>
              </div>

              <div className="subscription-plan-grid">
                {plans.length === 0 ? (
                  <div className="no-plans">
                    <strong>No subscription tariffs configured</strong>
                    <p>Create a draft tariff, preview affected contracts, and publish it with a separate reviewer.</p>
                  </div>
                ) : (
                  plans.map((plan) => (
                    <div className="subscription-plan" key={`${plan.plan_id}-${plan.plan_version}`}>
                      <div className="plan-status-line">
                        <span className="plan-id">
                          {plan.plan_id} · {plan.plan_version}
                        </span>
                        <StatusBadge value={plan.status} />
                      </div>
                      <h4>{plan.name}</h4>
                      <div className="subscription-prices">
                        <div>
                          <small>Setup Fee</small>
                          <strong>{plan.setup_fee == null ? 'Quoted' : money(plan.setup_fee)}</strong>
                        </div>
                        <div>
                          <small>Monthly</small>
                          <strong>{plan.recurring_fee == null ? 'Quoted' : money(plan.recurring_fee)}</strong>
                        </div>
                      </div>
                      <p>
                        {plan.metered_limits?.monthly_leads ?? '—'} leads / mo · {plan.overage_policy?.replaceAll('_', ' ')}
                      </p>
                      {plan.status === 'draft' ? (
                        <button
                          className="button button-primary full-button"
                          disabled={busy}
                          onClick={() => void openPublishPreview(plan)}
                        >
                          <ShieldCheck size={14} /> Preview &amp; Publish
                        </button>
                      ) : (
                        <span className="published-note">
                          <CheckCircle2 size={13} /> Published · {plan.approved_by || 'approved'}
                        </span>
                      )}
                    </div>
                  ))
                )}
              </div>

              {contracts.length > 0 && (
                <div style={{ marginTop: 24 }}>
                  <h4 style={{ fontSize: 13, marginBottom: 10, color: '#334155' }}>
                    Active Customer Contracts ({contracts.length})
                  </h4>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Contract ID</th>
                          <th>Customer Ref</th>
                          <th>Plan &amp; Version</th>
                          <th>Recurring Fee</th>
                          <th>Started At</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {contracts.map((c) => (
                          <tr key={c.contract_id}>
                            <td>
                              <code>{c.contract_id}</code>
                            </td>
                            <td>
                              <strong>{c.customer_ref}</strong>
                            </td>
                            <td>
                              {c.plan_id} · {c.plan_version}
                            </td>
                            <td>{money(c.recurring_fee)}</td>
                            <td>{fmtDate(c.started_at)}</td>
                            <td>
                              <span className="status status-green">
                                <i /> {c.status}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </section>
          )}

          {/* 10. SETTINGS */}
          {active === 'Settings' && (
            <section className="panel full-list-panel">
              <div className="list-toolbar">
                <div>
                  <h2>Tenant Workspace &amp; Governance Settings</h2>
                  <p>Configuration rules, budget limits, VAT treatment, and operational posture.</p>
                </div>
                <button
                  className="button button-primary"
                  onClick={() => {
                    setDraftSettings(JSON.parse(JSON.stringify(settings)));
                    setEditingSettings(true);
                  }}
                >
                  <Settings2 size={15} /> Edit Configuration
                </button>
              </div>

              <div className="settings-grid">
                <Setting
                  label="Tenant Workspace"
                  value={settings?.display_name || 'Northstar Facilities'}
                  detail={`Active Tenant ID: ${settings?.tenant_id || getTenantId()}`}
                />
                <Setting
                  label="AI Monthly Budget Guardrail"
                  value={`$${(settings?.ai_monthly_budget_usd ?? 1.0).toFixed(2)} USD`}
                  detail="Strict budget limit. Triggers HTTP 429 and preserves lead capture when reached."
                />
                <Setting
                  label="Standard VAT Rate"
                  value={`${Math.round((settings?.vat_rate ?? 0.2) * 100)}%`}
                  detail={`Policy Version: ${settings?.policy_version || 'policy-v1.0.0'}`}
                />
                <Setting
                  label="Service Territories"
                  value={(settings?.territories || []).join(', ') || 'Manchester, Salford, Stockport'}
                  detail="Leads outside these areas are flagged for out-of-territory policy rules."
                />
                <Setting
                  label="AI Model &amp; Rates"
                  value={health?.model_configured ? health.model_name : 'Deterministic fallback'}
                  detail="Token cost rates are applied by the backend when provider usage data is available."
                />
                <Setting
                  label="Outbound Messaging"
                  value="Sandbox Recording Only"
                  detail="No live emails or WhatsApp messages are sent by this local environment."
                />
              </div>

              <div style={{ marginTop: 20 }}>
                <h3 style={{ fontSize: 13, marginBottom: 8, color: '#334155' }}>
                  Tenant Role Permissions Matrix
                </h3>
                <pre className="code-box">
                  {JSON.stringify(settings?.role_permissions || {}, null, 2)}
                </pre>
              </div>
            </section>
          )}

          {/* 11. HELP */}
          {active === 'Help' && (
            <section className="panel full-list-panel">
              <h2>Help, Architecture &amp; Verification Guide</h2>
              <p className="welcome-copy">
                The Lead-to-Order Agent is a full-stack, local-first B2B operational system built with FastAPI, React,
                and Google Gemini AI.
              </p>

              <div className="security-note">
                <Headphones size={20} />
                <div>
                  <strong>Key Architectural Safeguards</strong>
                  <p>
                    1. <strong>AI Never Quotes:</strong> Gemini performs structured classification and entity extraction. Pricing is computed strictly from the tenant catalogue.
                    <br />
                    2. <strong>Human-in-the-Loop Approvals:</strong> Quotes must be approved by an authorized reviewer with generation compare-and-swap checks.
                    <br />
                    3. <strong>Budget Invariant:</strong>{' '}
                    {tenantBudget == null
                      ? 'No tenant AI spend budget is configured.'
                      : `The ${fmtUsd(tenantBudget)} tenant AI spend budget is checked before qualification.`}
                  </p>
                </div>
              </div>

              <div style={{ marginTop: 20 }}>
                <h3 style={{ fontSize: 13, marginBottom: 10, color: '#334155' }}>Useful API Endpoints</h3>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Endpoint</th>
                        <th>Method</th>
                        <th>Description</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td><code>/healthz</code></td>
                        <td>GET</td>
                        <td>Health and configuration status</td>
                      </tr>
                      <tr>
                        <td><code>/docs</code></td>
                        <td>GET</td>
                        <td>Interactive FastAPI Swagger UI</td>
                      </tr>
                      <tr>
                        <td><code>/v1/leads</code></td>
                        <td>GET / POST</td>
                        <td>List and capture new enquiries</td>
                      </tr>
                      <tr>
                        <td><code>/v1/leads/{'{id}'}/qualify</code></td>
                        <td>POST</td>
                        <td>Trigger asynchronous qualification job</td>
                      </tr>
                      <tr>
                        <td><code>/v1/quotes</code></td>
                        <td>GET</td>
                        <td>List tenant quotations</td>
                      </tr>
                      <tr>
                        <td><code>/v1/usage</code></td>
                        <td>GET</td>
                        <td>AI execution telemetry &amp; spend metrics</td>
                      </tr>
                      <tr>
                        <td><code>/v1/events</code></td>
                        <td>GET</td>
                        <td>Immutable audit event ledger</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          )}
          </>
          )}
        </div>
      </main>

      {/* NEW LEAD MODAL */}
      {showNew && (
        <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setShowNew(false); }}>
          <div className="modal">
            <div className="modal-header">
              <div>
                <span className="eyebrow">NEW ENQUIRY</span>
                <h2>Capture a Customer Lead</h2>
                <p>Submit enquiry text. AI suggestions will run asynchronously with human review.</p>
              </div>
              <button className="icon-button" onClick={() => setShowNew(false)}>
                <X size={17} />
              </button>
            </div>

            <label className="field-label">
              Customer Name <span>Optional</span>
            </label>
            <input
              className="field-input"
              value={customer}
              onChange={(e) => setCustomer(e.target.value)}
              placeholder="e.g. Alex Morgan"
            />

            <label className="field-label">
              Customer Email <span>Optional</span>
            </label>
            <input
              className="field-input"
              type="email"
              value={customerEmail}
              onChange={(e) => setCustomerEmail(e.target.value)}
              placeholder="e.g. alex@example.com"
            />

            <label className="field-label">Capture Channel</label>
            <select
              className="field-input"
              value={leadChannel}
              onChange={(e) => setLeadChannel(e.target.value as any)}
            >
              <option value="website">Website Contact Form</option>
              <option value="whatsapp">WhatsApp (Channel Gated)</option>
            </select>

            <label className="field-label">Enquiry Message *</label>
            <textarea
              className="field-textarea"
              rows={5}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Describe the requested service, equipment count, location, and preferred timing..."
            />

            <label className="consent-row">
              <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
              <span>Lawful consent has been confirmed for processing this customer enquiry.</span>
            </label>

            <div className="modal-actions">
              <button className="button button-secondary" onClick={() => setShowNew(false)}>
                Cancel
              </button>
              <button className="button button-primary" disabled={busy} onClick={() => void createLead()}>
                {busy ? <RefreshCw size={15} className="spin" /> : <WandSparkles size={16} />} Capture &amp; Qualify
              </button>
            </div>
          </div>
        </div>
      )}

      {/* LEAD DETAIL MODAL */}
      {detail && (
        <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setDetail(null); }}>
          <div className="modal detail-modal">
            <div className="modal-header">
              <div>
                <span className="eyebrow">LEAD DETAILS &amp; QUALIFICATION</span>
                <h2>{detail.customer_name || 'Customer Enquiry'}</h2>
                <p>
                  {detail.id} · received {fmtDate(detail.created_at)}
                </p>
              </div>
              <button className="icon-button" onClick={() => setDetail(null)}>
                <X size={17} />
              </button>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <StatusBadge value={detail.status} />
              <span className="badge-code">Channel: {detail.channel}</span>
              {detail.customer_email && <span className="badge-code">{detail.customer_email}</span>}
            </div>

            <div className="detail-message">“{detail.message}”</div>

            {detail.status === 'qualification_queued' || detail.status === 'running' ? (
              <div className="info-banner" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <RefreshCw size={16} className="spin" />
                <p>Qualification is currently queued / running in the background.</p>
              </div>
            ) : detail.qualification ? (
              <>
                {/* Transparent AI Model Banner */}
                {detail.qualification.model_used === 'deterministic_fallback' ? (
                  <div
                    style={{
                      background: '#fffbeb',
                      border: '1px solid #fde68a',
                      borderRadius: 8,
                      padding: '12px 14px',
                      margin: '14px 0',
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 10,
                      color: '#92400e',
                      fontSize: 13,
                    }}
                  >
                    <CircleAlert size={18} style={{ color: '#d97706', marginTop: 2, flexShrink: 0 }} />
                    <div>
                      <strong>Deterministic Rule-Based Fallback — This is NOT a Gemini AI model result.</strong>
                      <p style={{ margin: '4px 0 0', fontSize: 11, color: '#b45309' }}>
                        The Gemini API was unavailable or exceeded its quota limit. Extracted locally using heuristic rules.
                      </p>
                    </div>
                  </div>
                ) : (
                  <div
                    style={{
                      background: '#f0fdf4',
                      border: '1px solid #bbf7d0',
                      borderRadius: 8,
                      padding: '12px 14px',
                      margin: '14px 0',
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 10,
                      color: '#166534',
                      fontSize: 13,
                    }}
                  >
                    <CheckCircle2 size={18} style={{ color: '#16a34a', marginTop: 2, flexShrink: 0 }} />
                    <div>
                      <strong>Gemini structured extraction: <code>{detail.qualification.model_used}</code></strong>
                      <div style={{ marginTop: 4, fontSize: 11, color: '#15803d' }}>
                        Input Tokens: {detail.qualification.input_tokens ?? '—'} · Output Tokens: {detail.qualification.output_tokens ?? '—'}
                        {detail.qualification.thinking_tokens ? ` (${detail.qualification.thinking_tokens} thinking)` : ''}
                        {detail.qualification.estimated_cost_usd != null &&
                          ` · Est. Cost: $${detail.qualification.estimated_cost_usd.toFixed(6)}`}
                      </div>
                    </div>
                  </div>
                )}

                <div className="detail-grid">
                  {[
                    ['Service Type', detail.qualification.service_type || 'Not identified'],
                    ['Location', detail.qualification.location || 'Not identified'],
                    ['Quantity', detail.qualification.quantity ?? 'Not identified'],
                    ['Area', detail.qualification.area || 'Not identified'],
                    ['Frequency', detail.qualification.frequency || 'Not identified'],
                    ['Requested time', detail.qualification.requested_time || 'Not identified'],
                    ['Confidence', `${Math.round(detail.qualification.confidence * 100)}%`],
                    ['Extraction Method', detail.qualification.model_used === 'deterministic_fallback' ? 'Heuristic Rule Fallback' : detail.qualification.model_used],
                    ['Verifier Ran', detail.qualification.verifier_used ? 'Yes' : 'Not required'],
                  ].map(([k, v]) => (
                    <div className="detail-fact" key={k}>
                      <span>{k}</span>
                      <strong>{v}</strong>
                    </div>
                  ))}
                </div>

                <section
                  aria-label="Human qualification review"
                  style={{
                    marginTop: 16,
                    padding: 14,
                    border: '1px solid #dbe3ee',
                    borderRadius: 10,
                    background: '#fbfdff',
                  }}
                >
                  <div style={{ marginBottom: 12 }}>
                    <strong>Human review</strong>
                    <p style={{ margin: '4px 0 0', color: '#64748b', fontSize: 12 }}>
                      AI suggestions remain unchanged. Saved edits are attributed to the reviewer and must pass deterministic policy evaluation.
                    </p>
                    {detail.reviewed_by && (
                      <p style={{ margin: '6px 0 0', color: '#475569', fontSize: 12 }}>
                        Reviewed by {detail.reviewed_by} at {fmtDate(detail.reviewed_at)}.
                        {detail.reviewed_fields.length > 0
                          ? ` Corrected: ${detail.reviewed_fields.join(', ')}.`
                          : ' No AI values changed.'}
                      </p>
                    )}
                  </div>
                  <div className="detail-grid">
                    <label className="detail-fact">
                      <span>Service · AI suggested {detail.qualification.service_type || 'none'}</span>
                      <select
                        className="select-input"
                        value={reviewDraft.service_type}
                        onChange={(e) => setReviewDraft({ ...reviewDraft, service_type: e.target.value })}
                      >
                        <option value="">Not provided</option>
                        {reviewDraft.service_type &&
                          !settings?.service_catalogue?.[reviewDraft.service_type] && (
                            <option value={reviewDraft.service_type}>{reviewDraft.service_type} (not in catalogue)</option>
                          )}
                        {Object.entries(settings?.service_catalogue || {}).map(([code, service]) => (
                          <option key={code} value={code}>{service.label} ({code})</option>
                        ))}
                      </select>
                    </label>
                    <label className="detail-fact">
                      <span>Location · AI suggested {detail.qualification.location || 'none'}</span>
                      <input
                        style={reviewInputStyle}
                        value={reviewDraft.location}
                        onChange={(e) => setReviewDraft({ ...reviewDraft, location: e.target.value })}
                      />
                    </label>
                    <label className="detail-fact">
                      <span>Quantity · AI suggested {detail.qualification.quantity ?? 'none'}</span>
                      <input
                        style={reviewInputStyle}
                        type="number"
                        min="1"
                        max="10000"
                        step="1"
                        value={reviewDraft.quantity}
                        onChange={(e) => setReviewDraft({ ...reviewDraft, quantity: e.target.value })}
                      />
                    </label>
                    <label className="detail-fact">
                      <span>Area · AI suggested {detail.qualification.area || 'none'}</span>
                      <input
                        style={reviewInputStyle}
                        value={reviewDraft.area}
                        onChange={(e) => setReviewDraft({ ...reviewDraft, area: e.target.value })}
                      />
                    </label>
                    <label className="detail-fact">
                      <span>Frequency · AI suggested {detail.qualification.frequency || 'none'}</span>
                      <input
                        style={reviewInputStyle}
                        value={reviewDraft.frequency}
                        onChange={(e) => setReviewDraft({ ...reviewDraft, frequency: e.target.value })}
                      />
                    </label>
                    <label className="detail-fact">
                      <span>Requested time · AI suggested {detail.qualification.requested_time || 'none'}</span>
                      <input
                        style={reviewInputStyle}
                        value={reviewDraft.requested_time}
                        onChange={(e) => setReviewDraft({ ...reviewDraft, requested_time: e.target.value })}
                      />
                    </label>
                  </div>
                  {detail.policy_eligible !== null && detail.policy_eligible !== undefined && (
                    <div className={detail.policy_eligible ? 'info-banner' : 'warning-banner'} style={{ marginTop: 12 }}>
                      <p>
                        {detail.policy_eligible
                          ? 'Deterministic policy passed; quote eligibility is confirmed.'
                          : `Policy blocked this lead: ${detail.policy_reasons.join(', ')}`}
                      </p>
                    </div>
                  )}
                  {detail.reviewed_qualification && detail.policy_eligible == null && (
                    <p style={{ margin: '10px 0 0', color: '#92400e', fontSize: 12 }}>
                      Corrections are saved but have not yet been evaluated for quote eligibility.
                    </p>
                  )}
                </section>

                {detail.qualification.missing_fields.length > 0 && (
                  <div className="info-banner">
                    <Info size={16} />
                    <p>Missing required fields: {detail.qualification.missing_fields.join(', ')}</p>
                  </div>
                )}

                {(detail.qualification.safety_flags.length > 0 || detail.qualification.injection_detected) && (
                  <div className="warning-banner">
                    <ShieldAlert size={16} />
                    <p>
                      <strong>Safety review required:</strong> {detail.qualification.safety_flags.join(', ') || 'Possible prompt injection flagged'}.
                    </p>
                  </div>
                )}

                {detail.qualification.timing_ms && Object.keys(detail.qualification.timing_ms).length > 0 && (
                  <div style={{ marginTop: 14, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '12px 14px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 8 }}>
                      <Zap size={14} style={{ color: '#0284c7' }} />
                      Execution Performance Timing
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, fontSize: 12, color: '#64748b' }}>
                      {detail.qualification.timing_ms.total_duration_ms != null && (
                        <span>Total: <strong style={{ color: '#0f172a' }}>{detail.qualification.timing_ms.total_duration_ms} ms</strong></span>
                      )}
                      {detail.qualification.timing_ms.gemini_api_request_ms != null && (
                        <span>Gemini HTTP: <strong style={{ color: '#0f172a' }}>{(
                          detail.qualification.timing_ms.gemini_api_request_ms +
                          (detail.qualification.timing_ms.verifier_api_request_ms || 0)
                        ).toFixed(2)} ms</strong></span>
                      )}
                      {detail.qualification.timing_ms.request_preparation_ms != null && (
                        <span>Request prep: <strong style={{ color: '#0f172a' }}>{detail.qualification.timing_ms.request_preparation_ms.toFixed(2)} ms</strong></span>
                      )}
                      {detail.qualification.timing_ms.gemini_attempt_count != null && (
                        <span>Attempts: <strong style={{ color: '#0f172a' }}>{(
                          detail.qualification.timing_ms.gemini_attempt_count +
                          (detail.qualification.timing_ms.verifier_attempt_count || 0)
                        )}</strong></span>
                      )}
                      {detail.qualification.timing_ms.gemini_retry_count != null && (
                        <span>Retries: <strong style={{ color: '#0f172a' }}>{(
                          detail.qualification.timing_ms.gemini_retry_count +
                          (detail.qualification.timing_ms.verifier_retry_count || 0)
                        )}</strong> ({(
                          detail.qualification.timing_ms.gemini_retry_delay_ms +
                          (detail.qualification.timing_ms.verifier_retry_delay_ms || 0)
                        ).toFixed(2)} ms)</span>
                      )}
                      {detail.qualification.timing_ms.gemini_response_parse_ms != null && (
                        <span>Response parse: <strong style={{ color: '#0f172a' }}>{(
                          detail.qualification.timing_ms.gemini_response_parse_ms +
                          (detail.qualification.timing_ms.verifier_response_parse_ms || 0)
                        ).toFixed(2)} ms</strong></span>
                      )}
                      {detail.qualification.timing_ms.pydantic_validation_ms != null && (
                        <span>Validation: <strong style={{ color: '#0f172a' }}>{(
                          detail.qualification.timing_ms.pydantic_validation_ms +
                          (detail.qualification.timing_ms.verifier_validation_ms || 0)
                        ).toFixed(2)} ms</strong></span>
                      )}
                      {detail.qualification.timing_ms.policy_evaluation_ms != null && (
                        <span>Policy: <strong style={{ color: '#0f172a' }}>{detail.qualification.timing_ms.policy_evaluation_ms.toFixed(2)} ms</strong></span>
                      )}
                      {detail.qualification.timing_ms.verifier_duration_ms != null && (
                        <span>Verifier: <strong style={{ color: '#0f172a' }}>{detail.qualification.timing_ms.verifier_duration_ms} ms</strong></span>
                      )}
                      {detail.qualification.timing_ms.fallback_duration_ms != null && (
                        <span>Fallback: <strong style={{ color: '#0f172a' }}>{detail.qualification.timing_ms.fallback_duration_ms} ms</strong></span>
                      )}
                      {detail.qualification.timing_ms.storage_duration_ms != null && (
                        <span>Storage: <strong style={{ color: '#0f172a' }}>{detail.qualification.timing_ms.storage_duration_ms} ms</strong></span>
                      )}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <p className="welcome-copy" style={{ margin: '14px 0' }}>
                Qualification has not been executed for this lead yet.
              </p>
            )}

            <div className="modal-actions">
              <button className="button button-secondary" onClick={() => setDetail(null)}>
                Close
              </button>
              {['new', 'needs_information', 'escalated', 'qualification_queued'].includes(detail.status) && (
                <button
                  className="button button-secondary"
                  disabled={busy || detail.status === 'qualification_queued'}
                  onClick={() => void qualify(detail)}
                >
                  <RefreshCw size={15} className={busy ? 'spin' : ''} /> Re-run Qualification
                </button>
              )}
              {detail.qualification && !detail.quote_ids.length && (
                <>
                  <button
                    className="button button-secondary"
                    disabled={busy}
                    onClick={() => void saveReview()}
                  >
                    Save corrections
                  </button>
                  {detail.reviewed_qualification && (
                    <button
                      className="button button-secondary"
                      disabled={busy}
                      onClick={() => void evaluatePolicy()}
                    >
                      Evaluate policy
                    </button>
                  )}
                </>
              )}
              {detail.status === 'qualified' && (
                <button
                  className="button button-primary"
                  disabled={busy}
                  onClick={() => void createQuote(detail)}
                >
                  <FileCheck2 size={15} /> Draft Quotation
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* QUOTE DETAIL MODAL */}
      {quoteDetail && (
        <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setQuoteDetail(null); }}>
          <div className="modal detail-modal">
            <div className="modal-header">
              <div>
                <span className="eyebrow">QUOTE SPECIFICATION</span>
                <h2>Quote {quoteDetail.id}</h2>
                <p>
                  Lead: {quoteDetail.lead_id} · Catalogue: {quoteDetail.catalogue_version} · Policy: {quoteDetail.policy_version}
                </p>
              </div>
              <button className="icon-button" onClick={() => setQuoteDetail(null)}>
                <X size={17} />
              </button>
            </div>

            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12 }}>
              <StatusBadge value={quoteDetail.status} />
              <span className="badge-code">Generation: #{quoteDetail.generation}</span>
              {quoteDetail.approved_by && (
                <span className="badge-code">Approved by: {quoteDetail.approved_by}</span>
              )}
            </div>

            <table className="quote-item-table">
              <thead>
                <tr>
                  <th>Service Code</th>
                  <th>Description</th>
                  <th>Quantity</th>
                  <th>Unit Price</th>
                  <th>Line Total</th>
                </tr>
              </thead>
              <tbody>
                {quoteDetail.line_items.map((item, idx) => (
                  <tr key={idx}>
                    <td>
                      <code>{item.service_code}</code>
                    </td>
                    <td>{item.description}</td>
                    <td>{item.quantity}</td>
                    <td>{money(item.unit_price)}</td>
                    <td>
                      <strong>{money(item.quantity * item.unit_price)}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="quote-summary-box">
              <div className="quote-summary-row">
                <span>Subtotal (Net)</span>
                <span>{money(quoteDetail.subtotal)}</span>
              </div>
              <div className="quote-summary-row">
                <span>VAT ({Math.round(quoteDetail.vat_rate * 100)}%)</span>
                <span>{money(quoteDetail.vat_amount)}</span>
              </div>
              <div className="quote-summary-row total">
                <span>Total Amount Due</span>
                <span>{money(quoteDetail.total)} GBP</span>
              </div>
            </div>

            <div className="modal-actions">
              <button className="button button-secondary" onClick={() => setQuoteDetail(null)}>
                Close
              </button>
              {quoteDetail.status === 'draft' && (
                <button
                  className="button button-primary"
                  disabled={busy}
                  onClick={() => void approveQuote(quoteDetail)}
                >
                  <Check size={14} /> Approve Quote
                </button>
              )}
              {quoteDetail.status === 'approved' && (
                <button
                  className="button button-secondary"
                  disabled={busy}
                  onClick={() => void sendQuote(quoteDetail)}
                >
                  <Send size={14} /> Record Sandbox Send
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* EVENT INSPECT MODAL */}
      {eventDetail && (
        <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setEventDetail(null); }}>
          <div className="modal detail-modal">
            <div className="modal-header">
              <div>
                <span className="eyebrow">AUDIT RECORD INSPECTION</span>
                <h2>Event {eventDetail.event_id}</h2>
                <p>Action: {eventDetail.action} · Actor: {eventDetail.actor_id}</p>
              </div>
              <button className="icon-button" onClick={() => setEventDetail(null)}>
                <X size={17} />
              </button>
            </div>

            <div className="detail-grid" style={{ marginBottom: 14 }}>
              <div className="detail-fact">
                <span>Timestamp</span>
                <strong>{fmtDate(eventDetail.timestamp)}</strong>
              </div>
              <div className="detail-fact">
                <span>Entity ID</span>
                <strong>{eventDetail.entity_id}</strong>
              </div>
              <div className="detail-fact">
                <span>Policy Version</span>
                <strong>{eventDetail.policy_version}</strong>
              </div>
            </div>

            <label className="field-label">Cryptographic Content Hash (SHA-256)</label>
            <input className="field-input" readOnly value={eventDetail.content_hash} />

            <label className="field-label">Raw Event Record</label>
            <pre className="code-box">{JSON.stringify(eventDetail, null, 2)}</pre>

            <div className="modal-actions">
              <button className="button button-secondary" onClick={() => setEventDetail(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CREATE TARIFF DRAFT MODAL */}
      {showPlanModal && (
        <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setShowPlanModal(false); }}>
          <div className="modal">
            <div className="modal-header">
              <div>
                <span className="eyebrow">BILLING GOVERNANCE</span>
                <h2>Draft Subscription Tariff</h2>
                <p>Drafts are inactive until approved by a second reviewer.</p>
              </div>
              <button className="icon-button" onClick={() => setShowPlanModal(false)}>
                <X size={17} />
              </button>
            </div>

            <div className="plan-form-grid">
              <div>
                <label className="field-label">Plan ID</label>
                <input
                  className="field-input"
                  value={planDraft.plan_id}
                  onChange={(e) => setPlanDraft({ ...planDraft, plan_id: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') })}
                />
              </div>
              <div>
                <label className="field-label">Version</label>
                <input
                  className="field-input"
                  value={planDraft.plan_version}
                  onChange={(e) => setPlanDraft({ ...planDraft, plan_version: e.target.value })}
                />
              </div>
            </div>

            <label className="field-label">Display Name</label>
            <input
              className="field-input"
              value={planDraft.name}
              onChange={(e) => setPlanDraft({ ...planDraft, name: e.target.value })}
            />

            <div className="plan-form-grid">
              <div>
                <label className="field-label">Setup Fee (£)</label>
                <input
                  className="field-input"
                  type="number"
                  min="0"
                  value={planDraft.setup_fee ?? ''}
                  onChange={(e) => setPlanDraft({ ...planDraft, setup_fee: Number(e.target.value) })}
                />
              </div>
              <div>
                <label className="field-label">Monthly Fee (£)</label>
                <input
                  className="field-input"
                  type="number"
                  min="0"
                  value={planDraft.recurring_fee ?? ''}
                  onChange={(e) => setPlanDraft({ ...planDraft, recurring_fee: Number(e.target.value) })}
                />
              </div>
            </div>

            <div className="modal-actions">
              <button className="button button-secondary" onClick={() => setShowPlanModal(false)}>
                Cancel
              </button>
              <button className="button button-primary" disabled={busy} onClick={() => void createPlan()}>
                Save Tariff Draft
              </button>
            </div>
          </div>
        </div>
      )}

      {/* IMPORT CONTRACT MODAL */}
      {showContractModal && (
        <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setShowContractModal(false); }}>
          <div className="modal">
            <div className="modal-header">
              <div>
                <span className="eyebrow">CONTRACT MANAGEMENT</span>
                <h2>Import Subscription Contract</h2>
                <p>Register customer subscription contract under tenant: {getTenantId()}.</p>
              </div>
              <button className="icon-button" onClick={() => setShowContractModal(false)}>
                <X size={17} />
              </button>
            </div>

            <label className="field-label">Contract ID</label>
            <input
              className="field-input"
              value={contractDraft.contract_id}
              onChange={(e) => setContractDraft({ ...contractDraft, contract_id: e.target.value })}
            />

            <label className="field-label">Customer Reference</label>
            <input
              className="field-input"
              value={contractDraft.customer_ref}
              onChange={(e) => setContractDraft({ ...contractDraft, customer_ref: e.target.value })}
            />

            <div className="plan-form-grid">
              <div>
                <label className="field-label">Plan ID</label>
                <input
                  className="field-input"
                  value={contractDraft.plan_id}
                  onChange={(e) => setContractDraft({ ...contractDraft, plan_id: e.target.value })}
                />
              </div>
              <div>
                <label className="field-label">Version</label>
                <input
                  className="field-input"
                  value={contractDraft.plan_version}
                  onChange={(e) => setContractDraft({ ...contractDraft, plan_version: e.target.value })}
                />
              </div>
            </div>

            <label className="field-label">Monthly Recurring Fee (£)</label>
            <input
              className="field-input"
              type="number"
              min="0"
              value={contractDraft.recurring_fee}
              onChange={(e) => setContractDraft({ ...contractDraft, recurring_fee: Number(e.target.value) })}
            />

            <div className="modal-actions">
              <button className="button button-secondary" onClick={() => setShowContractModal(false)}>
                Cancel
              </button>
              <button className="button button-primary" disabled={busy} onClick={() => void createContract()}>
                Import Contract
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TWO-PERSON PUBLISH MODAL */}
      {publishingPlan && planPreview && (
        <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) { setPublishingPlan(null); setPlanPreview(null); } }}>
          <div className="modal">
            <div className="modal-header">
              <div>
                <span className="eyebrow">TWO-PERSON AUTHORIZATION</span>
                <h2>Publish Tariff Version</h2>
                <p>{publishingPlan.name} · {publishingPlan.plan_version}</p>
              </div>
              <button className="icon-button" onClick={() => { setPublishingPlan(null); setPlanPreview(null); }}>
                <X size={17} />
              </button>
            </div>

            <div className="preview-summary">
              <strong>{planPreview.affected_contract_count} Active Contract(s) Affected</strong>
              <p>Preview only — existing contract prices will never change automatically.</p>
            </div>

            <label className="field-label">Second Reviewer Actor ID *</label>
            <input
              className="field-input"
              value={planApproverId}
              onChange={(e) => setPlanApproverId(e.target.value)}
              placeholder="Different reviewer identity"
            />

            <label className="field-label">Future Effective Date *</label>
            <input
              className="field-input"
              type="datetime-local"
              value={effectiveDate}
              onChange={(e) => setEffectiveDate(e.target.value)}
            />

            <div className="modal-actions">
              <button className="button button-secondary" onClick={() => { setPublishingPlan(null); setPlanPreview(null); }}>
                Cancel
              </button>
              <button className="button button-primary" disabled={busy} onClick={() => void publishPlan()}>
                Authorize &amp; Publish
              </button>
            </div>
          </div>
        </div>
      )}

      {/* EDIT SETTINGS MODAL */}
      {editingSettings && draftSettings && (
        <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setEditingSettings(false); }}>
          <div className="modal config-modal">
            <div className="modal-header">
              <div>
                <span className="eyebrow">TENANT CONFIGURATION</span>
                <h2>Edit Workspace Settings</h2>
                <p>Full object PUT replaces configuration and automatically increments versions.</p>
              </div>
              <button className="icon-button" onClick={() => setEditingSettings(false)}>
                <X size={17} />
              </button>
            </div>

            <label className="field-label">Display Name</label>
            <input
              className="field-input"
              value={draftSettings.display_name}
              onChange={(e) => setDraftSettings({ ...draftSettings, display_name: e.target.value })}
            />

            <label className="field-label">Service Territories (Comma-Separated)</label>
            <input
              className="field-input"
              value={(draftSettings.territories || []).join(', ')}
              onChange={(e) =>
                setDraftSettings({
                  ...draftSettings,
                  territories: e.target.value.split(',').map((x) => x.trim()).filter(Boolean),
                })
              }
            />

            <label className="field-label">Standard VAT Rate (0.20 = 20%)</label>
            <input
              className="field-input"
              type="number"
              min="0"
              max="1"
              step="0.01"
              value={draftSettings.vat_rate}
              onChange={(e) => setDraftSettings({ ...draftSettings, vat_rate: Number(e.target.value) })}
            />

            <label className="field-label">AI Monthly Budget (USD)</label>
            <input
              className="field-input"
              type="number"
              min="0"
              step="0.1"
              value={draftSettings.ai_monthly_budget_usd ?? 1.0}
              onChange={(e) =>
                setDraftSettings({
                  ...draftSettings,
                  ai_monthly_budget_usd: e.target.value === '' ? null : Number(e.target.value),
                })
              }
            />

            <div className="field-label" style={{ marginTop: 14 }}>Service Catalogue</div>
            <div className="config-service-list">
              {Object.entries(draftSettings.service_catalogue || {}).map(([key, val]) => (
                <div className="config-service" key={key}>
                  <div>
                    <strong>{val.label}</strong>
                    <small>{key}</small>
                  </div>
                  <label>
                    <span>GBP</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={val.unit_price}
                      onChange={(e) =>
                        setDraftSettings({
                          ...draftSettings,
                          service_catalogue: {
                            ...draftSettings.service_catalogue,
                            [key]: { ...val, unit_price: Number(e.target.value) },
                          },
                        })
                      }
                    />
                  </label>
                  <label className="eligible-toggle">
                    <input
                      type="checkbox"
                      checked={Boolean(val.eligible)}
                      onChange={(e) =>
                        setDraftSettings({
                          ...draftSettings,
                          service_catalogue: {
                            ...draftSettings.service_catalogue,
                            [key]: { ...val, eligible: e.target.checked },
                          },
                        })
                      }
                    />{' '}
                    Eligible
                  </label>
                </div>
              ))}
            </div>

            <div className="modal-actions">
              <button className="button button-secondary" onClick={() => setEditingSettings(false)}>
                Cancel
              </button>
              <button className="button button-primary" disabled={busy} onClick={() => void saveSettings()}>
                Save Settings
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TOAST NOTIFICATION */}
      {toast && (
        <div className="toast">
          <CheckCircle2 size={17} />
          {toast}
          <button onClick={() => setToast('')}>
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  change,
  icon,
  tone,
  footer,
}: {
  label: string;
  value: any;
  change: string;
  icon: any;
  tone: string;
  footer: string;
}) {
  return (
    <div className="stat-card">
      <div className="stat-top">
        <span>{label}</span>
        <div className={`stat-icon ${tone}`}>{icon}</div>
      </div>
      <div className="stat-value">{value}</div>
      <div className="stat-change">
        <span className="change-dot" />
        {change}
      </div>
      <div className="stat-footer">{footer}</div>
    </div>
  );
}

function HealthItem({ label, detail }: { label: string; detail: string }) {
  return (
    <div className="health-item">
      <span>
        <i />
        {label}
      </span>
      <strong>{detail}</strong>
    </div>
  );
}

function LeadTable({
  leads,
  onOpen,
  onQualify,
  busy,
}: {
  leads: Lead[];
  onOpen: (l: Lead) => void;
  onQualify: (l: Lead) => void;
  busy: boolean;
}) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Customer &amp; ID</th>
            <th>Channel</th>
            <th>Service &amp; Location</th>
            <th>Status</th>
            <th>Confidence</th>
            <th>Received</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {leads.map((l) => (
            <tr key={l.id} onClick={() => void onOpen(l)} className="click-row">
              <td>
                <div className="lead-cell">
                  <div className="lead-avatar">
                    {(l.customer_name || 'EN')
                      .split(' ')
                      .map((x) => x[0])
                      .slice(0, 2)
                      .join('')
                      .toUpperCase()}
                  </div>
                  <div>
                    <strong>{l.customer_name || l.id}</strong>
                    <small>{l.id}</small>
                  </div>
                </div>
              </td>
              <td>
                <span className="badge-code">{l.channel}</span>
              </td>
              <td>
                <div className="service-cell">
                  <strong>
                    {l.qualification?.service_type?.replaceAll('_', ' ') || 'Unclassified enquiry'}
                  </strong>
                  <small>{l.qualification?.location || 'Location pending'}</small>
                </div>
              </td>
              <td>
                <StatusBadge value={l.status} />
              </td>
              <td>
                {l.qualification ? (
                  <div className="confidence-cell">
                    <div className="confidence-track">
                      <i style={{ width: `${Math.round(l.qualification.confidence * 100)}%` }} />
                    </div>
                    <span>{Math.round(l.qualification.confidence * 100)}%</span>
                  </div>
                ) : (
                  '—'
                )}
              </td>
              <td className="date-cell">{fmtDate(l.created_at)}</td>
              <td>
                <div style={{ display: 'flex', gap: 6 }} onClick={(e) => e.stopPropagation()}>
                  <button
                    className="button button-light"
                    style={{ padding: '5px 8px', fontSize: 10 }}
                    onClick={() => void onOpen(l)}
                  >
                    View
                  </button>
                  {['new', 'needs_information', 'escalated'].includes(l.status) && (
                    <button
                      className="button button-primary"
                      style={{ padding: '5px 8px', fontSize: 10 }}
                      disabled={busy}
                      onClick={() => void onQualify(l)}
                    >
                      Qualify
                    </button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {leads.length === 0 && (
        <Empty title="No enquiries found" text="Create an enquiry or adjust filters to view leads." />
      )}
    </div>
  );
}

function Empty({ title, text }: { title: string; text: string }) {
  return (
    <div className="empty-state">
      <div>
        <Layers3 size={21} />
      </div>
      <strong>{title}</strong>
      <p>{text}</p>
    </div>
  );
}

function AgentCard({ n, title, desc, tag }: { n: string; title: string; desc: string; tag: string }) {
  return (
    <div className="agent-card">
      <div className="agent-num">{n}</div>
      <div className="agent-copy">
        <div className="agent-card-title">
          <h3>{title}</h3>
          <span>{tag}</span>
        </div>
        <p>{desc}</p>
      </div>
    </div>
  );
}

function Setting({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="setting-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <p>{detail}</p>
    </div>
  );
}

export default App;
