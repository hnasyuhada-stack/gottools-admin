// js/reports.js
import { auth, db } from "./firebase-config.js";

import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import {
  collection,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  getDocsFromServer,
  query,
  orderBy,
  limit,
  where,          
  onSnapshot,
  updateDoc,
  Timestamp,
  increment,
  addDoc,
  setDoc
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";



/* =========================
   DOM
   ========================= */
const reportsListView = document.getElementById("reportsListView");
const reportsDetailView = document.getElementById("reportsDetailView");

const reportsTbody = document.getElementById("reportsTbody");
const reportSearchInput = document.getElementById("reportSearchInput");

const statusFilter = document.getElementById("statusFilter");
const targetFilter = document.getElementById("targetFilter");
const userTypeFilter = document.getElementById("userTypeFilter");
const btnClearFilters = document.getElementById("btnClearFilters");
const btnExportCsv = document.getElementById("btnExportCsv");

const mTotalReports = document.getElementById("mTotalReports");
const mPendingReports = document.getElementById("mPendingReports");
const mInReviewReports = document.getElementById("mInReviewReports");
const mResolvedReports = document.getElementById("mResolvedReports");
const chipPending = document.getElementById("chipPending");
const chipResolved = document.getElementById("chipResolved");

/* Detail */
const btnBackToList = document.getElementById("btnBackToList");
const btnOpenTool = document.getElementById("btnOpenTool");
const adminActionSelect = document.getElementById("adminActionSelect");
const btnHideToolViaReport = document.getElementById("btnHideToolViaReport");

const reportStatusBadge = document.getElementById("reportStatusBadge");
const detailStatusSelect = document.getElementById("detailStatusSelect");
const btnSaveDecision = document.getElementById("btnSaveDecision");
const adminNotes = document.getElementById("adminNotes");

/* ✅ Deposit decision UI */
const depositDecisionWrap = document.getElementById("depositDecisionWrap");
const depositDecisionSelect = document.getElementById("depositDecisionSelect");
const partialAmountWrap = document.getElementById("partialAmountWrap");
const partialRefundInput = document.getElementById("partialRefundInput");
const ownerKeepsText = document.getElementById("ownerKeepsText");
const depositAmountText = document.getElementById("depositAmountText");
const depositHelpText = document.getElementById("depositHelpText");
const depositDecisionHint = document.getElementById("depositDecisionHint");
const chipDisputesBtn = document.getElementById("chipDisputesBtn");
const chipDisputes = document.getElementById("chipDisputes");
/* ✅ Notifications (Admin bell) */
const notifBtn = document.getElementById("notifBtn");
const notifPanel = document.getElementById("notificationPanel");
const notifDot = document.getElementById("notifDot");
const notifList = document.getElementById("notifList");
const notifFooterLink = document.getElementById("notifFooterLink");

let notifUnsub = null;

/* =========================
   STATE
   ========================= */
let allReports = [];
let currentAdminUid = null;
let currentReport = null;
let isSavingDecision = false;

let currentReportId = null;
let currentRental = null;
let currentRentalId = null;

const ALLOWED_STATUSES = ["pending", "in_review", "resolved", "rejected"];
let quickFilterMode = "all"; // "all" | "disputes"
const disputeRentalStatusCache = new Map(); // rentalId -> "dispute_opened" | ...

/* =========================
   HELPERS
   ========================= */
   function getRentalIdFromReport(report) {
  return inferRentalIdFromReport(report);
}

function isDepositReport(report) {
  return isDepositKeywordReport(report); // you already have this
}

// “Dispute” = deposit report + has rentalId (must link to rental)
function isDisputeCandidate(report) {
  if (!isDepositReport(report)) return false;
  const rid = getRentalIdFromReport(report);
  return !!rid;
}

function timeAgo(ts) {
  try {
    const d = ts?.toDate ? ts.toDate() : null;
    if (!d) return "-";
    const diff = Date.now() - d.getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return "Just now";
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const days = Math.floor(h / 24);
    return `${days}d ago`;
  } catch {
    return "-";
  }
}

function renderAdminNotifItems(items) {
  if (!notifList) return;

  const list = Array.isArray(items) ? items : [];

  if (list.length === 0) {
    notifList.innerHTML = `
      <div class="notif-item">
        <img src="img/profile.png" class="notif-avatar" alt="">
        <div class="notif-info">
          <p class="notif-name">No updates</p>
          <p class="notif-msg">You're all caught up.</p>
        </div>
        <span class="notif-time">—</span>
      </div>
    `;
    if (notifDot) notifDot.style.display = "none";
    return;
  }

  // ✅ dot shows if anything needs action
  if (notifDot) notifDot.style.display = "inline-block";

  notifList.innerHTML = list.slice(0, 6).map(r => {
    const issue = escapeHtml(r.issueType || r.reason || "New report");
    const by = escapeHtml(r.reportedByName || r.reportedBy || "User");
    const t = timeAgo(r.createdAt);
    const id = escapeHtml(r.id);

    return `
      <div class="notif-item" style="cursor:pointer;" data-report-id="${id}">
        <img src="img/profile.png" class="notif-avatar" alt="">
        <div class="notif-info">
          <p class="notif-name">${issue}</p>
          <p class="notif-msg">Reported by ${by}</p>
        </div>
        <span class="notif-time">${escapeHtml(t)}</span>
      </div>
    `;
  }).join("");

  // click → open report detail
  notifList.querySelectorAll(".notif-item[data-report-id]").forEach(el => {
    el.addEventListener("click", () => {
      const rid = el.getAttribute("data-report-id");
      if (!rid) return;
      const url = new URL(window.location.href);
      url.searchParams.set("id", rid);
      window.location.href = url.toString();
    });
  });
}

function wireNotifDropdownUi() {
  if (!notifBtn || !notifPanel) return;

  notifBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    notifPanel.style.display = (notifPanel.style.display === "block") ? "none" : "block";
  });

  document.addEventListener("click", (e) => {
    if (!notifPanel.contains(e.target) && !notifBtn.contains(e.target)) {
      notifPanel.style.display = "none";
    }
  });
}

function startAdminBellFromReports() {
  // prevent duplicate listeners
  if (notifUnsub) { try { notifUnsub(); } catch {} }
  notifUnsub = null;

  wireNotifDropdownUi();

  // ✅ show only “needs action” (pending/in_review)
  const qy = query(
    collection(db, "reports"),
    where("status", "in", ["pending", "in_review"]),
    orderBy("createdAt", "desc"),
    limit(6)
  );

  notifUnsub = onSnapshot(qy, (snap) => {
    const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderAdminNotifItems(items);
  }, (err) => {
    console.warn("Admin notif listener failed:", err);
    // fallback: hide dot, show empty
    if (notifDot) notifDot.style.display = "none";
    renderAdminNotifItems([]);
  });
}


function getUrlParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}

function safeLower(x) {
  return String(x || "").toLowerCase().trim();
}

function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function fmtDate(ts) {
  if (ts?.toDate) return ts.toDate().toLocaleString();
  return "-";
}

function normalizeStatus(s) {
  const v = safeLower(s || "pending");
  return ALLOWED_STATUSES.includes(v) ? v : "pending";
}

function isTerminalStatus(s) {
  const v = normalizeStatus(s);
  return v === "resolved" || v === "rejected";
}

function needsAction(report) {
  const st = normalizeStatus(report?.status || "pending");
  return st === "pending" || st === "in_review";
}

/* ✅ OLD:
function isDepositIssueType(issueType = "") {
  const t = (issueType || "").toLowerCase();
  return t.includes("deposit");
}
*/

function isDepositCase(report) {
  // UI visibility: deposit keyword only
  return isDepositKeywordReport(report);
}



function mapDecisionToDepositStatus(decision) {
  switch (decision) {
    case "release": return "RELEASED";
    case "partial": return "PARTIAL";
    case "forfeit": return "FORFEITED";
    default: return null;
  }
}

function money(n) {
  const v = Number(n || 0);
  return "RM " + v.toFixed(2);
}
function isDepositKeywordReport(report) {
  const issue = safeLower(report?.issueType || report?.reason);
  return issue.includes("deposit");
}

function isDepositSettlementAllowed() {
  const rentalSt = safeLower(currentRental?.status);
  const depAmount = Number(currentRental?.depositAmount);
  return rentalSt === "dispute_opened" && Number.isFinite(depAmount) && depAmount > 0;
}

function notifCol(uid) {
  return collection(db, "notifications", String(uid), "userNotifications");
}

async function pushInAppNotification(toUid, payload) {
  if (!toUid) return;
  const now = Timestamp.now();

  await addDoc(notifCol(toUid), {
    title: payload.title || "Update",
    message: payload.message || "",
    type: payload.type || "admin_update",

    relatedReportId: payload.reportId || null,
    relatedRentalId: payload.rentalId || null,
    relatedToolId: payload.toolId || null,

    isRead: false,
    createdAt: now
  });
}

/* update bookedRanges if your app uses it */
async function tryUpdateBookedRangeCompleted({ toolId, rentalId }) {
  if (!toolId || !rentalId) return;

  try {
    const brRef = doc(db, "tools", String(toolId), "bookedRanges", String(rentalId));
    // setDoc with merge so it won't fail if doc is new/optional
    await setDoc(brRef, {
      status: "completed",
      updatedAt: Timestamp.now()
    }, { merge: true });
  } catch (e) {
    console.warn("bookedRanges update skipped:", e);
  }
}

async function warmDisputeRentalStatuses(reports) {
  const candidates = (reports || []).filter(isDisputeCandidate);

  // only fetch ones not cached yet
  const missing = candidates
    .map(r => getRentalIdFromReport(r))
    .filter(rid => rid && !disputeRentalStatusCache.has(String(rid)));

  if (missing.length === 0) return;

  // Fetch sequentially (safe + simple). You can batch later.
  for (const rid of missing.slice(0, 80)) { // limit to avoid excessive reads
    try {
      const rentalRef = doc(db, "rentals", String(rid));
      let snap;
      try { snap = await getDocFromServer(rentalRef); }
      catch { snap = await getDoc(rentalRef); }

      const st = snap.exists() ? safeLower(snap.data()?.status) : "";
      disputeRentalStatusCache.set(String(rid), st || "");
    } catch (e) {
      console.warn("warmDisputeRentalStatuses failed for", rid, e);
      disputeRentalStatusCache.set(String(rid), "");
    }
  }
}

function isOpenDisputeReport(report) {
  if (!isDisputeCandidate(report)) return false;
  const rid = String(getRentalIdFromReport(report));
  const st = disputeRentalStatusCache.get(rid);
  return st === "dispute_opened";
}


/* =========================
   MODAL (Reports)
   ========================= */
function $(id){ return document.getElementById(id); }

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
  $("gtModalBackdrop")?.classList.add("show");
  $("gtModalBackdrop")?.setAttribute("aria-hidden", "false");
}

function closeModal(){
  $("gtModalBackdrop")?.classList.remove("show");
  $("gtModalBackdrop")?.setAttribute("aria-hidden", "true");
}

function toastModal(title, message){
  openModal({
    title,
    sub: "",
    bodyHtml: `<div class="gt-field"><div class="k">Message</div><div class="v">${escapeHtml(message)}</div></div>`,
    footerHtml: `<button class="gt-btn primary" type="button" id="gtOkBtn">OK</button>`
  });
  $("gtOkBtn")?.addEventListener("click", closeModal);
}

function confirmModal({ title, sub, bodyHtml, confirmText="Confirm", danger=false, onConfirm }){
  openModal({
    title,
    sub,
    bodyHtml: bodyHtml || "",
    footerHtml: `
      <button class="gt-btn" type="button" id="gtCancelBtn">Cancel</button>
      <button class="gt-btn ${danger ? "danger" : "primary"}" type="button" id="gtConfirmBtn">${escapeHtml(confirmText)}</button>
    `
  });

  $("gtCancelBtn")?.addEventListener("click", closeModal);
  $("gtConfirmBtn")?.addEventListener("click", async () => {
    const btn = $("gtConfirmBtn");
    if (btn) btn.disabled = true;

    try {
      await onConfirm?.();
    } catch (e) {
      console.error(e);
      toastModal("Action failed", e?.message || String(e));
    } finally {
      if (btn) btn.disabled = false;
    }
  });
}

function reasonModal({ title, sub, hint, placeholder, confirmText="Confirm", danger=false, required=true, onConfirm }){
  openModal({
    title,
    sub,
    bodyHtml: `
      <div class="gt-form">
        <div>
          <div class="gt-label">Reason</div>
          <textarea class="gt-textarea" id="gtReasonInput" placeholder="${escapeHtml(placeholder || "Write reason...")}"></textarea>
          <div class="gt-hint ${required ? "danger" : ""}" id="gtReasonErr" style="display:none;">Reason is required.</div>
          ${hint ? `<div class="gt-hint" style="margin-top:6px;">${hint}</div>` : ""}
        </div>
      </div>
    `,
    footerHtml: `
      <button class="gt-btn" type="button" id="gtReasonCancel">Cancel</button>
      <button class="gt-btn ${danger ? "danger" : "primary"}" type="button" id="gtReasonConfirm">${escapeHtml(confirmText)}</button>
    `
  });

  $("gtReasonCancel")?.addEventListener("click", closeModal);
  $("gtReasonConfirm")?.addEventListener("click", async () => {
    const val = String($("gtReasonInput")?.value || "").trim();
    if (required && !val){
      const err = $("gtReasonErr");
      if (err) err.style.display = "block";
      $("gtReasonInput")?.focus();
      return;
    }
    try{
      await onConfirm?.(val);
      closeModal();
    }catch(e){
      console.error(e);
      toastModal("Action failed", e?.message || String(e));
    }
  });
}


/* reporter role helpers */
function normalizeReporterRole(raw) {
  const v = safeLower(raw);
  if (!v) return "";
  if (v === "lender") return "owner";
  if (v === "borrower") return "renter";
  if (v === "owner" || v === "renter") return v;
  return v;
}

function prettyReporterRole(raw) {
  const n = normalizeReporterRole(raw);
  if (n === "owner") return "Owner";
  if (n === "renter") return "Renter";
  if (!n) return "-";
  return raw;
}

/* target inference */
function inferTargetType(report) {
  const t = safeLower(report?.targetType);
  if (t) return t;
  if (report?.rentalId || report?.bookingId || report?.transactionId || report?.bookingRef) return "rental";
  if (report?.forumPostId || report?.postId) return "forum";
  if (report?.reportedUserId) return "user";
  if (report?.toolId || report?.targetToolId) return "tool";
  return "tool";
}

function inferTargetId(report) {
  return (
    report?.targetId ||
    report?.rentalId ||
    report?.bookingId ||
    report?.transactionId ||
    report?.bookingRef ||
    report?.toolId ||
    report?.targetToolId ||
    report?.postId ||
    report?.forumPostId ||
    report?.reportedUserId ||
    null
  );
}

function inferRentalIdFromReport(report) {
  return (
    report?.rentalId ||
    report?.bookingId ||
    report?.transactionId ||
    report?.bookingRef ||
    (inferTargetType(report) === "rental" ? inferTargetId(report) : null) ||
    null
  );
}

/* badges */
function badgeForStatus(status) {
  const s = safeLower(status);
  const cls =
    s === "resolved" ? "badge badge-ok" :
    s === "in_review" ? "badge badge-warn" :
    s === "rejected" ? "badge badge-danger" :
    "badge badge-muted";
  return `<span class="${cls}">${escapeHtml(status || "pending")}</span>`;
}

function setBadgeStatus(status) {
  if (!reportStatusBadge) return;
  const s = safeLower(status || "pending");

  reportStatusBadge.textContent =
    s === "resolved" ? "Resolved" :
    s === "in_review" ? "In Review" :
    s === "rejected" ? "Rejected" :
    "Pending Review";

  reportStatusBadge.className = "badge-status";
  reportStatusBadge.classList.add(
    s === "resolved" ? "resolved" :
    s === "in_review" ? "in_review" :
    s === "rejected" ? "rejected" :
    "pending"
  );

  if (detailStatusSelect) detailStatusSelect.value = s;
}

function renderEvidence(urls) {
  const container = document.getElementById("evidenceRow");
  if (!container) return;

  const list = Array.isArray(urls) ? urls : [];
  if (list.length === 0) {
    container.innerHTML = `<p style="margin:0;color:#6b7280;">No evidence uploaded.</p>`;
    return;
  }

  container.innerHTML = list
    .slice(0, 8)
    .map((u) => `<img src="${u}" class="evidence-img" alt="Evidence">`)
    .join("");
}

function prettyBytes(bytes) {
  const b = Number(bytes || 0);
  if (!b) return "";
  const units = ["B","KB","MB","GB"];
  let i = 0, v = b;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function evidenceIconFor(att) {
  const t = safeLower(att?.type);
  const mime = safeLower(att?.mime);
  if (t === "image" || mime.startsWith("image/")) return "🖼️";
  if (t === "video" || mime.startsWith("video/")) return "🎥";
  if (t === "doc" || mime.includes("pdf")) return "📄";
  return "📎";
}

function renderEvidenceFromAttachments(attachments) {
  const container = document.getElementById("evidenceRow");
  if (!container) return;

  const list = Array.isArray(attachments) ? attachments : [];
  if (list.length === 0) {
    container.innerHTML = `<p style="margin:0;color:#6b7280;">No evidence uploaded.</p>`;
    return;
  }

  container.innerHTML = list.slice(0, 12).map(att => {
    const url = String(att?.url || "").trim();
    if (!url) return "";

    const type = safeLower(att?.type || att?.fileType || att?.kind);
    const mime = safeLower(att?.mime);
    const name = escapeHtml(att?.name || "Evidence");
    const size = escapeHtml(prettyBytes(att?.sizeBytes));
    const icon = evidenceIconFor(att);

    const isImage = (type === "image") || mime.startsWith("image/");
    const isVideo = (type === "video") || mime.startsWith("video/");
    const isDoc   = (type === "doc") || mime.includes("pdf") || mime.includes("application/");

    if (isImage) {
      return `
        <a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" title="${name}">
          <img src="${escapeHtml(url)}" class="evidence-img" alt="${name}">
        </a>
      `;
    }

    const label = isVideo ? "Video evidence" : isDoc ? "Document evidence" : "File evidence";

    return `
      <a class="evidence-card" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" title="${name}">
        <div class="evidence-ico">${icon}</div>
        <div class="evidence-meta">
          <div class="evidence-name">${name}</div>
          <div class="evidence-sub">${label}${size ? ` • ${size}` : ""}</div>
          <div class="evidence-sub" style="opacity:.85;">Click to open</div>
        </div>
      </a>
    `;
  }).join("");

  if (!container.innerHTML.trim()) {
    container.innerHTML = `<p style="margin:0;color:#6b7280;">No valid evidence URLs found in attachments.</p>`;
  }
}


/* ✅ Keep premium button UI intact: DO NOT replace innerHTML */
function setSaveButtonLoading(loading) {
  if (!btnSaveDecision) return;

  btnSaveDecision.disabled = loading;
  btnSaveDecision.style.opacity = loading ? "0.75" : "1";
  btnSaveDecision.style.pointerEvents = loading ? "none" : "auto";
  btnSaveDecision.setAttribute("aria-busy", loading ? "true" : "false");
}

/* =========================
   ✅ ADMIN SESSION / GUARD (LOGIC ONLY)
   ========================= */
function getCachedAdminUid() {
  try {
    const cache = JSON.parse(localStorage.getItem("gt_admin_cache") || "null");
    if (cache?.uid) return String(cache.uid);
  } catch (e) {}
  return null;
}

async function verifyAdminByUid(uid) {
  if (!uid) return null;

  try {
    const snap = await getDoc(doc(db, "admins", uid));
    if (!snap.exists()) return null;

    const admin = snap.data() || {};
    const role = safeLower(admin.role);
    const active = admin.active === true;

    if (!active) return null;
    if (role !== "admin" && role !== "super_admin") return null;

    return { uid, ...admin };
  } catch (e) {
    console.warn("verifyAdminByUid failed:", e);
    return null;
  }
}

async function ensureAdminSession() {
  const user = auth.currentUser;
  if (user?.uid) {
    const admin = await verifyAdminByUid(user.uid);
    if (admin) return admin;
  }

  const cachedUid = getCachedAdminUid();
  if (cachedUid) {
    const admin = await verifyAdminByUid(cachedUid);
    if (admin) return admin;
  }

  return null;
}

/* =========================
   DEPOSIT UI (status-aware)
   ========================= */
async function loadLinkedRentalIfAny() {
  currentRental = null;
  if (!currentRentalId) return;

  try {
    const rentalRef = doc(db, "rentals", String(currentRentalId));

    let rentalSnap;
    try {
      rentalSnap = await getDocFromServer(rentalRef);
    } catch (e) {
      rentalSnap = await getDoc(rentalRef);
    }

    if (rentalSnap.exists()) currentRental = rentalSnap.data();
  } catch (e) {
    console.warn("Failed to load rental:", e);
  }
}

function updateOwnerKeepsPreview() {
  if (!ownerKeepsText || !depositDecisionSelect) return;

  const depAmount = Number(currentRental?.depositAmount || 0);

  if (depositDecisionSelect.value !== "partial") {
    ownerKeepsText.textContent = money(0);
    updateDepositDecisionHint();
    return;
  }

  const borrowerRefund = Number(partialRefundInput?.value || 0);
  const ownerKeeps = Math.max(0, depAmount - borrowerRefund);
  ownerKeepsText.textContent = money(ownerKeeps);

  updateDepositDecisionHint();
}

function setDepositHelpMessage(html) {
  if (!depositHelpText) return;
  depositHelpText.innerHTML = html;
}

function rentalStatusLower() {
  return safeLower(currentRental?.status || "");
}

function applyDepositUiRulesByStatus() {
  if (!depositDecisionWrap || !depositDecisionSelect) return;

  const isDeposit = isDepositKeywordReport(currentReport);

  // ✅ Non-deposit reports: hide + exit early
  depositDecisionWrap.style.display = isDeposit ? "block" : "none";
  if (!isDeposit) {
    depositDecisionSelect.disabled = true;
    if (partialAmountWrap) partialAmountWrap.style.display = "none";
    if (depositHelpText) depositHelpText.innerHTML = "";
    if (depositDecisionHint) depositDecisionHint.style.display = "none";
    return;
  }

  // ✅ Deposit reports: hint visible
  if (depositDecisionHint) depositDecisionHint.style.display = "block";

  // ✅ Rental not loaded yet
  if (!currentRental) {
    depositDecisionSelect.disabled = true;
    if (partialAmountWrap) partialAmountWrap.style.display = "none";
    setDepositHelpMessage("Loading rental details…");
    updateDepositDecisionHint();
    return;
  }

  const canSettle = isDepositSettlementAllowed();
  const st = normalizeStatus(detailStatusSelect?.value || currentReport?.status || "pending");
  const depAmount = Number(currentRental?.depositAmount || 0);

  if (depositAmountText) depositAmountText.textContent = money(depAmount);

  // ✅ Info-only mode when not dispute_opened OR no depositAmount
  if (!canSettle) {
    depositDecisionSelect.value = "release";
    depositDecisionSelect.disabled = true;
    if (partialAmountWrap) partialAmountWrap.style.display = "none";

    setDepositHelpMessage(
      `Deposit amount: <strong>${money(depAmount)}</strong><br/>
       Deposit settlement is available only when rental status is <b>dispute_opened</b> and depositAmount &gt; 0.<br/>
       Current rental status: <b>${escapeHtml(currentRental?.status || "-")}</b>`
    );

    updateDepositDecisionHint();
    return;
  }

  // ✅ If REJECTED: force release
  if (st === "rejected") {
    depositDecisionSelect.value = "release";
    depositDecisionSelect.disabled = true;
    if (partialAmountWrap) partialAmountWrap.style.display = "none";

    setDepositHelpMessage(
      `Deposit amount: <strong>${money(depAmount)}</strong><br/>
       <b>Rejected</b> will close the dispute and <b>return full deposit</b> to borrower.`
    );

    updateDepositDecisionHint();
    return;
  }

  // ✅ RESOLVED: allow choose decision
  if (st === "resolved") {
    depositDecisionSelect.disabled = false;

    if (partialAmountWrap) {
      partialAmountWrap.style.display = (depositDecisionSelect.value === "partial") ? "block" : "none";
    }

    updateOwnerKeepsPreview();

    setDepositHelpMessage(
      `Deposit amount: <strong>${money(depAmount)}</strong><br/>
       Choose what happens to the deposit, then click <b>Save Decision</b> to apply it and close the report.`
    );

    updateDepositDecisionHint();
    return;
  }

  // ✅ Pending / In review
  depositDecisionSelect.disabled = true;
  if (partialAmountWrap) partialAmountWrap.style.display = "none";

  setDepositHelpMessage(
    `Deposit amount: <strong>${money(depAmount)}</strong><br/>
     You can only apply deposit decision when Status is <b>Resolved</b> or <b>Rejected</b>.`
  );

  updateDepositDecisionHint();
}


function updateDepositDecisionHint() {
  if (!depositDecisionHint || !depositDecisionSelect) return;

  const depAmount = Number(currentRental?.depositAmount || 0);
  const decision = depositDecisionSelect.value;

  if (decision === "release") {
    depositDecisionHint.textContent = `Return RM ${depAmount.toFixed(2)} to borrower. Owner keeps RM 0.00.`;
    return;
  }

  if (decision === "forfeit") {
    depositDecisionHint.textContent = `Owner keeps RM ${depAmount.toFixed(2)}. Borrower gets RM 0.00.`;
    return;
  }

  if (decision === "partial") {
    const borrowerRefund = Number(partialRefundInput?.value || 0);
    const safeRefund = Math.max(0, Math.min(depAmount, borrowerRefund));
    const ownerKeeps = Math.max(0, depAmount - safeRefund);

    depositDecisionHint.textContent =
      `Borrower gets RM ${safeRefund.toFixed(2)}. Owner keeps RM ${ownerKeeps.toFixed(2)}.`;
    return;
  }

  depositDecisionHint.textContent = `Choose an option to see what it means.`;
}

function setupDepositDecisionUi(reportData) {
  if (!depositDecisionWrap || !depositDecisionSelect) return;

  const isDeposit = isDepositKeywordReport(reportData);
  depositDecisionWrap.style.display = isDeposit ? "block" : "none";

  depositDecisionSelect.value = "release";
  if (partialAmountWrap) partialAmountWrap.style.display = "none";

  updateDepositDecisionHint();

  depositDecisionSelect.onchange = () => {
    if (partialAmountWrap) {
      partialAmountWrap.style.display =
        (depositDecisionSelect.value === "partial") ? "block" : "none";
    }
    updateOwnerKeepsPreview();
    updateDepositDecisionHint();
  };

  if (partialRefundInput) {
    partialRefundInput.oninput = () => {
      updateOwnerKeepsPreview();
      updateDepositDecisionHint();
    };
  }
}


function syncDepositDecisionUiWithRental() {
  if (!depositDecisionWrap || !depositDecisionSelect) return;

const isDeposit = isDepositKeywordReport(currentReport);
depositDecisionWrap.style.display = isDeposit ? "block" : "none";
if (!isDeposit) { 
  if (depositDecisionSelect) depositDecisionSelect.disabled = true;
  if (partialAmountWrap) partialAmountWrap.style.display = "none";
  return;
}

  const depAmount = Number(currentRental?.depositAmount || 0);
  if (depositAmountText) depositAmountText.textContent = money(depAmount);

  const depStatus = String(currentRental?.depositStatus || "").toUpperCase();
  if (depStatus === "RELEASED") depositDecisionSelect.value = "release";
  if (depStatus === "FORFEITED") depositDecisionSelect.value = "forfeit";
  if (depStatus === "PARTIAL") depositDecisionSelect.value = "partial";

  applyDepositUiRulesByStatus();
  updateDepositDecisionHint();
}

/* =========================
   APPLY DEPOSIT RESOLUTION
   -Admin settles dispute and ends rental as COMPLETED 
   ========================= */
async function applyDepositResolutionToRental({ mode }) {
  if (!currentAdminUid) throw new Error("Admin session not ready (uid missing).");
  if (!currentRentalId) throw new Error("Missing rentalId for this deposit report.");

  await loadLinkedRentalIfAny();
  if (!currentRental) throw new Error("Rental not found.");

  const st = rentalStatusLower();

  // Only allow resolving when dispute is opened
  if (st !== "dispute_opened") {
    throw new Error(`Rental cannot be resolved in current state. Status: ${currentRental?.status || "-"}`);
  }

  const depAmount = Number(currentRental?.depositAmount || 0);
  if (!(depAmount >= 0)) throw new Error("Deposit amount missing/invalid on rental.");

  let decision = depositDecisionSelect?.value || "release";
  if (mode === "rejected") decision = "release";

  const depositStatus = mapDecisionToDepositStatus(decision);
  if (!depositStatus) throw new Error("Deposit decision is invalid.");

  let borrowerGets = depAmount;
  let ownerGets = 0;

  if (decision === "forfeit") {
    borrowerGets = 0;
    ownerGets = depAmount;
  }

  if (decision === "partial") {
    const valRaw = String(partialRefundInput?.value || "").trim();
    const val = valRaw === "" ? 0 : Number(valRaw);
    if (Number.isNaN(val)) throw new Error("Partial refund amount is invalid.");
    if (val < 0 || val > depAmount) throw new Error("Partial refund must be between 0 and deposit amount.");
    borrowerGets = val;
    ownerGets = depAmount - val;
  }

  const now = Timestamp.now();
  const rentalRef = doc(db, "rentals", String(currentRentalId));

  await updateDoc(rentalRef, {
    status: "completed",

    depositStatus,
    depositFinalAmountToBorrower: borrowerGets,
    depositFinalAmountToOwner: ownerGets,

    depositResolvedAt: now,
    depositResolvedBy: currentAdminUid,

    adminNotes: (adminNotes?.value || "").trim(),
    updatedAt: now,
    statusUpdatedAt: now
  });

  const ownerId = currentRental?.ownerId;
  const renterId = currentRental?.renterId;
  const toolId = currentRental?.toolId;

  const depStatusLabel =
    depositStatus === "RELEASED" ? "Full deposit returned" :
    depositStatus === "FORFEITED" ? "Deposit forfeited to owner" :
    "Partial deposit settled";

  const msgCommon =
    depositStatus === "PARTIAL"
      ? `Admin settled the deposit: Borrower gets ${money(borrowerGets)}, Owner keeps ${money(ownerGets)}.`
      : depositStatus === "RELEASED"
        ? `Admin settled the deposit: Borrower gets ${money(depAmount)}, Owner keeps RM 0.00.`
        : `Admin settled the deposit: Owner keeps ${money(depAmount)}, Borrower gets RM 0.00.`;

  await pushInAppNotification(ownerId, {
    title: `Deposit dispute resolved (${depStatusLabel})`,
    message: `${msgCommon} Rental is now completed.`,
    type: `deposit_${depositStatus.toLowerCase()}`,
    rentalId: currentRentalId,
    toolId,
    reportId: currentReportId
  });

  await pushInAppNotification(renterId, {
    title: `Deposit dispute resolved (${depStatusLabel})`,
    message: `${msgCommon} Rental is now completed.`,
    type: `deposit_${depositStatus.toLowerCase()}`,
    rentalId: currentRentalId,
    toolId,
    reportId: currentReportId
  });

  await tryUpdateBookedRangeCompleted({ toolId, rentalId: currentRentalId });

  await loadLinkedRentalIfAny();
  syncDepositDecisionUiWithRental();
}

/* =========================
   VIEW SWITCH
   ========================= */
function showListView() {
  if (reportsListView) reportsListView.style.display = "block";
  if (reportsDetailView) reportsDetailView.style.display = "none";
  currentReport = null;
  currentReportId = null;
  currentRentalId = null;
  currentRental = null;

  const url = new URL(window.location.href);
  url.searchParams.delete("id");
  history.replaceState({}, "", url.toString());
}

function showDetailView() {
  if (reportsListView) reportsListView.style.display = "none";
  if (reportsDetailView) reportsDetailView.style.display = "block";
}

/* =========================
   LOAD REPORTS
   ========================= */
async function loadReports() {
  if (!reportsTbody) return;

  reportsTbody.innerHTML = `<tr><td colspan="7">Loading reports…</td></tr>`;

  try {
    const snaps = await getDocsFromServer(
      query(collection(db, "reports"), orderBy("createdAt", "desc"), limit(200))
    );

    allReports = snaps.docs.map(d => ({ id: d.id, ...d.data() }));
    await warmDisputeRentalStatuses(allReports);
    applyAndRender();

  } catch (e) {
    console.warn("Primary query failed. Fallback:", e);

    try {
      const snaps = await getDocs(collection(db, "reports"));
      allReports = snaps.docs.map(d => ({ id: d.id, ...d.data() }));
      allReports.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
      applyAndRender();
    } catch (err) {
      console.error(err);
      reportsTbody.innerHTML = `<tr><td colspan="7">Failed to load reports</td></tr>`;
    }
  }
}

/* =========================
   METRICS
   ========================= */
function updateMetrics(list) {
  const arr = Array.isArray(list) ? list : [];

  const total = arr.length;
  const pending = arr.filter(needsAction).length;
  const inReview = arr.filter(r => normalizeStatus(r.status) === "in_review").length;
  const resolved = arr.filter(r => normalizeStatus(r.status) === "resolved").length;

  if (mTotalReports) mTotalReports.textContent = total;
  if (mPendingReports) mPendingReports.textContent = pending;
  if (mInReviewReports) mInReviewReports.textContent = inReview;
  if (mResolvedReports) mResolvedReports.textContent = resolved;

  if (chipPending) chipPending.textContent = pending;
  if (chipResolved) chipResolved.textContent = resolved;

  // ✅ disputes count (based on current filtered list)
  const disputeCount = arr.filter(isOpenDisputeReport).length;
  if (chipDisputes) chipDisputes.textContent = disputeCount;
}


/* =========================
   FILTERING
   ========================= */
function matchesSearch(r, q) {
  if (!q) return true;
  const blob = [
    r.id,
    r.status,
    r.issueType,
    r.description,
    r.reportedByName,
    r.reportedBy,
    r.userType,
    r.reporterRole,
    r.toolName,
    r.bookingId,
    r.rentalId,
    r.toolId,
    r.reportedUserId
  ].map(x => String(x || "")).join(" ").toLowerCase();
  return blob.includes(q);
}

function applyFilters() {
  const q = safeLower(reportSearchInput?.value);
  const status = safeLower(statusFilter?.value || "all");
  const target = safeLower(targetFilter?.value || "all");
  const utype = safeLower(userTypeFilter?.value || "all");

  const urlTargetType = safeLower(getUrlParam("targetType"));
  const urlTargetId = getUrlParam("targetId");
  const urlToolId = getUrlParam("toolId");

  return allReports.filter(r => {
    const rs = safeLower(r.status || "pending");
    const rt = inferTargetType(r);
    const rid = inferTargetId(r);

    if (!matchesSearch(r, q)) return false;

    if (status !== "all") {
      if (status === "pending") {
        if (!needsAction(r)) return false;
      } else {
        if (rs !== status) return false;
      }
    }

    if (urlToolId) {
      const reportToolId =
        r.toolId ||
        r.targetToolId ||
        (inferTargetType(r) === "tool" ? inferTargetId(r) : null);

      if (String(reportToolId || "") !== String(urlToolId)) return false;
    }

    if (target !== "all" && rt !== target) return false;

    const ru = normalizeReporterRole(r.userType || r.reporterRole);
    if (utype !== "all") {
      if (utype === "renter" && ru !== "renter") return false;
      if (utype === "owner" && ru !== "owner") return false;
    }

    if (urlTargetType === "tool" && urlTargetId) {
      const reportToolId =
        r.toolId ||
        r.targetToolId ||
        (inferTargetType(r) === "tool" ? inferTargetId(r) : null);

      if (String(reportToolId || "") !== String(urlTargetId)) return false;
    } else {
      if (urlTargetType && rt !== urlTargetType) return false;
      if (urlTargetId && String(rid || "") !== String(urlTargetId)) return false;
    }
// ✅ Quick filter: disputes only
if (quickFilterMode === "disputes") {
  if (!isOpenDisputeReport(r)) return false;
}

    return true;
    
  });
}

function applyAndRender() {
  const filtered = applyFilters();
  updateMetrics(filtered);
  renderTable(filtered);
}

/* =========================
   TABLE RENDER
   ========================= */
function renderTable(list) {
  if (!reportsTbody) return;

  reportsTbody.innerHTML = "";

  if (!list || list.length === 0) {
    reportsTbody.innerHTML = `<tr><td colspan="7">No reports found</td></tr>`;
    return;
  }

  list.forEach(r => {
    const tr = document.createElement("tr");

    const statusHtml = badgeForStatus(r.status || "pending");
    const issue = escapeHtml(r.issueType || "-");

    const toolName = escapeHtml(r.toolName || r.ToolName || "-");
    const targetType = inferTargetType(r);
    const targetId = inferTargetId(r);

    const targetLabel =
      targetType === "tool" ? `Tool: ${toolName}` :
      targetType === "rental" ? `Rental: ${escapeHtml(r.rentalId || r.bookingId || r.transactionId || "-")}` :
      targetType === "forum" ? `Forum Post` :
      targetType === "user" ? `User` :
      `Target`;

    const reporter = escapeHtml(r.reportedByName || r.reportedBy || "-");
    const userTypeDisplay = escapeHtml(prettyReporterRole(r.userType || r.reporterRole));
    const date = fmtDate(r.createdAt);

    const hasTool = !!(r.toolId || r.targetToolId || (targetType === "tool" && targetId));
    const toolId = r.toolId || r.targetToolId || (targetType === "tool" ? targetId : null);

    tr.innerHTML = `
      <td>${statusHtml}</td>
      <td>${issue}</td>
      <td>${targetLabel}</td>
      <td>${reporter}</td>
      <td>${userTypeDisplay}</td>
      <td>${escapeHtml(date)}</td>
      <td>
        <div class="actions-stack">
          <button class="btn-table btn-outline" onclick="openReport('${r.id}')">View</button>
          ${
            hasTool
              ? `<button class="btn-table btn-outline" onclick="openTool('${escapeHtml(toolId)}')">Tool</button>`
              : `<span class="badge badge-muted">No Tool ID</span>`
          }
        </div>
      </td>
    `;

    reportsTbody.appendChild(tr);
  });
}

async function loadReportDetail(reportId) {
  const ref = doc(db, "reports", reportId);

  let snap;
  try {
    snap = await getDocFromServer(ref);
  } catch (e) {
    snap = await getDoc(ref);
  }

  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() };
}

function lockUiIfTerminal() {
  const term = isTerminalStatus(currentReport?.status);

  if (detailStatusSelect) detailStatusSelect.disabled = term;
  if (adminNotes) adminNotes.disabled = term;
  if (btnSaveDecision) btnSaveDecision.disabled = term;

  if (depositDecisionSelect) depositDecisionSelect.disabled = term;
  if (partialRefundInput) partialRefundInput.disabled = term;

  if (adminActionSelect) adminActionSelect.disabled = term;
}

async function fillReportUI(r) {
  currentReport = r;
  currentReportId = r?.id || null;

  currentRentalId = inferRentalIdFromReport(r);

  const bookingId = r?.bookingId || r?.rentalId || r?.transactionId || "-";
  const reportedByName = r?.reportedByName || r?.reportedBy || "-";
  const userTypeText = prettyReporterRole(r?.userType || r?.reporterRole);
  const toolName = r?.toolName || r?.ToolName || "-";
  const issueType = r?.issueType || r?.reason || "-";
  const description = r?.description || r?.details || "-";

  const setText = (id, text) => {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  };
  const setHTML = (id, html) => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = html;
  };

  setText("rowBookingId", bookingId);
  setText("rowReportedBy", reportedByName);
  setText("rowUserType", userTypeText);
  setText("rowToolInvolved", toolName);
  setText("rowReportDate", r?.createdAt?.toDate ? r.createdAt.toDate().toLocaleString() : "-");

  setHTML("issueTypeText", `<strong class="issue-label">Issue Type:</strong> ${escapeHtml(issueType)}`);
  setHTML("issueDescText", `<strong class="issue-label">Description:</strong><br>${escapeHtml(description)}`);

  setBadgeStatus(r?.status || "pending");

  if (adminNotes) adminNotes.value = r?.adminNotes || "";
  if (detailStatusSelect) detailStatusSelect.value = normalizeStatus(r?.status || "pending");

  // Evidence
  if (Array.isArray(r?.attachments) && r.attachments.length > 0) {
    renderEvidenceFromAttachments(r.attachments);
  } else {
    const evidenceUrls =
      r?.evidenceUrls ||
      r?.evidence ||
      (r?.evidenceUrl ? [r.evidenceUrl] : []);
    renderEvidence(evidenceUrls);
  }

  const toolId = r?.toolId || r?.targetToolId || (inferTargetType(r) === "tool" ? inferTargetId(r) : null);

  if (btnOpenTool && toolId) {
    btnOpenTool.style.display = "inline-flex";
    btnOpenTool.onclick = () => window.location.href = `tool-details.html?toolId=${encodeURIComponent(toolId)}`;
  } else if (btnOpenTool) btnOpenTool.style.display = "none";

  if (btnHideToolViaReport && toolId) {
    btnHideToolViaReport.style.display = "inline-flex";
    btnHideToolViaReport.onclick = () => hideToolViaReport(toolId, r.id);
  } else if (btnHideToolViaReport) btnHideToolViaReport.style.display = "none";

  setupDepositDecisionUi(r);
  await loadLinkedRentalIfAny();
  syncDepositDecisionUiWithRental(); // ✅ will decide final visibility using rental.status too
// ✅ If not deposit case, hide hint/help too
if (!isDepositCase(currentReport)) {
  if (depositDecisionHint) depositDecisionHint.style.display = "none";
  if (depositHelpText) depositHelpText.innerHTML = "";
} else {
  if (depositDecisionHint) depositDecisionHint.style.display = "block";
}

  if (detailStatusSelect && detailStatusSelect.dataset.wired !== "1") {
    detailStatusSelect.dataset.wired = "1";
    detailStatusSelect.addEventListener("change", () => {
      applyDepositUiRulesByStatus();
    });
  }

  lockUiIfTerminal();
}

/* =========================
   ACTIONS
   ========================= */
window.openReport = (reportId) => {
  const url = new URL(window.location.href);
  url.searchParams.set("id", reportId);
  history.pushState({}, "", url.toString());
  initRoute();
};

window.openTool = (toolId) => {
  window.location.href = `tool-details.html?toolId=${encodeURIComponent(toolId)}`;
};

function isTransitionAllowed(prev, next) {
  const p = normalizeStatus(prev);
  const n = normalizeStatus(next);

  if ((p === "resolved" || p === "rejected") && n !== p) return false;
  return true;
}

async function saveDecision() {
  if (!currentReport?.id) return;
  if (!currentAdminUid) {
    const admin = await ensureAdminSession();
    if (!admin?.uid) {
      toastModal("Session expired", "Admin session expired. Please login again.");
      window.location.href = "login.html";
      return;
    }
    currentAdminUid = admin.uid;
  }
  if (isSavingDecision) return;
  const prevStatus = normalizeStatus(currentReport.status || "pending");
  const nextStatus = normalizeStatus(detailStatusSelect?.value || "pending");
  const notes = (adminNotes?.value || "").trim();
  if (!ALLOWED_STATUSES.includes(nextStatus)) {
    toastModal("Invalid status", "Invalid status selected.");
    return;
  }
  if (!isTransitionAllowed(prevStatus, nextStatus)) {
    toastModal("Invalid transition", `Invalid transition: ${prevStatus} → ${nextStatus}`);
    if (detailStatusSelect) detailStatusSelect.value = prevStatus;
    return;
  }
  const isDeposit = isDepositKeywordReport(currentReport);
  if (isDeposit && (nextStatus === "resolved" || nextStatus === "rejected")) {
    if (!currentRentalId) {
      toastModal("Missing rental", "This deposit report has no linked rentalId. Cannot finalise.");
      return;
    }
  }
  isSavingDecision = true;
  setSaveButtonLoading(true);
  try {
    const now = Timestamp.now();
    if ((nextStatus === "resolved" || nextStatus === "rejected") && isDeposit) {
      if (isDepositSettlementAllowed()) {
        await applyDepositResolutionToRental({ mode: nextStatus });
      }
    }
    const adminAction = adminActionSelect?.value || "none";
    if ((nextStatus === "resolved" || nextStatus === "rejected") && adminAction !== "none") {
      const targetUserId =
        currentReport?.reportedUserId ||
        currentReport?.targetUserId ||
        currentReport?.offenderUserId;
      if (targetUserId) {
        const userRef = doc(db, "users", String(targetUserId));
        const actionPayload = {
          lastAdminAction: adminAction,
          lastAdminActionAt: now,
          lastAdminActionBy: currentAdminUid,
          updatedAt: now
        };
        if (adminAction === "warn") {
          actionPayload.warningCount = increment(1);
          actionPayload.lastWarningAt = now;
          actionPayload.lastWarningReason = notes || "Policy violation";
        }
        if (adminAction === "suspend") {
          actionPayload.isSuspended = true;
          actionPayload.suspendedAt = now;
          actionPayload.suspendedBy = currentAdminUid;
          actionPayload.suspendReason = notes || "Suspended due to report";
        }
        if (adminAction === "ban") {
          actionPayload.accountStatus = "banned";
          actionPayload.bannedAt = now;
          actionPayload.bannedBy = currentAdminUid;
          actionPayload.banReason = notes || "Repeated violations";
        }
        await updateDoc(userRef, actionPayload);
      }
    }
    const payload = {
      status: nextStatus,
      adminNotes: notes,
      adminDecisionNote: notes,
      updatedAt: now,
      decidedAt: now,
      decidedBy: currentAdminUid
    };
    const decision = {
      result: nextStatus === "resolved" ? "valid" : "invalid",
      adminAction: adminAction || "none"
    };
    if (isDeposit) {
      const outcome =
        (nextStatus === "rejected")
          ? "RELEASED"
          : mapDecisionToDepositStatus(depositDecisionSelect?.value);
      decision.depositOutcome = outcome;
      payload.isDepositCase = true;
      payload.linkedRentalId = currentRentalId || null;

      if (nextStatus === "resolved" || nextStatus === "rejected") {
        payload.depositDecisionApplied = true;
        payload.depositDecisionAppliedAt = now;
        payload.depositDecision = outcome; // RELEASED | PARTIAL | FORFEITED
        payload.linkedRentalFinalStatus = "completed";
      } else {
        payload.depositDecisionApplied = false;
        payload.depositDecision = null;
        payload.linkedRentalFinalStatus = null;
      }
    }
    payload.decision = decision;
    if (nextStatus === "resolved" || nextStatus === "rejected") {
      payload.resolvedAt = now;
      payload.resolvedBy = currentAdminUid;
    }
    await updateDoc(doc(db, "reports", currentReport.id), payload);
    currentReport.status = nextStatus;
    currentReport.adminNotes = notes;
    currentReport.updatedAt = now;
    setBadgeStatus(nextStatus);
    toastModal("Saved", "Decision saved successfully.");
  } catch (e) {
    console.error(e);
    toastModal("Save failed", e?.message || "Failed to save decision. Check Firestore rules/console.");
  } finally {
    isSavingDecision = false;
    setSaveButtonLoading(false);
    lockUiIfTerminal();
  }
}


/* hide tool via report */
async function hideToolViaReport(toolId, reportId) {
  if (!currentAdminUid) {
    const admin = await ensureAdminSession();
    if (!admin?.uid) {
      toastModal("Session expired", "Admin session expired. Please login again.");
      window.location.href = "login.html";
      return;
    }
    currentAdminUid = admin.uid;
  }

  reasonModal({
    title: "Hide Tool (via report)",
    sub: "This will hide the listing from public Explore.",
    hint: `Will update <code>tools/${escapeHtml(toolId)}</code> and link to this report.`,
    placeholder: "Example: Tool violates policy / scam listing / inappropriate content...",
    confirmText: "Hide Tool",
    danger: true,
    required: true,
    onConfirm: async (reason) => {
      const now = Timestamp.now();

      const payload = {
        isVisible: false,
        adminHidden: true,
        adminHiddenReason: reason,
        adminHiddenAt: now,
        adminHiddenBy: currentAdminUid,
        relatedReportId: reportId || "",
        updatedAt: now
      };

      await updateDoc(doc(db, "tools", toolId), payload);

      toastModal("Tool hidden", "Tool was hidden successfully (via report).");
    }
  });
}


/* =========================
   EXPORT CSV
   ========================= */
function exportCsv(rows) {
  const header = ["reportId","status","issueType","toolName","toolId","reportedByName","userType","createdAt"];
  const lines = [header.join(",")];

  rows.forEach(r => {
    const toolName = r.toolName || r.ToolName || "";
    const toolId = r.toolId || r.targetToolId || "";
    const createdAt = r.createdAt?.toDate ? r.createdAt.toDate().toISOString() : "";
    const utype = normalizeReporterRole(r.userType || r.reporterRole);

    const vals = [
      r.id || "",
      r.status || "",
      r.issueType || r.reason || "",
      toolName,
      toolId,
      r.reportedByName || "",
      utype || "",
      createdAt
    ].map(v => `"${String(v).replaceAll('"','""')}"`);
    lines.push(vals.join(","));
  });

  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `reports_export_${Date.now()}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/* =========================
   ROUTING
   ========================= */
async function initRoute() {
  const reportId = getUrlParam("id");

  if (!reportId) {
    showListView();
    applyAndRender();
    return;
  }

  showDetailView();
  try {
    const r = await loadReportDetail(reportId);
    if (!r) {
      toastModal("Not found", "Report not found.");
      showListView();
      return;
    }
    await fillReportUI(r);
  } catch (e) {
    console.error(e);
    toastModal("Load failed", "Failed to load report detail.");
    showListView();
  }
}

/* =========================
   WIRING
   ========================= */
function wireFilters() {
  reportSearchInput?.addEventListener("input", applyAndRender);
  statusFilter?.addEventListener("change", applyAndRender);
  targetFilter?.addEventListener("change", applyAndRender);
  userTypeFilter?.addEventListener("change", applyAndRender);
chipDisputesBtn?.addEventListener("click", async () => {
  quickFilterMode = (quickFilterMode === "disputes") ? "all" : "disputes";

  // keep cache fresh
  await warmDisputeRentalStatuses(allReports);

  applyAndRender();

  // active look
  chipDisputesBtn.style.borderColor =
    (quickFilterMode === "disputes")
      ? "rgba(255,138,61,.55)"
      : "rgba(15,23,42,.10)";
});

btnClearFilters?.addEventListener("click", () => {
  if (reportSearchInput) reportSearchInput.value = "";
  if (statusFilter) statusFilter.value = "all";
  if (targetFilter) targetFilter.value = "all";
  if (userTypeFilter) userTypeFilter.value = "all";

  quickFilterMode = "all";

  // ✅ reset disputes chip look too
  if (chipDisputesBtn) chipDisputesBtn.style.borderColor = "rgba(15,23,42,.10)";

  const url = new URL(window.location.href);
  url.searchParams.delete("targetType");
  url.searchParams.delete("targetId");
  url.searchParams.delete("toolId");
  history.replaceState({}, "", url.toString());

  applyAndRender();
});



  btnClearFilters?.addEventListener("click", () => {
    if (reportSearchInput) reportSearchInput.value = "";
    if (statusFilter) statusFilter.value = "all";
    if (targetFilter) targetFilter.value = "all";
    if (userTypeFilter) userTypeFilter.value = "all";
    quickFilterMode = "all";


    const url = new URL(window.location.href);
    url.searchParams.delete("targetType");
    url.searchParams.delete("targetId");
    url.searchParams.delete("toolId");
    history.replaceState({}, "", url.toString());

    applyAndRender();
  });

  btnExportCsv?.addEventListener("click", () => {
    const filtered = applyFilters();
    exportCsv(filtered);
  });

  btnBackToList?.addEventListener("click", () => {
    showListView();
    applyAndRender();
  });

  if (btnSaveDecision && btnSaveDecision.dataset.wired !== "1") {
    btnSaveDecision.dataset.wired = "1";
    btnSaveDecision.addEventListener("click", async () => {
      try {
        confirmModal({
          title: "Confirm Save Decision",
          sub: "This will update the report (and may update rental deposit / user status).",
          bodyHtml: `
            <div class="gt-field">
              <div class="k">New Status</div>
              <div class="v">${escapeHtml(detailStatusSelect?.value || "-")}</div>
            </div>
            <div class="gt-field" style="margin-top:10px;">
              <div class="k">Admin Action</div>
              <div class="v">${escapeHtml(adminActionSelect?.value || "none")}</div>
            </div>
          `,
          confirmText: "Save",
          danger: (safeLower(detailStatusSelect?.value) === "rejected"),
          onConfirm: async () => {
            closeModal();
            await saveDecision();
            await loadReports();

            const rid = getUrlParam("id");
            if (rid) {
              const r = await loadReportDetail(rid);
              if (r) await fillReportUI(r);
            }
          }
        });
      } catch (e) {
        console.error(e);
        toastModal("Save failed", e?.message || "Failed to save decision. Check Firestore rules.");
      }
    });
  }
}

/* =========================
   INIT
   ========================= */
async function init() {
  wireFilters();

  const urlTargetType = safeLower(getUrlParam("targetType"));
  const urlToolId = getUrlParam("toolId");

  if (urlToolId && targetFilter) targetFilter.value = "all";
  else if (urlTargetType && targetFilter) targetFilter.value = urlTargetType;

  const cachedUid = getCachedAdminUid();
  if (cachedUid) currentAdminUid = cachedUid;

  onAuthStateChanged(auth, async (user) => {
    if (!user) return;

    const admin = await ensureAdminSession();
    if (!admin?.uid) {
      window.location.href = "login.html";
      return;
    }

    currentAdminUid = admin.uid;
    startAdminBellFromReports(); // LIVE bell: pending/in_review reports


    try {
      await loadReports();
      await initRoute();
    } catch (e) {
      console.error(e);
      toastModal("Load error", "Error loading reports. Check DevTools Console for details.");
    }
  });
}

window.addEventListener("DOMContentLoaded", init);
window.addEventListener("popstate", initRoute);
// NOTE:
// Admin actions are lightweight flags applied only after final report resolution.
// Most disputes are expected to be resolved via deposit settlement.
