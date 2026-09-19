"use strict";

const state = {
  config: null,
  base: "",
  visitor: null,
  token: null,
  embedError: null,
  statusTimer: null,
  fastTimer: null,
  widgetRequested: false,
};

const els = {
  crumbs: document.getElementById("crumbs"),
  views: {
    dashboard: document.getElementById("view-dashboard"),
    contacts: document.getElementById("view-contacts"),
    deals: document.getElementById("view-deals"),
    integrations: document.getElementById("view-integrations"),
  },
  themeBtn: document.getElementById("themeBtn"),
  widgetFrame: document.getElementById("widgetFrame"),
  widgetLoading: document.getElementById("widgetLoading"),
  embedNotice: document.getElementById("embedNotice"),
  kpiConnected: document.getElementById("kpiConnected"),
  kpiSynced: document.getElementById("kpiSynced"),
  kpiCreated: document.getElementById("kpiCreated"),
  kpiUpdated: document.getElementById("kpiUpdated"),
  kpiSkipped: document.getElementById("kpiSkipped"),
  activity: document.getElementById("activity"),
  workflowLinks: document.getElementById("workflowLinks"),
  userName: document.getElementById("userName"),
  userRole: document.getElementById("userRole"),
  userAvatar: document.getElementById("userAvatar"),
};

const TITLES = {
  dashboard: "Dashboard",
  contacts: "Contacts",
  deals: "Deals",
  integrations: "Settings · Integrations",
};

function apiUrl(path) {
  return `${state.base}${path}`;
}

/*
 * A stable, anonymous identity per browser. It is what makes tenancy
 * user-level: the serverless API turns it into a userEmail/userName and mints a
 * token for that identity, so each visitor's connections stay isolated.
 */
function getVisitor() {
  let id = null;
  try {
    id = localStorage.getItem("orbit-visitor-id");
  } catch {
    /* storage unavailable */
  }
  if (!id) {
    id =
      window.crypto && window.crypto.randomUUID
        ? window.crypto.randomUUID()
        : `v-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    try {
      localStorage.setItem("orbit-visitor-id", id);
    } catch {
      /* storage unavailable */
    }
  }
  return id;
}

function visitorLabel(id) {
  const short = String(id).replace(/[^a-zA-Z0-9]/g, "").slice(0, 6) || "anon";
  return `Visitor ${short}`;
}

function setView(name) {
  if (!els.views[name]) name = "dashboard";
  Object.entries(els.views).forEach(([key, el]) => {
    el.hidden = key !== name;
  });
  document.querySelectorAll(".nav-item").forEach((a) => {
    a.classList.toggle("active", a.dataset.view === name);
  });
  els.crumbs.textContent = TITLES[name] || "Dashboard";

  if (name === "integrations") ensureWidget();
}

function initTheme() {
  const saved = localStorage.getItem("orbit-theme");
  const theme = saved || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  document.documentElement.setAttribute("data-theme", theme);
  els.themeBtn.addEventListener("click", () => {
    const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("orbit-theme", next);
  });
}

function initNav() {
  document.querySelectorAll(".nav-item").forEach((a) => {
    a.addEventListener("click", () => setView(a.dataset.view));
  });
  window.addEventListener("hashchange", () => setView(location.hash.replace("#", "")));
}

function renderNotice(message) {
  els.embedNotice.hidden = false;
  els.embedNotice.textContent = message;
}

function paintVisitorIdentity() {
  if (!state.visitor) return;
  const label = visitorLabel(state.visitor);
  if (els.userName) els.userName.textContent = label;
  if (els.userRole) els.userRole.textContent = "You";
  if (els.userAvatar) els.userAvatar.textContent = label.slice(-1).toUpperCase();
}

/*
 * Load non-secret configuration. ./config.json is always readable (it is what
 * tells us where the API lives); /api/config refines it when the serverless
 * backend is reachable.
 */
async function loadConfig() {
  let fileCfg = {};
  try {
    const r = await fetch("./config.json", { cache: "no-store" });
    if (r.ok) fileCfg = await r.json();
  } catch {
    /* no static config */
  }

  state.config = fileCfg || {};
  state.base = String(state.config.apiBase || "").replace(/\/+$/, "");

  try {
    const r = await fetch(apiUrl("/api/config"), { cache: "no-store" });
    if (r.ok) {
      const server = await r.json();
      state.config = {
        ...fileCfg,
        ...server,
        connectors: server.connectors || fileCfg.connectors || {},
        workflows: fileCfg.workflows || server.workflows || [],
      };
      state.config.canMintToken = Boolean(server.canMintToken);
    }
  } catch {
    /* static hosting only; token mint will report the real reason */
  }
}

function setConnectorState(id, label, dotState) {
  const stateEl = document.getElementById(`state-${id}`);
  const dotEl = document.getElementById(`dot-${id}`);
  const btn = document.querySelector(`[data-connect="${id}"]`);
  if (stateEl) stateEl.textContent = label;
  if (dotEl) dotEl.setAttribute("data-state", dotState);
  if (btn) btn.classList.toggle("ghost", dotState === "connected");
}

function renderKpis(kpis, connectedCount) {
  const paint = (el, value) => {
    if (el) el.textContent = value === null || value === undefined ? "—" : String(value);
  };
  paint(els.kpiConnected, connectedCount);
  if (!kpis) return;
  paint(els.kpiSynced, kpis.syncsToday);
  paint(els.kpiCreated, kpis.created);
  paint(els.kpiUpdated, kpis.updated);
  paint(els.kpiSkipped, kpis.skipped);
}

function renderActivity(activity) {
  if (!els.activity) return;
  const items = Array.isArray(activity) ? activity : [];
  els.activity.innerHTML = "";
  if (!items.length) {
    const li = document.createElement("li");
    li.className = "muted small";
    li.textContent = "No sync activity yet. Connect your CRMs to get started.";
    els.activity.appendChild(li);
    return;
  }
  items.forEach((item) => {
    const li = document.createElement("li");
    const dot = document.createElement("span");
    dot.className = `dot ${item.status === "failed" ? "err" : item.status === "skipped" ? "" : "ok"}`.trim();
    li.appendChild(dot);
    const when = item.at ? new Date(item.at).toLocaleString() : "";
    li.appendChild(document.createTextNode(` ${item.workflow || "Sync"} — ${item.status || "ran"} `));
    const meta = document.createElement("span");
    meta.className = "muted small";
    meta.textContent = `· ${when}`;
    li.appendChild(meta);
    els.activity.appendChild(li);
  });
}

/*
 * Real, customer-scoped state from the serverless API. It reads the embed
 * customer only, so the owner's personal-org connections and executions never
 * appear here.
 */
async function refreshStatus() {
  let data = null;
  try {
    const r = await fetch(apiUrl("/api/status"), { cache: "no-store" });
    if (!r.ok) return;
    data = await r.json();
  } catch {
    return;
  }
  if (!data || !data.available) return;

  Object.entries(data.connectors || {}).forEach(([id, conn]) => {
    if (!document.getElementById(`state-${id}`)) return;
    if (conn.connected) {
      const verified = conn.verified === false ? " (unverified)" : "";
      setConnectorState(id, `Connected${verified}`, "connected");
    } else if (conn.status && conn.status !== "unknown") {
      setConnectorState(id, `Not connected — ${String(conn.status).toLowerCase()}`, "unknown");
    } else {
      setConnectorState(id, "Not connected", "unknown");
    }
  });

  renderKpis(data.kpis, data.connectedCount);
  renderActivity(data.activity);
}

function startStatusPolling() {
  if (state.statusTimer) return;
  refreshStatus();
  state.statusTimer = setInterval(refreshStatus, 10000);
}

function stopStatusPolling() {
  if (state.statusTimer) {
    clearInterval(state.statusTimer);
    state.statusTimer = null;
  }
}

function pulseStatus() {
  refreshStatus();
  if (state.fastTimer) clearInterval(state.fastTimer);
  let ticks = 0;
  state.fastTimer = setInterval(() => {
    refreshStatus();
    if (++ticks >= 20) {
      clearInterval(state.fastTimer);
      state.fastTimer = null;
    }
  }, 3000);
}

function initConnectors() {
  document.querySelectorAll("[data-connect]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.connect;
      setConnectorState(id, "Finish sign-in in the hub below", "pending");
      els.widgetFrame.scrollIntoView({ behavior: "smooth", block: "center" });
      pulseStatus();
    });
  });
}

/*
 * The Fastn hub posts lifecycle events to its parent. Refresh on connect events,
 * and start a fresh session when the platform reports the token session expired.
 */
function initEmbedEvents() {
  window.addEventListener("message", (event) => {
    const data = event.data;
    if (!data || typeof data !== "object" || typeof data.type !== "string") return;
    if (!data.type.startsWith("fastn:")) return;
    if (/session-expired/i.test(data.type)) {
      state.widgetRequested = false;
      state.token = null;
      if (els.widgetFrame) els.widgetFrame.innerHTML = "";
      ensureWidget();
      return;
    }
    if (/connect|disconnect|ready|oauth|complete/i.test(data.type)) {
      pulseStatus();
    }
  });
}

function renderWorkflowLinks() {
  if (!els.workflowLinks || !state.config || !Array.isArray(state.config.workflows)) return;
  const links = state.config.workflows.filter((w) => w.url);
  if (!links.length) return;
  els.workflowLinks.innerHTML = "";
  links.forEach((w) => {
    const a = document.createElement("a");
    a.className = "link";
    a.href = w.url;
    a.target = "_blank";
    a.rel = "noopener";
    a.textContent = `${w.name} workflow ↗`;
    els.workflowLinks.appendChild(a);
  });
  els.workflowLinks.hidden = false;
}

async function ensureWidget() {
  if (state.widgetRequested) return;
  state.widgetRequested = true;

  if (!state.config) await loadConfig();
  renderWorkflowLinks();

  state.visitor = getVisitor();
  paintVisitorIdentity();

  try {
    const res = await fetch(apiUrl("/api/embed-token"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ visitorId: state.visitor }),
    });
    const data = await res.json();
    if (data.ok && data.token) {
      state.token = data;
      mountWidget(data);
      markReady();
      startStatusPolling();
      return;
    }
    state.embedError = data.detail || data.error || `Token request failed (${res.status})`;
  } catch (err) {
    state.embedError = err.message;
  }

  showEmbedFallback();
}

function mountWidget(data) {
  const host = String(state.config.fastnHost || "https://api.fastn.dev").replace(/\/+$/, "");
  const src = `${host}/api/v1/embed/iframe?tenant-id=${encodeURIComponent(
    data.endOrgId
  )}&token=${encodeURIComponent(data.token)}`;
  mountIframe(src);
}

function mountIframe(src) {
  if (els.widgetLoading && els.widgetLoading.parentNode) els.widgetLoading.remove();
  const iframe = document.createElement("iframe");
  iframe.src = src;
  iframe.title = "Fastn integration hub";
  iframe.setAttribute("allow", "clipboard-write");
  els.widgetFrame.appendChild(iframe);
}

function markReady() {
  setConnectorState("salesforce", "Connect in the hub below", "unknown");
  setConnectorState("zoho", "Connect in the hub below", "unknown");
  renderNotice(
    "You are signed in as a visitor. Connect your own Salesforce and Zoho CRM accounts below — they stay private to you."
  );
  startStatusPolling();
}

function showEmbedFallback() {
  if (els.widgetLoading && els.widgetLoading.parentNode) els.widgetLoading.remove();
  const detail = state.embedError ? ` (${state.embedError})` : "";
  renderNotice(
    `The integration hub is not reachable${detail}. Deploy the API (see README) and set "apiBase" in config.json to its URL, then reload.`
  );
  setConnectorState("salesforce", "Unavailable", "unknown");
  setConnectorState("zoho", "Unavailable", "unknown");
  els.widgetFrame.innerHTML =
    `<div class="widget-loading">Embed unavailable. The serverless API must be configured.</div>`;
}

async function boot() {
  initTheme();
  initNav();
  initConnectors();
  initEmbedEvents();
  state.visitor = getVisitor();
  paintVisitorIdentity();
  await loadConfig();
  setView(location.hash.replace("#", "") || "dashboard");
  startStatusPolling();
  if (location.hash.replace("#", "") === "integrations") ensureWidget();
}

boot();
