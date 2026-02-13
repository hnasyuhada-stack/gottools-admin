// js/logout.js
import { auth } from "./firebase-config.js";
import { signOut } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";

function clearSession() {
  localStorage.removeItem("gt_admin_uid");
  localStorage.removeItem("gt_admin_role");
  localStorage.removeItem("gt_admin_email");
  localStorage.removeItem("gt_login_error");
}

export async function logout() {
  try {
    await signOut(auth);
  } catch (e) {
    // ignore
  } finally {
    clearSession();
    window.location.replace("index.html");
  }
}

