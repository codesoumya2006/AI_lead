const API = import.meta.env.VITE_API_URL || 'http://localhost:8000';

export function getTenantId(): string {
  return localStorage.getItem('tenant_id') || 'northstar-test';
}

export function setTenantId(id: string): void {
  localStorage.setItem('tenant_id', id);
}

export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const currentTenant = getTenantId();
  const response = await fetch(`${API}/v1${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'X-Tenant-ID': currentTenant,
      'X-Actor-ID': 'demo-reviewer',
      'X-Role': 'tenant_admin',
      ...(init.headers || {}),
    },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ detail: response.statusText }));
    throw new Error(typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail || body));
  }
  return response.json();
}

export function formatApiError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes("tenant_ai_budget_exceeded") || msg.includes("ai_budget_exceeded")) {
    return "AI Budget Exceeded (HTTP 429): Monthly AI budget limit ($1.00) reached. Lead capture was preserved.";
  }
  if (msg.includes("tenant_monthly_lead_quota_exceeded")) {
    return "Monthly Lead Quota Exceeded (HTTP 429): Monthly lead quota limit reached. Lead capture was preserved.";
  }
  if (msg.includes("ai_cost_rates_required_for_budget_enforcement")) {
    return "AI Configuration Error (HTTP 503): Model token cost rates must be configured before budget enforcement can proceed.";
  }
  if (msg.includes("qualification_queue_unavailable")) {
    return "Queue Unavailable (HTTP 503): Background worker queue is currently unavailable. Safe to retry.";
  }
  return msg;
}

export type Lead = {
  id: string;
  tenant_id: string;
  status: string;
  channel: string;
  message: string;
  customer_name?: string;
  customer_email?: string;
  created_at: string;
  updated_at?: string;
  qualification?: {
    intent?: string;
    service_type?: string;
    location?: string;
    quantity?: number;
    equipment?: string[];
    requested_time?: string;
    urgency?: string;
    confidence: number;
    confidence_reason: string;
    missing_fields: string[];
    evidence?: Record<string, string>;
    safety_flags: string[];
    injection_detected: boolean;
    model_used: string;
    verifier_used: boolean;
    input_tokens?: number | null;
    output_tokens?: number | null;
    thinking_tokens?: number | null;
    estimated_cost_usd?: number | null;
    timing_ms?: Record<string, number>;
  };
  quote_ids: string[];
  history?: Array<{ action: string; actor_id?: string; at: string; reasons?: string[] }>;
};

export type QuoteLineItem = {
  service_code: string;
  description: string;
  quantity: number;
  unit_price: number;
};

export type Quote = {
  id: string;
  tenant_id: string;
  lead_id: string;
  subtotal: number;
  vat_rate: number;
  vat_amount: number;
  total: number;
  currency: string;
  status: 'draft' | 'approved' | 'sent' | string;
  policy_version: string;
  catalogue_version: string;
  generation: number;
  approved_by?: string;
  approved_at?: string;
  sent_at?: string;
  send_channel?: string;
  exclusions?: string[];
  vat_exempt?: boolean;
  line_items: QuoteLineItem[];
};

export type UsageRecord = {
  tenant_id: string;
  job_id: string;
  lead_id: string;
  timestamp: string;
  model: string;
  input_tokens: number | null;
  output_tokens: number | null;
  thinking_tokens?: number | null;
  estimated_cost_usd: number | null;
  verifier_used: boolean;
  timing_ms?: Record<string, number>;
};

export type JobRecord = {
  id: string;
  tenant_id: string;
  lead_id: string;
  state: string;
  errors: string[];
  created_at: string;
  completed_at?: string | null;
  trace: string[];
  timing_ms?: Record<string, number>;
};

export type UsageSummary = {
  tenant_id: string;
  monthly_spend_usd: number;
  ai_monthly_budget_usd: number | null;
  remaining_budget_usd: number | null;
  total_records: number;
  records: UsageRecord[];
};

export type EventRecord = {
  event_id: string;
  tenant_id: string;
  entity_id: string;
  action: string;
  actor_id: string;
  policy_version: string;
  content_hash: string;
  result: string;
  timestamp: string;
  correlation_id?: string;
  content?: Record<string, unknown>;
};

export type SubscriptionPlan = {
  plan_id: string;
  plan_version: string;
  name: string;
  status: 'draft' | 'published';
  currency: string;
  setup_fee: number | null;
  recurring_fee: number | null;
  billing_interval: string;
  metered_limits: Record<string, number>;
  feature_flags: Record<string, boolean>;
  support_sla: string;
  pricing_visibility: string;
  overage_policy: string;
  created_by?: string;
  approved_by?: string;
  effective_from?: string;
  effective_to?: string | null;
  published_at?: string;
  generation: number;
};

export type SubscriptionContract = {
  contract_id: string;
  tenant_id: string;
  customer_ref: string;
  plan_id: string;
  plan_version: string;
  status: string;
  recurring_fee: number;
  currency: string;
  started_at: string;
  expires_at?: string | null;
};

export type TenantSettings = {
  tenant_id: string;
  display_name: string;
  allowed_services: string[];
  territories: string[];
  service_catalogue: Record<string, { label: string; unit_price: number; eligible?: boolean }>;
  vat_rate: number;
  vat_exempt_services?: string[];
  ai_monthly_budget_usd: number | null;
  catalogue_version: string;
  policy_version: string;
  plan_id?: string;
  plan_version?: string;
  opening_hours?: Record<string, string>;
  role_permissions?: Record<string, string[]>;
  qualification_questions?: string[];
  message_templates?: Record<string, string>;
};

export type Dashboard = {
  lead_count: number;
  quote_count: number;
  draft_quotes: number;
  approved_quotes: number;
  sent_quotes: number;
  status_counts: Record<string, number>;
  monthly_spend_usd: number;
  ai_monthly_budget_usd: number | null;
  remaining_budget_usd: number | null;
  recent_leads: Lead[];
  events_today: number;
};

export const money = (n: number) =>
  new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 2 }).format(n);
