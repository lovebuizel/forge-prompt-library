# Forge Prompt Library

Chrome 擴充功能，搭配 **[Stable Diffusion WebUI Forge](https://github.com/lllyasviel/stable-diffusion-webui-forge)** 使用。將 Forge 生成的 PNG 拖入側欄，依**正提示詞 + 負提示詞**自動分組整理，所有資料保存在本機。

**授權**：[MIT License](LICENSE) · **作者**：[lovebuizel](https://github.com/lovebuizel)

---

## 示範影片

<video src="demo.mp4" controls width="100%"></video>

---

## 快速開始

### 你需要

| 項目 | 說明 |
|------|------|
| 瀏覽器 | Google Chrome（建議 **141+**，Side Panel 關閉功能較完整） |
| 生圖環境 | Forge 運行於 `http://127.0.0.1` 或 `http://localhost` |
| 圖片格式 | 含 Forge / A1111 `parameters` metadata 的 **PNG** |

> 擴充功能 UI 為英文。資料僅存於本機 IndexedDB，**不會上傳到任何伺服器**。

### 安裝

1. 下載或 clone 本 repo
2. 開啟 `chrome://extensions/`
3. 右上角開啟 **開發人員模式**
4. 點 **載入未封裝項目**，選擇本專案資料夾
5. 確認工具列出現 **Forge Prompt Library**

### 日常使用

1. **開啟側欄** — 在 Forge 頁面點工具列上的擴充功能圖示，或點右下角的 **Prompt Library** 浮動按鈕
2. **匯入圖片** — 從 Forge 圖庫將 PNG **拖放**到側欄列表區（任意空白處即可）
3. **自動分組** — 相同正+負提示詞的圖片會歸到同一組（不同 seed 也同組）
4. **複製提示詞** — 點單一 tag 複製該 tag；或點 **Copy** 複製整段正/負提示詞
5. **瀏覽圖片** — 點縮圖開啟全螢幕檢視；滾輪可縮放
6. **備份資料** — Header 的 **Export** 匯出 JSON；**Import** 還原備份

### 側欄功能一覽

| 區塊 | 用途 |
|------|------|
| **Storage** | 顯示本機已用容量（Images / Prompts） |
| **Export / Import** | 匯出、匯入全部資料 |
| **Delete All Data** | 清空本機所有資料（需確認） |
| **提示詞卡片** | 正提示詞（綠）、負提示詞（紅）、備註、縮圖輪播、生成參數 |
| **Delete Prompt** | 刪除整組提示詞及其圖片 |

### 常見問題

| 問題 | 說明 |
|------|------|
| 拖放沒反應 | 側欄須先開啟；Forge 頁面需重新整理（F5） |
| 無法分組 | PNG 須含 Forge / A1111 的 `parameters`（ComfyUI 原生 JSON 不支援） |
| 浮動按鈕沒出現 | 僅在 `127.0.0.1` / `localhost` 的 Forge 頁面注入；其他網址需改 `manifest.json` |

---

> **給 AI 的說明**：UI 文案為英文；所有使用者資料存於本機 IndexedDB，不上傳伺服器（副標：`All data is stored locally on your device.`）。主要邏輯在 `sidepanel/sidepanel.js`（~1340 行），儲存層在 `lib/db.js`，PNG 解析在 `lib/utils.js`，Side panel 開關在 `background/service-worker.js`。

---

## 專案概述

| 項目 | 說明 |
|------|------|
| 名稱 | Forge Prompt Library |
| 平台 | Chrome Extension MV3 |
| 目標使用者 | 使用 Forge 生圖、需要依提示詞組合整理歷史圖片的人 |
| 核心價值 | 拖 Forge PNG → 依「正+負提示詞」自動歸類、本機持久化、匯出匯入 |
| 授權 | [MIT License](LICENSE)，開源 |
| 作者 | [lovebuizel](https://github.com/lovebuizel) |

---

## 架構

```mermaid
flowchart TB
  subgraph forge [Forge 127.0.0.1 / localhost]
    CS[content/content.js]
    CS -->|TOGGLE_SIDE_PANEL| BG
    CS -->|IMAGE_DRAG_START / END| SP
  end

  subgraph ext [Chrome Extension]
    BG[background/service-worker.js]
    SP[sidepanel/sidepanel.js]
    DB[(lib/db.js)]
    UTIL[lib/utils.js]

    BG -->|sidePanel.open / close| SP
    SP -->|SIDE_PANEL_MOUNTED| BG
    SP --> DB
    SP --> UTIL
  end

  User -->|工具列 icon / Prompt Library 浮動按鈕| BG
  User -->|拖放 PNG 到側欄| SP
```

### 各層職責

| 檔案 | 職責 |
|------|------|
| `manifest.json` | MV3、sidePanel、content_scripts、權限 |
| `background/service-worker.js` | Side panel toggle、`sidePanelOpenByWindow` Map、tab 綁定 |
| `content/content.js` | Forge 右下角 **Prompt Library** 按鈕；圖片 drag 廣播 |
| `sidepanel/sidepanel.html` | Header + `#prompt-list` |
| `sidepanel/sidepanel.css` | 深色主題、正/負色塊、輪播、viewer |
| `sidepanel/sidepanel.js` | 列表、輪播、viewer、拖放 ingest、Storage、匯出匯入 |
| `lib/db.js` | IndexedDB CRUD、匯出匯入、`estimateStorageUsage` |
| `lib/utils.js` | PNG 解析、`promptToTags`、原圖 data URL |

### Side Panel 開關

| 事件 | 行為 |
|------|------|
| `TOGGLE_SIDE_PANEL` | 依 `windowId` Map → `close` 或 `open`（優先 `tabId`） |
| `chrome.sidePanel.onClosed` | Map 設 `false` |
| `SIDE_PANEL_MOUNTED` | Map 設 `true` |
| 無 `sidePanel.close` | `REQUEST_SIDE_PANEL_CLOSE` → `window.close()` |

不要用 `chrome.runtime.getContexts` 判斷開關。`close()` 需 Chrome 141+。

### 跨元件訊息

| type | 方向 | 用途 |
|------|------|------|
| `TOGGLE_SIDE_PANEL` | content → background | 切換 side panel |
| `SIDE_PANEL_MOUNTED` | sidepanel → background | 同步開啟狀態 |
| `REQUEST_SIDE_PANEL_CLOSE` | background → sidepanel | 舊版 Chrome fallback |
| `IMAGE_DRAG_START` / `END` | content → sidepanel | 拖放高亮（側欄須已開啟） |

---

## UI 布局

```
body (flex column, min-height 100dvh)
├── .app-header-wrap (sticky)
│   ├── #storage-usage
│   └── .app-header
│       ├── 標題 + 副標
│       └── Export | Import | Delete All Data
└── main#prompt-list.prompt-list (flex:1)
    └── .prompt-item × N
```

- 單欄全寬；`#prompt-list` 撐滿 header 以下空間
- Header 按鈕靠右（`.header-actions`）
- 正/負提示詞：`.prompt-field-positive`（綠）、`.prompt-field-negative`（紅）
- 輪播縮圖：`--carousel-item-size: 120px`

---

## 目錄結構

```
prompt-manage-extension/
├── manifest.json
├── demo.mp4
├── background/service-worker.js
├── content/content.js
├── lib/db.js
├── lib/utils.js
├── sidepanel/
│   ├── sidepanel.html
│   ├── sidepanel.css
│   └── sidepanel.js
├── icons/
├── LICENSE
└── README.md
```

---

## 資料模型（IndexedDB）

- **資料庫**：`forgePromptManager`
- **版本**：`2`
- **本機儲存**，無遠端 API

### `prompts`

```js
{
  id: string,
  key: string,              // makePromptKey(positive, negative)
  positive: string,
  negative: string,
  note: string,
  createdAt: number,
  updatedAt: number,
  images: [{
    id, fileName, thumbnailId, addedAt,
    metadata: { steps, sampler, seed, size, model, ... }
  }]
}
```

### `thumbnails`

Store 名稱為 `thumbnails`，存放**原圖 PNG data URL**：

```js
{ imageId: string, dataUrl: string }
```

寫入：`createImageDataUrl(file)` → `saveThumbnail(id, dataUrl)`

### 分組

```js
// lib/utils.js
normalizePromptText(prompt)
  // 換行 → 逗號，再 promptToTags → tagsToPrompt（去前後空白、空 tag、`, ` 連接）

// lib/db.js
makePromptKey(positive, negative)
  => `${normalizePromptText(positive)}\u0000${normalizePromptText(negative)}`
```

正規化後相同者歸同一組，例如 `aaa,bbb,ccc` 與 `,aaa,bbb,ccc`；`aaa,bbb` 與 `aaa,\n\nbbb` 亦同組；`<aaa><bbb>`、`<aaa> <bbb>`、`<aaa>, <bbb>` 亦同組（`<...>` 角括號 token 會拆成獨立 tag）。不同 seed 仍同組。

### 匯出格式（version 2）

```js
{
  version: 2,
  exportedAt: ISO string,
  prompts: PromptRecord[],
  thumbnails: { [thumbnailId]: dataUrl }
}
```

### Storage 用量

Header `#storage-usage` 顯示 `prompts` + `thumbnails` 估算容量；tooltip 細分 Images / Prompts。

---

## 功能

### 提示詞列表

每筆 `.prompt-item` 含：

| 區塊 | 說明 |
|------|------|
| Header | ID 前 8 字 + 建立時間 + Delete Prompt |
| Note | textarea，blur 儲存 |
| Positive / Negative | 色塊、可點擊複製的 tag、Copy 按鈕 |
| Carousel | 120px 縮圖、scrollbar、箭頭、zoom / delete |
| Metadata | Steps、Sampler、Seed 等 |

**新增方式**：拖 Forge 生成的 PNG 到側欄任意位置。

```
resolveDroppedImageFiles
  → ingestImageFile → parseImageFile
  → createImageDataUrl → saveThumbnail
  → addImageToPromptByPair → loadPrompts → focusPromptItem
```

### 拖放

| 步驟 | 說明 |
|------|------|
| Forge dragstart | content 送 `IMAGE_DRAG_START`，側欄高亮 |
| dragover | `document` + `#prompt-list`（capture）；`preventDefault` |
| 有效拖放 | `forgeImageDragActive` 或 `Files` 或 `text/uri-list` / `text/html` |
| 取得檔案 | 優先 `dataTransfer.files`；否則 URL → `fetch` → `File` |
| 排除區 | dialog、Import label 不觸發 ingest |

Forge 拖曳常帶 URL 而非 `Files`，需支援 URL fetch。

### 輪播

- 縮圖不可 HTML drag；carousel 以 pointer 橫向 pan
- Hover：放大、刪除；雙擊開 viewer
- 無預覽：🥟 placeholder

### 全圖查看器（`#image-viewer`）

- 黑色全屏；預設寬度撐滿側欄（`fitScale`）
- 滾輪以滑鼠為中心縮放 1×～8×；縮回 1×不重置位置
- `clampViewerPan` 邊界限制；`ResizeObserver` 隨側欄 relayout
- 開啟時 `body.viewer-open`，輪播不搶 pointer

`viewerState`：`naturalWidth/Height`, `fitScale`, `zoom`, `x`, `y`

### Header

| 按鈕 | 行為 |
|------|------|
| Export | 下載 `forge-prompt-library-YYYY-MM-DD.json` |
| Import | JSON → `importAllData` |
| Delete All Data | 確認後 `clearAllData()` |

刪除相關操作使用 `requestConfirm` 單次確認。

---

## PNG Metadata

| 來源 | 自動歸類 |
|------|----------|
| Forge / A1111 `parameters` | ✅ |
| ComfyUI 原生 JSON | ❌ |
| ComfyUI + 額外 `parameters` | ⚠️ 視設定 |

`lib/utils.js`：`extractPngTextChunks` → `parseParametersString`

---

## 程式參考

### sidepanel.js `state`

```js
{
  prompts,
  selectedImageByPrompt: { [promptId]: imageId },
  pendingPromptFocus: { promptId, imageId },
  confirmAction,
}
```

| 領域 | 函式 |
|------|------|
| 列表 | `loadPrompts`, `renderPromptList`, `createPromptItemElement`, `renderPromptTagList` |
| 拖放 | `setupGlobalDropZone`, `resolveDroppedImageFiles`, `extractDraggedImageUrl` |
| Ingest | `ingestImageFile` |
| 輪播 | `setupCarouselNav`, `setupCarouselPan`, `updateCarouselUI` |
| Viewer | `openImageViewer`, `layoutViewerImage`, `applyViewerZoomAtPoint`, `clampViewerPan` |
| Storage | `updateStorageUsage`, `scheduleStorageUsageUpdate` |
| 確認 | `requestConfirm` |

### lib/utils.js

| 函式 | 用途 |
|------|------|
| `extractPngTextChunks` | 讀 PNG tEXt |
| `parseParametersString` | 解析 parameters |
| `parseImageFile` | File → 提示詞 + metadata |
| `normalizePromptText` | 提示詞正規化（分組 key 與儲存用） |
| `promptToTags` | 提示詞拆 tag（逗號分段 + `<...>` 角括號 token 拆分） |
| `createImageDataUrl` | 原圖 data URL |

### lib/db.js

| 函式 | 用途 |
|------|------|
| `getAllPrompts` / `savePrompt` / `deletePrompt` | 提示詞 CRUD |
| `saveThumbnail` / `getThumbnail` / `deleteThumbnail` | 圖片 data |
| `exportAllData` / `importAllData` | 匯出匯入 |
| `clearAllData` | 清空全部 |
| `estimateStorageUsage` | 容量估算 |

---

## 開發與測試

安裝步驟見上方 **快速開始 → 安裝**。開發時額外注意：

1. 改程式後：`chrome://extensions/` 重載擴充功能 + Forge 頁 **F5**
2. 拖 PNG 到列表區 → 自動歸類

Content script 僅匹配 `127.0.0.1` / `localhost`；其他 host 需改 `manifest.json` 與 `background/service-worker.js`。

慣例：ES modules、vanilla JS、日期 locale `en-US`。

---

## 已知限制

| 項目 | 說明 |
|------|------|
| 儲存 | 原圖 data URL 占用大，留意 Storage 指示 |
| Forge host | 預設本機 |
| PNG | 僅 A1111/Forge `parameters` 格式 |
| Side panel | `close()` 需 Chrome 141+ |
| 商店 | `host_permissions` 含 `http://*/*` 可能需審核說明 |

---

## 快速決策表（給 AI）

| 想改… | 先看… |
|--------|--------|
| 文案 / Header | `sidepanel.html` |
| 布局 / 色塊 / 輪播 | `sidepanel.css` |
| 列表 / 輪播 / 確認框 | `sidepanel.js` |
| 拖放 / URL fetch | `setupGlobalDropZone`, `resolveDroppedImageFiles` |
| Viewer | `openImageViewer`～`setupImageViewerControls` |
| Storage | `updateStorageUsage`, `estimateStorageUsage` |
| 資料 / 匯出 | `lib/db.js` |
| PNG | `lib/utils.js` |
| Forge 浮動鈕 | `content/content.js` |
| Side panel toggle | `background/service-worker.js` |
| 權限 / URL | `manifest.json` |

---

## 作者與授權

本專案以 [MIT License](LICENSE) 開源。

| | |
|---|---|
| 作者 | [lovebuizel](https://github.com/lovebuizel) |
| GitHub | https://github.com/lovebuizel |
