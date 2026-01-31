// js/reports-page.js
import { requireAdmin } from "./auth-guard.js";
import { logout } from "./logout.js";

function prettyRole(role) {
  const r = String(role || "").toLowerCase().trim();
  if (r === "super_admin") return "Super Admin";
  if (r === "admin") return "Admin";
  return r ? r : "Admin";
}

function applyAdminUI(admin) {
  if (!admin) return;

  const name = admin.name || admin.displayName || "Admin";
  const role = admin.role || "admin";

  const welcome = document.getElementById("adminWelcomeName");
  const topName = document.getElementById("adminNameTop");
  const topRole = document.getElementById("adminRoleTop");

  if (welcome) welcome.textContent = name;
  if (topName) topName.textContent = name;
  if (topRole) topRole.textContent = prettyRole(role);

  // ✅ Settings visible only to super_admin
  const settingsLink = document.querySelector('.sidebar-link[href="settings.html"]');
  const isSuper = String(role).toLowerCase().trim() === "super_admin";
  if (settingsLink) settingsLink.style.display = isSuper ? "" : "none";
}

function wireLogoutOnce() {
  const btnLogout = document.getElementById("btnLogout");
  if (!btnLogout) return;

  // prevent duplicate listeners if script runs twice (or hot reload)
  if (btnLogout.dataset.wired === "1") return;
  btnLogout.dataset.wired = "1";

  btnLogout.addEventListener("click", async (e) => {
    e.preventDefault();
    try {
      await logout();
    } catch (err) {
      console.error("Logout failed:", err);
      // still try to move user away if logout throws
      window.location.href = "login.html";
    }
  });
}

function preventFlashIfGuardFails() {
  // If guard fails and doesn't redirect fast enough, keep page visually hidden.
  // Your HTML already has: body { opacity:0 } then adds fade-in later.
  // We just ensure fade-in only happens after guard success.
  document.body.classList.remove("fade-in");
}

window.addEventListener("DOMContentLoaded", async () => {
  preventFlashIfGuardFails();

  try {
    // 1) Guard page (must redirect internally if not admin)
    const admin = await requireAdmin();

    // If requireAdmin returns null/undefined, do not reveal page.
    if (!admin) return;

    // 2) Wire logout
    wireLogoutOnce();

    // 3) Fill UI
    applyAdminUI(admin);

    // 4) Allow page to fade in ONLY after admin confirmed
    document.body.classList.add("fade-in");
  } catch (err) {
    console.error("Admin guard error:", err);
    // Fail closed: do not reveal page. Guard should redirect, but just in case:
    // You can change this to your preferred destination.
    window.location.href = "login.html";
  }
});
