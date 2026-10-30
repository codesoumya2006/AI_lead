import {
  Activity,
  ArrowUpRight,
  BadgePoundSterling,
  Bot,
  BriefcaseBusiness,
  ChevronDown,
  CircleHelp,
  Command,
  FileCheck2,
  LayoutDashboard,
  Settings2,
  ShieldCheck,
  UsersRound,
  WandSparkles,
} from 'lucide-react';
import { getTenantId } from '../lib/api';

interface SidebarProps {
  active: string;
  onNavigate: (v: string) => void;
  counts?: {
    pendingApprovals?: number;
    totalLeads?: number;
  };
}

export function Sidebar({ active, onNavigate, counts }: SidebarProps) {
  const primary = [
    { label: 'Overview', icon: LayoutDashboard },
    { label: 'Leads', icon: BriefcaseBusiness, count: counts?.totalLeads },
    { label: 'Qualification', icon: WandSparkles },
    { label: 'Quotes', icon: FileCheck2 },
    { label: 'Approvals', icon: ShieldCheck, count: counts?.pendingApprovals },
  ];

  const operations = [
    { label: 'Customers', icon: UsersRound },
    { label: 'AI Activity & Usage', icon: Bot },
    { label: 'Audit Logs', icon: Activity },
  ];

  const configuration = [
    { label: 'Catalogue', icon: BadgePoundSterling },
    { label: 'Settings', icon: Settings2 },
  ];

  const currentTenant = getTenantId();

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">
          <Command size={19} />
        </div>
        <div>
          <strong>
            northstar<span>.</span>
          </strong>
          <small>OPERATIONS CLOUD</small>
        </div>
      </div>

      <button className="workspace" onClick={() => onNavigate('Settings')}>
        <div className="workspace-icon">NF</div>
        <div className="workspace-text">
          <strong>Northstar Facilities</strong>
          <small>Tenant: {currentTenant}</small>
        </div>
        <ChevronDown size={15} />
      </button>

      <div className="nav-label">PRIMARY WORKFLOW</div>
      {primary.map((x) => (
        <button
          key={x.label}
          className={`nav-item ${active === x.label ? 'active' : ''}`}
          onClick={() => onNavigate(x.label)}
        >
          <x.icon size={17} />
          <span>{x.label}</span>
          {typeof x.count === 'number' && x.count > 0 && (
            <b className="nav-count">{x.count}</b>
          )}
        </button>
      ))}

      <div className="nav-label system-label">OPERATIONS &amp; AI</div>
      {operations.map((x) => (
        <button
          key={x.label}
          className={`nav-item ${active === x.label ? 'active' : ''}`}
          onClick={() => onNavigate(x.label)}
        >
          <x.icon size={17} />
          <span>{x.label}</span>
        </button>
      ))}

      <div className="nav-label system-label">CONFIGURATION</div>
      {configuration.map((x) => (
        <button
          key={x.label}
          className={`nav-item ${active === x.label ? 'active' : ''}`}
          onClick={() => onNavigate(x.label)}
        >
          <x.icon size={17} />
          <span>{x.label}</span>
        </button>
      ))}

      <div className="sidebar-bottom">
        <div className="plan-card">
          <div className="plan-top">
            <span className="plan-dot" />
            PILOT ENVIRONMENT
          </div>
          <strong>Sandbox Mode</strong>
          <p>Outbound messages disabled. All sends recorded safely in audit ledger.</p>
          <button onClick={() => onNavigate('Settings')}>
            Environment details <ArrowUpRight size={13} />
          </button>
        </div>

        <button className="help-link" onClick={() => onNavigate('Help')}>
          <CircleHelp size={16} /> Help &amp; documentation
        </button>

        <div className="profile">
          <div className="avatar">SR</div>
          <div className="profile-info">
            <strong>Senior Reviewer</strong>
            <small>Workspace admin</small>
          </div>
          <span className="online-dot" />
        </div>
      </div>
    </aside>
  );
}
