// js/users-page.js
import { requireAdmin } from "./auth-guard.js";
import { logout } from "./logout.js";
import { db } from "./firebase-config.js";

import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

const SETTINGS_REF = doc(db, "admin_settings", "system");

function prettyRole(role) {
  const r = String(role || "").toLowerCase().trim();
  if (r === "super_admin") return "Super Admin";
  if (r === "admin") return "Admin";
  return r ? r : "Admin";
}

function applyAdminUI(admin) {
  if (!admin) return;

  const name = admin.name || "Admin";
  const role = admin.role || "admin";

  const isSuper = String(role).toLowerCase().trim() === "super_admin";
  const settingsLink = document.querySelector('.sidebar-link[href="settings.html"]');
  if (settingsLink) settingsLink.style.display = isSuper ? "" : "none";

  const welcome = document.getElementById("adminWelcomeName");
  const topName = document.getElementById("adminNameTop");
  const topRole = document.getElementById("adminRoleTop");
  if (welcome) welcome.textContent = name;
  if (topName) topName.textContent = name;
  if (topRole) topRole.textContent = prettyRole(role);
}

function wireLogoutOnce() {
  const btnLogout =
    document.getElementById("btnLogout") ||
    document.querySelector(".sidebar-logout a");

  if (!btnLogout) return;
  if (btnLogout.dataset.wired === "1") return;
  btnLogout.dataset.wired = "1";

  btnLogout.addEventListener("click", async (e) => {
    e.preventDefault();
    try {
      await logout();
    } catch (err) {
      console.error("Logout failed:", err);
      window.location.href = "login.html";
    }
  });
}

async function ensureSettingsDocExistsSafe(isSuperAdmin) {
  // ✅ If not super admin, do NOT create settings doc (rules may block)
  try {
    const snap = await getDoc(SETTINGS_REF);
    if (snap.exists()) return snap.data() || {};
  } catch (e) {
    console.warn("[users-page] get settings failed (non-blocking):", e);
    return {};
  }

  if (!isSuperAdmin) return {};

  const defaults = {
    maintenanceMode: "disabled",
    reportResolvePolicy: "admins_allowed",
    reportAssignmentEnabled: true,

    toolAutoApprove: true,
    maxImagesPerListing: 6,
    allowedListingTypes: { rent: true, swap: true, free: true, sell: true },

    userBanPolicy: "super_admin_only",
    auditLogEnabled: true,

    updatedAt: serverTimestamp(),
    updatedBy: null
  };

  try {
    await setDoc(SETTINGS_REF, defaults, { merge: true });
    return defaults;
  } catch (e) {
    console.warn("[users-page] create settings failed (non-blocking):", e);
    return {};
  }
}

function preventFlashIfGuardFails() {
  document.body.classList.remove("fade-in");
}

window.addEventListener("DOMContentLoaded", async () => {
  preventFlashIfGuardFails();

  // ✅ Create a single shared promise for ALL page scripts (users.js will await this)
  if (!window.GT_ADMIN_READY) {
    window.GT_ADMIN_READY = (async () => {
      const admin = await requireAdmin(); // ✅ ONLY CALL ONCE
      return admin;
    })();
  }

  try {
    const admin = await window.GT_ADMIN_READY;
    if (!admin) return;

    // ✅ Share globally BEFORE any other module uses it
    window.GT_ADMIN = admin;

    wireLogoutOnce();
    applyAdminUI(admin);

    const isSuper = String(admin.role || "").toLowerCase().trim() === "super_admin";
    const settings = await ensureSettingsDocExistsSafe(isSuper);
    window.GT_SETTINGS = settings;

    // ✅ reveal only after guard success
    document.body.classList.add("fade-in");
    document.documentElement.style.visibility = "visible";
  } catch (err) {
    console.error("Users page init error:", err);
    window.location.href = "login.html";
  }
});
