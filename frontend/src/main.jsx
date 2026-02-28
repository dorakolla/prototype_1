import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation } from "react-router-dom";
import App from "./App.jsx";
import ExecutiveDashboard from "./ExecutiveDashboard.jsx";
import IncidentDetail from "./IncidentDetail.jsx";
import TeamAnalysis from "./TeamAnalysis.jsx";
import "./styles.css";

/* ── Inline SVG icons ── */
const HomeIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
    <polyline points="9,22 9,12 15,12 15,22"/>
  </svg>
);
const BarChartIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" x2="12" y1="20" y2="10"/><line x1="18" x2="18" y1="20" y2="4"/><line x1="6" x2="6" y1="20" y2="16"/>
  </svg>
);
const ListIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <line x1="8" x2="21" y1="6" y2="6"/><line x1="8" x2="21" y1="12" y2="12"/><line x1="8" x2="21" y1="18" y2="18"/>
    <line x1="3" x2="3.01" y1="6" y2="6"/><line x1="3" x2="3.01" y1="12" y2="12"/><line x1="3" x2="3.01" y1="18" y2="18"/>
  </svg>
);
const UsersIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
    <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>
  </svg>
);
const FileTextIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/>
    <polyline points="14,2 14,8 20,8"/><line x1="16" x2="8" y1="13" y2="13"/><line x1="16" x2="8" y1="17" y2="17"/>
  </svg>
);
const AlertIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/>
    <path d="M12 9v4"/><path d="M12 17h.01"/>
  </svg>
);
const BookIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/>
  </svg>
);
const CampaignIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 11l19-9-9 19-2-8-8-2Z"/>
  </svg>
);
const FlaskIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" x2="21" y1="6" y2="6"/>
    <path d="M16 10a4 4 0 0 1-8 0"/>
  </svg>
);
const TrendingIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="22,7 13.5,15.5 8.5,10.5 2,17"/><polyline points="16,7 22,7 22,13"/>
  </svg>
);
const DatabaseIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <ellipse cx="12" cy="5" rx="9" ry="3"/>
    <path d="M3 5v14c0 1.66 4.03 3 9 3s9-1.34 9-3V5"/>
    <path d="M3 12c0 1.66 4.03 3 9 3s9-1.34 9-3"/>
  </svg>
);
const PlugIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 22v-5"/><path d="M9 7V2"/><path d="M15 7V2"/>
    <path d="M18 7H6a2 2 0 0 0-2 2v2a6 6 0 0 0 12 0V9a2 2 0 0 0-2-2z"/>
  </svg>
);
const SearchIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8"/><line x1="21" x2="16.65" y1="21" y2="16.65"/>
  </svg>
);
const ChevronDownIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="6,9 12,15 18,9"/>
  </svg>
);

/* ── Sidebar ── */
function Sidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const isActive = (path) => location.pathname === path;

  const navMain = [
    { icon: <HomeIcon />, label: "Home", path: "/" },
    { icon: <BarChartIcon />, label: "Executive Dashboard", path: "/executive" },
    { icon: <ListIcon />, label: "All Incidents", path: "/dashboard" },
    { icon: <UsersIcon />, label: "Teams", path: "/teams" },
    { icon: <FileTextIcon />, label: "SLA Reports", path: "#" },
    { icon: <AlertIcon />, label: "Severity Analysis", path: "#" },
    { icon: <BookIcon />, label: "Playbooks", path: "#" },
  ];
  const navGrowth = [
    { icon: <CampaignIcon />, label: "Investigations", path: "#" },
    { icon: <FlaskIcon />, label: "Experiments", path: "#" },
  ];
  const navOps = [
    { icon: <TrendingIcon />, label: "Forecasting", path: "#" },
    { icon: <DatabaseIcon />, label: "Data Sources", path: "#" },
    { icon: <PlugIcon />, label: "Integrations", path: "#" },
  ];

  const go = (path) => { if (path !== "#") navigate(path); };

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <div className="sidebar-logo">
          <div className="sidebar-logo-icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="white" aria-hidden="true">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
            </svg>
          </div>
          <span className="sidebar-brand-name">Incident Platform</span>
        </div>
        <span className="sidebar-brand-chevron" aria-hidden="true"><ChevronDownIcon /></span>
      </div>

      <div className="sidebar-search-wrap">
        <span className="sidebar-search-icon"><SearchIcon /></span>
        <input type="text" placeholder="Search..." className="sidebar-search-input" readOnly aria-label="Search incidents" />
      </div>

      <nav className="sidebar-nav">
        {navMain.map(item => (
          <button
            key={item.label}
            className={`sidebar-nav-item ${isActive(item.path) ? "active" : ""}`}
            onClick={() => go(item.path)}
            aria-current={isActive(item.path) ? "page" : undefined}
          >
            <span className="sidebar-nav-icon" aria-hidden="true">{item.icon}</span>
            <span>{item.label}</span>
          </button>
        ))}

        <div className="sidebar-section-label">Growth</div>
        {navGrowth.map(item => (
          <button key={item.label} className="sidebar-nav-item" onClick={() => go(item.path)}>
            <span className="sidebar-nav-icon" aria-hidden="true">{item.icon}</span>
            <span>{item.label}</span>
          </button>
        ))}

        <div className="sidebar-section-label">Operations</div>
        {navOps.map(item => (
          <button key={item.label} className="sidebar-nav-item" onClick={() => go(item.path)}>
            <span className="sidebar-nav-icon" aria-hidden="true">{item.icon}</span>
            <span>{item.label}</span>
          </button>
        ))}
      </nav>
    </aside>
  );
}

/* ── Shell layout with sidebar ── */
function SidebarLayout({ children }) {
  return (
    <div className="app-shell">
      <a href="#main-content" className="skip-link">Skip to main content</a>
      <Sidebar />
      <main id="main-content" className="main-content" tabIndex="-1">
        {children}
      </main>
    </div>
  );
}

/* ── Role selector (no sidebar) ── */
function RoleSelector() {
  const navigate = useNavigate();
  return (
    <div className="page role-page">
      <div className="role-selector">
        <div className="role-glow" />
        <h1 className="role-title">Incident Analysis Platform</h1>
        <p className="role-subtitle">Oracle EC2 / RDS • Enterprise Incident Desk</p>
        <p className="role-prompt">Select your dashboard view</p>
        <div className="role-cards">
          <button className="role-card" onClick={() => navigate("/executive")}>
            <span className="role-icon" aria-hidden="true">📊</span>
            <h2>Leadership View</h2>
            <p>Executive summary with health scores, team accountability, and strategic actions. Designed for Application Team Heads &amp; Chapter Leads.</p>
            <span className="role-tag">Recommended for leadership</span>
          </button>
          <button className="role-card" onClick={() => navigate("/dashboard")}>
            <span className="role-icon" aria-hidden="true">🔧</span>
            <h2>Developer View</h2>
            <p>Technical deep-dive with incident patterns, closure-note NLP analysis, semantic clustering, and database-level breakdowns.</p>
            <span className="role-tag">For engineering teams</span>
          </button>
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<RoleSelector />} />
        <Route path="/dashboard" element={<SidebarLayout><App /></SidebarLayout>} />
        <Route path="/executive" element={<SidebarLayout><ExecutiveDashboard /></SidebarLayout>} />
        <Route path="/incident/:incidentId" element={<SidebarLayout><IncidentDetail /></SidebarLayout>} />
        <Route path="/teams" element={<SidebarLayout><TeamAnalysis /></SidebarLayout>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
