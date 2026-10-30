from dataclasses import dataclass
from fastapi import Header, HTTPException, Request
from app.core.config import settings
from app.domain.schemas import Role

@dataclass
class Principal:
    actor_id: str
    tenant_id: str
    role: Role

def get_principal(request: Request, x_actor_id: str | None = Header(default=None), x_tenant_id: str | None = Header(default=None), x_role: str | None = Header(default=None), authorization: str | None = Header(default=None)) -> Principal:
    # Header-based identity is intentionally restricted to local development.
    if settings.auth_mode == "dev" and settings.environment == "local":
        try: role = Role(x_role or "tenant_admin")
        except ValueError: raise HTTPException(403, "invalid_role")
        return Principal(actor_id=(x_actor_id or "local-user")[:120], tenant_id=(x_tenant_id or "demo-tenant")[:80], role=role)
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "bearer_token_required")
    token = authorization.removeprefix("Bearer ").strip()
    try:
        from google.oauth2 import id_token
        from google.auth.transport import requests
        if not settings.oidc_audience:
            raise ValueError("OIDC_AUDIENCE must be configured outside local mode")
        claims = id_token.verify_oauth2_token(token, requests.Request(), audience=settings.oidc_audience)
        tenant = claims.get("tenant_id") or claims.get("tenant")
        role_claim = claims.get("role", "viewer")
        if not tenant: raise ValueError("tenant claim missing")
        return Principal(actor_id=str(claims.get("sub", "unknown")), tenant_id=str(tenant), role=Role(role_claim))
    except Exception as exc:
        raise HTTPException(401, "invalid_oidc_token") from exc

def require_role(principal: Principal, *roles: Role) -> None:
    if principal.role not in roles and principal.role != Role.PLATFORM_ADMIN:
        raise HTTPException(403, "insufficient_role")

def require_tenant(principal: Principal, tenant_id: str) -> None:
    if principal.tenant_id != tenant_id and principal.role != Role.PLATFORM_ADMIN:
        # Do not disclose whether another tenant's object exists.
        raise HTTPException(404, "not_found")
