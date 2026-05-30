const FORGE_URL_PATTERNS = [
  /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//i,
];

/** @type {Map<number, boolean>} */
const sidePanelOpenByWindow = new Map();

function isForgeLikeUrl(url) {
  if (!url) return false;
  return FORGE_URL_PATTERNS.some((pattern) => pattern.test(url));
}

function setSidePanelOpen(windowId, isOpen) {
  if (windowId == null) return;
  sidePanelOpenByWindow.set(windowId, isOpen);
}

function isSidePanelOpen(windowId) {
  return sidePanelOpenByWindow.get(windowId) === true;
}

async function openSidePanel({ windowId, tabId }) {
  const openOptions = tabId != null ? { tabId } : { windowId };

  try {
    await chrome.sidePanel.open(openOptions);
  } catch {
    await chrome.sidePanel.open({ windowId });
  }

  setSidePanelOpen(windowId, true);
}

async function closeSidePanel({ windowId, tabId }) {
  if (chrome.sidePanel.close) {
    const closeOptions = tabId != null ? { tabId } : { windowId };

    try {
      await chrome.sidePanel.close(closeOptions);
    } catch {
      await chrome.sidePanel.close({ windowId });
    }
  } else {
    await chrome.runtime.sendMessage({
      type: "REQUEST_SIDE_PANEL_CLOSE",
      windowId,
    });
  }

  setSidePanelOpen(windowId, false);
}

async function toggleSidePanel({ windowId, tabId }) {
  if (isSidePanelOpen(windowId)) {
    await closeSidePanel({ windowId, tabId });
    return false;
  }

  await openSidePanel({ windowId, tabId });
  return true;
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

if (chrome.sidePanel.onClosed) {
  chrome.sidePanel.onClosed.addListener(({ windowId }) => {
    setSidePanelOpen(windowId, false);
  });
}

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete" || !tab.url) return;
  if (!isForgeLikeUrl(tab.url)) return;

  try {
    await chrome.sidePanel.setOptions({
      tabId,
      path: "sidepanel/sidepanel.html",
      enabled: true,
    });
  } catch {
    // Side panel may be unavailable in some contexts.
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "SIDE_PANEL_MOUNTED") {
    setSidePanelOpen(message.windowId, true);
    sendResponse({ ok: true });
    return true;
  }

  if (message?.type !== "TOGGLE_SIDE_PANEL" || !sender.tab?.windowId) {
    return false;
  }

  toggleSidePanel({
    windowId: sender.tab.windowId,
    tabId: sender.tab.id,
  })
    .then((opened) => sendResponse({ ok: true, opened }))
    .catch((error) => sendResponse({ ok: false, error: String(error) }));

  return true;
});
