import {
  addImageToPromptByPair,
  clearAllData,
  deleteAllImagesFromPrompt,
  deleteImageFromPrompt,
  deletePrompt,
  exportAllData,
  estimateStorageUsage,
  getAllPrompts,
  getThumbnail,
  importAllData,
  saveThumbnail,
  updatePromptNote,
} from "../lib/db.js";
import {
  createImageDataUrl,
  parseImageFile,
  promptToTags,
} from "../lib/utils.js";
const COPY_ICON_SVG = `
  <svg class="btn-icon" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
    <rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" stroke-width="2" fill="none" />
    <path d="M5 15V5a2 2 0 0 1 2-2h10" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" />
  </svg>
`.trim();
const TRASH_ICON_SVG = `
  <svg class="btn-icon" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
    <path d="M4 7h16" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
    <path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none" />
    <path d="M6 7l1 13h10l1-13" stroke="currentColor" stroke-width="2" stroke-linejoin="round" fill="none" />
    <path d="M10 11v5M14 11v5" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
  </svg>
`.trim();

const state = {
  prompts: [],
  selectedImageByPrompt: {},
  pendingPromptFocus: null,
  confirmAction: null,
};

const els = {
  promptList: document.getElementById("prompt-list"),
  toast: document.getElementById("toast"),
  confirmDialog: document.getElementById("confirm-dialog"),
  confirmTitle: document.getElementById("confirm-title"),
  confirmMessage: document.getElementById("confirm-message"),
  imageViewer: document.getElementById("image-viewer"),
  viewerImage: document.getElementById("viewer-image"),
  viewerCanvas: document.getElementById("viewer-canvas"),
  viewerStage: document.getElementById("viewer-stage"),
  viewerClose: document.getElementById("viewer-close"),
  storageUsage: document.getElementById("storage-usage"),
};

const viewerState = {
  naturalWidth: 0,
  naturalHeight: 0,
  fitScale: 1,
  zoom: 1,
  x: 0,
  y: 0,
};

let viewerPanActive = false;
let viewerPanStart = null;
let viewerResizeObserver = null;
let viewerRelayoutTimer = null;

function formatStorageBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const exp = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / (1024 ** exp);
  const formatted = value >= 100 || exp === 0
    ? value.toFixed(0)
    : value.toFixed(1);
  return `${formatted} ${units[exp]}`;
}

let storageUsageTimer = null;

function scheduleStorageUsageUpdate() {
  clearTimeout(storageUsageTimer);
  storageUsageTimer = setTimeout(() => {
    updateStorageUsage().catch(() => {});
  }, 200);
}

async function updateStorageUsage() {
  if (!els.storageUsage) return;

  try {
    const { totalBytes, promptsBytes, thumbnailsBytes } = await estimateStorageUsage();
    els.storageUsage.textContent = `Storage: ${formatStorageBytes(totalBytes)}`;
    const totalMb = totalBytes / (1024 * 1024);
    const totalMbText = totalMb >= 100 ? totalMb.toFixed(0) : totalMb.toFixed(2);
    els.storageUsage.title = `Images ${formatStorageBytes(thumbnailsBytes)} · Prompts ${formatStorageBytes(promptsBytes)} (${totalMbText} MB total)`;
  } catch {
    els.storageUsage.textContent = "Storage: unavailable";
    els.storageUsage.title = "";
  }
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.hidden = false;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => {
    els.toast.hidden = true;
  }, 2200);
}

async function copyText(text, label) {
  if (!text) {
    showToast(`${label} is empty, nothing to copy`);
    return;
  }
  await navigator.clipboard.writeText(text);
  showToast(`Copied ${label}`);
}

function renderPromptTagList(container, text) {
  container.replaceChildren();
  const tags = promptToTags(text);

  if (!tags.length) {
    container.classList.add("empty");
    container.textContent = "(empty)";
    return;
  }

  container.classList.remove("empty");

  tags.forEach((tag, index) => {
    if (index > 0) {
      const sep = document.createElement("span");
      sep.className = "prompt-tag-sep";
      sep.textContent = ", ";
      sep.setAttribute("aria-hidden", "true");
      container.appendChild(sep);
    }

    const button = document.createElement("button");
    button.type = "button";
    button.className = "prompt-tag";
    button.textContent = tag;
    button.title = `Click to copy: ${tag}`;
    button.addEventListener("click", () => copyText(tag, "tag"));
    container.appendChild(button);
  });
}

const thumbnailCache = new Map();

function formatDateTime(timestamp) {
  if (!timestamp) return "(unknown)";
  return new Date(timestamp).toLocaleString("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function getSelectedImage(prompt) {
  const selectedId = state.selectedImageByPrompt[prompt.id];
  if (!selectedId) return prompt.images[0] ?? null;
  return prompt.images.find((image) => image.id === selectedId) ?? prompt.images[0] ?? null;
}

async function loadPrompts() {
  state.prompts = await getAllPrompts();
  await renderPromptList();

  if (state.pendingPromptFocus) {
    const { promptId, imageId } = state.pendingPromptFocus;
    state.pendingPromptFocus = null;
    focusPromptItem(promptId, imageId);
  }

  scheduleStorageUsageUpdate();
}

function scrollSidepanelToTop() {
  window.scrollTo({ top: 0, left: 0, behavior: "auto" });
}

function scrollPromptItemToTop(item, { behavior = "smooth" } = {}) {
  const header = document.querySelector(".app-header-wrap");
  const topInset = header ? header.getBoundingClientRect().bottom : 0;
  const gap = 8;
  const targetTop = window.scrollY + item.getBoundingClientRect().top - topInset - gap;

  window.scrollTo({
    top: Math.max(0, targetTop),
    left: 0,
    behavior,
  });
}

function focusPromptItem(promptId, imageId) {
  state.selectedImageByPrompt[promptId] = imageId;

  const item = els.promptList.querySelector(`[data-prompt-id="${promptId}"]`);
  if (!item) return;

  selectPromptImage(promptId, imageId);
  requestAnimationFrame(() => {
    scrollPromptItemToTop(item);
  });
}

async function resolveImageSrc(image) {
  if (image.thumbnailId && thumbnailCache.has(image.thumbnailId)) {
    return thumbnailCache.get(image.thumbnailId);
  }

  if (image.thumbnailId) {
    const cached = await getThumbnail(image.thumbnailId);
    if (cached) {
      thumbnailCache.set(image.thumbnailId, cached);
      return cached;
    }
  }

  return null;
}

function metadataRows(image) {
  const meta = image.metadata ?? {};
  return [
    ["Created", formatDateTime(image.addedAt)],
    ["Steps", meta.steps],
    ["Sampler", meta.sampler],
    ["Schedule type", meta.scheduleType],
    ["CFG scale", meta.cfgScale],
    ["Seed", meta.seed],
    ["Size", meta.size],
    ["Model hash", meta.modelHash],
    ["Model", meta.model],
    ["Lora hashes", meta.loraHashes],
    ["Version", meta.version],
    ["Filename", image.fileName],
  ];
}

async function openImageViewer(image) {
  const src = await resolveImageSrc(image);
  if (!src) {
    showToast("No preview available for full-size view");
    return;
  }
  resetViewerTransform();
  els.viewerImage.onload = null;
  els.viewerImage.src = src;
  els.imageViewer.showModal();
  document.body.classList.add("viewer-open");

  let layoutApplied = false;
  const applyLayout = () => {
    if (layoutApplied) return;
    layoutApplied = true;
    requestAnimationFrame(() => layoutViewerImage({ resetZoom: true }));
  };

  if (els.viewerImage.complete) {
    applyLayout();
  } else {
    els.viewerImage.onload = () => {
      els.viewerImage.onload = null;
      applyLayout();
    };
  }
}

function onViewerPanMove(event) {
  if (!viewerPanActive || !viewerPanStart) return;
  if (event.pointerId !== viewerPanStart.pointerId) return;
  event.preventDefault();
  viewerState.x = viewerPanStart.x + (event.clientX - viewerPanStart.clientX);
  viewerState.y = viewerPanStart.y + (event.clientY - viewerPanStart.clientY);
  applyViewerTransform();
}

function endViewerPan(event) {
  if (!viewerPanActive) return;
  if (event?.pointerId != null && viewerPanStart?.pointerId != null
    && event.pointerId !== viewerPanStart.pointerId) {
    return;
  }
  viewerPanActive = false;
  viewerPanStart = null;
  els.viewerStage?.classList.remove("is-dragging");
  stopViewerPanListeners();
}

function stopViewerPanListeners() {
  document.removeEventListener("pointermove", onViewerPanMove);
  document.removeEventListener("pointerup", endViewerPan);
  document.removeEventListener("pointercancel", endViewerPan);
}

function getViewerTotalScale() {
  return viewerState.fitScale * viewerState.zoom;
}

function getViewerContentSize() {
  const scale = getViewerTotalScale();
  return {
    width: viewerState.naturalWidth * scale,
    height: viewerState.naturalHeight * scale,
  };
}

function canViewerPan() {
  if (!els.viewerStage || !viewerState.naturalWidth) return false;
  if (viewerState.zoom > 1) return true;
  const { width, height } = getViewerContentSize();
  return width > els.viewerStage.clientWidth + 1
    || height > els.viewerStage.clientHeight + 1;
}

function scheduleViewerRelayout() {
  clearTimeout(viewerRelayoutTimer);
  viewerRelayoutTimer = setTimeout(() => {
    layoutViewerImage({ resetZoom: false });
  }, 50);
}

function layoutViewerImage({ resetZoom = false } = {}) {
  const img = els.viewerImage;
  const stage = els.viewerStage;
  if (!img?.naturalWidth || !stage) return;

  const prevFitScale = viewerState.fitScale || 1;

  viewerState.naturalWidth = img.naturalWidth;
  viewerState.naturalHeight = img.naturalHeight;
  viewerState.fitScale = stage.clientWidth / img.naturalWidth;

  if (resetZoom) {
    viewerState.zoom = 1;
    viewerState.x = 0;
  } else if (viewerState.zoom > 1 && prevFitScale > 0) {
    const ratio = viewerState.fitScale / prevFitScale;
    viewerState.x *= ratio;
    viewerState.y *= ratio;
  } else {
    viewerState.x = 0;
  }

  img.style.width = `${img.naturalWidth}px`;
  img.style.height = `${img.naturalHeight}px`;

  applyViewerTransform();
  updateViewerStageCursor();
}

function resetViewerTransform() {
  clearTimeout(viewerRelayoutTimer);
  viewerRelayoutTimer = null;
  stopViewerPanListeners();
  viewerPanActive = false;
  viewerPanStart = null;
  viewerState.naturalWidth = 0;
  viewerState.naturalHeight = 0;
  viewerState.fitScale = 1;
  viewerState.zoom = 1;
  viewerState.x = 0;
  viewerState.y = 0;
  if (els.viewerCanvas) {
    els.viewerCanvas.style.transform = "";
  }
  if (els.viewerStage) {
    els.viewerStage.classList.remove("is-dragging");
  }
  updateViewerStageCursor();
}

function clampViewerPan() {
  const stage = els.viewerStage;
  if (!stage || !viewerState.naturalWidth) return;

  const contentW = viewerState.naturalWidth * getViewerTotalScale();
  const contentH = viewerState.naturalHeight * getViewerTotalScale();
  const stageW = stage.clientWidth;
  const stageH = stage.clientHeight;

  if (contentW <= stageW) {
    viewerState.x = (stageW - contentW) / 2;
  } else {
    viewerState.x = Math.min(0, Math.max(stageW - contentW, viewerState.x));
  }

  if (contentH <= stageH) {
    viewerState.y = (stageH - contentH) / 2;
  } else {
    viewerState.y = Math.min(0, Math.max(stageH - contentH, viewerState.y));
  }
}

function applyViewerTransform() {
  if (!els.viewerCanvas) return;
  clampViewerPan();
  const scale = getViewerTotalScale();
  els.viewerCanvas.style.transform = `translate(${viewerState.x}px, ${viewerState.y}px) scale(${scale})`;
}

function applyViewerZoomAtPoint(factor, clientX, clientY) {
  const stage = els.viewerStage;
  if (!stage || !viewerState.naturalWidth) return;

  const oldZoom = viewerState.zoom;
  const newZoom = Math.max(1, Math.min(8, oldZoom * factor));
  if (newZoom === oldZoom) return;

  const rect = stage.getBoundingClientRect();
  const mouseX = clientX - rect.left;
  const mouseY = clientY - rect.top;
  const oldTotalScale = getViewerTotalScale();
  const imageX = (mouseX - viewerState.x) / oldTotalScale;
  const imageY = (mouseY - viewerState.y) / oldTotalScale;

  viewerState.zoom = newZoom;
  const newTotalScale = getViewerTotalScale();
  viewerState.x = mouseX - imageX * newTotalScale;
  viewerState.y = mouseY - imageY * newTotalScale;

  applyViewerTransform();
  updateViewerStageCursor();
}

function updateViewerStageCursor() {
  if (!els.viewerStage) return;
  els.viewerStage.classList.toggle("can-pan", canViewerPan());
}

function setupViewerResizeObserver() {
  if (!els.viewerStage || viewerResizeObserver) return;

  viewerResizeObserver = new ResizeObserver(() => {
    if (!els.imageViewer?.open || !viewerState.naturalWidth) return;
    scheduleViewerRelayout();
  });
  viewerResizeObserver.observe(els.viewerStage);
}

function setupImageViewerControls() {
  if (!els.viewerStage || !els.viewerCanvas) return;

  setupViewerResizeObserver();

  window.addEventListener("resize", () => {
    if (!els.imageViewer?.open || !viewerState.naturalWidth) return;
    scheduleViewerRelayout();
  });

  els.viewerClose?.addEventListener("click", () => {
    els.imageViewer.close();
  });

  els.viewerStage.addEventListener("wheel", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const factor = event.deltaY > 0 ? 0.9 : 1.1;
    applyViewerZoomAtPoint(factor, event.clientX, event.clientY);
  }, { passive: false });

  els.viewerStage.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    if (event.target.closest(".image-viewer-close")) return;
    if (!canViewerPan()) return;
    event.preventDefault();
    event.stopPropagation();
    viewerPanActive = true;
    viewerPanStart = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      x: viewerState.x,
      y: viewerState.y,
    };
    els.viewerStage.classList.add("is-dragging");
    document.addEventListener("pointermove", onViewerPanMove);
    document.addEventListener("pointerup", endViewerPan);
    document.addEventListener("pointercancel", endViewerPan);
  });

  els.imageViewer.addEventListener("close", () => {
    document.body.classList.remove("viewer-open");
    resetViewerTransform();
  });
}

function requestDeleteImage(prompt, imageId) {
  requestConfirm(
    "Delete Image",
    "Delete the currently selected image?",
    async () => {
      await deleteImageFromPrompt(prompt.id, imageId);
      delete state.selectedImageByPrompt[prompt.id];
      await loadPrompts();
      showToast("Image deleted");
    },
  );
}

function createCarouselItemActions({ withZoom = true } = {}) {
  const actions = document.createElement("div");
  actions.className = "carousel-item-actions";

  if (withZoom) {
    const zoomBtn = document.createElement("button");
    zoomBtn.type = "button";
    zoomBtn.className = "carousel-zoom";
    zoomBtn.setAttribute("aria-label", "View full size");
    zoomBtn.innerHTML = `
      <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
        <circle cx="10.5" cy="10.5" r="6.25" fill="none" stroke="currentColor" stroke-width="2" />
        <path d="M15.5 15.5L20 20" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
        <path d="M8 10.5h5M10.5 8v5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
      </svg>
    `;
    actions.appendChild(zoomBtn);
  }

  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "carousel-delete";
  deleteBtn.setAttribute("aria-label", "Delete this image");
  deleteBtn.innerHTML = `
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <path d="M4 7h16" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
      <path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none" />
      <path d="M6 7l1 13h10l1-13" stroke="currentColor" stroke-width="2" stroke-linejoin="round" fill="none" />
      <path d="M10 11v5M14 11v5" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
    </svg>
  `;
  actions.appendChild(deleteBtn);

  return actions;
}

function renderImageDetailsContent(details, selected) {
  if (!selected) {
    details.innerHTML = '<p class="hint">No images in this prompt group yet. Drag a Forge image anywhere in the sidebar.</p>';
    return;
  }

  const rows = metadataRows(selected);
  details.innerHTML = `
    <dl>
      ${rows.map(([key, value]) => {
        if (key === "Seed" && value) {
          return `<dt>${key}</dt><dd><button type="button" class="meta-seed-copy" title="Click to copy Seed"></button></dd>`;
        }
        return `<dt>${key}</dt><dd>${value || "(empty)"}</dd>`;
      }).join("")}
    </dl>
    <div class="image-actions">
      <button class="btn danger btn-delete-all-images" type="button">Delete All Images in Group</button>
    </div>
  `;
}

function bindImageDetailsActions(item, prompt, selected) {
  const details = item.querySelector(".image-details");
  if (!details || !selected) return;

  const seedButton = details.querySelector(".meta-seed-copy");
  const seedValue = selected.metadata?.seed;
  if (seedButton && seedValue) {
    seedButton.textContent = seedValue;
    seedButton.addEventListener("click", () => copyText(String(seedValue), "Seed"));
  }

  details.querySelector(".btn-delete-all-images")?.addEventListener("click", () => {
    requestConfirm(
      "Delete All Images",
      "Delete all images in this prompt group?",
      async () => {
        await deleteAllImagesFromPrompt(prompt.id);
        delete state.selectedImageByPrompt[prompt.id];
        await loadPrompts();
        showToast("All images in group deleted");
      },
    );
  });
}

const CAROUSEL_ITEM_STEP = 96;

function getCarouselHasOverflow(carousel) {
  const itemCount = carousel.querySelectorAll(".carousel-item").length;
  if (itemCount <= 1) return false;

  const measuredOverflow = carousel.scrollWidth - carousel.clientWidth > 2;
  const estimatedOverflow = itemCount * CAROUSEL_ITEM_STEP > carousel.clientWidth + 1;
  return measuredOverflow || estimatedOverflow;
}

function updateCarouselUI(wrap) {
  const carousel = wrap?.querySelector(".carousel");
  const prev = wrap?.querySelector(".carousel-nav.prev");
  const next = wrap?.querySelector(".carousel-nav.next");
  const scrollbar = wrap?.querySelector(".carousel-scrollbar");
  const track = wrap?.querySelector(".carousel-track");
  const thumb = wrap?.querySelector(".carousel-thumb");
  if (!carousel || !prev || !next || !scrollbar || !track || !thumb) return;

  const hasOverflow = getCarouselHasOverflow(carousel);
  const maxScroll = Math.max(0, carousel.scrollWidth - carousel.clientWidth);

  wrap.classList.toggle("has-overflow", hasOverflow);
  prev.hidden = !hasOverflow;
  next.hidden = !hasOverflow;
  scrollbar.hidden = !hasOverflow;
  prev.disabled = !hasOverflow || carousel.scrollLeft <= 1;
  next.disabled = !hasOverflow || carousel.scrollLeft >= maxScroll - 1;

  if (!hasOverflow) return;

  const trackWidth = track.clientWidth;
  if (trackWidth <= 0) return;

  const thumbWidth = Math.max(28, trackWidth * (carousel.clientWidth / carousel.scrollWidth));
  const maxThumbLeft = Math.max(0, trackWidth - thumbWidth);
  const scrollRatio = maxScroll > 0 ? carousel.scrollLeft / maxScroll : 0;

  thumb.style.width = `${thumbWidth}px`;
  thumb.style.transform = `translateX(${scrollRatio * maxThumbLeft}px)`;
}

function scheduleCarouselUIUpdate(wrap) {
  requestAnimationFrame(() => updateCarouselUI(wrap));
}

function setupCarouselScrollSync(wrap) {
  const carousel = wrap.querySelector(".carousel");
  let scrollRaf = null;

  carousel.addEventListener("scroll", () => {
    if (scrollRaf) return;
    scrollRaf = requestAnimationFrame(() => {
      scrollRaf = null;
      updateCarouselUI(wrap);
    });
  }, { passive: true });
}

function setupCarouselPan(carousel) {
  let isPointerDown = false;
  let hasPanned = false;
  let startX = 0;
  let startScroll = 0;
  let activePointerId = null;

  const endPan = () => {
    isPointerDown = false;
    activePointerId = null;
    carousel.classList.remove("is-panning");
  };

  carousel.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    isPointerDown = true;
    hasPanned = false;
    startX = event.clientX;
    startScroll = carousel.scrollLeft;
    activePointerId = event.pointerId;
  });

  carousel.addEventListener("pointermove", (event) => {
    if (!isPointerDown || event.pointerId !== activePointerId) return;

    const deltaX = event.clientX - startX;
    if (!hasPanned && Math.abs(deltaX) < 6) return;

    if (!hasPanned) {
      hasPanned = true;
      carousel.classList.add("is-panning");
      carousel.setPointerCapture(event.pointerId);
    }

    event.preventDefault();
    carousel.scrollLeft = startScroll - deltaX;
  });

  const finishPan = (event) => {
    if (!isPointerDown || event.pointerId !== activePointerId) return;

    if (hasPanned) {
      const blockClick = (clickEvent) => {
        clickEvent.preventDefault();
        clickEvent.stopPropagation();
      };
      carousel.addEventListener("click", blockClick, { capture: true, once: true });
    }

    try {
      carousel.releasePointerCapture(event.pointerId);
    } catch {
      // Pointer capture may already be released.
    }

    endPan();
  };

  carousel.addEventListener("pointerup", finishPan);
  carousel.addEventListener("pointercancel", finishPan);
}

function setupCarouselNav(wrap) {
  const carousel = wrap.querySelector(".carousel");
  const prev = wrap.querySelector(".carousel-nav.prev");
  const next = wrap.querySelector(".carousel-nav.next");
  const track = wrap.querySelector(".carousel-track");
  const thumb = wrap.querySelector(".carousel-thumb");

  carousel.addEventListener("dragstart", (event) => {
    event.preventDefault();
  }, true);

  prev.addEventListener("click", () => {
    carousel.scrollBy({ left: -CAROUSEL_ITEM_STEP * 2, behavior: "smooth" });
  });

  next.addEventListener("click", () => {
    carousel.scrollBy({ left: CAROUSEL_ITEM_STEP * 2, behavior: "smooth" });
  });

  setupCarouselScrollSync(wrap);
  setupCarouselPan(carousel);

  let wheelDelta = 0;
  let wheelRaf = null;

  carousel.addEventListener("wheel", (event) => {
    if (!getCarouselHasOverflow(carousel)) return;
    event.preventDefault();

    wheelDelta += event.deltaY || event.deltaX;
    if (wheelRaf) return;

    wheelRaf = requestAnimationFrame(() => {
      carousel.scrollLeft += wheelDelta;
      wheelDelta = 0;
      wheelRaf = null;
    });
  }, { passive: false });

  let thumbDragging = false;
  let thumbStartX = 0;
  let thumbStartScroll = 0;

  const onThumbMove = (event) => {
    if (!thumbDragging) return;
    const trackWidth = track.clientWidth;
    const thumbWidth = thumb.offsetWidth;
    const maxThumbLeft = Math.max(1, trackWidth - thumbWidth);
    const maxScroll = Math.max(0, carousel.scrollWidth - carousel.clientWidth);
    const deltaX = event.clientX - thumbStartX;
    carousel.scrollLeft = thumbStartScroll + (deltaX / maxThumbLeft) * maxScroll;
  };

  const stopThumbDrag = () => {
    thumbDragging = false;
    thumb.classList.remove("dragging");
    document.removeEventListener("pointermove", onThumbMove);
    document.removeEventListener("pointerup", stopThumbDrag);
  };

  thumb.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    event.stopPropagation();
    thumbDragging = true;
    thumbStartX = event.clientX;
    thumbStartScroll = carousel.scrollLeft;
    thumb.classList.add("dragging");
    document.addEventListener("pointermove", onThumbMove);
    document.addEventListener("pointerup", stopThumbDrag);
  });

  track.addEventListener("pointerdown", (event) => {
    if (event.target === thumb) return;
    const rect = track.getBoundingClientRect();
    const thumbWidth = thumb.offsetWidth;
    const maxScroll = Math.max(0, carousel.scrollWidth - carousel.clientWidth);
    const maxThumbLeft = Math.max(1, rect.width - thumbWidth);
    const clickX = event.clientX - rect.left - thumbWidth / 2;
    const ratio = Math.max(0, Math.min(clickX / maxThumbLeft, 1));
    carousel.scrollLeft = ratio * maxScroll;
  });

  carousel.querySelectorAll("img").forEach((img) => {
    if (img.complete) return;
    img.addEventListener("load", () => scheduleCarouselUIUpdate(wrap), { once: true });
  });

  if (typeof ResizeObserver !== "undefined") {
    const observer = new ResizeObserver(() => scheduleCarouselUIUpdate(wrap));
    observer.observe(carousel);
    observer.observe(wrap);
    observer.observe(track);
  }

  scheduleCarouselUIUpdate(wrap);
  window.setTimeout(() => scheduleCarouselUIUpdate(wrap), 200);
  window.setTimeout(() => scheduleCarouselUIUpdate(wrap), 800);
}

function createCarouselWrap(carousel) {
  const wrap = document.createElement("div");
  wrap.className = "carousel-wrap";

  const row = document.createElement("div");
  row.className = "carousel-row";

  const prev = document.createElement("button");
  prev.type = "button";
  prev.className = "carousel-nav prev";
  prev.setAttribute("aria-label", "Previous");
  prev.textContent = "◀";

  const viewport = document.createElement("div");
  viewport.className = "carousel-viewport";
  viewport.append(carousel);

  const next = document.createElement("button");
  next.type = "button";
  next.className = "carousel-nav next";
  next.setAttribute("aria-label", "Next");
  next.textContent = "▶";

  const scrollbar = document.createElement("div");
  scrollbar.className = "carousel-scrollbar";
  scrollbar.hidden = true;
  scrollbar.innerHTML = `
    <div class="carousel-track">
      <div class="carousel-thumb"></div>
    </div>
  `;

  row.append(prev, viewport, next);
  wrap.append(row, scrollbar);
  return wrap;
}

function selectPromptImage(promptId, imageId) {
  state.selectedImageByPrompt[promptId] = imageId;

  const prompt = state.prompts.find((item) => item.id === promptId);
  const item = els.promptList.querySelector(`[data-prompt-id="${promptId}"]`);
  if (!prompt || !item) return;

  item.querySelectorAll(".carousel-item").forEach((card) => {
    card.classList.toggle("active", card.dataset.imageId === imageId);
  });

  const active = item.querySelector(".carousel-item.active");
  active?.scrollIntoView({ inline: "nearest", block: "nearest", behavior: "auto" });
  updateCarouselUI(item.querySelector(".carousel-wrap"));

  const selected = getSelectedImage(prompt);
  const details = item.querySelector(".image-details");
  renderImageDetailsContent(details, selected);
  bindImageDetailsActions(item, prompt, selected);
}

function bindPromptItemActions(item, prompt) {
  item.querySelector(".btn-delete-prompt")?.addEventListener("click", () => {
    requestConfirm(
      "Delete Prompt",
      "This will permanently delete this prompt and all of its images.",
      async () => {
        await deletePrompt(prompt.id);
        delete state.selectedImageByPrompt[prompt.id];
        await loadPrompts();
        showToast("Prompt deleted");
      },
    );
  });

  item.querySelectorAll(".btn-copy-field").forEach((button) => {
    button.addEventListener("click", async () => {
      const text = decodeURIComponent(button.dataset.copy);
      await copyText(text, "prompt");
    });
  });

  item.querySelectorAll(".carousel-item").forEach((card) => {
    card.addEventListener("click", () => {
      selectPromptImage(prompt.id, card.dataset.imageId);
    });

    card.querySelector(".carousel-zoom")?.addEventListener("click", async (event) => {
      event.stopPropagation();
      const image = prompt.images.find((entry) => entry.id === card.dataset.imageId);
      if (image) await openImageViewer(image);
    });

    card.querySelector(".carousel-delete")?.addEventListener("click", (event) => {
      event.stopPropagation();
      requestDeleteImage(prompt, card.dataset.imageId);
    });

    if (card.querySelector(".carousel-zoom")) {
      card.addEventListener("dblclick", async (event) => {
        event.preventDefault();
        const image = prompt.images.find((entry) => entry.id === card.dataset.imageId);
        if (image) await openImageViewer(image);
      });
    }
  });

  const noteInput = item.querySelector(".prompt-note-input");
  noteInput?.addEventListener("blur", async () => {
    const note = noteInput.value;
    await updatePromptNote(prompt.id, note);
    const stored = state.prompts.find((entry) => entry.id === prompt.id);
    if (stored) stored.note = note;
  });

  bindImageDetailsActions(item, prompt, getSelectedImage(prompt));
}

async function createPromptItemElement(prompt) {
  const item = document.createElement("article");
  item.className = "prompt-item";
  item.dataset.promptId = prompt.id;

  const head = document.createElement("div");
  head.className = "prompt-item-head";
  head.innerHTML = `
    <div class="prompt-item-meta">
      <strong class="prompt-summary">
        <span class="prompt-id">#${prompt.id.slice(0, 8)}</span>
        <span class="prompt-created-at">${formatDateTime(prompt.createdAt)}</span>
      </strong>
    </div>
    <button class="btn danger btn-with-icon btn-delete-prompt" type="button">${TRASH_ICON_SVG}<span>Delete Prompt</span></button>
  `;

  const noteSection = document.createElement("div");
  noteSection.className = "prompt-note";
  noteSection.innerHTML = `
    <label class="prompt-note-label" for="note-${prompt.id}">Note</label>
    <textarea
      id="note-${prompt.id}"
      class="prompt-note-input"
      rows="2"
      placeholder="Add a note…"
    ></textarea>
  `;
  noteSection.querySelector(".prompt-note-input").value = prompt.note || "";

  const fields = document.createElement("div");
  fields.className = "prompt-fields";

  ["positive", "negative"].forEach((type) => {
    const field = document.createElement("div");
    field.className = `prompt-field prompt-field-${type}`;
    const label = type === "positive" ? "Positive Prompt" : "Negative Prompt";
    const text = type === "positive" ? prompt.positive : prompt.negative;
    field.innerHTML = `
      <div class="prompt-field-head">
        <span>${label}</span>
        <button class="btn ghost btn-with-icon btn-copy-field" data-copy="${encodeURIComponent(text)}" type="button">${COPY_ICON_SVG}<span>Copy</span></button>
      </div>
      <div class="prompt-tags"></div>
    `;
    renderPromptTagList(field.querySelector(".prompt-tags"), text);
    fields.appendChild(field);
  });

  const carousel = document.createElement("div");
  carousel.className = "carousel";

  for (const image of prompt.images) {
    const card = document.createElement("div");
    card.className = "carousel-item";
    card.dataset.imageId = image.id;
    card.setAttribute("role", "button");
    card.tabIndex = 0;
    if (getSelectedImage(prompt)?.id === image.id) {
      card.classList.add("active");
    }

    const src = await resolveImageSrc(image);
    if (src) {
      const img = document.createElement("img");
      img.src = src;
      img.alt = image.fileName || "Preview";
      img.loading = "lazy";
      img.draggable = false;
      card.appendChild(img);
      card.appendChild(createCarouselItemActions({ withZoom: true }));
    } else {
      const placeholder = document.createElement("div");
      placeholder.className = "placeholder-thumb";
      placeholder.textContent = "🥟";
        placeholder.title = "No preview; you can delete this entry manually";
      card.appendChild(placeholder);
      card.appendChild(createCarouselItemActions({ withZoom: false }));
    }

    carousel.appendChild(card);
  }

  const carouselWrap = createCarouselWrap(carousel);

  const details = document.createElement("div");
  details.className = "image-details";
  renderImageDetailsContent(details, getSelectedImage(prompt));

  item.appendChild(head);
  item.appendChild(noteSection);
  item.appendChild(fields);
  item.appendChild(carouselWrap);
  item.appendChild(details);
  bindPromptItemActions(item, prompt);
  setupCarouselNav(carouselWrap);

  const activeCard = carousel.querySelector(".carousel-item.active");
  if (activeCard) {
    requestAnimationFrame(() => {
      scheduleCarouselUIUpdate(carouselWrap);
    });
  }

  return item;
}

async function renderPromptList() {
  if (!state.prompts.length) {
    els.promptList.innerHTML = '<div class="empty-state">No prompts yet. Drag a Forge image into the sidebar to add one.</div>';
    return;
  }

  els.promptList.innerHTML = "";
  const fragment = document.createDocumentFragment();

  for (const prompt of state.prompts) {
    fragment.appendChild(await createPromptItemElement(prompt));
  }

  els.promptList.appendChild(fragment);
}

function requestConfirm(title, message, action) {
  state.confirmAction = action;
  els.confirmTitle.textContent = title;
  els.confirmMessage.textContent = message;
  els.confirmDialog.showModal();
}

els.confirmDialog.addEventListener("close", async () => {
  if (els.confirmDialog.returnValue !== "accept") {
    state.confirmAction = null;
    return;
  }

  const action = state.confirmAction;
  state.confirmAction = null;
  if (action) await action();
});

async function ingestImageFile(file) {
  const parsed = await parseImageFile(file);
  const positive = parsed.positive || "";
  const negative = parsed.negative || "";

  if (!positive && !negative) {
    showToast("Could not read prompts from image; ensure it is a Forge/A1111 PNG");
    return;
  }

  const thumbnailId = crypto.randomUUID();
  let savedThumbnailId = "";

  try {
    const imageDataUrl = await createImageDataUrl(file);
    await saveThumbnail(thumbnailId, imageDataUrl);
    savedThumbnailId = thumbnailId;
  } catch {
    savedThumbnailId = "";
  }

  const { prompt, image } = await addImageToPromptByPair(positive, negative, {
    fileName: parsed.fileName || file.name || "",
    thumbnailId: savedThumbnailId,
    metadata: {
      steps: parsed.steps,
      sampler: parsed.sampler,
      scheduleType: parsed.scheduleType,
      cfgScale: parsed.cfgScale,
      seed: parsed.seed,
      size: parsed.size,
      modelHash: parsed.modelHash,
      model: parsed.model,
      loraHashes: parsed.loraHashes,
      version: parsed.version,
      rawParameters: parsed.rawParameters,
    },
  });

  state.selectedImageByPrompt[prompt.id] = image.id;
  state.pendingPromptFocus = { promptId: prompt.id, imageId: image.id };
  await loadPrompts();
  showToast("Image sorted into prompt group automatically");
}

let forgeImageDragActive = false;
let imagePointerInSidepanel = false;

function updateSidepanelDragHighlight() {
  document.body.classList.toggle(
    "sidepanel-drag-over",
    forgeImageDragActive || imagePointerInSidepanel,
  );
}

function setupSidepanelDragBroadcast() {
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "IMAGE_DRAG_START") {
      forgeImageDragActive = true;
      updateSidepanelDragHighlight();
    }
    if (message?.type === "IMAGE_DRAG_END") {
      forgeImageDragActive = false;
      imagePointerInSidepanel = false;
      updateSidepanelDragHighlight();
    }
  });
}

function isImageDragEvent(event) {
  const transfer = event.dataTransfer;
  if (!transfer) return false;

  if (forgeImageDragActive) return true;

  const types = [...transfer.types];
  if (types.includes("Files")) return true;
  if (types.includes("text/uri-list") || types.includes("text/html")) return true;

  return [...transfer.items].some(
    (item) => item.kind === "file" && item.type.startsWith("image/"),
  );
}

function shouldIgnoreImageDrop(event) {
  return Boolean(
    event.target.closest("dialog")
    || event.target.closest("label.file-label")
    || event.target.closest("#import-file"),
  );
}

function shouldHandleImageDrop(event) {
  return isImageDragEvent(event) && !shouldIgnoreImageDrop(event);
}

function extractDraggedImageUrl(transfer) {
  const uriList = transfer.getData("text/uri-list")?.trim();
  if (uriList) {
    const url = uriList
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line && !line.startsWith("#"));
    if (url) return url;
  }

  const html = transfer.getData("text/html");
  if (html) {
    const match = html.match(/src=["']([^"']+)["']/i);
    if (match?.[1]) return match[1];
  }

  return null;
}

async function resolveDroppedImageFiles(event) {
  const transfer = event.dataTransfer;
  if (!transfer) return [];

  const fileList = [...transfer.files].filter((file) => file.type.startsWith("image/"));
  if (fileList.length) return fileList;

  const url = extractDraggedImageUrl(transfer);
  if (!url) return [];

  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const blob = await response.blob();
    if (!blob.type.startsWith("image/")) {
      showToast("Dropped link is not an image");
      return [];
    }

    const fileName = url.split("/").pop()?.split("?")[0] || "dropped-image.png";
    return [new File([blob], fileName, { type: blob.type || "image/png" })];
  } catch {
    showToast("Could not fetch dropped image");
    return [];
  }
}

function setupGlobalDropZone() {
  const onDragEnter = (event) => {
    if (!shouldHandleImageDrop(event)) return;
    event.preventDefault();
    imagePointerInSidepanel = true;
    updateSidepanelDragHighlight();
  };

  const onDragOver = (event) => {
    if (!shouldHandleImageDrop(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  };

  const onDragLeave = (event) => {
    if (event.relatedTarget && document.body.contains(event.relatedTarget)) return;
    imagePointerInSidepanel = false;
    updateSidepanelDragHighlight();
  };

  const onDrop = async (event) => {
    if (!shouldHandleImageDrop(event)) return;
    event.preventDefault();
    event.stopPropagation();
    forgeImageDragActive = false;
    imagePointerInSidepanel = false;
    updateSidepanelDragHighlight();

    const files = await resolveDroppedImageFiles(event);
    if (!files.length) return;

    for (const file of files) {
      await ingestImageFile(file);
    }
  };

  for (const target of [document, els.promptList]) {
    if (!target) continue;
    target.addEventListener("dragenter", onDragEnter, true);
    target.addEventListener("dragover", onDragOver, true);
    target.addEventListener("dragleave", onDragLeave, true);
    target.addEventListener("drop", onDrop, true);
  }
}

document.getElementById("btn-export").addEventListener("click", async () => {
  const payload = await exportAllData();
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `forge-prompt-library-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
  showToast("Settings exported");
});

document.getElementById("import-file").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;

  try {
    const text = await file.text();
    const payload = JSON.parse(text);
    await importAllData(payload);
    state.selectedImageByPrompt = {};
    state.pendingPromptFocus = null;
    thumbnailCache.clear();
    await loadPrompts();
    showToast("Settings imported");
  } catch (error) {
    showToast(`Import failed: ${error.message}`);
  }
});

document.getElementById("btn-clear-all").addEventListener("click", () => {
  requestConfirm(
    "Delete All Data",
    "This will permanently delete all prompt groups and stored images.",
    async () => {
      await clearAllData();
      state.selectedImageByPrompt = {};
      state.pendingPromptFocus = null;
      thumbnailCache.clear();
      await loadPrompts();
      scrollSidepanelToTop();
      showToast("All data cleared");
    },
  );
});

setupSidepanelDragBroadcast();
setupGlobalDropZone();
setupImageViewerControls();

els.imageViewer.addEventListener("click", (event) => {
  if (event.target === els.imageViewer) {
    els.imageViewer.close();
  }
});

loadPrompts().then(() => {
  scrollSidepanelToTop();
});

let sidePanelWindowId = null;
chrome.windows.getCurrent().then((window) => {
  sidePanelWindowId = window.id ?? null;
  if (sidePanelWindowId != null) {
    chrome.runtime.sendMessage({
      type: "SIDE_PANEL_MOUNTED",
      windowId: sidePanelWindowId,
    }).catch(() => {});
  }
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== "REQUEST_SIDE_PANEL_CLOSE") return;
  if (message.windowId != null && message.windowId !== sidePanelWindowId) return;
  window.close();
});
