// js/dashboard.js  ✅ UPDATED: "swap" REMOVED (counts + chart dataset)
import { db } from "./firebase-config.js";

import {
  collection,
  getDocs,
  getCountFromServer,
  query,
  where,
  orderBy,
  limit,
  Timestamp
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

/* =========================
   SMALL HELPERS
   ========================= */
function $(id) { return document.getElementById(id); }

function setText(id, text) {
  const el = $(id);
  if (el) el.textContent = String(text);
}

function safeLower(x) {
  return String(x || "").toLowerCase().trim();
}

function isSuspendedUser(u) {
  if (u?.accountStatus === "banned") return true;
  if (u?.accountStatus === "suspended") return true;
  if (u?.isSuspended === true) return true;
  return false;
}

function isBannedUser(u) {
  return u?.accountStatus === "banned" || u?.status === "banned";
}

function pickName(u) {
  return u?.name || u?.fullName || u?.username || u?.displayName || "Unknown";
}

function txCount(u) {
  return (
    u?.transactionsCount ??
    u?.totalTransactions ??
    u?.rentalsCount ??
    u?.trxCount ??
    0
  );
}

function formatJoined(ts) {
  const d = ts?.toDate ? ts.toDate() : null;
  return d ? d.toLocaleDateString() : "-";
}

function escapeHtml(v) {
  return String(v ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/* =========================
   CHART BACKGROUND PLUGIN
   ========================= */
const darkChartBgPlugin = {
  id: "darkChartBg",
  beforeDraw(chart, args, opts) {
    const { ctx, chartArea } = chart;
    if (!chartArea) return;

    ctx.save();
    ctx.fillStyle = (opts && opts.color) ? opts.color : "#0b1e3a";
    ctx.fillRect(
      chartArea.left,
      chartArea.top,
      chartArea.right - chartArea.left,
      chartArea.bottom - chartArea.top
    );
    ctx.restore();
  }
};

function makeSoftLineFill(ctx, chartArea) {
  const g = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
  g.addColorStop(0, "rgba(72,178,255,.30)");
  g.addColorStop(0.6, "rgba(72,178,255,.10)");
  g.addColorStop(1, "rgba(72,178,255,0)");
  return g;
}

function compactNumber(n) {
  const x = Number(n || 0);
  if (x >= 1000000) return (x / 1000000).toFixed(1).replace(".0", "") + "M";
  if (x >= 1000) return (x / 1000).toFixed(1).replace(".0", "") + "K";
  return String(x);
}

/* =========================
   PREMIUM CHART THEME
   ========================= */
function setPremiumChartDefaults() {
  if (typeof Chart === "undefined") return;

  const THEME = {
    chartBg: "#0b1e3a",
    text: "rgba(255,255,255,.92)",
    muted: "rgba(255,255,255,.70)",
    grid: "rgba(255,255,255,.10)",
    tooltipBg: "rgba(255,255,255,.98)",
    tooltipTitle: "rgba(15,23,42,.95)",
    tooltipBody: "rgba(15,23,42,.80)"
  };

  Chart.defaults.font.family =
    'system-ui, -apple-system, Segoe UI, Roboto, "Helvetica Neue", Arial';
  Chart.defaults.font.size = 12;

  Chart.defaults.color = THEME.muted;

  Chart.defaults.plugins.tooltip.backgroundColor = THEME.tooltipBg;
  Chart.defaults.plugins.tooltip.borderColor = "rgba(15,23,42,.12)";
  Chart.defaults.plugins.tooltip.borderWidth = 1;
  Chart.defaults.plugins.tooltip.cornerRadius = 14;
  Chart.defaults.plugins.tooltip.padding = 12;
  Chart.defaults.plugins.tooltip.titleColor = THEME.tooltipTitle;
  Chart.defaults.plugins.tooltip.bodyColor = THEME.tooltipBody;

  Chart.defaults.plugins.legend.labels.usePointStyle = true;
  Chart.defaults.plugins.legend.labels.pointStyle = "circle";
  Chart.defaults.plugins.legend.labels.boxWidth = 8;
  Chart.defaults.plugins.legend.labels.boxHeight = 8;
  Chart.defaults.plugins.legend.labels.color = THEME.text;

  Chart.defaults.scale.grid.color = THEME.grid;
  Chart.defaults.scale.border.color = "rgba(255,255,255,.12)";
  Chart.defaults.scale.ticks.color = THEME.muted;
  Chart.defaults.scale.ticks.padding = 8;

  Chart.defaults.animation.duration = 650;

  Chart.register(darkChartBgPlugin);
}

/* =========================
   CHART HELPERS
   ========================= */
let weeklyChart = null;
let casesInflowChart = null;
let casesStatusChart = null;
let disputeOutcomesChart = null;

function destroyCharts() {
  try { weeklyChart?.destroy(); } catch {}
  try { casesInflowChart?.destroy(); } catch {}
  try { casesStatusChart?.destroy(); } catch {}
  try { disputeOutcomesChart?.destroy(); } catch {}
  weeklyChart = casesInflowChart = casesStatusChart = disputeOutcomesChart = null;
}
function isDepositDisputeReport(r) {
  const issue = safeLower(r.issueType);
  return issue.includes("deposit dispute") || safeLower(r.reason).includes("deposit");
}

function pickReportDate(r) {
  return r.createdAt || r.updatedAt || r.resolvedAt || r.decidedAt || null;
}

function normalizeCaseStatus(r) {
  const st = safeLower(r.status);
  if (st === "pending" || st === "open") return "pending";
  if (st === "in_review" || st === "review" || st === "in review") return "in_review";
  if (st === "resolved" || st === "closed") return "resolved";
  // fallback: treat unknown as in review
  return "in_review";
}


function lastNDaysLabels(n = 7) {
  const labels = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    labels.push(d.toLocaleDateString(undefined, { weekday: "short" }));
  }
  return labels;
}

function dayKey(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.getTime();
}

/* =========================
   DASHBOARD COUNTERS (FIXED)
   ========================= */
// Total Active Users = users where NOT suspended AND NOT banned
async function fetchActiveUsersCount() {
  try {
    const snaps = await getDocs(query(collection(db, "users"), limit(3000)));
    let active = 0;
    snaps.forEach(docSnap => {
      const u = docSnap.data() || {};
      const suspended = isSuspendedUser(u);
      const banned = isBannedUser(u);
      if (!suspended && !banned) active += 1;
    });
    return active;
  } catch (e) {
    console.warn("[dashboard] fetchActiveUsersCount failed:", e);
    return 0;
  }
}
async function fetchTotalListingsCount() {
  try {
    const snaps = await getDocs(query(collection(db, "tools"), limit(3000)));
    let total = 0;
    snaps.forEach(d => {
      const t = d.data() || {};
      if (t.adminHidden === true) return;
      total += 1;
    });
    return total;
  } catch (e) {
    console.warn("[dashboard] fetchTotalListingsCount failed:", e);
    return 0;
  }
}
async function fetchReportQueueCounts() {
  const colRef = collection(db, "reports");

  // You currently have: status = "pending" and "resolved"
  // We'll treat these as "in review" too:
  // "in_review", "review", "in review", "open"
  const inReviewStatuses = ["in_review", "review", "in review", "open"];

  // Try fast server counts first
  try {
    const pendingRes = await getCountFromServer(query(colRef, where("status", "==", "pending")));

    const inReviewResults = await Promise.allSettled(
      inReviewStatuses.map(st => getCountFromServer(query(colRef, where("status", "==", st))))
    );
    const inReview = inReviewResults.reduce((sum, r) => {
      if (r.status !== "fulfilled") return sum;
      return sum + (r.value.data().count || 0);
    }, 0);

    return { pending: pendingRes.data().count || 0, inReview };
  } catch (e) {
    console.warn("[dashboard] fetchReportQueueCounts failed, fallback:", e);
  }

  // Fallback scan
  const out = { pending: 0, inReview: 0 };
  try {
    const snaps = await getDocs(query(colRef, limit(3000)));
    snaps.forEach(d => {
      const r = d.data() || {};
      const st = safeLower(r.status);

      if (st === "pending") out.pending += 1;
      else if (inReviewStatuses.includes(st)) out.inReview += 1;
    });
  } catch {}
  return out;
}

async function fetchOngoingCompletedRentals() {
  const colRef = collection(db, "rentals");

  // ✅ statuses you currently use
  // ongoing = "ongoing"
  // completed = "completed"
  // NOTE: you also have "completion_review" (not completed yet)
  // we will NOT count completion_review as completed; you can decide if you want it in ongoing
  try {
    const [ongoingRes, completedRes] = await Promise.all([
      getCountFromServer(query(colRef, where("status", "==", "ongoing"))),
      getCountFromServer(query(colRef, where("status", "==", "completed")))
    ]);

    return {
      ongoing: ongoingRes.data().count || 0,
      completed: completedRes.data().count || 0
    };
  } catch (e) {
    console.warn("[dashboard] fetchOngoingCompletedRentals count failed, fallback:", e);

    // fallback scan
    const out = { ongoing: 0, completed: 0 };
    try {
      const snaps = await getDocs(query(colRef, limit(3000)));
      snaps.forEach(d => {
        const r = d.data() || {};
        const st = safeLower(r.status);
        if (st === "ongoing") out.ongoing += 1;
        if (st === "completed") out.completed += 1;
      });
    } catch {}
    return out;
  }
}


async function fetchTotalRentalsCount() {
  try {
    const res = await getCountFromServer(collection(db, "rentals"));
    return res.data().count || 0;
  } catch (e) {
    console.warn("[dashboard] getCountFromServer rentals failed, fallback:", e);
    try {
      const snaps = await getDocs(query(collection(db, "rentals"), limit(3000)));
      return snaps.size || 0;
    } catch { return 0; }
  }
}

async function fetchPendingReportsCount() {
  const colRef = collection(db, "reports");

  try {
    const res = await getCountFromServer(query(colRef, where("status", "==", "pending")));
    return res.data().count || 0;
  } catch {}

  try {
    const res = await getCountFromServer(query(colRef, where("status", "==", "open")));
    return res.data().count || 0;
  } catch {}

  try {
    const snaps = await getDocs(query(colRef, orderBy("updatedAt", "desc"), limit(2000)));
    let pending = 0;
    snaps.forEach(s => {
      const r = s.data() || {};
      const st = safeLower(r.status);
      if (st && st !== "resolved" && st !== "closed") pending += 1;
    });
    return pending;
  } catch (e) {
    console.warn("[dashboard] pending reports fallback failed:", e);
    return 0;
  }
}

/* =========================
   TABLES (RECENT REPORTS + LATEST USERS)
   ========================= */
function badgeHtml(status) {
  const st = safeLower(status);
  if (st === "resolved" || st === "closed") return `<span class="metric-chip">Resolved</span>`;
  if (st === "pending" || st === "open") return `<span class="metric-chip danger">Pending</span>`;
  return `<span class="metric-chip"> ${escapeHtml(status || "Unknown")} </span>`;
}

async function loadRecentReportsTable() {
  const tbody = $("recentReportsTbody");
  if (!tbody) return;

  tbody.innerHTML = `<tr><td colspan="6">Loading…</td></tr>`;

  try {
    const snaps = await getDocs(
      query(collection(db, "reports"), orderBy("updatedAt", "desc"), limit(6))
    );

    const rows = [];
    snaps.forEach(d => {
      const r = d.data() || {};
      const id = d.id || r.id || "-";
      const user = r.reportedUserName || r.reportedUserId || r.reportedBy || "-";
      const tool = r.toolName || r.toolId || "-";
      const type = r.issueType || r.targetType || "Report";
      const status = r.status || "pending";

      rows.push(`
        <tr>
          <td>${escapeHtml(id)}</td>
          <td>${escapeHtml(user)}</td>
          <td>${escapeHtml(tool)}</td>
          <td>${escapeHtml(type)}</td>
          <td>${badgeHtml(status)}</td>
          <td>
            <button class="btn" type="button" onclick="window.location.href='reports.html'">View</button>
          </td>
        </tr>
      `);
    });

    tbody.innerHTML = rows.length
      ? rows.join("")
      : `<tr><td colspan="6">No reports found.</td></tr>`;
  } catch (e) {
    console.error("[dashboard] loadRecentReportsTable failed:", e);
    tbody.innerHTML = `<tr><td colspan="6">Failed to load reports.</td></tr>`;
  }
}

async function loadLatestUsersTable() {
  const tbody = $("latestUsersTbody");
  if (!tbody) return;

  tbody.innerHTML = `<tr><td colspan="5">Loading…</td></tr>`;

  try {
    const snaps = await getDocs(
      query(collection(db, "users"), orderBy("updatedAt", "desc"), limit(6))
    );

    const rows = [];
    snaps.forEach(d => {
      const u = d.data() || {};
      const name = pickName(u);
      const joined = formatJoined(u.createdAt || u.joinedAt);
      const trx = txCount(u);

      const suspended = isSuspendedUser(u);
      const banned = isBannedUser(u);
      const status = banned ? "Banned" : suspended ? "Suspended" : "Active";

      rows.push(`
        <tr>
          <td>${escapeHtml(name)}</td>
          <td>${escapeHtml(joined)}</td>
          <td>${escapeHtml(trx)}</td>
          <td>${badgeHtml(status)}</td>
          <td>
            <button class="btn" type="button" onclick="window.location.href='users.html'">Open</button>
          </td>
        </tr>
      `);
    });

    tbody.innerHTML = rows.length
      ? rows.join("")
      : `<tr><td colspan="5">No users found.</td></tr>`;
  } catch (e) {
    console.error("[dashboard] loadLatestUsersTable failed:", e);
    tbody.innerHTML = `<tr><td colspan="5">Failed to load users.</td></tr>`;
  }
}

/* =========================
   STATUS COUNTS (CHARTS)
   ========================= */
async function fetchRentalStatusCounts() {
  const statuses = ["pending", "ongoing", "completed", "cancelled"];
  const colRef = collection(db, "rentals");

  try {
    const results = await Promise.allSettled(
      statuses.map(s => getCountFromServer(query(colRef, where("status", "==", s))))
    );
    const counts = {};
    results.forEach((res, idx) => {
      const key = statuses[idx];
      counts[key] = res.status === "fulfilled" ? (res.value.data().count || 0) : 0;
    });
    return counts;
  } catch {}

  const counts = { pending: 0, ongoing: 0, completed: 0, cancelled: 0 };
  try {
    const snaps = await getDocs(query(colRef, limit(3000)));
    snaps.forEach(d => {
      const r = d.data() || {};
      const s = safeLower(r.status);
      if (counts[s] != null) counts[s] += 1;
    });
  } catch {}
  return counts;
}

function parseDDMMYYYY(s) {
  // supports "25/1/2026" or "25/01/2026"
  const str = String(s || "").trim();
  const m = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;

  const dd = Number(m[1]);
  const mm = Number(m[2]);
  const yyyy = Number(m[3]);

  const d = new Date(yyyy, mm - 1, dd);
  d.setHours(0, 0, 0, 0);

  return isNaN(d.getTime()) ? null : d;
}

async function fetchInReviewReportsCount() {
  const colRef = collection(db, "reports");

  // treat these as "in review"
  const inReviewStatuses = ["open", "in_review", "review", "in review"];

  // fast count attempt
  try {
    const results = await Promise.allSettled(
      inReviewStatuses.map(st => getCountFromServer(query(colRef, where("status", "==", st))))
    );

    return results.reduce((sum, r) => {
      if (r.status !== "fulfilled") return sum;
      return sum + (r.value.data().count || 0);
    }, 0);
  } catch (e) {
    console.warn("[dashboard] fetchInReviewReportsCount failed, fallback:", e);
  }

  // fallback scan
  let count = 0;
  try {
    const snaps = await getDocs(query(colRef, limit(3000)));
    snaps.forEach(d => {
      const st = safeLower(d.data()?.status);
      if (inReviewStatuses.includes(st)) count += 1;
    });
  } catch {}
  return count;
}

/* ✅ UPDATED: LISTINGS AVAILABILITY COUNTS (based on your tool fields) */
async function fetchListingAvailabilityCounts() {
  const counts = { available: 0, booked: 0, hidden: 0, expired: 0 };

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  try {
    const snaps = await getDocs(query(collection(db, "tools"), limit(3000)));

    snaps.forEach(docSnap => {
      const t = docSnap.data() || {};

      // 1) Hidden (admin hidden)
      if (t.adminHidden === true) {
        counts.hidden += 1;
        return;
      }

      // 2) Expired (availability.endDate is "DD/MM/YYYY")
      const endStr = t?.availability?.endDate;
      const endDate = parseDDMMYYYY(endStr);
      if (endDate && endDate < today) {
        counts.expired += 1;
        return;
      }

      // 3) Booked (status OR bookedRanges has data)
      const st = safeLower(t.status);
      const br = t.bookedRanges;

      const bookedRangesHasData =
        Array.isArray(br) ? br.length > 0 :
        (br && typeof br === "object") ? Object.keys(br).length > 0 :
        false;

      if (st === "booked" || bookedRangesHasData) {
        counts.booked += 1;
        return;
      }

      // 4) Available (default)
      counts.available += 1;
    });

    return counts;
  } catch (e) {
    console.warn("[dashboard] fetchListingAvailabilityCounts failed:", e);
    return counts;
  }
}


/* =========================
   1) WEEKLY BOOKINGS (LINE)
   ========================= */
async function buildWeeklyBookingsChart() {
  const canvas = $("chartWeeklyBookings");
  if (!canvas || typeof Chart === "undefined") return;

  const labels = lastNDaysLabels(7);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const start = new Date(today);
  start.setDate(today.getDate() - 6);

  const bucket = new Map();
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    bucket.set(dayKey(d), 0);
  }

  const startTs = Timestamp.fromDate(start);

  let docs = [];
  try {
    const snaps = await getDocs(
      query(collection(db, "rentals"), where("createdAt", ">=", startTs), orderBy("createdAt", "asc"), limit(500))
    );
    docs = snaps.docs.map(s => s.data());
  } catch {
    const snaps = await getDocs(query(collection(db, "rentals"), limit(1200)));
    docs = snaps.docs.map(s => s.data());
  }

  docs.forEach(r => {
    const ts = r.createdAt || r.paidAt || r.statusUpdatedAt;
    const dt = ts?.toDate ? ts.toDate() : null;
    if (!dt || dt < start) return;
    const k = dayKey(dt);
    if (bucket.has(k)) bucket.set(k, (bucket.get(k) || 0) + 1);
  });

  const data = Array.from(bucket.values());

  weeklyChart = new Chart(canvas, {
    type: "line",
    data: {
      labels,
      datasets: [{
        label: "Bookings",
        data,
        borderColor: "rgba(72,178,255,1)",
        borderWidth: 3,
        tension: 0.42,
        fill: true,
        backgroundColor: (c) => {
          const { chart } = c;
          const area = chart.chartArea;
          if (!area) return "rgba(72,178,255,.12)";
          return makeSoftLineFill(chart.ctx, area);
        },
        pointRadius: 3,
        pointHoverRadius: 5,
        pointBorderWidth: 2,
        pointBackgroundColor: "#ffffff",
        pointBorderColor: "rgba(72,178,255,1)"
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        darkChartBg: { color: "#0b1e3a" },
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: (items) => items?.[0]?.label ?? "",
            label: (item) => `Bookings: ${item.formattedValue}`
          }
        }
      },
      scales: {
        x: { grid: { display: false }, ticks: { maxRotation: 0, color: "rgba(255,255,255,.70)" } },
        y: { beginAtZero: true, ticks: { precision: 0, color: "rgba(255,255,255,.70)", callback: (v) => compactNumber(v) } }
      }
    }
  });
}

async function buildCasesInflowChart() {
  const canvas = $("chartCasesInflow");
  if (!canvas || typeof Chart === "undefined") return;

  const labels = lastNDaysLabels(7);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const start = new Date(today);
  start.setDate(today.getDate() - 6);

  const bucket = new Map();
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    bucket.set(dayKey(d), 0);
  }

  const startTs = Timestamp.fromDate(start);

  let docs = [];
  try {
    const snaps = await getDocs(
      query(
        collection(db, "reports"),
        where("createdAt", ">=", startTs),
        orderBy("createdAt", "asc"),
        limit(800)
      )
    );
    docs = snaps.docs.map(s => s.data());
  } catch {
    const snaps = await getDocs(query(collection(db, "reports"), limit(1500)));
    docs = snaps.docs.map(s => s.data());
  }

  docs.forEach(r => {
    const ts = pickReportDate(r);
    const dt = ts?.toDate ? ts.toDate() : null;
    if (!dt || dt < start) return;
    const k = dayKey(dt);
    if (bucket.has(k)) bucket.set(k, (bucket.get(k) || 0) + 1);
  });

  const data = Array.from(bucket.values());

  casesInflowChart = new Chart(canvas, {
    type: "line",
    data: {
      labels,
      datasets: [{
        label: "New Cases",
        data,
        borderColor: "rgba(72,178,255,1)",
        borderWidth: 3,
        tension: 0.42,
        fill: true,
        backgroundColor: (c) => {
          const { chart } = c;
          const area = chart.chartArea;
          if (!area) return "rgba(72,178,255,.12)";
          return makeSoftLineFill(chart.ctx, area);
        },
        pointRadius: 3,
        pointHoverRadius: 5,
        pointBorderWidth: 2,
        pointBackgroundColor: "#ffffff",
        pointBorderColor: "rgba(72,178,255,1)"
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        darkChartBg: { color: "#0b1e3a" },
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (item) => `Cases: ${item.formattedValue}`
          }
        }
      },
      scales: {
        x: { grid: { display: false }, ticks: { maxRotation: 0, color: "rgba(255,255,255,.70)" } },
        y: { beginAtZero: true, ticks: { precision: 0, color: "rgba(255,255,255,.70)", callback: (v) => compactNumber(v) } }
      }
    }
  });
}

async function buildCasesByStatusChart() {
  const canvas = $("chartCasesByStatus");
  if (!canvas || typeof Chart === "undefined") return;

  let docs = [];
  try {
    const snaps = await getDocs(query(collection(db, "reports"), orderBy("updatedAt", "desc"), limit(1500)));
    docs = snaps.docs.map(s => s.data());
  } catch {
    const snaps = await getDocs(query(collection(db, "reports"), limit(1500)));
    docs = snaps.docs.map(s => s.data());
  }

  const now = Date.now();
  const OVERDUE_MS = 48 * 60 * 60 * 1000; // 48 hours

  let pending = 0, inReview = 0, resolved = 0, overdue = 0;

  docs.forEach(r => {
    const st = normalizeCaseStatus(r);
    const created = r.createdAt?.toDate ? r.createdAt.toDate() : null;

    if (st === "resolved") {
      resolved += 1;
      return;
    }

    if (st === "pending") pending += 1;
    else inReview += 1;

    if (created && (now - created.getTime()) > OVERDUE_MS) overdue += 1;
  });

  const labels = ["Pending", "In Review", "Resolved", "Overdue"];
  const data = [pending, inReview, resolved, overdue];

  casesStatusChart = new Chart(canvas, {
    type: "bar",
    data: {
      labels,
      datasets: [{
        label: "Cases",
        data,
        borderRadius: 999,
        barThickness: 14,
        backgroundColor: [
          "rgba(255,202,40,.95)",  // Pending
          "rgba(79,195,247,.95)",  // In Review
          "rgba(102,187,106,.95)", // Resolved
          "rgba(239,83,80,.95)"    // Overdue
        ]
      }]
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        darkChartBg: { color: "#0b1e3a" },
        legend: { display: false }
      },
      scales: {
        x: {
          beginAtZero: true,
          grid: { display: false },
          ticks: { precision: 0, color: "rgba(255,255,255,.70)", callback: (v) => compactNumber(v) }
        },
        y: { grid: { display: false }, ticks: { color: "rgba(255,255,255,.80)" } }
      }
    }
  });
}

async function buildDisputeOutcomesChart() {
  const canvas = $("chartDisputeOutcomes");
  if (!canvas || typeof Chart === "undefined") return;

  let docs = [];
  try {
    const snaps = await getDocs(query(collection(db, "reports"), limit(2000)));
    docs = snaps.docs.map(s => s.data());
  } catch { docs = []; }

  const counts = { released: 0, partial: 0, forfeited: 0, held: 0 };

  docs.forEach(r => {
    if (!isDepositDisputeReport(r)) return;

    const st = normalizeCaseStatus(r);

    // if unresolved -> HELD (still pending decision)
    if (st !== "resolved") {
      counts.held += 1;
      return;
    }

    const outcome = safeLower(r?.decision?.depositOutcome || "");
    if (outcome.includes("release")) counts.released += 1;
    else if (outcome.includes("partial")) counts.partial += 1;
    else if (outcome.includes("forfeit")) counts.forfeited += 1;
    else counts.released += 1; // fallback
  });

  const labels = ["RELEASED", "PARTIAL", "FORFEITED", "HELD"];
  const data = [counts.released, counts.partial, counts.forfeited, counts.held];

  disputeOutcomesChart = new Chart(canvas, {
    type: "doughnut",
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: [
          "rgba(102,187,106,.95)", // Released
          "rgba(255,202,40,.95)",  // Partial
          "rgba(239,83,80,.95)",   // Forfeited
          "rgba(79,195,247,.95)"   // Held
        ],
        borderWidth: 0,
        hoverOffset: 10,
        borderRadius: 14,
        spacing: 4,
        cutout: "70%"
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        darkChartBg: { color: "#0b1e3a" },
        legend: { position: "bottom", labels: { padding: 16, color: "rgba(255,255,255,.80)" } }
      }
    }
  });
}

/* =========================
   LOAD DASHBOARD DATA
   ========================= */
async function loadDashboardData() {
  destroyCharts();

const [
  activeUsers,
  totalListings,
  totalRentals,
  pendingReports,
  inReviewCount
] = await Promise.all([
  fetchActiveUsersCount(),
  fetchTotalListingsCount(),
  fetchTotalRentalsCount(),
  fetchPendingReportsCount(),    
  fetchInReviewReportsCount()     
]);
setText("mTotalUsers", activeUsers);
setText("mTotalListings", totalListings);
setText("mTotalRentals", totalRentals);
setText("mPendingReports", pendingReports);

setText("mInReviewReportsMini", inReviewCount || 0);


await Promise.all([
  loadRecentReportsTable(),
  loadLatestUsersTable(),
  buildWeeklyBookingsChart(),   
  buildCasesInflowChart(),
  buildCasesByStatusChart(),
  buildDisputeOutcomesChart()
]);

}

/* =========================
   INIT (STANDARDIZED - WAIT FOR dashboard-page.js GUARD)
   ========================= */
async function init() {
  if (!window.GT_ADMIN_READY) {
    console.error("[dashboard] GT_ADMIN_READY missing. Ensure dashboard-page.js is loaded before dashboard.js");
    return;
  }

  const admin = await window.GT_ADMIN_READY;
  if (!admin) return;

  setPremiumChartDefaults();
  await loadDashboardData();
}

window.addEventListener("DOMContentLoaded", init);
