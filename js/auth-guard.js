// js/auth-guard.js
import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

/* =========================
   STORAGE KEYS (STANDARD)
   ========================= */
const LS_UID = "gt_admin_uid";
const LS_ROLE = "gt_admin_role";
const LS_EMAIL = "gt_admin_email";
const LS_ERROR = "gt_login_error";
const LS_CACHE = "gt_admin_cache";

/* =========================
   SINGLETON PROMISE CACHE
   Prevent multiple guards from racing
   ========================= */
const _guardPromises = new Map(); // key = allowedRoles joined

/* =========================
   GLOBAL REDIRECT LOCK
   Prevent multiple redirects firing together
   ========================= */
let _redirecting = false;

function clearSession({ keepError = false } = {}) {
  localStorage.removeItem(LS_UID);
  localStorage.removeItem(LS_ROLE);
  localStorage.removeItem(LS_EMAIL);
  localStorage.removeItem(LS_CACHE);
  if (!keepError) localStorage.removeItem(LS_ERROR);
}

/**
 * Normalize role values from Firestore into canonical:
 * - super_admin
 * - admin
 */
function normalizeRole(role) {
  const r = String(role || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/-+/g, "_");

  if (r === "superadmin") return "super_admin";
  if (r === "super_admin") return "super_admin";
  if (r === "admin") return "admin";
  return r;
}

function prettyNameFromEmail(email) {
  if (!email) return "Admin";
  const base = (email.split("@")[0] || "Admin").trim();
  if (!base) return "Admin";
  return base.charAt(0).toUpperCase() + base.slice(1);
}

function isOnLoginPage() {
  const p = (location.pathname || "").split("/").pop();
  return p === "login.html" || p === "" || p == null;
}

/**
 * Force logout + redirect (fail-closed)
 * - keepError: keep/overwrite LS_ERROR for login page
 * - ✅ redirect lock to prevent multiple pages/scripts from looping
 */
async function forceLogoutAndRedirect(message = "") {
  if (_redirecting) return;
  _redirecting = true;

  try {
    // Always clear session immediately so other scripts can't reuse stale cache
    clearSession({ keepError: true });

    if (message) localStorage.setItem(LS_ERROR, message);

    // If already on login page, don’t spam signOut/redirect
    if (isOnLoginPage()) {
      try { await signOut(auth); } catch (_) {}
      return;
    }

    // Best-effort signout (ignore failures)
    try { await signOut(auth); } catch (_) {}

    window.location.replace("login.html");
  } finally {
    // Keep redirect lock true; we don't want any follow-up redirects racing.
  }
}

async function fetchAndValidateAdmin(user, allowedRoles) {
  const adminRef = doc(db, "admins", user.uid);

  let adminSnap;
  try {
    adminSnap = await getDoc(adminRef);
  } catch (e) {
    // Network / rules / transient issue → fail closed
    await forceLogoutAndRedirect("Session error. Please login again.");
    return null;
  }

  if (!adminSnap.exists()) {
    await forceLogoutAndRedirect("Access denied. Not an admin account.");
    return null;
  }

  const data = adminSnap.data() || {};
  const active = data.active === true;

  const role = normalizeRole(data.role);
  const email = user.email || data.email || "";

  if (!active) {
    await forceLogoutAndRedirect("Account disabled. Contact super admin.");
    return null;
  }

  if (!allowedRoles.includes(role)) {
    await forceLogoutAndRedirect(`Access denied. Invalid role: ${role}`);
    return null;
  }

  const name = data.name || user.displayName || prettyNameFromEmail(email);

  const admin = { uid: user.uid, email, role, active, name };

  // ✅ Standardized session
  localStorage.setItem(LS_UID, admin.uid);
  localStorage.setItem(LS_ROLE, admin.role);
  localStorage.setItem(LS_EMAIL, admin.email);

  // ✅ Cache for UI / faster init
  localStorage.setItem(LS_CACHE, JSON.stringify({ ...admin, cachedAt: Date.now() }));

  return admin;
}

/**
 * ✅ Standard guard that RETURNS admin object (Promise)
 * - Fail closed: redirects to login.html
 * - Handles "first auth event null" during session restore
 * - ✅ Memoized per role-set to avoid double redirects
 */
export function requireAccess(options = {}) {
  const allowedRoles = (options.allowedRoles || ["admin", "super_admin"]).map(normalizeRole);
  const key = allowedRoles.slice().sort().join("|");

  // ✅ If already running, reuse the same Promise
  if (_guardPromises.has(key)) return _guardPromises.get(key);

  const p = new Promise((resolve) => {
    let settled = false;
    let restoreTimer = null;

    const settle = (adminOrNull, unsubscribe) => {
      if (settled) return;
      settled = true;

      try { if (restoreTimer) clearTimeout(restoreTimer); } catch (_) {}
      try { unsubscribe && unsubscribe(); } catch (_) {}

      resolve(adminOrNull || null);

      // ✅ allow future guards to run again
      _guardPromises.delete(key);
    };

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (settled || _redirecting) return;

      // Common case: auth restores and gives user immediately
      if (user) {
        const admin = await fetchAndValidateAdmin(user, allowedRoles);
        return settle(admin, unsubscribe);
      }

      // First event might be null while restoring session
      // Wait briefly, then validate using auth.currentUser
      if (!restoreTimer) {
        restoreTimer = setTimeout(async () => {
          if (settled || _redirecting) return;

          const u = auth.currentUser;
          if (!u) {
            await forceLogoutAndRedirect("Please login to continue.");
            return settle(null, unsubscribe);
          }

          const admin = await fetchAndValidateAdmin(u, allowedRoles);
          return settle(admin, unsubscribe);
        }, 450);
      }
    });
  });

  _guardPromises.set(key, p);
  return p;
}

export function requireAdmin() {
  return requireAccess({ allowedRoles: ["admin", "super_admin"] });
}

export function requireSuperAdmin() {
  return requireAccess({ allowedRoles: ["super_admin"] });
}

/**
 * Optional helper (UI only)
 */
export function getCachedAdmin() {
  try {
    const raw = localStorage.getItem(LS_CACHE);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.uid) return null;
    return parsed;
  } catch (_) {
    return null;
  }
}
