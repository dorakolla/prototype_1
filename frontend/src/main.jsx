import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from "react-router-dom";
import App from "./App.jsx";
import ExecutiveDashboard from "./ExecutiveDashboard.jsx";
import IncidentDetail from "./IncidentDetail.jsx";
import "./styles.css";

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
            <span className="role-icon">📊</span>
            <h2>Leadership View</h2>
            <p>Executive summary with health scores, team accountability, and strategic actions. Designed for Application Team Heads &amp; Chapter Leads.</p>
            <span className="role-tag">Recommended for leadership</span>
          </button>
          <button className="role-card" onClick={() => navigate("/dashboard")}>
            <span className="role-icon">🔧</span>
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
        <Route path="/dashboard" element={<App />} />
        <Route path="/executive" element={<ExecutiveDashboard />} />
        <Route path="/incident/:incidentId" element={<IncidentDetail />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
