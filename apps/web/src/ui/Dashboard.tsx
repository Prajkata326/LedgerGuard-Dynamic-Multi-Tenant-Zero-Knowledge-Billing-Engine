import { useState } from "react";
import { Bar, Line } from "react-chartjs-2";
import { CategoryScale, Chart as ChartJS, Filler, Legend, LinearScale, LineElement, BarElement, PointElement, Tooltip } from "chart.js";

ChartJS.register(CategoryScale, LinearScale, LineElement, BarElement, PointElement, Tooltip, Legend, Filler);

const currencies = ["USD", "EUR", "GBP"];
const fractionDigits = (currency: string) => {
  try { return new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits; }
  catch { return 2; }
};
const money = (value: number, currency: string) => {
  try { return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(value); }
  catch { return `${currency} ${value.toFixed(0)}`; }
};
const preciseMoney = (value: number, currency: string) => {
  try { return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(value); }
  catch { return `${currency} ${value.toFixed(2)}`; }
};
type Charge = { id: string; customerId: string; description: string; amountMinor: number; currency: string; createdAt: string };
type Summary = {
  organizationId: string;
  chargeCount: number;
  customerCount: number;
  currencies: { currency: string; chargeCount: number; totalMinor: number }[];
  timeSeries: { bucket: string; chargeCount: number; currencies: Record<string, number> }[];
  recentCharges: Charge[];
};
type ChargePage = { page: number; pages: number; total: number; charges: Charge[] };

export function Dashboard() {
  const [period, setPeriod] = useState("7 days");
  const [currency, setCurrency] = useState("USD");
  const [token, setToken] = useState("");
  const [apiStatus, setApiStatus] = useState("Enter a token to load tenant data");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(false);
  const [apiError, setApiError] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyPage, setHistoryPage] = useState<ChargePage | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const labels = summary?.timeSeries.map((point) => period === "24 hours"
    ? new Date(point.bucket).toLocaleTimeString([], { hour: "numeric", hour12: false })
    : new Date(point.bucket).toLocaleDateString([], { month: "short", day: "numeric" })) ?? [];
  const selectedCurrency = summary?.currencies.find((item) => item.currency === currency);
  const currencyOptions = [...new Set([...currencies, ...(summary?.currencies.map((item) => item.currency) ?? [])])];
  const currencyDigits = fractionDigits(currency);
  const divisor = 10 ** currencyDigits;

  const lineData = {
    labels,
    datasets: [
      { label: "Charge volume", data: summary?.timeSeries.map((point) => (point.currencies[currency] ?? 0) / divisor) ?? [], borderColor: "#7c91ff", backgroundColor: "rgba(124,145,255,.12)", fill: true, tension: .4, pointRadius: 0, pointHoverRadius: 5 },
    ],
  };
  const barData = { labels, datasets: [
    { label: "Charges", data: summary?.timeSeries.map((point) => point.chargeCount) ?? [], backgroundColor: "#8292ff", borderRadius: 5, borderSkipped: false },
  ] };
  const options = { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { backgroundColor: "#171f2d", padding: 11, cornerRadius: 8 } }, scales: { x: { grid: { display: false }, border: { display: false }, ticks: { color: "#778397", font: { size: 10 } } }, y: { grid: { color: "rgba(133,148,171,.09)" }, border: { display: false }, ticks: { color: "#778397", font: { size: 10 }, callback: (value: string | number) => money(Number(value), currency) } } } } as const;
  const activityOptions = { ...options, scales: { ...options.scales, y: { ...options.scales.y, ticks: { ...options.scales.y.ticks, callback: (value: string | number) => Number(value).toLocaleString() } } } };

  async function loadSummary(nextPeriod = period) {
    if (!token.trim()) { setApiError("Enter your access token to connect."); return; }
    setLoading(true);
    setApiError("");
    setSummary(null);
    setHistoryPage(null);
    setHistoryOpen(false);
    try {
      const apiPeriod = nextPeriod === "24 hours" ? "24h" : "7d";
      const response = await fetch(`/v1/billing/summary?period=${apiPeriod}`, { headers: { Authorization: `Bearer ${token.trim()}` } });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? `API returned ${response.status}`);
      setSummary(payload as Summary);
      setApiStatus(`Connected · ${(payload as Summary).chargeCount} charges in this period`);
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "Could not connect");
      setApiStatus("Connection failed");
    } finally { setLoading(false); }
  }

  async function loadChargeHistory(page = 1) {
    if (!token.trim()) { setHistoryError("Connect an access token before viewing charge history."); return; }
    setHistoryLoading(true);
    setHistoryError("");
    try {
      const response = await fetch(`/v1/billing/charges?page=${page}&limit=20`, { headers: { Authorization: `Bearer ${token.trim()}` } });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? `API returned ${response.status}`);
      setHistoryPage(payload as ChargePage);
      setHistoryOpen(true);
    } catch (error) {
      setHistoryError(error instanceof Error ? error.message : "Could not load charge history");
    } finally { setHistoryLoading(false); }
  }

  return <div className="app-shell">
    <aside className="sidebar">
      <a className="brand" href="#overview"><span className="brand-mark"><span>◈</span></span><span>ledger<span className="brand-light">guard</span><small>BILLING INTELLIGENCE</small></span></a>
      <div className="workspace-label">WORKSPACE</div>
      <button className="org-switch"><span className="org-avatar">{summary?.organizationId.slice(0, 1).toUpperCase() ?? "?"}</span><span className="org-copy"><b>{summary?.organizationId ?? "Connect a tenant"}</b><small>{summary ? "Verified organization" : "Awaiting access token"}</small></span><span className="chevron">⌄</span></button>
      <div className="nav-label">GENERAL</div>
      <nav><a className="nav-item active" href="#overview"><span>◫</span>Overview</a><a className="nav-item" href="#transactions"><span>⇄</span>Transactions <span className="nav-count">12</span></a><a className="nav-item" href="#customers"><span>♙</span>Customers</a><a className="nav-item" href="#analytics"><span>▤</span>Analytics</a></nav>
      <div className="nav-label manage-label">MANAGE</div>
      <nav><a className="nav-item" href="#plans"><span>▧</span>Plans & pricing</a><a className="nav-item" href="#developers"><span>⌘</span>Developers</a></nav>
      <div className="sidebar-bottom"><div className="help-card"><div className="help-icon">✳</div><b>Tenant billing</b><p>Summary is scoped to the verified organization.</p><a href="#developers">API details <span>↗</span></a></div><a className="nav-item" href="#settings"><span>⚙</span>Settings</a><div className="profile"><div className="profile-avatar">LG</div><div className="profile-copy"><b>LedgerGuard</b><small>Billing dashboard</small></div></div></div>
    </aside>
    <main className="main-content" id="overview">
      <header className="topbar"><div className="breadcrumbs">Workspace <span>/</span> <b>Overview</b></div><div className="top-actions"><button className="icon-btn" aria-label="Search">⌕</button><button className="icon-btn notification" aria-label="Notifications">♧<i /></button><div className="top-divider"/><span className="help-link">Help center ↗</span></div></header>
      <section className="content-wrap">
        <div className="welcome-row"><div><div className="eyebrow"><span className="live-dot"/> YOUR BUSINESS AT A GLANCE</div><h1>Billing overview <span className="wave">✦</span></h1><p className="subtitle">Tenant billing activity for the selected period.</p></div><div className="header-controls"><select value={period} onChange={(e) => { setPeriod(e.target.value); if (summary) void loadSummary(e.target.value); }} aria-label="Reporting period"><option>7 days</option><option>24 hours</option></select><button className="export-btn" onClick={() => window.print()}><span>↓</span> Export report</button></div></div>
        <div className="stat-grid">
          <article className="stat-card"><div className="stat-top"><span>GROSS VOLUME · {currency}</span><span className="stat-icon purple">↗</span></div><div className="stat-value">{selectedCurrency ? preciseMoney(selectedCurrency.totalMinor / divisor, currency) : "—"}</div><div className="stat-foot"><span>{selectedCurrency ? `${selectedCurrency.chargeCount} charges` : "No charges in this currency"}</span></div></article>
          <article className="stat-card"><div className="stat-top"><span>CHARGES</span><span className="stat-icon green">✓</span></div><div className="stat-value">{summary?.chargeCount.toLocaleString() ?? "—"}</div><div className="stat-foot"><span>Recorded during this period</span></div></article>
          <article className="stat-card"><div className="stat-top"><span>CUSTOMERS BILLED</span><span className="stat-icon amber">♙</span></div><div className="stat-value">{summary?.customerCount.toLocaleString() ?? "—"}</div><div className="stat-foot"><span>Unique customer IDs</span></div></article>
          <article className="stat-card"><div className="stat-top"><span>REPORTING PERIOD</span><span className="stat-icon cyan">◷</span></div><div className="stat-value">{summary ? period : "—"}</div><div className="stat-foot"><span>{summary ? `Updated ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : "Connect to load live data"}</span></div></article>
        </div>
        <div className="chart-grid">
          <section className="panel revenue-panel"><div className="panel-heading"><div><h2>Charge volume</h2><p>Recorded charges by time</p></div><select value={currency} onChange={(e) => setCurrency(e.target.value)} aria-label="Currency">{currencyOptions.map((code) => <option key={code}>{code}</option>)}</select></div><div className="revenue-total">{selectedCurrency ? preciseMoney(selectedCurrency.totalMinor / divisor, currency) : "—"}</div><div className="chart-legend"><span><i className="legend-dot captured"/>Volume ({currency})</span></div><div className="line-chart">{summary && selectedCurrency ? <Line data={lineData} options={options}/> : <p className="empty-state">{summary ? `No ${currency} charges during this period.` : "Connect with an authorized token to view tenant billing data."}</p>}</div></section>
          <section className="panel mix-panel"><div className="panel-heading"><div><h2>Tenant currencies</h2><p>Volume recorded in this period</p></div></div><div className="currency-breakdown">{summary?.currencies.length ? summary.currencies.map((item) => <div key={item.currency}><span>{item.currency}</span><b>{preciseMoney(item.totalMinor / (10 ** fractionDigits(item.currency)), item.currency)}</b><small>{item.chargeCount} charges</small></div>) : <p className="empty-state">Currency totals will appear after connecting.</p>}</div></section>
        </div>
        <div className="lower-grid">
          <section className="panel payments-panel" id="transactions"><div className="panel-heading"><div><h2>Charge activity</h2><p>Charges recorded over the selected period</p></div></div><div className="bar-chart">{summary ? <Bar data={barData} options={activityOptions}/> : <p className="empty-state">Connect to view activity.</p>}</div><div className="activity-foot"><span><i className="legend-dot captured"/> Charges <b>{summary?.chargeCount.toLocaleString() ?? "—"}</b></span><span className="activity-rate">Customers billed <b>{summary?.customerCount.toLocaleString() ?? "—"}</b></span></div></section>
          <section className="panel transactions-panel"><div className="panel-heading"><div><h2>Recent charges</h2><p>Latest charge records for this tenant</p></div><button className="view-link" onClick={() => void loadChargeHistory(1)} disabled={historyLoading}>{historyLoading ? "Loading…" : "View all →"}</button></div><div className="transaction-list">{summary?.recentCharges.length ? summary.recentCharges.map((charge) => <div className="transaction-row" key={charge.id}><div className="transaction-icon ti-purple">↗</div><div className="transaction-copy"><b>{charge.description || "Charge"}</b><small>{charge.customerId} · {new Date(charge.createdAt).toLocaleString()}</small></div><div className="transaction-amount"><b>{preciseMoney(charge.amountMinor / (10 ** fractionDigits(charge.currency)), charge.currency)}</b><small className="status paid">● Recorded</small></div></div>) : <p className="empty-state">Recent charges will appear here after connecting.</p>}</div></section>
        </div>
        {historyOpen && <section className="panel history-panel" id="charge-history"><div className="panel-heading"><div><h2>Charge history</h2><p>{historyPage?.total.toLocaleString() ?? 0} tenant charge records</p></div><button className="view-link" onClick={() => setHistoryOpen(false)}>Close</button></div>{historyError && <p className="history-error" role="alert">{historyError}</p>}<div className="transaction-list">{historyPage?.charges.length ? historyPage.charges.map((charge) => <div className="transaction-row" key={charge.id}><div className="transaction-icon ti-purple">↗</div><div className="transaction-copy"><b>{charge.description || "Charge"}</b><small>{charge.customerId} · {new Date(charge.createdAt).toLocaleString()}</small></div><div className="transaction-amount"><b>{preciseMoney(charge.amountMinor / (10 ** fractionDigits(charge.currency)), charge.currency)}</b><small className="status paid">● Recorded</small></div></div>) : <p className="empty-state">{historyLoading ? "Loading charges…" : "No charges recorded yet."}</p>}</div>{historyPage && <div className="history-controls"><button className="export-btn" onClick={() => void loadChargeHistory(historyPage.page - 1)} disabled={historyLoading || historyPage.page <= 1}>← Previous</button><span>Page {historyPage.page} of {Math.max(1, historyPage.pages)}</span><button className="export-btn" onClick={() => void loadChargeHistory(historyPage.page + 1)} disabled={historyLoading || historyPage.page >= historyPage.pages}>Next →</button></div>}</section>}
        <section className="api-strip"><div><span className="api-icon">⌘</span><div><b>API connection</b><small>Connect this dashboard to live tenant analytics</small></div></div><form className="api-connect" onSubmit={(event) => { event.preventDefault(); void loadSummary(); }}><input type="password" value={token} onChange={(e) => { setToken(e.target.value); setSummary(null); setHistoryPage(null); setHistoryOpen(false); setApiStatus("Token changed · reconnect to reload tenant data"); }} placeholder="Paste RS256 access token" aria-label="API access token" autoComplete="off"/><button disabled={loading}>{loading ? "Connecting…" : "Connect"}</button><span className={`api-status${apiError ? " api-status-error" : ""}`}><i/> {apiStatus}</span>{apiError && <small className="api-error" role="alert">{apiError}</small>}</form></section>
        <footer className="footer"><span>© 2025 LedgerGuard, Inc.</span><div><a href="#status">System status <i/> Operational</a><a href="#privacy">Privacy</a><a href="#terms">Terms</a></div><span>Built for better business <b>✦</b></span></footer>
      </section>
    </main>
  </div>;
}
