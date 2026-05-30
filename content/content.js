(function initForgePromptHelper() {
  const BUTTON_ID = "forge-prompt-library-toggle";

  document.getElementById(BUTTON_ID)?.remove();

  const button = document.createElement("button");
  button.id = BUTTON_ID;
  button.type = "button";
  button.textContent = "Prompt Library";
  button.title = "Toggle Forge Prompt Library sidebar";
  button.style.cssText = [
    "position:fixed",
    "bottom:24px",
    "right:24px",
    "z-index:99999",
    "padding:10px 14px",
    "border:none",
    "border-radius:999px",
    "background:#6366f1",
    "color:#fff",
    "font-size:13px",
    "font-weight:600",
    "cursor:pointer",
    "box-shadow:0 8px 24px rgba(99,102,241,.35)",
  ].join(";");

  button.addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "TOGGLE_SIDE_PANEL" }).catch(() => {});
  });

  document.documentElement.appendChild(button);

  function isForgeImageDrag(event) {
    const transfer = event.dataTransfer;
    if (!transfer) return false;
    if ([...transfer.types].includes("Files")) return true;

    const target = event.target;
    if (target instanceof HTMLImageElement) return true;
    if (target instanceof Element && target.closest("img")) return true;

    return [...transfer.items].some(
      (item) => item.kind === "file" && item.type.startsWith("image/"),
    );
  }

  function notifyImageDrag(active) {
    chrome.runtime.sendMessage({
      type: active ? "IMAGE_DRAG_START" : "IMAGE_DRAG_END",
    }).catch(() => {});
  }

  document.addEventListener("dragstart", (event) => {
    if (!isForgeImageDrag(event)) return;
    notifyImageDrag(true);
  }, true);

  document.addEventListener("dragend", () => {
    notifyImageDrag(false);
  }, true);
})();
