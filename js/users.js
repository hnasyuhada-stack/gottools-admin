// js/users.js (UPDATED: Warnings + duration (suspendedUntil/banUntil) + support email display)
import { db } from "./firebase-config.js";

import {
  collection,
  doc,
  getDocs,
  getDocsFromServer,
  getDoc,
  updateDoc,
  serverTimestamp,
  addDoc
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

/* =========================
   Firestore paths
   ========================= */
const SETTINGS_REF = doc(db, "admin_settings", "system");
const AUDIT_COL = collection(db, "audit_logs");

/* =========================
   Badge / Reputation scheme
   ========================= */
function clamp(n, min, max) {
  const x = Number(n);
  if (Number.isNaN(x)) return min;
  return Math.max(min, Math.min(max, x));
}

function badgeFromScore(score) {
  const s = clamp(score ?? 100, 0, 100);
  if (s >= 90) return "trusted";
  if (s >= 75) return "gold";
  if (s >= 55) return "silver";
  return "bronze";
}

function badgeLabel(b) {
  const x = String(b || "").toLowerCase();
  if (x === "trusted") return "Trusted";
  if (x === "gold") return "Gold";
  if (x === "silver") return "Silver";
  return "Bronze";
}

function penaltyForSeverity(sev) {
  const s = String(sev || "minor").toLowerCase();
  if (s === "major") return 30;
  return 10;
}

/* =========================
   Helpers (user fields)
   ========================= */
function pickName(u) {
  return u?.name || u?.fullName || u?.username || u?.displayName || "Unknown";
}
function pickEmail(u) {
  return u?.email || "-";
}

function pickJoined(u) {
  const t = u?.createdAt || u?.joinedAt;

  // Firestore Timestamp
  if (t?.toDate) {
    return t.toDate().toLocaleDateString();
  }

  // Milliseconds number (System.currentTimeMillis)
  if (typeof t === "number") {
    return new Date(t).toLocaleDateString();
  }

  // ISO string (if ever)
  if (typeof t === "string") {
    const d = new Date(t);
    return isNaN(d.getTime()) ? "-" : d.toLocaleDateString();
  }

  return "-";
}

function warningsCount(u) {
  const val = u?.warningCount ?? u?.warningsCount ?? u?.warning ?? 0;
  return Number(val) || 0;
}

function isSuspended(u) {
  if (u?.accountStatus === "banned") return true;
  if (u?.accountStatus === "suspended") return true;
  if (u?.isSuspended === true) return true;
  return false;
}

function isBanned(u) {
  return u?.accountStatus === "banned";
}

function userRoleLabel(u) {
  const r = String(u?.role || "").toLowerCase();
  if (r === "super_admin") return "Super Admin";
  if (r === "admin") return "Admin";
  return "User";
}

function escapeHtml(v) {
  return String(v ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = String(text);
}

function isSuperAdminRole(admin) {
  return String(admin?.role || "").toLowerCase().trim() === "super_admin";
}

/* =========================
   Duration helpers
   ========================= */
function toDateObj(ts) {
  if (!ts) return null;
  if (ts?.toDate) return ts.toDate();
  if (ts instanceof Date) return ts;
  if (typeof ts === "number") return new Date(ts);
  if (typeof ts === "string") {
    const d = new Date(ts);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function formatDateTimeAny(ts) {
  const d = toDateObj(ts);
  return d ? d.toLocaleString() : "-";
}

function durationText(u) {
  const st = String(u?.accountStatus || u?.status || "active").toLowerCase().trim();
  if (st === "banned") {
    const until = u?.banUntil;
    return until ? `Until: ${formatDateTimeAny(until)}` : "Until: Permanent";
  }
  if (st === "suspended") {
    const until = u?.suspendedUntil;
    return until ? `Until: ${formatDateTimeAny(until)}` : "Until: Further notice";
  }
  return "-";
}

function computeUntilFromDuration(durationKey) {
  const now = new Date();
  const key = String(durationKey || "indefinite").toLowerCase().trim();

  const daysMap = {
    "1d": 1,
    "3d": 3,
    "7d": 7,
    "14d": 14,
    "30d": 30
  };

  const days = daysMap[key];
  if (!days) return null; // indefinite

  const ms = days * 24 * 60 * 60 * 1000;
  return new Date(now.getTime() + ms);
}

/* =========================
   Settings + policy
   ========================= */
async function loadSettingsSafe() {
  if (window.GT_SETTINGS) return window.GT_SETTINGS;

  try {
    const snap = await getDoc(SETTINGS_REF);
    const data = snap.exists() ? (snap.data() || {}) : {};
    return {
      userBanPolicy: data.userBanPolicy || "admins_allowed",
      auditLogEnabled: !!data.auditLogEnabled,
      supportEmail: data.supportEmail || "sgottools@gmail.com"
    };
  } catch (e) {
    console.warn("[users] loadSettingsSafe failed:", e);
    return {
      userBanPolicy: "admins_allowed",
      auditLogEnabled: false,
      supportEmail: "sgottools@gmail.com"
    };
  }
}

function canModerateUsers(admin, settings) {
  const policy = String(settings?.userBanPolicy || "admins_allowed").toLowerCase().trim();
  if (policy === "super_admin_only") return isSuperAdminRole(admin);
  return true;
}

async function writeAuditIfEnabled(settings, payload) {
  const enabled = !!settings?.auditLogEnabled;
  if (!enabled) return;

  try {
    await addDoc(AUDIT_COL, {
      ...payload,
      createdAt: serverTimestamp()
    });
  } catch (e) {
    console.warn("[users] audit log write failed (non-blocking):", e);
  }
}

/* =========================
   Modal helpers (Users)
   ========================= */
function $(id){ return document.getElementById(id); }

function formatDate(ts){
  const d = ts?.toDate ? ts.toDate() : (ts instanceof Date ? ts : null);
  return d ? d.toLocaleString() : "-";
}

function statusText(u){
  const st = String(u?.accountStatus || u?.status || "active").toLowerCase().trim();
  if (st === "banned") return "Banned";
  if (st === "suspended") return "Suspended";
  return "Active";
}

function ensureModalWiredOnce(){
  const backdrop = $("gtModalBackdrop");
  const closeBtn = $("gtModalCloseBtn");
  if (!backdrop || !closeBtn) return;

  if (backdrop.dataset.wired === "1") return;
  backdrop.dataset.wired = "1";

  const close = () => closeModal();

  closeBtn.addEventListener("click", close);

  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) close();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
  });
}

function openModal({ title, sub, bodyHtml, footerHtml }){
  ensureModalWiredOnce();
  $("gtModalTitle").textContent = title || "Action";
  $("gtModalSub").textContent = sub || "";
  $("gtModalBody").innerHTML = bodyHtml || "";
  $("gtModalFooter").innerHTML = footerHtml || "";
  $("gtModalBackdrop").classList.add("show");
  $("gtModalBackdrop").setAttribute("aria-hidden", "false");
}

function closeModal(){
  const b = $("gtModalBackdrop");
  if (!b) return;
  b.classList.remove("show");
  b.setAttribute("aria-hidden", "true");
}

/* =========================
   Moderation ops
   ========================= */
async function applyWarning(userId, admin, settings, { severity = "minor", reason = "" } = {}) {
  const ref = doc(db, "users", userId);

  const snap = await getDoc(ref);
  const cur = snap.exists() ? (snap.data() || {}) : {};

  const prevWarnings = Number(cur.warningCount ?? cur.warningsCount ?? 0) || 0;
  const prevScore = clamp(cur.reputationScore ?? 100, 0, 100);

  const penalty = penaltyForSeverity(severity);
  const nextScore = clamp(prevScore - penalty, 0, 100);
  const nextBadge = badgeFromScore(nextScore);

  await updateDoc(ref, {
    warningCount: prevWarnings + 1,
    lastWarningAt: serverTimestamp(),
    lastWarningReason: reason || "",
    lastAdminAction: "warn",
    lastAdminActionAt: serverTimestamp(),
    reputationScore: nextScore,
    badgeLevel: nextBadge,
    updatedAt: serverTimestamp()
  });

  await writeAuditIfEnabled(settings, {
    type: "user_warning",
    target: { userId },
    severity,
    penalty,
    before: { warningCount: prevWarnings, reputationScore: prevScore, badgeLevel: cur.badgeLevel || "bronze" },
    after: { warningCount: prevWarnings + 1, reputationScore: nextScore, badgeLevel: nextBadge },
    reason,
    actor: { uid: admin.uid, name: admin.name || "Admin", role: admin.role || "admin" }
  });

  return { nextScore, nextBadge };
}

async function suspendUser(userId, admin, reason, settings, suspendedUntilDate = null) {
  const ref = doc(db, "users", userId);

  await updateDoc(ref, {
    isSuspended: true,
    status: "suspended",
    accountStatus: "suspended",
    suspendedAt: serverTimestamp(),
    suspendedBy: admin.uid,
    suspendReason: reason || "Suspended by admin",

    // ✅ NEW
    suspendedUntil: suspendedUntilDate ? suspendedUntilDate : null,

    lastAdminAction: "suspend",
    lastAdminActionAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });

  await writeAuditIfEnabled(settings, {
    type: "user_suspend",
    target: { userId },
    reason,
    until: suspendedUntilDate ? suspendedUntilDate.toISOString() : null,
    actor: { uid: admin.uid, name: admin.name || "Admin", role: admin.role || "admin" }
  });
}

async function activateUser(userId, admin, settings) {
  const ref = doc(db, "users", userId);

  await updateDoc(ref, {
    isSuspended: false,
    status: "active",
    accountStatus: "active",
    suspendedAt: null,
    suspendedUntil: null,   // ✅ NEW
    suspendReason: "",
    lastAdminAction: "activate",
    lastAdminActionAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });

  await writeAuditIfEnabled(settings, {
    type: "user_activate",
    target: { userId },
    actor: { uid: admin.uid, name: admin.name || "Admin", role: admin.role || "admin" }
  });
}

async function banUser(userId, admin, settings, reason) {
  const ref = doc(db, "users", userId);

  await updateDoc(ref, {
    status: "banned",
    accountStatus: "banned",
    isSuspended: true,
    bannedAt: serverTimestamp(),
    bannedBy: admin.uid,
    banReason: reason || "Major violation",

    // ✅ optional: keep as permanent unless you add ban duration UI later
    banUntil: null,

    lastAdminAction: "ban",
    lastAdminActionAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });

  await writeAuditIfEnabled(settings, {
    type: "user_ban",
    target: { userId },
    reason: reason || "",
    actor: { uid: admin.uid, name: admin.name || "Admin", role: admin.role || "admin" }
  });
}

async function unbanUser(userId, admin, settings) {
  const ref = doc(db, "users", userId);

  await updateDoc(ref, {
    status: "active",
    accountStatus: "active",
    isSuspended: false,
    bannedAt: null,
    banUntil: null,        // ✅ NEW
    banReason: "",
    lastAdminAction: "unban",
    lastAdminActionAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });

  await writeAuditIfEnabled(settings, {
    type: "user_unban",
    target: { userId },
    actor: { uid: admin.uid, name: admin.name || "Admin", role: admin.role || "admin" }
  });
}

function renderUsersTable(users, admin, settings) {
  const tbody = document.getElementById("usersTbody");
  if (!tbody) return;

  if (!users.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" style="padding:14px; color:#6b7280;">No users found.</td>
      </tr>
    `;
    return;
  }

  const usersById = new Map();
  users.forEach(u => usersById.set(u.id, u));

  const allowModeration = canModerateUsers(admin, settings);

  tbody.innerHTML = users.map((u) => {
    const suspended = isSuspended(u);
    const banned = isBanned(u);

    const statusBadge = banned
      ? `<span class="badge badge-danger">Banned</span>`
      : suspended
        ? `<span class="badge badge-warn">Suspended</span>`
        : `<span class="badge badge-ok">Active</span>`;

    const badge = badgeLabel(u?.badgeLevel);

    const w = warningsCount(u);
    const warningsBadge =
      w > 0 ? `<span class="badge badge-warn">${escapeHtml(w)}</span>`
            : `<span class="badge badge-muted">0</span>`;

    const btnWarn = `<button class="btn-table" data-action="warn" data-id="${u.id}" ${allowModeration ? "" : "disabled"}>Warn</button>`;
    const btnSuspend = `<button class="btn-table" data-action="suspend" data-id="${u.id}" ${allowModeration ? "" : "disabled"}>Suspend</button>`;
    const btnActivate = `<button class="btn-table" data-action="activate" data-id="${u.id}" ${allowModeration ? "" : "disabled"}>Activate</button>`;
    const btnBan = `<button class="btn-table" data-action="ban" data-id="${u.id}" ${allowModeration ? "" : "disabled"}>Ban</button>`;
    const btnUnban = `<button class="btn-table" data-action="unban" data-id="${u.id}" ${allowModeration ? "" : "disabled"}>Unban</button>`;

    let actionSet = "";
    if (banned) actionSet = `${btnUnban}`;
    else if (suspended) actionSet = `${btnActivate} ${btnBan}`;
    else actionSet = `${btnWarn} ${btnSuspend} ${btnBan}`;

    return `
      <tr>
        <td>
          ${escapeHtml(pickName(u))}
          <div style="font-size:12px; opacity:.7; margin-top:2px;">
            Badge: ${escapeHtml(badge)}
          </div>
        </td>
        <td>${escapeHtml(pickEmail(u))}</td>
        <td>${escapeHtml(pickJoined(u))}</td>
        <td>${warningsBadge}</td>
        <td>${statusBadge}</td>
        <td>${escapeHtml(userRoleLabel(u))}</td>
        <td class="actions-stack">
          <button class="btn-table" data-action="view" data-id="${u.id}">View</button>
          ${actionSet}
        </td>
      </tr>
    `;
  }).join("");

  const showUserDetails = async (u) => {
    let fresh = u;
    try {
      const snap = await getDoc(doc(db, "users", u.id));
      if (snap.exists()) fresh = { id: u.id, ...snap.data() };
    } catch (_) {}

    const supportEmail = (settings?.supportEmail || window.GT_SETTINGS?.supportEmail || "sgottools@gmail.com");

    const body = `
      <div class="gt-grid">
        <div class="gt-field"><div class="k">Name</div><div class="v">${escapeHtml(pickName(fresh))}</div></div>
        <div class="gt-field"><div class="k">Email</div><div class="v">${escapeHtml(pickEmail(fresh))}</div></div>
        <div class="gt-field"><div class="k">User UID</div><div class="v">${escapeHtml(fresh.id)}</div></div>
        <div class="gt-field"><div class="k">Role</div><div class="v">${escapeHtml(userRoleLabel(fresh))}</div></div>

        <div class="gt-field"><div class="k">Status</div><div class="v">${escapeHtml(statusText(fresh))}</div></div>
        <div class="gt-field"><div class="k">Duration</div><div class="v">${escapeHtml(durationText(fresh))}</div></div>

        <div class="gt-field"><div class="k">Action At</div><div class="v">${escapeHtml(formatDate(fresh.lastAdminActionAt || fresh.suspendedAt || fresh.bannedAt))}</div></div>
        <div class="gt-field"><div class="k">Support Email</div><div class="v">${escapeHtml(supportEmail)}</div></div>

        <div class="gt-field"><div class="k">Joined</div><div class="v">${escapeHtml(pickJoined(fresh))}</div></div>
        <div class="gt-field"><div class="k">Badge</div><div class="v">${escapeHtml(badgeLabel(fresh.badgeLevel))}</div></div>
        <div class="gt-field"><div class="k">Reputation</div><div class="v">${escapeHtml(fresh.reputationScore ?? 100)}</div></div>
        <div class="gt-field"><div class="k">Warnings</div><div class="v">${escapeHtml(warningsCount(fresh))}</div></div>
        <div class="gt-field"><div class="k">Last Warning</div><div class="v">${escapeHtml(formatDate(fresh.lastWarningAt))}</div></div>
      </div>

      <div class="gt-form">
        <div class="gt-field">
          <div class="k">Last Warning Reason</div>
          <div class="v">${escapeHtml(fresh.lastWarningReason || "-")}</div>
        </div>

        <div class="gt-field">
          <div class="k">Suspend Reason</div>
          <div class="v">${escapeHtml(fresh.suspendReason || "-")}</div>
        </div>

        <div class="gt-field">
          <div class="k">Ban Reason</div>
          <div class="v">${escapeHtml(fresh.banReason || "-")}</div>
        </div>
      </div>
    `;

    openModal({
      title: "User Details",
      sub: "Quick view for moderation decisions",
      bodyHtml: body,
      footerHtml: `<button class="gt-btn" type="button" id="gtCloseOnly">Close</button>`
    });

    $("gtCloseOnly").addEventListener("click", closeModal);
  };

  const showWarnModal = async (u) => {
    let fresh = u;
    try {
      const snap = await getDoc(doc(db, "users", u.id));
      if (snap.exists()) fresh = { id: u.id, ...snap.data() };
    } catch (_) {}

    const body = `
      <div class="gt-grid">
        <div class="gt-field"><div class="k">User</div><div class="v">${escapeHtml(pickName(fresh))}</div></div>
        <div class="gt-field"><div class="k">Email</div><div class="v">${escapeHtml(pickEmail(fresh))}</div></div>
        <div class="gt-field"><div class="k">Current Badge</div><div class="v">${escapeHtml(badgeLabel(fresh.badgeLevel))}</div></div>
        <div class="gt-field"><div class="k">Reputation</div><div class="v">${escapeHtml(fresh.reputationScore ?? 100)}</div></div>
      </div>

      <div class="gt-form">
        <div>
          <div class="gt-label">Severity</div>
          <select class="gt-select" id="gtWarnSeverity">
            <option value="minor">Minor (−10)</option>
            <option value="major">Major (−30)</option>
          </select>
          <div class="gt-hint">Major warning requires a reason.</div>
        </div>

        <div>
          <div class="gt-label">Reason</div>
          <textarea class="gt-textarea" id="gtWarnReason" placeholder="Write the reason (required for major)..."></textarea>
          <div class="gt-hint danger" id="gtWarnErr" style="display:none;">Major warning needs a reason.</div>
        </div>
      </div>
    `;

    openModal({
      title: "Issue Warning",
      sub: "This will reduce reputation and may downgrade badge",
      bodyHtml: body,
      footerHtml: `
        <button class="gt-btn" type="button" id="gtWarnCancel">Cancel</button>
        <button class="gt-btn primary" type="button" id="gtWarnConfirm">Confirm Warning</button>
      `
    });

    const sevEl = $("gtWarnSeverity");
    const reasonEl = $("gtWarnReason");
    const errEl = $("gtWarnErr");

    $("gtWarnCancel").addEventListener("click", closeModal);

    $("gtWarnConfirm").addEventListener("click", async () => {
      const severity = String(sevEl.value || "minor").toLowerCase().trim();
      const reason = String(reasonEl.value || "").trim();

      if (severity === "major" && !reason) {
        errEl.style.display = "block";
        reasonEl.focus();
        return;
      }
      errEl.style.display = "none";

      try {
        const res = await applyWarning(fresh.id, admin, settings, { severity, reason });
        closeModal();

        openModal({
          title: "Warning Applied",
          sub: "User reputation has been updated",
          bodyHtml: `
            <div class="gt-grid">
              <div class="gt-field"><div class="k">User</div><div class="v">${escapeHtml(pickName(fresh))}</div></div>
              <div class="gt-field"><div class="k">Severity</div><div class="v">${escapeHtml(severity.toUpperCase())}</div></div>
              <div class="gt-field"><div class="k">New Reputation</div><div class="v">${escapeHtml(res.nextScore)}</div></div>
              <div class="gt-field"><div class="k">New Badge</div><div class="v">${escapeHtml(badgeLabel(res.nextBadge))}</div></div>
            </div>
          `,
          footerHtml: `<button class="gt-btn primary" type="button" id="gtReloadOk">OK</button>`
        });

        $("gtReloadOk").addEventListener("click", () => window.location.reload());
      } catch (err) {
        console.error("[users] warn failed:", err);
        alert(`Action failed:\n${err?.message || err}`);
      }
    });
  };

  const showSuspendModal = async (u) => {
    openModal({
      title: "Suspend User",
      sub: "User will be blocked from logging in until activated",
      bodyHtml: `
        <div class="gt-grid">
          <div class="gt-field"><div class="k">User</div><div class="v">${escapeHtml(pickName(u))}</div></div>
          <div class="gt-field"><div class="k">Email</div><div class="v">${escapeHtml(pickEmail(u))}</div></div>
          <div class="gt-field"><div class="k">Current Status</div><div class="v">${escapeHtml(statusText(u))}</div></div>
          <div class="gt-field"><div class="k">User UID</div><div class="v">${escapeHtml(u.id)}</div></div>
        </div>

        <div class="gt-form">
          <div>
            <div class="gt-label">Suspend duration</div>
            <select class="gt-select" id="gtSuspendDuration">
              <option value="indefinite">Until further notice</option>
              <option value="1d">1 day</option>
              <option value="3d">3 days</option>
              <option value="7d">7 days</option>
              <option value="14d">14 days</option>
              <option value="30d">30 days</option>
            </select>
            <div class="gt-hint">Choose how long the account is suspended.</div>
          </div>

          <div>
            <div class="gt-label">Reason (optional)</div>
            <textarea class="gt-textarea" id="gtSuspendReason" placeholder="Explain why this user is suspended..."></textarea>
            <div class="gt-hint">Tip: include report ID or short evidence note.</div>
          </div>
        </div>
      `,
      footerHtml: `
        <button class="gt-btn" type="button" id="gtSuspendCancel">Cancel</button>
        <button class="gt-btn danger" type="button" id="gtSuspendConfirm">Suspend</button>
      `
    });

    $("gtSuspendCancel").addEventListener("click", closeModal);

    $("gtSuspendConfirm").addEventListener("click", async () => {
      const reason = String($("gtSuspendReason").value || "").trim();
      const durationKey = String($("gtSuspendDuration").value || "indefinite");
      const untilDate = computeUntilFromDuration(durationKey);

      try {
        await suspendUser(u.id, admin, reason, settings, untilDate);
        window.location.reload();
      } catch (err) {
        console.error("[users] suspend failed:", err);
        alert(`Action failed:\n${err?.message || err}`);
      }
    });
  };

  const showBanModal = async (u) => {
    openModal({
      title: "Ban User",
      sub: "Severe action — user will be blocked and marked as banned",
      bodyHtml: `
        <div class="gt-grid">
          <div class="gt-field"><div class="k">User</div><div class="v">${escapeHtml(pickName(u))}</div></div>
          <div class="gt-field"><div class="k">Email</div><div class="v">${escapeHtml(pickEmail(u))}</div></div>
          <div class="gt-field"><div class="k">Current Status</div><div class="v">${escapeHtml(statusText(u))}</div></div>
          <div class="gt-field"><div class="k">User UID</div><div class="v">${escapeHtml(u.id)}</div></div>
        </div>

        <div class="gt-form">
          <div>
            <div class="gt-label">Ban reason (required)</div>
            <textarea class="gt-textarea" id="gtBanReason" placeholder="Required: explain major violation..."></textarea>
            <div class="gt-hint danger" id="gtBanErr" style="display:none;">Ban reason is required.</div>
          </div>
        </div>
      `,
      footerHtml: `
        <button class="gt-btn" type="button" id="gtBanCancel">Cancel</button>
        <button class="gt-btn danger" type="button" id="gtBanConfirm">Ban User</button>
      `
    });

    $("gtBanCancel").addEventListener("click", closeModal);

    $("gtBanConfirm").addEventListener("click", async () => {
      const reason = String($("gtBanReason").value || "").trim();
      const errEl = $("gtBanErr");

      if (!reason) {
        errEl.style.display = "block";
        $("gtBanReason").focus();
        return;
      }
      errEl.style.display = "none";

      try {
        await banUser(u.id, admin, settings, reason);
        window.location.reload();
      } catch (err) {
        console.error("[users] ban failed:", err);
        alert(`Action failed:\n${err?.message || err}`);
      }
    });
  };

  const showConfirmModal = ({ title, sub, bodyHtml, confirmText = "Confirm", danger = false, onConfirm }) => {
    openModal({
      title,
      sub,
      bodyHtml,
      footerHtml: `
        <button class="gt-btn" type="button" id="gtConfirmCancel">Cancel</button>
        <button class="gt-btn ${danger ? "danger" : "primary"}" type="button" id="gtConfirmOk">${escapeHtml(confirmText)}</button>
      `
    });

    $("gtConfirmCancel").addEventListener("click", closeModal);
    $("gtConfirmOk").addEventListener("click", async () => {
      try {
        await onConfirm?.();
      } catch (err) {
        console.error("[users] confirm action failed:", err);
        alert(`Action failed:\n${err?.message || err}`);
      }
    });
  };

  tbody.querySelectorAll("button[data-action]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const action = btn.dataset.action;
      const userId = btn.dataset.id;
      const u = usersById.get(userId);
      if (!u) return;

      if (action === "view") { await showUserDetails(u); return; }

      if (!canModerateUsers(admin, settings)) {
        openModal({
          title: "Action Not Allowed",
          sub: "Policy restriction",
          bodyHtml: `<div class="gt-field"><div class="k">Message</div><div class="v">Only Super Admin can do this action (per Settings).</div></div>`,
          footerHtml: `<button class="gt-btn" type="button" id="gtNopeOk">OK</button>`
        });
        $("gtNopeOk").addEventListener("click", closeModal);
        return;
      }

      if (action === "warn") { await showWarnModal(u); return; }
      if (action === "suspend") { await showSuspendModal(u); return; }
      if (action === "ban") { await showBanModal(u); return; }

      if (action === "activate") {
        showConfirmModal({
          title: "Activate User",
          sub: "User will be allowed to login again",
          bodyHtml: `
            <div class="gt-grid">
              <div class="gt-field"><div class="k">User</div><div class="v">${escapeHtml(pickName(u))}</div></div>
              <div class="gt-field"><div class="k">User UID</div><div class="v">${escapeHtml(u.id)}</div></div>
            </div>
          `,
          confirmText: "Activate",
          onConfirm: async () => {
            await activateUser(u.id, admin, settings);
            window.location.reload();
          }
        });
        return;
      }

      if (action === "unban") {
        showConfirmModal({
          title: "Unban User",
          sub: "User status will be set back to Active",
          bodyHtml: `
            <div class="gt-grid">
              <div class="gt-field"><div class="k">User</div><div class="v">${escapeHtml(pickName(u))}</div></div>
              <div class="gt-field"><div class="k">User UID</div><div class="v">${escapeHtml(u.id)}</div></div>
            </div>
          `,
          confirmText: "Unban",
          onConfirm: async () => {
            await unbanUser(u.id, admin, settings);
            window.location.reload();
          }
        });
        return;
      }
    });
  });
}

/* =========================
   Load users (force server)
   ========================= */
async function fetchUsers() {
  const colRef = collection(db, "users");

  try {
    const snaps = await getDocsFromServer(colRef);
    const users = [];
    snaps.forEach((d) => users.push({ id: d.id, ...d.data() }));
    console.log("[users] fetched from SERVER:", users.length);
    return users;
  } catch (e) {
    console.warn("[users] getDocsFromServer failed, fallback getDocs:", e);
    const snaps = await getDocs(colRef);
    const users = [];
    snaps.forEach((d) => users.push({ id: d.id, ...d.data() }));
    console.log("[users] fetched from CACHE/FALLBACK:", users.length);
    return users;
  }
}

async function fetchAdminsCountIfAllowed(admin) {
  if (!isSuperAdminRole(admin)) return 0;

  const colRef = collection(db, "admins");

  try {
    const snaps = await getDocsFromServer(colRef);
    let count = 0;
    snaps.forEach((d) => {
      const a = d.data() || {};
      const role = String(a.role || "").toLowerCase();
      const active = a.active === true;
      if (active && (role === "admin" || role === "super_admin")) count++;
    });
    return count;
  } catch (e) {
    console.warn("[admins] getDocsFromServer failed, fallback getDocs:", e);
    const snaps = await getDocs(colRef);
    let count = 0;
    snaps.forEach((d) => {
      const a = d.data() || {};
      const role = String(a.role || "").toLowerCase();
      const active = a.active === true;
      if (active && (role === "admin" || role === "super_admin")) count++;
    });
    return count;
  }
}

/* =========================
   Metrics
   ========================= */
function updateMetrics(users, adminsCount = 0) {
  const total = users.length;
  const suspended = users.filter((u) => isSuspended(u) && !isBanned(u)).length;
  const banned = users.filter((u) => isBanned(u)).length;

  const active = total - suspended - banned;

  setText("mTotalUsers", total);
  setText("mActiveUsers", active);
  setText("mSuspendedUsers", suspended + banned);
  setText("mAdminsMods", adminsCount);
}

/* =========================
   Search
   ========================= */
function wireSearch(allUsers, admin, settings, adminsCount) {
  const input = document.getElementById("userSearchInput");
  if (!input) return;

  input.addEventListener("input", () => {
    const q = input.value.trim().toLowerCase();
    const filtered = !q
      ? allUsers
      : allUsers.filter((u) => {
          const n = pickName(u).toLowerCase();
          const e = pickEmail(u).toLowerCase();
          return n.includes(q) || e.includes(q) || String(u.id).includes(q);
        });

    updateMetrics(filtered, adminsCount);
    renderUsersTable(filtered, admin, settings);
  });
}

/* =========================
   Init (WAIT for users-page.js guard)
   ========================= */
async function init() {
  if (!window.GT_ADMIN_READY) {
    console.error("[users] GT_ADMIN_READY missing. Ensure users-page.js is loaded before users.js");
    return;
  }

  const admin = await window.GT_ADMIN_READY;
  if (!admin) return;

  const settings = await loadSettingsSafe();

  const users = await fetchUsers();
  const adminsCount = await fetchAdminsCountIfAllowed(admin);

  updateMetrics(users, adminsCount);
  renderUsersTable(users, admin, settings);
  wireSearch(users, admin, settings, adminsCount);
}

window.addEventListener("DOMContentLoaded", init);
