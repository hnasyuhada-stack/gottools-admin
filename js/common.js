// js/common.js
import { auth } from "./firebase-config.js";
import { signOut } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";

export async function logout() {
  await signOut(auth);
  window.location.href = "login.html";
}

// highlight active link if you have nav links like <a href="dashboard.html">
export function highlightActiveNav() {
  const path = window.location.pathname.split("/").pop();
  document.querySelectorAll("a[data-nav]").forEach(a => {
    const href = a.getAttribute("href");
    if (href === path) a.classList.add("active");
  });
}
