"use strict";

const state = {
  config: null,
  embedError: null,
  statusTimer: null,
  fastTimer: null,
  statusAvailable: null,
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
  kpiSynced: document.getElementById("kpiSynced"),
  workflowLinks: document.getElementById("workflowLinks"),
};

const TITLES = {
  dashboard: "Dashboard",
  contacts: "Contacts",
  deals: "Deals",
  integrations: "Settings · Integrations",
};

function setView(name) {
  if (!els.views[name]) name = "dashboard";
  Object.entries(els.views).forEach(([key, el]) => {
    el.hidden = key !== name;
  });
  document.querySelectorAll(".nav-item").forEach((a) => {
    a.classList.toggle("active", a.dataset.view === name);
  });
  els.crumbs.textContent = TITLES[name] || "Dashboard";

  if (name === "integrations") {
    ensureWidget();
    if (state.config) startStatusPolling();
  } else {
    stopStatusPolling();
  }
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

function setConnectorState(id, label, dotState) {
  const stateEl = document.getElementById(`state-${id}`);
  const dotEl = document.getElementById(`dot-${id}`);
  const btn = document.querySelector(`[data-connect="${id}"]`);
  if (stateEl) stateEl.textContent = label;
  if (dotEl) dotEl.setAttribute("data-state", dotState);
  if (btn) btn.classList.toggle("ghost", dotState === "connected");
}

/*
 * Connector cards resolve from /api/status, which reads the live Fastn
 * connection state server-side (with the API key). This is what lets the host
 * app show "Connected" without the browser ever holding a credential.
 */
async function refreshConnectorStatus() {
  if (!state.config || state.config.staticHosting) return;
  let data = null;
  try {
    data = await (await fetch("api/status")).json();
  } catch {
    return;
  }

  state.statusAvailable = Boolean(data && data.available);
  if (!state.statusAvailable) return;

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
}

function startStatusPolling() {
  if (!state.config || state.config.staticHosting || els.views.integrations.hidden) return;
  if (state.statusTimer) return;
  refreshConnectorStatus();
  state.statusTimer = setInterval(refreshConnectorStatus, 5000);
}

function stopStatusPolling() {
  if (state.statusTimer) {
    clearInterval(state.statusTimer);
    state.statusTimer = null;
  }
}

function pulseStatus() {
  if (!state.config || state.config.staticHosting) return;
  refreshConnectorStatus();
  if (state.fastTimer) clearInterval(state.fastTimer);
  let ticks = 0;
  state.fastTimer = setInterval(() => {
    refreshConnectorStatus();
    if (++ticks >= 40) {
      clearInterval(state.fastTimer);
      state.fastTimer = null;
    }
  }, 3000);
}

function initConnectors() {
  document.querySelectorAll("[data-connect]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.connect;
      setConnectorState(id, "Finish sign-in and check status in the hub below", "pending");
      els.widgetFrame.scrollIntoView({ behavior: "smooth", block: "center" });
      pulseStatus();
    });
  });
}

/*
 * The Fastn hub (hosted in the iframe) posts lifecycle events to its parent.
 * Listen for them and refresh status the moment an account finishes connecting.
 */
function initEmbedEvents() {
  window.addEventListener("message", (event) => {
    const data = event.data;
    if (!data || typeof data !== "object" || typeof data.type !== "string") return;
    if (!data.type.startsWith("fastn:")) return;
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

let widgetRequested = false;

async function ensureWidget() {
  if (widgetRequested) return;
  widgetRequested = true;

  if (!state.config) {
    try {
      const response = await fetch("api/config");
      if (!response.ok) throw new Error("Server configuration unavailable");
      state.config = await response.json();
    } catch {
      try {
        const response = await fetch("./config.json");
        if (!response.ok) throw new Error("Static configuration unavailable");
        state.config = await response.json();
      } catch {
        state.config = { staticHosting: true };
      }
    }
  }

  renderWorkflowLinks();

  // Preferred: a direct Fastn shareable widget link.
  if (state.config.widgetUrl) {
    mountIframe(state.config.widgetUrl);
    markReady();
    return;
  }

  // Otherwise mint a customer-scoped embed token server-side.
  if (state.config.canMintToken) {
    try {
      const res = await fetch("api/embed-token");
      const data = await res.json();
      if (data.ok && data.token) {
        const src = `${state.config.fastnHost}/api/v1/embed/iframe?token=${encodeURIComponent(data.token)}`;
        mountIframe(src);
        markReady();
        return;
      }
      state.embedError = data.detail || data.error || "Token request failed";
    } catch (err) {
      state.embedError = err.message;
    }
  }

  showEmbedFallback();
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
  if (state.config.staticHosting) {
    renderNotice("Connect your accounts and check their live connection status in the integration hub below.");
  }
  startStatusPolling();
}

function showEmbedFallback() {
  if (els.widgetLoading && els.widgetLoading.parentNode) els.widgetLoading.remove();
  const hostHint = state.config && state.config.fastnHost ? state.config.fastnHost : "your Fastn host";
  const detail = state.embedError ? ` (${state.embedError})` : "";
  renderNotice(
    `The integration hub is not configured yet${detail}. Set WIDGET_URL (a Fastn shareable link) or FASTN_HOST + FASTN_API_KEY when starting the server, then reload.`
  );
  setConnectorState("salesforce", "Unavailable", "unknown");
  setConnectorState("zoho", "Unavailable", "unknown");
  els.widgetFrame.innerHTML =
    `<div class="widget-loading">Embed unavailable. Configure ${hostHint} and reload.</div>`;
}

function initActivity() {
  if (els.kpiSynced) els.kpiSynced.textContent = "12";
}

function boot() {
  initTheme();
  initNav();
  initConnectors();
  initEmbedEvents();
  initActivity();
  setView(location.hash.replace("#", "") || "dashboard");
}

boot();
