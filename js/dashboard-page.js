// js/dashboard-page.js
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
  const btnLogout = document.getElementById("btnLogout");
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

function preventFlashIfGuardFails() {
  document.body.classList.remove("fade-in");
}

window.addEventListener("DOMContentLoaded", async () => {
  preventFlashIfGuardFails();

  // ✅ Single shared promise for dashboard + any other modules on the page
  if (!window.GT_ADMIN_READY) {
    window.GT_ADMIN_READY = (async () => {
      const admin = await requireAdmin(); // ✅ ONLY CALL ONCE
      return admin;
    })();
  }

  try {
    const admin = await window.GT_ADMIN_READY;
    if (!admin) return;

    window.GT_ADMIN = admin;

    wireLogoutOnce();
    applyAdminUI(admin);

    // ✅ reveal only after guard success
    document.body.classList.add("fade-in");
    document.documentElement.style.visibility = "visible";
  } catch (err) {
    console.error("Dashboard page init error:", err);
    window.location.href = "login.html";
  }
});
