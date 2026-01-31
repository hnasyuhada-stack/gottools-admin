import { auth, db } from "./firebase-config.js";
import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import {
  doc,
  getDoc,
  updateDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

/* =========================
   STORAGE KEYS (STANDARD)
   ========================= */
const LS_UID = "gt_admin_uid";
const LS_ROLE = "gt_admin_role";
const LS_EMAIL = "gt_admin_email";
const LS_ERROR = "gt_login_error";
const LS_CACHE = "gt_admin_cache";

const ALLOWED_ROLES = ["admin", "super_admin"];

function normalizeRole(role) {
  return String(role || "").trim().toLowerCase();
}

function prettyNameFromEmail(email) {
  if (!email) return "Admin";
  const base = (email.split("@")[0] || "Admin").trim();
  if (!base) return "Admin";
  return base.charAt(0).toUpperCase() + base.slice(1);
}

function clearSession({ keepError = false } = {}) {
  localStorage.removeItem(LS_UID);
  localStorage.removeItem(LS_ROLE);
  localStorage.removeItem(LS_EMAIL);
  localStorage.removeItem(LS_CACHE);
  if (!keepError) localStorage.removeItem(LS_ERROR);
}

function showError(msg) {
  const error = document.getElementById("errorMsg");
  if (!error) return;
  error.innerText = msg;
  error.style.display = "block";
}

function hideError() {
  const error = document.getElementById("errorMsg");
  if (!error) return;
  error.style.display = "none";
}

function setLoading(isLoading) {
  const btn = document.getElementById("btnLogin");
  if (!btn) return;
  btn.disabled = isLoading;
  btn.textContent = isLoading ? "Signing in..." : "Login";
}

async function validateAdminAndCache(user) {
  const adminRef = doc(db, "admins", user.uid);
  const adminSnap = await getDoc(adminRef);

  if (!adminSnap.exists()) {
    return { ok: false, message: "Access denied. This account is not registered as admin." };
  }

  const adminData = adminSnap.data() || {};
  const active = adminData.active === true;
  const role = normalizeRole(adminData.role);
  const email = user.email || adminData.email || "";

  if (!active) {
    return { ok: false, message: "Account disabled. Please contact super admin." };
  }
  if (!ALLOWED_ROLES.includes(role)) {
    return { ok: false, message: "Access denied. Invalid admin role." };
  }

  const name = adminData.name || user.displayName || prettyNameFromEmail(email);

  // ✅ Standardized session + UI cache
  localStorage.setItem(LS_UID, user.uid);
  localStorage.setItem(LS_ROLE, role);
  localStorage.setItem(LS_EMAIL, email);

  localStorage.setItem(
    LS_CACHE,
    JSON.stringify({
      uid: user.uid,
      email,
      role,
      active: true,
      name,
      cachedAt: Date.now()
    })
  );

  // ✅ Optional: update last login (ignore if blocked)
  try {
    await updateDoc(adminRef, { lastLoginAt: serverTimestamp() });
  } catch (e) {}

  return { ok: true, role };
}

async function forceLogoutWithMessage(message) {
  try {
    await signOut(auth);
  } catch (e) {
    // ignore
  } finally {
    clearSession({ keepError: true });
    if (message) localStorage.setItem(LS_ERROR, message);
  }
}

function mapAuthError(err) {
  const code = String(err?.code || "");
  // Firebase often uses auth/invalid-credential now instead of wrong-password
  if (code.includes("auth/invalid-email")) return "Invalid email format.";
  if (code.includes("auth/user-not-found")) return "Account not found.";
  if (code.includes("auth/wrong-password")) return "Wrong password.";
  if (code.includes("auth/invalid-credential")) return "Wrong email or password.";
  if (code.includes("auth/too-many-requests")) return "Too many attempts. Try again later.";
  if (code.includes("auth/network-request-failed")) return "Network error. Check your internet and try again.";
  return "Login failed. Please check your email & password.";
}

/* =========================
   INIT
   ========================= */
window.addEventListener("DOMContentLoaded", () => {
  document.body.classList.add("fade-in");

  // Premium toggle logic: swaps SVG visibility
  window.togglePassword = function () {
    const pass = document.getElementById("password");
    const eyeOpen = document.getElementById("eyeOpen");
    const eyeClosed = document.getElementById("eyeClosed");

    if (!pass) return;

    if (pass.type === "password") {
      pass.type = "text";
      if(eyeOpen) eyeOpen.style.display = "none";
      if(eyeClosed) eyeClosed.style.display = "block";
    } else {
      pass.type = "password";
      if(eyeOpen) eyeOpen.style.display = "block";
      if(eyeClosed) eyeClosed.style.display = "none";
    }
  };

  const btn = document.getElementById("btnLogin");
  if (btn) btn.addEventListener("click", login);

  document.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const active = document.activeElement?.id;
      if (active === "email" || active === "password") login();
    }
  });

  // show redirected error message from auth-guard pages
  const saved = localStorage.getItem(LS_ERROR);
  if (saved) {
    showError(saved);
    localStorage.removeItem(LS_ERROR);
  }

  // ✅ Auto-redirect if already logged in as valid admin
  onAuthStateChanged(auth, async (user) => {
    if (!user) return; // stay on login
    try {
      const result = await validateAdminAndCache(user);
      if (result.ok) {
        window.location.replace("dashboard.html");
      } else {
        await forceLogoutWithMessage(result.message);
        // show it immediately too (no redirect needed)
        showError(result.message);
      }
    } catch (e) {
      await forceLogoutWithMessage("Session error. Please login again.");
      showError("Session error. Please login again.");
    }
  });
});

/* =========================
   LOGIN FLOW
   ========================= */
async function login() {
  hideError();

  const email = document.getElementById("email")?.value?.trim() || "";
  const pass = document.getElementById("password")?.value?.trim() || "";

  if (!email || !pass) {
    showError("Please fill in all fields.");
    return;
  }

  setLoading(true);

  try {
    // 1) Firebase Auth login
    const cred = await signInWithEmailAndPassword(auth, email, pass);
    const user = cred.user;

    // 2) Validate admin permissions + save session/cache
    const result = await validateAdminAndCache(user);
    if (!result.ok) {
      await forceLogoutWithMessage(result.message);
      showError(result.message);
      return;
    }

    // 3) Redirect
    window.location.replace("dashboard.html");
  } catch (err) {
    clearSession();
    showError(mapAuthError(err));
  } finally {
    setLoading(false);
  }
}