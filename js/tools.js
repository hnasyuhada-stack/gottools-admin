// js/tools.js
import { auth, db } from "./firebase-config.js";

import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import {
  collection,
  getDocs,
  getDocsFromServer,
  query,
  orderBy,
  limit
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

/* =========================
   DOM HELPERS
   ========================= */
const $ = (id) => document.getElementById(id);

/* =========================
   STATE
   ========================= */
let allTools = [];
let highlightToolId = null;
let currentAdminUid = null;

/* =========================
   GLOBAL FALLBACKS (so inline onchange ALWAYS works)
   ========================= */
window.gtApplyFilters = () => applyFiltersAndRender();
window.gtClearToolFilters = () => clearFilters();

/* =========================
   INIT
   ========================= */
function init() {
  const params = new URLSearchParams(window.location.search);
  highlightToolId = params.get("toolId") || params.get("highlight") || null;

  wireUi();
  try {
    const cache = JSON.parse(localStorage.getItem("gt_admin_cache") || "null");
    if (cache?.uid) currentAdminUid = cache.uid;
  } catch (e) {}

  onAuthStateChanged(auth, async (user) => {
    if (!user) return;

    currentAdminUid = user.uid;

    try {
      await loadTools();
    } catch (e) {
      console.error(e);
      const tbody = $("toolsTbody");
      if (tbody) tbody.innerHTML = `<tr><td colspan="7">Failed to load tools</td></tr>`;
      updateShowing(0, 0);
    }
  });
}

window.addEventListener("DOMContentLoaded", init);

/* ✅ extra safety: if module loaded after DOMContentLoaded for any reason */
if (document.readyState === "interactive" || document.readyState === "complete") {
  // avoid double init
  setTimeout(() => {
    if (!window.__gt_tools_inited) {
      window.__gt_tools_inited = true;
      init();
    }
  }, 0);
} else {
  window.__gt_tools_inited = true;
}

/* =========================
   UI WIRING
   ========================= */
function wireUi() {
  $("toolSearchInput")?.addEventListener("input", () => applyFiltersAndRender());
  $("filterVisibility")?.addEventListener("change", () => applyFiltersAndRender());
  $("filterListingType")?.addEventListener("change", () => applyFiltersAndRender());
  $("filterStatus")?.addEventListener("change", () => applyFiltersAndRender());

  $("btnClearFilters")?.addEventListener("click", () => clearFilters());
  $("btnExportCsv")?.addEventListener("click", () => exportCsv());

  $("btnRefresh")?.addEventListener("click", async () => {
    if ($("toolSearchInput")) $("toolSearchInput").value = "";
    highlightToolId = null;

    if ($("filterVisibility")) $("filterVisibility").value = "all";
    if ($("filterListingType")) $("filterListingType").value = "all";
    if ($("filterStatus")) $("filterStatus").value = "all";

    await loadTools();
  });

  /* ✅ HARD FALLBACK: even if some script messes with listeners,
     any change/input on these IDs will still filter. */
  document.addEventListener("change", (e) => {
    const id = e.target?.id;
    if (id === "filterVisibility" || id === "filterListingType" || id === "filterStatus") {
      applyFiltersAndRender();
    }
  });

  document.addEventListener("input", (e) => {
    const id = e.target?.id;
    if (id === "toolSearchInput") applyFiltersAndRender();
  });
}

function clearFilters() {
  if ($("filterVisibility")) $("filterVisibility").value = "all";
  if ($("filterListingType")) $("filterListingType").value = "all";
  if ($("filterStatus")) $("filterStatus").value = "all";
  if ($("toolSearchInput")) $("toolSearchInput").value = "";
  highlightToolId = null;
  applyFiltersAndRender();
}

/* =========================
   LOAD TOOLS (SERVER-FIRST + FALLBACK)
   ========================= */
async function loadTools() {
  const toolsTbody = $("toolsTbody");
  if (!toolsTbody) return;
  toolsTbody.innerHTML = `<tr><td colspan="7">Loading tools…</td></tr>`;
  const q = query(collection(db, "tools"), orderBy("createdAt", "desc"), limit(300));
  try {
    const snap = await getDocsFromServer(q);
    allTools = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (err) {
    console.warn("getDocsFromServer failed. Fallback to cache:", err);
    try {
      const snap = await getDocs(q);
      allTools = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (e2) {
      console.error("Fallback getDocs failed:", e2);
      toolsTbody.innerHTML = `<tr><td colspan="7">Failed to load tools</td></tr>`;
      updateMetrics([]);
      updateShowing(0, 0);
      return;
    }
  }
  updateMetrics(allTools);
  applyFiltersAndRender();
  const toolSearchInput = $("toolSearchInput");
  if (highlightToolId && toolSearchInput) {
    toolSearchInput.value = highlightToolId;
    applyFiltersAndRender();

    requestAnimationFrame(() => {
      const row = document.querySelector(`tr[data-tool-id="${safeCssEscape(highlightToolId)}"]`);
      if (row) {
        row.classList.add("row-highlight");
        row.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    });
  }
}

/* =========================
   APPLY FILTERS + SEARCH
   ========================= */
function applyFiltersAndRender() {
  const q = String($("toolSearchInput")?.value || "").toLowerCase().trim();
  const vis = String($("filterVisibility")?.value || "all").toLowerCase().trim();
  const lt = String($("filterListingType")?.value || "all").toLowerCase().trim();
  const st = String($("filterStatus")?.value || "all").toLowerCase().trim();

  const filtered = allTools.filter(t => {
    // Visibility (ONLY: visible / hidden)
    const isVisible = t.isVisible !== false; 
    if (vis === "visible" && !isVisible) return false;
    if (vis === "hidden" && isVisible) return false;
    // Status
    const status = String(t.status || "").toLowerCase().trim();
    if (st !== "all" && status !== st) return false;

    // Search
    if (!q) return true;

    const blob = [
      t.id,
      t.name,
      t.toolName,
      t.category,
      t.listingType,
      t.userName,
      t.ownerName,
      t.userId,
      t.ownerId,
      t.status
    ].map(x => String(x || "").toLowerCase()).join(" ");

    return blob.includes(q);
  });

  renderTable(filtered);
  updateShowing(filtered.length, allTools.length);
}

/* =========================
   METRICS (ONLY rent/sell/free)
   ========================= */
function updateMetrics(tools) {
  const list = Array.isArray(tools) ? tools : [];

  if ($("mTotalTools")) $("mTotalTools").textContent = list.length;

  const visible = list.filter(t => t.isVisible !== false).length;
  const hidden = list.filter(t => t.isVisible === false).length;

  if ($("mVisibleTools")) $("mVisibleTools").textContent = visible;
  if ($("mHiddenTools")) $("mHiddenTools").textContent = hidden;

  const counts = { rent: 0, sell: 0, free: 0 };
  list.forEach(t => {
    const lt = String(t.listingType || "").toLowerCase().trim();
    if (counts[lt] !== undefined) counts[lt]++;
  });

  if ($("mRentCount")) $("mRentCount").textContent = counts.rent;
  if ($("mSellCount")) $("mSellCount").textContent = counts.sell;
  if ($("mFreeCount")) $("mFreeCount").textContent = counts.free;
}

/* =========================
   SHOWING LABEL
   ========================= */
function updateShowing(showing, total) {
  if (!$("lblShowing")) return;
  $("lblShowing").textContent = `Showing ${showing} of ${total}`;
}

/* =========================
   TABLE RENDER
   ========================= */
function renderTable(tools) {
  const toolsTbody = $("toolsTbody");
  if (!toolsTbody) return;

  toolsTbody.innerHTML = "";

  if (!tools || tools.length === 0) {
    toolsTbody.innerHTML = `<tr><td colspan="7">No tools found</td></tr>`;
    return;
  }

  tools.forEach(tool => {
    const tr = document.createElement("tr");
    tr.setAttribute("data-tool-id", tool.id);

    const image = tool.imageUrls?.[0] || tool.imageUrl || "img/placeholder.png";
    const statusBadge = getStatusBadge(tool.status);

    const created =
      tool.createdAt?.toDate
        ? tool.createdAt.toDate().toLocaleDateString()
        : "-";

    const visibilityBadge = tool.isVisible === false
      ? `<span class="badge badge-muted">Hidden</span>`
      : `<span class="badge badge-ok">Visible</span>`;

    tr.innerHTML = `
      <td>
        <div class="table-tool">
          <img src="${escapeHtmlAttr(image)}" class="tool-thumb" onerror="this.src='img/placeholder.png'">
          <div class="tool-meta">
            <div class="tool-name">${escapeHtml(tool.name || tool.toolName || "-")}</div>
            <div class="tool-sub">${escapeHtml(tool.id)}</div>
          </div>
        </div>
      </td>

      <td>${escapeHtml(tool.userName || tool.ownerName || tool.userId || tool.ownerId || "-")}</td>
      <td>${escapeHtml(tool.category || "-")}</td>
      <td>${escapeHtml(String(tool.listingType || "-").toUpperCase())}</td>

      <td>${statusBadge} ${visibilityBadge}</td>

      <td>${escapeHtml(created)}</td>

      <td>
        <div class="actions-stack">
          <button class="btn-table btn-outline" onclick="viewTool('${escapeJs(tool.id)}')">View</button>
          <button class="btn-table btn-outline" onclick="openToolReports('${escapeJs(tool.id)}')">Reports</button>
        </div>
      </td>
    `;

    toolsTbody.appendChild(tr);
  });
}

/* =========================
   ACTIONS
   ========================= */
window.viewTool = (toolId) => {
  window.location.href = `tool-details.html?toolId=${encodeURIComponent(toolId)}`;
};

window.openToolReports = (toolId) => {
  window.location.href = `reports.html?toolId=${encodeURIComponent(toolId)}`;
};

/* =========================
   EXPORT CSV
   ========================= */
function exportCsv() {
  const rows = [];
  const headers = [
    "toolId","name","category","listingType","status","isVisible",
    "userId","userName","createdAt","updatedAt"
  ];
  rows.push(headers.join(","));

  for (const t of allTools) {
    const createdAt = t.createdAt?.toDate ? t.createdAt.toDate().toISOString() : "";
    const updatedAt = t.updatedAt?.toDate ? t.updatedAt.toDate().toISOString() : "";

    const line = [
      safeCsv(t.id),
      safeCsv(t.name || t.toolName),
      safeCsv(t.category),
      safeCsv(t.listingType),
      safeCsv(t.status),
      safeCsv(t.isVisible === false ? "false" : "true"),
      safeCsv(t.userId || t.ownerId),
      safeCsv(t.userName || t.ownerName),
      safeCsv(createdAt),
      safeCsv(updatedAt)
    ].join(",");

    rows.push(line);
  }

  const blob = new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = `gottools_tools_${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function safeCsv(val) {
  const s = String(val ?? "");
  return `"${s.replaceAll('"', '""')}"`;
}

/* =========================
   HELPERS
   ========================= */
function getStatusBadge(status) {
  if (!status) return `<span class="badge badge-muted">unknown</span>`;

  const s = String(status).toLowerCase().trim();
  const map = {
    available: "badge-ok",
    sold: "badge-danger",
    booked: "badge-warn",
    ongoing: "badge-warn",
    given: "badge-muted",
    reported: "badge-warn"
  };

  const cls = map[s] || "badge-muted";
  return `<span class="badge ${cls}">${escapeHtml(status)}</span>`;
}

function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeHtmlAttr(str) {
  return escapeHtml(str).replaceAll('"', "&quot;");
}

function escapeJs(str) {
  return String(str ?? "").replaceAll("\\", "\\\\").replaceAll("'", "\\'");
}

function safeCssEscape(s) {
  const v = String(s ?? "");
  if (window.CSS && typeof window.CSS.escape === "function") return window.CSS.escape(v);
  return v.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}
