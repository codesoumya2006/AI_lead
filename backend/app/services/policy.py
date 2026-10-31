"""Deterministic qualification and quote policy; model outputs never set prices."""
from app.domain.schemas import Qualification, QuoteCreate, QuoteRecord, TenantSettings, new_id

class PolicyError(ValueError): pass

def evaluate_qualification(
    q: Qualification,
    settings: TenantSettings,
    *,
    human_reviewed: bool = False,
) -> tuple[bool, list[str]]:
    reasons = []
    if not q.service_type or q.service_type not in settings.allowed_services: reasons.append("service_not_configured_or_unknown")
    if not q.location or q.location not in settings.territories: reasons.append("location_missing_or_out_of_territory")
    if not q.quantity: reasons.append("quantity_missing")
    if q.missing_fields: reasons.append("required_fields_missing")
    if q.confidence < 0.70 and not human_reviewed: reasons.append("low_confidence_human_review_required")
    if q.injection_detected: reasons.append("possible_prompt_injection_human_review_required")
    if q.safety_flags: reasons.append("safety_flags_require_review")
    return not reasons, reasons

def create_quote(tenant_id: str, lead_id: str, data: QuoteCreate, tenant: TenantSettings) -> QuoteRecord:
    if data.catalogue_version != tenant.catalogue_version:
        raise PolicyError("catalogue_version_mismatch")
    subtotal = 0.0
    for item in data.line_items:
        service = tenant.service_catalogue.get(item.service_code)
        if not service or not service.get("eligible", False): raise PolicyError(f"non_eligible_service:{item.service_code}")
        # The tenant catalogue is authoritative; client-supplied unit price must match it.
        expected = float(service["unit_price"])
        if abs(item.unit_price - expected) > 0.001: raise PolicyError(f"unit_price_mismatch:{item.service_code}")
        subtotal += expected * item.quantity
    subtotal = round(subtotal, 2)
    policy_exempt = all(x.service_code in tenant.vat_exempt_services for x in data.line_items)
    if data.vat_exempt and not policy_exempt:
        raise PolicyError("vat_exemption_not_permitted_by_tenant_policy")
    exempt = policy_exempt
    vat_rate = 0.0 if exempt else tenant.vat_rate
    vat = round(subtotal * vat_rate, 2)
    return QuoteRecord(id=new_id("quo"), tenant_id=tenant_id, lead_id=lead_id, catalogue_version=tenant.catalogue_version,
        policy_version=tenant.policy_version, line_items=data.line_items, subtotal=subtotal, vat_rate=vat_rate,
        vat_amount=vat, total=round(subtotal + vat, 2), vat_exempt=exempt, exclusions=data.exclusions)
