import { Bell, Search, ShieldCheck } from 'lucide-react';
import { getTenantId } from '../lib/api';

interface TopbarProps {
  title: string;
  subtitle: string;
  search?: string;
  onSearchChange?: (val: string) => void;
  onRefresh?: () => void;
}

export function Topbar({ title, subtitle, search, onSearchChange }: TopbarProps) {
  const tenant = getTenantId();
  return (
    <header className="topbar">
      <div className="breadcrumbs">
        <span>{tenant}</span>
        <i>/</i>
        <strong>{title}</strong>
        <p>{subtitle}</p>
      </div>

      <div className="top-actions">
        {onSearchChange ? (
          <div className="search-button" style={{ cursor: 'text' }}>
            <Search size={15} />
            <input
              type="text"
              placeholder="Filter view..."
              value={search || ''}
              onChange={(e) => onSearchChange(e.target.value)}
              style={{
                border: 'none',
                background: 'transparent',
                outline: 'none',
                fontSize: 10,
                color: '#33415b',
                width: 140,
              }}
            />
          </div>
        ) : (
          <div className="search-button">
            <Search size={15} />
            <span>Search workspace</span>
            <kbd>⌘ K</kbd>
          </div>
        )}

        <div className="secure-pill" title="Local sandbox: no live outbound communications enabled">
          <ShieldCheck size={14} /> Sandbox Secure
        </div>

        <button className="icon-button" aria-label="Notifications" title="Sandbox audit alerts active">
          <Bell size={17} />
          <i />
        </button>

        <div className="top-avatar" title={`Tenant: ${tenant}`}>
          SR
        </div>
      </div>
    </header>
  );
}
