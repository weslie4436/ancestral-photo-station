# AGENTS — ancestral-photo-station（Famiphoto 照片門）

## 這是什麼

- **GitHub Pages 門面** + **家裡保險庫**（隧道 origin 寫在 `config.js` 的 `VAULT_ORIGIN`）。
- 公開網址：https://weslie4436.github.io/ancestral-photo-station/
- 資料、封面、個人鑰匙不上 Pages；成人／私密內容只走隧道 + 鑰匙。

## UI 與共用規則

- **能共用的物件 100% 共用**；UI chrome 詞彙遵循 skill **`fami-shared-ui`**（返回／確認／找卡／操作卡／愛心／首頁頭）。
- 活標本：`E:\FamilyPhotos\web`（本專案）、`D:\Mybook\web`。三套表面（iPhone／iPad／桌機）見 skill **`ios-home-web`**。
- Cursor 規則目錄：`.cursor/rules/`  
  - `shared-web-sheets.mdc` — 共用殼 vs 產品邊界（本檔摘要）  
  - `wait-ui.mdc` — 等待必須有畫面  
  - `ios-keyboard.mdc` — 小鍵盤 `--kb`  
  - `surfaces.mdc` — 三套表面  
  - `always-push-github.mdc` — 改 Pages 必 push main  

## 共用 chrome vs 產品外掛

| 共用（跟其他 Fami 門面對齊） | 本 repo 產品專屬 |
|---|---|
| Rose Two 等待、標準個人頁殼、齒輪／標籤／多選 | **`FamiphotoGate`**（`gate.js` 匯出）：邀請連結入口 |
| 返回、確認、操作卡詞彙 | **Apple 帳密／MFA**（`gate.js` invite 流程） |
| 入口 `hey.html` 的共用等待／鍵盤規則 | 相簿、上傳、備份、家人格子（`door.js`、`gallery.js`） |

- **`gate.js` 整檔不是共用 kernel**。Invite／Apple MFA 是 Famiphoto 產品外掛，疊在共用 chrome 上；其他門面（book／kodohon／gamepal）不要整包複製這段。
- 共用入口邏輯優先對齊 **FamiGate 核心**；無「有必要」自審不要 fork gate。

## 代理進場

1. 讀本檔 → `.cursor/rules/` → 相關 skill（`fami-shared-ui`、`ios-home-web`）。
2. 畫面／按鈕／卡片工作：對照詞彙表，禁止自造第三種卡或閹割版個人頁（除非使用者明確允許）。
3. 改會上 Pages 的檔：驗證後 **commit + push `main`**，提高 `index.html` 的 `?v=`。不要推金鑰、`status.json`、照片本體。

## 主要檔案（參考，wave1 勿動 runtime）

| 檔案 | 角色 |
|---|---|
| `hey.html` | 邀請入口頁 |
| `index.html` | 個人相簿主頁 |
| `gate.js` | 入口 gate + FamiphotoGate（invite／Apple MFA） |
| `door.js` | 個人頁／相簿邏輯 |
| `tags.js` | 標籤列 + 鍵盤 |
| `app.css` | 專案色票與殼 |
| `config.js` | `VAULT_ORIGIN`（不上 Pages 的隧道位址由部署環境維護） |
