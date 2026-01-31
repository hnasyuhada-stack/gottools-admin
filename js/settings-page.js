// js/settings-page.js (UPDATED: removed System State + Tools Moderation, alert when saving)
import { requireSuperAdmin } from "./auth-guard.js";
import { logout } from "./logout.js";
import { db } from "./firebase-config.js";

import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp,
  collection,
  addDoc
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

/* =========================
   Firestore paths
   ========================= */
const SETTINGS_REF = doc(db, "admin_settings", "system");
const AUDIT_COL = collection(db, "audit_logs");

/* =========================
   DOM
   ========================= */
const saveStatus = document.getElementById("saveStatus");

const settingReportResolvePolicy = document.getElementById("settingReportResolvePolicy");
const settingReportAssignmentEnabled = document.getElementById("settingReportAssignmentEnabled");

const settingUserBanPolicy = document.getElementById("settingUserBanPolicy");
const settingAuditLogEnabled = document.getElementById("settingAuditLogEnabled");

/* =========================
   Admin UI helpers
   ========================= */
function prettyRole(role) {
  const r = String(role || "").toLowerCase().trim();
  if (r === "super_admin") return "Super Admin";
  if (r === "admin") return "Admin";
  return r ? r : "Admin";
}

function applyAdminUI(admin) {
  if (!admin) return;

  const name = admin.name || admin.displayName || "Admin";
  const roleLabel = prettyRole(admin.role);

  const welcome = document.getElementById("adminWelcomeName");
  if (welcome) welcome.textContent = name;

  const topName = document.getElementById("adminNameTop");
  const topRole = document.getElementById("adminRoleTop");
  if (topName) topName.textContent = name;
  if (topRole) topRole.textContent = roleLabel;

  const topNamePill = document.getElementById("adminNameTopPill");
  const topRolePill = document.getElementById("adminRoleTopPill");
  if (topNamePill) topNamePill.textContent = name;
  if (topRolePill) topRolePill.textContent = roleLabel;

  const profileName = document.getElementById("profileName");
  const profileRole = document.getElementById("profileRole");
  const profileEmail = document.getElementById("profileEmail");
  if (profileName) profileName.textContent = name;
  if (profileRole) profileRole.textContent = roleLabel;
  if (profileEmail) profileEmail.textContent = admin.email || "-";
}

function wireLogoutOnce() {
  const btn = document.getElementById("btnLogout");
  if (!btn) return;

  if (btn.dataset.wired === "1") return;
  btn.dataset.wired = "1";

  btn.addEventListener("click", async (e) => {
    e.preventDefault();
    try {
      await logout();
    } catch (err) {
      console.error("Logout failed:", err);
      window.location.href = "login.html";
    }
  });
}

/* =========================
   Settings state
   ========================= */
let CURRENT = null;
let ADMIN = null;
let savingTimer = null;
let isBootstrapping = true;
let lastAlertAt = 0;

function setStatus(text) {
  if (!saveStatus) return;
  saveStatus.textContent = text;
}

function readUI() {
  return {
    reportResolvePolicy: settingReportResolvePolicy?.value || "admins_allowed",
    reportAssignmentEnabled: !!settingReportAssignmentEnabled?.checked,
    userBanPolicy: settingUserBanPolicy?.value || "admins_allowed",
    auditLogEnabled: !!settingAuditLogEnabled?.checked
  };
}

function writeUI(settings) {
  if (!settings) return;

  if (settingReportResolvePolicy) settingReportResolvePolicy.value = settings.reportResolvePolicy || "admins_allowed";
  if (settingReportAssignmentEnabled) settingReportAssignmentEnabled.checked = !!settings.reportAssignmentEnabled;

  if (settingUserBanPolicy) settingUserBanPolicy.value = settings.userBanPolicy || "admins_allowed";
  if (settingAuditLogEnabled) settingAuditLogEnabled.checked = !!settings.auditLogEnabled;
}

function diffKeys(before, after) {
  const keys = [];
  const all = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  all.forEach((k) => {
    if ((before || {})[k] !== (after || {})[k]) keys.push(k);
  });
  return keys;
}

async function ensureSettingsDocExists() {
  const snap = await getDoc(SETTINGS_REF);
  if (snap.exists()) return snap.data() || {};

  const defaults = {
    reportResolvePolicy: "admins_allowed",
    reportAssignmentEnabled: true,
    userBanPolicy: "super_admin_only",
    auditLogEnabled: true,
    updatedAt: serverTimestamp(),
    updatedBy: null
  };

  await setDoc(SETTINGS_REF, defaults, { merge: true });
  return defaults;
}

async function writeAuditIfEnabled(before, after, changedKeys) {
  if (!after?.auditLogEnabled) return;

  try {
    await addDoc(AUDIT_COL, {
      type: "settings_update",
      changedKeys,
      before,
      after,
      actor: {
        uid: ADMIN?.uid || "",
        name: ADMIN?.name || "Admin",
        role: ADMIN?.role || "super_admin"
      },
      createdAt: serverTimestamp()
    });
  } catch (e) {
    console.warn("Audit log write failed (non-blocking):", e);
  }
}

function showSavedAlert() {
  const now = Date.now();
  if (now - lastAlertAt < 1400) return; // prevent alert spam
  lastAlertAt = now;
  alert("Settings saved successfully.");
}

async function saveSettingsDebounced() {
  if (isBootstrapping) return;

  clearTimeout(savingTimer);
  savingTimer = setTimeout(async () => {
    try {
      setStatus("Saving…");

      const next = readUI();
      const before = CURRENT || {};
      const changed = diffKeys(before, next);

      if (changed.length === 0) {
        setStatus("Saved");
        return;
      }

      await updateDoc(SETTINGS_REF, {
        ...next,
        updatedAt: serverTimestamp(),
        updatedBy: {
          uid: ADMIN?.uid || "",
          name: ADMIN?.name || "Admin",
          role: ADMIN?.role || "super_admin"
        }
      });

      await writeAuditIfEnabled(before, next, changed);

      CURRENT = { ...before, ...next };
      setStatus("Saved");
      showSavedAlert();
    } catch (err) {
      console.error("Settings save failed:", err);
      setStatus("Save failed");
      alert("Save failed. Please try again.");
    }
  }, 350);
}

function wireChangeHandlers() {
  const els = [
    settingReportResolvePolicy,
    settingReportAssignmentEnabled,
    settingUserBanPolicy,
    settingAuditLogEnabled
  ].filter(Boolean);

  els.forEach((el) => {
    const evt = el.tagName === "SELECT" || el.type === "checkbox" ? "change" : "input";
    el.addEventListener(evt, saveSettingsDebounced);
  });
}

/* =========================
   INIT (fail-closed)
   ========================= */
window.addEventListener("DOMContentLoaded", async () => {
  document.body.classList.remove("fade-in");
  setStatus("Loading…");

  try {
    ADMIN = await requireSuperAdmin();
    if (!ADMIN) return;

    wireLogoutOnce();
    applyAdminUI(ADMIN);

    const data = await ensureSettingsDocExists();

    CURRENT = {
      reportResolvePolicy: data.reportResolvePolicy || "admins_allowed",
      reportAssignmentEnabled: !!data.reportAssignmentEnabled,
      userBanPolicy: data.userBanPolicy || "admins_allowed",
      auditLogEnabled: !!data.auditLogEnabled
    };

    isBootstrapping = true;
    writeUI(CURRENT);
    wireChangeHandlers();
    isBootstrapping = false;

    setStatus("Saved");
    document.body.classList.add("fade-in");
  } catch (err) {
    console.error("Settings init error:", err);
    setStatus("Error");
    document.body.classList.add("fade-in");
  }
});
