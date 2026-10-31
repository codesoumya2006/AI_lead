from datetime import datetime, timezone
from enum import StrEnum
from typing import Any
from pydantic import BaseModel, ConfigDict, Field, field_validator
import uuid

def now_utc() -> datetime: return datetime.now(timezone.utc)
def new_id(prefix: str) -> str: return f"{prefix}_{uuid.uuid4().hex[:12]}"

class Channel(StrEnum):
    WEBSITE = "website"
    WHATSAPP = "whatsapp"

class LeadStatus(StrEnum):
    NEW = "new"
    QUALIFICATION_QUEUED = "qualification_queued"
    NEEDS_INFORMATION = "needs_information"
    QUALIFIED = "qualified"
    QUOTE_DRAFT = "quote_draft"
    QUOTE_APPROVED = "quote_approved"
    SENT = "sent"
    REJECTED = "rejected"
    CLOSED = "closed"
    ESCALATED = "escalated"

class Role(StrEnum):
    VIEWER = "viewer"
    STAFF = "staff"
    REVIEWER = "reviewer"
    TENANT_ADMIN = "tenant_admin"
    PLATFORM_ADMIN = "platform_admin"

class LeadCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    tenant_id: str = Field(min_length=2, max_length=80, pattern=r"^[A-Za-z0-9][A-Za-z0-9_-]*$")
    channel: Channel = Channel.WEBSITE
    external_ref: str | None = Field(default=None, max_length=200)
    message: str = Field(min_length=8, max_length=10000)
    consent: bool
    idempotency_key: str = Field(min_length=8, max_length=200, pattern=r"^[A-Za-z0-9][A-Za-z0-9_.:-]*$")
    customer_name: str | None = Field(default=None, max_length=160)
    customer_email: str | None = Field(default=None, max_length=254)

    @field_validator("message")
    @classmethod
    def strip_message(cls, value: str) -> str:
        value = value.strip()
        if not value: raise ValueError("message cannot be empty")
        return value

class Qualification(BaseModel):
    intent: str = "service_enquiry"
    service_type: str | None = None
    location: str | None = None
    quantity: int | None = Field(default=None, ge=1, le=10000)
    equipment: list[str] = Field(default_factory=list)
    area: str | None = Field(default=None, max_length=80)
    frequency: str | None = Field(default=None, max_length=80)
    requested_time: str | None = None
    urgency: str = "normal"
    missing_fields: list[str] = Field(default_factory=list)
    evidence: dict[str, str] = Field(default_factory=dict)
    confidence: float = Field(ge=0, le=1, default=0.0)
    confidence_reason: str = ""
    injection_detected: bool = False
    model_used: str = "deterministic_fallback"
    verifier_used: bool = False
    input_tokens: int | None = None
    output_tokens: int | None = None
    thinking_tokens: int | None = None
    estimated_cost_usd: float | None = None
    safety_flags: list[str] = Field(default_factory=list)
    timing_ms: dict[str, float] = Field(default_factory=dict)

class LeadRecord(BaseModel):
    id: str
    tenant_id: str
    channel: Channel
    external_ref: str | None = None
    message: str
    consent: bool
    idempotency_key: str
    customer_name: str | None = None
    customer_email: str | None = None
    status: LeadStatus = LeadStatus.NEW
    qualification: Qualification | None = None
    reviewed_qualification: Qualification | None = None
    reviewed_by: str | None = None
    reviewed_at: datetime | None = None
    reviewed_fields: list[str] = Field(default_factory=list)
    policy_eligible: bool | None = None
    policy_reasons: list[str] = Field(default_factory=list)
    quote_ids: list[str] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=now_utc)
    updated_at: datetime = Field(default_factory=now_utc)
    generation: int = 0
    history: list[dict[str, Any]] = Field(default_factory=list)


class LeadReviewSubmission(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_generation: int = Field(ge=0)
    service_type: str | None = Field(default=None, max_length=80)
    location: str | None = Field(default=None, max_length=160)
    quantity: int | None = Field(default=None, ge=1, le=10000)
    area: str | None = Field(default=None, max_length=80)
    frequency: str | None = Field(default=None, max_length=80)
    requested_time: str | None = Field(default=None, max_length=160)


class QuoteLineItem(BaseModel):
    service_code: str = Field(min_length=1, max_length=80)
    description: str = Field(min_length=1, max_length=240)
    quantity: int = Field(ge=1, le=10000)
    unit_price: float = Field(ge=0)

class QuoteCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    catalogue_version: str = Field(min_length=1, max_length=80)
    line_items: list[QuoteLineItem] = Field(min_length=1, max_length=30)
    vat_exempt: bool = False
    exclusions: list[str] = Field(default_factory=list, max_length=30)

class QuoteRecord(BaseModel):
    id: str
    tenant_id: str
    lead_id: str
    catalogue_version: str
    policy_version: str
    line_items: list[QuoteLineItem]
    subtotal: float
    vat_rate: float
    vat_amount: float
    total: float
    currency: str = "GBP"
    vat_exempt: bool = False
    exclusions: list[str] = Field(default_factory=list)
    status: str = "draft"
    created_at: datetime = Field(default_factory=now_utc)
    approved_by: str | None = None
    approved_at: datetime | None = None
    approval_generation: int | None = None
    sent_at: datetime | None = None
    send_channel: str | None = None
    generation: int = 0

class ApproveQuote(BaseModel):
    expected_generation: int = Field(ge=0)
    reviewer_id: str = Field(min_length=2, max_length=120)

class SendQuote(BaseModel):
    channel: Channel = Channel.WEBSITE
    approved_by: str = Field(min_length=2, max_length=120)

class JobRecord(BaseModel):
    id: str
    tenant_id: str
    lead_id: str
    state: str = "queued"
    errors: list[str] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=now_utc)
    completed_at: datetime | None = None
    trace: list[str] = Field(default_factory=list)
    retry_safe: bool = True
    timing_ms: dict[str, float] = Field(default_factory=dict)

class TenantSettings(BaseModel):
    tenant_id: str = Field(min_length=2, max_length=80, pattern=r"^[A-Za-z0-9][A-Za-z0-9_-]*$")
    display_name: str = "Northstar Facilities"
    allowed_services: list[str] = Field(default_factory=lambda: ["boiler_service", "inspection", "maintenance"])
    territories: list[str] = Field(default_factory=lambda: ["Manchester", "Salford", "Stockport"])
    service_catalogue: dict[str, dict[str, Any]] = Field(default_factory=lambda: {
        "boiler_service": {"label": "Boiler service", "unit_price": 150.0, "eligible": True},
        "inspection": {"label": "Site inspection", "unit_price": 95.0, "eligible": True},
        "maintenance": {"label": "Maintenance visit", "unit_price": 125.0, "eligible": True},
    })
    catalogue_version: str = "catalogue-v1"
    policy_version: str = "policy-v1.0.0"
    vat_rate: float = 0.20
    vat_exempt_services: list[str] = Field(default_factory=list)
    entitlements: dict[str, Any] = Field(default_factory=lambda: {"monthly_leads": 100, "ai_qualification": True, "crm_csv_export": True})
    plan_id: str = "pilot"
    plan_version: str = "v1"
    opening_hours: dict[str, str] = Field(default_factory=lambda: {"monday":"09:00-17:00", "tuesday":"09:00-17:00", "wednesday":"09:00-17:00", "thursday":"09:00-17:00", "friday":"09:00-17:00", "saturday":"closed", "sunday":"closed"})
    qualification_questions: list[str] = Field(default_factory=lambda: ["What service is required?", "Where is the site located?", "How many units or items are involved?", "When is the service required?"])
    role_permissions: dict[str, list[str]] = Field(default_factory=lambda: {"viewer":["read"], "staff":["read","create_lead","qualify_lead","draft_quote","csv_export"], "reviewer":["read","create_lead","qualify_lead","draft_quote","approve_quote","record_send","csv_export","manage_billing"], "tenant_admin":["read","create_lead","qualify_lead","draft_quote","approve_quote","record_send","csv_export","tenant_settings","manage_catalogue","manage_billing"]})
    ai_monthly_budget_usd: float | None = Field(default=None, ge=0)
    message_templates: dict[str, str] = Field(default_factory=dict)

class SubscriptionPlanDraft(BaseModel):
    model_config = ConfigDict(extra="forbid")
    plan_id: str = Field(min_length=2, max_length=80, pattern=r"^[A-Za-z0-9][A-Za-z0-9_-]*$")
    plan_version: str = Field(min_length=1, max_length=40, pattern=r"^[A-Za-z0-9][A-Za-z0-9._-]*$")
    name: str = Field(min_length=2, max_length=100)
    currency: str = Field(default="GBP", min_length=3, max_length=3)
    setup_fee: float | None = Field(default=None, ge=0)
    recurring_fee: float | None = Field(default=None, ge=0)
    effective_from: datetime | None = None
    effective_to: datetime | None = None
    metered_limits: dict[str, int] = Field(default_factory=dict)
    feature_flags: dict[str, bool] = Field(default_factory=dict)
    support_sla: str = "standard"
    pricing_visibility: str = "private"
    overage_policy: str = "pause_premium"

    @field_validator("effective_from", "effective_to")
    @classmethod
    def require_timezone_for_effective_dates(cls, value):
        if value is not None and value.tzinfo is None:
            raise ValueError("effective dates must include a timezone")
        return value

class SubscriptionPlan(SubscriptionPlanDraft):
    tenant_id: str
    status: str = "draft"
    created_by: str
    created_at: datetime = Field(default_factory=now_utc)
    approved_by: str | None = None
    published_at: datetime | None = None
    generation: int = 1

class PublishPlan(BaseModel):
    expected_generation: int = Field(ge=1)
    approver_id: str = Field(min_length=2, max_length=120)
    effective_from: datetime

    @field_validator("effective_from")
    @classmethod
    def require_timezone(cls, value):
        if value.tzinfo is None: raise ValueError("effective_from must include a timezone")
        return value

class SubscriptionContract(BaseModel):
    model_config = ConfigDict(extra="forbid")
    contract_id: str = Field(min_length=2, max_length=100, pattern=r"^[A-Za-z0-9][A-Za-z0-9_-]*$")
    tenant_id: str
    customer_ref: str = Field(min_length=2, max_length=120)
    plan_id: str
    plan_version: str
    currency: str = "GBP"
    setup_fee: float | None = Field(default=None, ge=0)
    recurring_fee: float | None = Field(default=None, ge=0)
    effective_from: datetime
    effective_to: datetime | None = None
    status: str = "active"
    created_at: datetime = Field(default_factory=now_utc)

class EventRecord(BaseModel):
    event_id: str = Field(default_factory=lambda: new_id("evt"))
    tenant_id: str
    actor_id: str = "system"
    entity_id: str
    action: str
    timestamp: datetime = Field(default_factory=now_utc)
    correlation_id: str = "-"
    policy_version: str = "policy-v1.0.0"
    content_hash: str = ""
    result: str = "success"
