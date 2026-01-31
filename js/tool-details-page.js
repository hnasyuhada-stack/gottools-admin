// js/tool-details-page.js
import { requireAdmin } from "./auth-guard.js";
import { logout } from "./logout.js";

function prettyRole(role) {
  const r = String(role || "").toLowerCase().trim();
  if (r === "super_admin") return "Super Admin";
  if (r === "admin") return "Admin";
  if (r === "support") return "Support";
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

  // settings visible only to super_admin
  const settingsLink = document.querySelector('.sidebar-link[href="settings.html"]');
  const isSuper = String(role).toLowerCase().trim() === "super_admin";
  if (settingsLink) settingsLink.style.display = isSuper ? "" : "none";
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

window.addEventListener("DOMContentLoaded", async () => {
  // fail-closed: keep hidden until guard passes
  document.body.classList.remove("fade-in");

  try {
    const admin = await requireAdmin();
    if (!admin) return;

    wireLogoutOnce();
    applyAdminUI(admin);

    // show page only after admin confirmed
    document.body.classList.add("fade-in");
  } catch (err) {
    console.error("Admin guard error:", err);
    window.location.href = "login.html";
  }
});
