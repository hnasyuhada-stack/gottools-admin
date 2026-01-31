// js/tool-details.js
import {
  doc,
  getDocFromServer
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

import { db } from "./firebase-config.js";

/* =========================
   DOM
   ========================= */
const btnGoReports = document.getElementById("btnGoReports");

// images
const imgHero = document.getElementById("imgHero");
const imgThumbs = document.getElementById("imgThumbs");

// header fields
const txtToolName = document.getElementById("txtToolName");
const txtToolId = document.getElementById("txtToolId");
const tagListingType = document.getElementById("tagListingType");
const txtToolPrice = document.getElementById("txtToolPrice");
const txtPriceNote = document.getElementById("txtPriceNote");
const txtToolRating = document.getElementById("txtToolRating");

// cards
const cardDescription = document.getElementById("cardDescription");
const txtToolDescription = document.getElementById("txtToolDescription");

const cardSwapSection = document.getElementById("cardSwapSection");
const txtSwapItem = document.getElementById("txtSwapItem");

const cardUsageGuide = document.getElementById("cardUsageGuide");
const txtUsageGuide = document.getElementById("txtUsageGuide");
const usageImagesWrap = document.getElementById("usageImagesWrap");
const usageHero = document.getElementById("usageHero");
const usageThumbs = document.getElementById("usageThumbs");

const cardRules = document.getElementById("cardRules");
const txtToolRules = document.getElementById("txtToolRules");

const cardCancelPolicy = document.getElementById("cardCancelPolicy");
const txtToolCancelPolicy = document.getElementById("txtToolCancelPolicy");

const cardAvailability = document.getElementById("cardAvailability");
const txtToolAvailability = document.getElementById("txtToolAvailability");

// right column
const ownerName = document.getElementById("ownerName");
const ownerId = document.getElementById("ownerId");

const txtToolLocation = document.getElementById("txtToolLocation");
const txtLat = document.getElementById("txtLat");
const txtLng = document.getElementById("txtLng");
const btnOpenMaps = document.getElementById("btnOpenMaps");

const txtToolCondition = document.getElementById("txtToolCondition");
const txtStatus = document.getElementById("txtStatus");
const txtVisible = document.getElementById("txtVisible");
const txtDeposit = document.getElementById("txtDeposit");

/* =========================
   INIT
   ========================= */
document.addEventListener("DOMContentLoaded", async () => {
  // ✅ Guard is handled by tool-details-page.js
  // Here we only do page logic.

  const toolId = new URLSearchParams(location.search).get("toolId");
  if (!toolId) {
    txtToolName.textContent = "Missing toolId";
    txtToolId.textContent = "Open from Tools page.";
    return;
  }

  btnGoReports?.addEventListener("click", () => {
    window.location.href = `reports.html?targetType=tool&targetId=${encodeURIComponent(toolId)}`;
  });

  await fetchToolDetails(toolId);
});

/* =========================
   FETCH TOOL DETAILS (mirror Kotlin fetchToolDetails)
   ========================= */
async function fetchToolDetails(toolId) {
  try {
    const ref = doc(db, "tools", toolId);
    const snap = await getDocFromServer(ref);

    if (!snap.exists()) {
      txtToolName.textContent = "Tool not found";
      txtToolId.textContent = `Tool ID: ${toolId}`;
      return;
    }

    const d = snap.data() || {};
    const tool = { id: snap.id, ...d };

    // Title
    txtToolName.textContent = tool.name || "Untitled Tool";
    txtToolId.textContent = `Tool ID: ${tool.id}`;

    // Owner
    ownerName.textContent = tool.userName || "Unknown User";
    ownerId.textContent = tool.userId || "-";

    // Condition
    txtToolCondition.textContent = tool.condition || "-";

    // Status + Visibility
    txtStatus.textContent = tool.status || "available";
    txtVisible.textContent = tool.isVisible === false ? "Hidden" : "Visible";

    // Deposit (always show in info card)
    const dep = numberOrZero(tool.depositAmount);
    txtDeposit.textContent = dep > 0 ? `RM ${dep.toFixed(2)}` : "-";

    // Listing type tag (with color)
    const type = String(tool.listingType || "").toLowerCase().trim();
    applyListingTypeTag(type);

    // Price display logic (same as Kotlin)
    const pricePerDay = safePrice(tool);
    const priceText = getPriceText(type, pricePerDay);
    txtToolPrice.textContent = priceText;

    // Footer note: for rent show + deposit note
    txtPriceNote.textContent = "";
    if (type === "rent" && dep > 0) {
      txtPriceNote.textContent = `+ RM ${dep.toFixed(2)} deposit`;
    }

    // Rating text
    const reviewCount = toLong(tool.reviewCount);
    const avgRating = toDouble(tool.averageRating);
    txtToolRating.textContent =
      reviewCount > 0
        ? `⭐ ${avgRating.toFixed(1)} (${reviewCount} reviews)`
        : `⭐ No reviews yet`;

    // Image carousel (tool.imageUrls)
    const images = Array.isArray(tool.imageUrls) ? tool.imageUrls : [];
    renderCarousel(images, imgHero, imgThumbs);

    // Description card show/hide
    const desc = (tool.description || "").trim();
    if (desc) {
      cardDescription.style.display = "block";
      txtToolDescription.textContent = desc;
    } else {
      cardDescription.style.display = "none";
    }

    // Swap section show/hide
    const swapItem = (tool.swapItem || "").trim();
    if (type === "swap" && swapItem) {
      cardSwapSection.style.display = "block";
      txtSwapItem.textContent = swapItem;
    } else {
      cardSwapSection.style.display = "none";
    }

    // Usage guide show/hide (text + images)
    const usageText = (tool.usageGuide || "").trim();
    const usageImages = Array.isArray(tool.usageImageUrls) ? tool.usageImageUrls : [];

    if (!usageText && usageImages.length === 0) {
      cardUsageGuide.style.display = "none";
    } else {
      cardUsageGuide.style.display = "block";

      if (usageText) {
        txtUsageGuide.style.display = "block";
        txtUsageGuide.textContent = usageText;
      } else {
        txtUsageGuide.style.display = "none";
      }

      if (usageImages.length > 0) {
        usageImagesWrap.style.display = "block";
        renderUsageImages(usageImages);
      } else {
        usageImagesWrap.style.display = "none";
      }
    }

    // Rules show/hide
    const rules = (tool.rules || "").trim();
    if (rules) {
      cardRules.style.display = "block";
      txtToolRules.textContent = rules;
    } else {
      cardRules.style.display = "none";
    }

    // Cancellation show/hide
    const cancel = (tool.cancellationPolicy || "").trim();
    if (cancel) {
      cardCancelPolicy.style.display = "block";
      txtToolCancelPolicy.textContent = cancel;
    } else {
      cardCancelPolicy.style.display = "none";
    }

    // Availability show/hide (tool.availability map)
    const avail = tool.availability && typeof tool.availability === "object" ? tool.availability : null;
    const hasAvail = avail && avail.startDate != null && avail.endDate != null;

    if (hasAvail) {
      const start = String(avail.startDate);
      const end = String(avail.endDate);
      const startTime = avail.startTime ? String(avail.startTime) : "12:00 PM";
      const endTime = avail.endTime ? String(avail.endTime) : "12:00 PM";
      txtToolAvailability.textContent = `📅 Available from ${start} ${startTime} → ${end} ${endTime}`;
      cardAvailability.style.display = "block";
    } else {
      cardAvailability.style.display = "none";
    }

    // Location map (tool.locationMap lat/lng/label)
    const mapData = tool.locationMap && typeof tool.locationMap === "object" ? tool.locationMap : null;

    // Default fallback
    let lat = 3.0675;
    let lng = 101.5031;
    let label = "UiTM Shah Alam (Default)";

    if (mapData && mapData.lat != null && mapData.lng != null) {
      lat = Number(mapData.lat);
      lng = Number(mapData.lng);
      label = mapData.label ? String(mapData.label) : "Tool Location";
    }

    txtToolLocation.textContent = label;
    txtLat.textContent = isFinite(lat) ? String(lat) : "-";
    txtLng.textContent = isFinite(lng) ? String(lng) : "-";

    const mapsUrl = `https://www.google.com/maps?q=${encodeURIComponent(`${lat},${lng}`)}`;
    btnOpenMaps.href = mapsUrl;

  } catch (err) {
    console.error("fetchToolDetails failed:", err);
    txtToolName.textContent = "Failed to load tool details";
    txtToolId.textContent = "Check console / Firestore rules.";
  }
}

/* =========================
   UI: Listing tag
   ========================= */
function applyListingTypeTag(type) {
  tagListingType.className = "tag"; // reset
  const t = (type || "").toLowerCase();

  if (t === "rent") tagListingType.classList.add("tag-rent");
  else if (t === "swap") tagListingType.classList.add("tag-swap");
  else if (t === "sell") tagListingType.classList.add("tag-sell");
  else if (t === "free") tagListingType.classList.add("tag-free");

  tagListingType.textContent = t ? t.toUpperCase() : "TYPE";
}

/* =========================
   PRICE logic aligned with Kotlin
   ========================= */
function getPriceText(type, pricePerDay) {
  const t = (type || "").toLowerCase();
  if (t === "free") return "FREE";
  if (t === "rent" || t === "swap") return `RM ${pricePerDay.toFixed(2)}/day`;
  if (t === "sell") return `RM ${pricePerDay.toFixed(2)}`;
  return `RM ${pricePerDay.toFixed(2)}`;
}

/* =========================
   SAFE PRICE PARSING
   ========================= */
function safePrice(tool) {
  const priceAny = tool.pricePerDay ?? tool.price;
  if (typeof priceAny === "number") return priceAny;
  if (typeof priceAny === "string") return parseFloat(priceAny) || 0.0;
  return 0.0;
}

/* =========================
   Carousel rendering (tool images)
   ========================= */
function renderCarousel(images, heroEl, thumbsEl) {
  const list = Array.isArray(images) ? images.filter(Boolean) : [];
  const safe = list.length ? list : ["img/placeholder.png"];

  heroEl.src = safe[0];
  heroEl.onerror = () => heroEl.src = "img/placeholder.png";

  thumbsEl.innerHTML = "";
  safe.forEach((src, idx) => {
    const img = document.createElement("img");
    img.className = "thumb" + (idx === 0 ? " active" : "");
    img.src = src;
    img.onerror = () => img.src = "img/placeholder.png";

    img.addEventListener("click", () => {
      heroEl.src = src;
      thumbsEl.querySelectorAll(".thumb").forEach(t => t.classList.remove("active"));
      img.classList.add("active");
    });

    thumbsEl.appendChild(img);
  });
}

/* =========================
   Usage guide images (usageImageUrls)
   ========================= */
function renderUsageImages(images) {
  const list = Array.isArray(images) ? images.filter(Boolean) : [];
  const safe = list.length ? list : ["img/placeholder.png"];

  usageHero.src = safe[0];
  usageHero.onerror = () => usageHero.src = "img/placeholder.png";

  usageThumbs.innerHTML = "";
  safe.forEach((src) => {
    const img = document.createElement("img");
    img.className = "usage-thumb";
    img.src = src;
    img.onerror = () => img.src = "img/placeholder.png";

    img.addEventListener("click", () => {
      usageHero.src = src;
    });

    usageThumbs.appendChild(img);
  });
}

/* =========================
   Helpers
   ========================= */
function numberOrZero(val) {
  if (typeof val === "number") return val;
  if (typeof val === "string") return parseFloat(val) || 0;
  return 0;
}

function toLong(val) {
  if (typeof val === "number") return Math.floor(val);
  if (typeof val === "string") return parseInt(val, 10) || 0;
  return 0;
}

function toDouble(val) {
  if (typeof val === "number") return val;
  if (typeof val === "string") return parseFloat(val) || 0.0;
  return 0.0;
}
