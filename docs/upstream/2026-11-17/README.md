# 原站重新下載與備查 / Upstream archive

取得時間：2026-11-17 18:25（Asia/Taipei；逐檔 UTC 時間見 manifest）。本次在 main 保存原始交付資源，供後續比對與研究。

## 查核結果

| 項目 | 當次結果 |
| --- | --- |
| [平台入口](https://www.bilibili.com/toy/golden-hour/index.html) | HTTP 200，標題「随时随地cod」，Toy ID `54263300497408`。 |
| [遊戲 iframe](https://www.bilibilitoy.com/toy/golden-hour/54263300497408-v49221/index.html) | HTTP 200，標題「暮色酒店」，交付版本 `54263300497408-v49221`。 |
| 舊清單的 42 個公開資源 | 本次全部重新透過 HTTP 取得，SHA-256 全數相同。包含平台外殼、遊戲入口、核心 JS、客戶端模組、CSS、語系、圖示與三個資料資源。 |
| [原 Repo 公開 API](https://api.github.com/repos/LankiYang/golden-hour) | HTTP 404，原始 JSON 已封存；不能據此區分私人化與刪除。 |
| [作者公開資料](https://api.github.com/users/LankiYang) | HTTP 200，原始 JSON 已封存。 |
| fork／開發同意 | 維護者確認已獲同意；README 既有[對話圖片](https://github.com/user-attachments/assets/44a7cc57-4f56-40a9-9d06-63b2ac29da3e)已下載備查，具體開源授權待定。 |

## 檔案與驗證

- [resources.zip](resources.zip)：47 個原件，共 14,272,566 bytes；ZIP 為 5,715,181 bytes。以本分支工具從公開 URL 重新下載並封裝，並非作者提供的原始碼 ZIP。
- [manifest.json](manifest.json)：逐檔來源 URL、最終 URL、HTTP 狀態、取得時間、回應標頭、內容大小、SHA-256 與舊清單比對結果。
- ZIP SHA-256：`9af358f637fcb041c972de67b08f217e34cb66dbe2c39a2f8ebcd0f07bfae06d`。

ZIP 的 `game/` 保存 40 個遊戲資源；`original/` 保存平台與遊戲 HTML；`platform/` 保存 manifest 與 service worker；`reference/` 保存 Repo 回應、作者公開資料及 fork 同意對話圖片。位元組為 HTTP 內容解壓後的原件，未改寫編碼、換行、網址或遠端服務設定。回應的 `Content-Length` 可能是壓縮傳輸大小，與 manifest 的解壓內容大小不同；CDN `Date`／`Last-Modified` 也不等於本機取得時間。

在專案根目錄執行以下指令即可離線檢查 ZIP 雜湊、CRC、完整檔案清單、每個原件的大小與 SHA-256、相對 JS 依賴是否已封存，以及 HTML 的 `data-bundle` 是否對應核心 JS 雜湊：

```sh
python scripts/archive_upstream.py docs/upstream/2026-11-17 --verify
```

日後重新下載請指定新的目錄，工具會拒絕覆寫現有快照：

```sh
python scripts/archive_upstream.py docs/upstream/YYYY-MM-DD
```

下載工具以舊來源清單的 42 個資源為範圍，從當時平台頁的 iframe 取得版本路徑；若新版本新增相對 JS 依賴，離線檢查會失敗，需補充清單後再封存。動態產生的路徑及其他類型的新資源仍需人工檢查。

## 技術資訊與範圍

原版 HTML 的 `data-bundle` 為 `5c5c112f76f1017784126e6912e239ad779110ce9c2b0c3a91c54f8f386d2af3`，與原版 `dist/game.js` 的 SHA-256 一致。HTML 宣告的 API origin 為 `https://cod.apikeygame.top:8008`；僅保存此宣告，沒有查詢、登入或驗證原服。平台 service worker 僅在導覽失敗時回傳離線提示，沒有在此次取得的程式中建立遊戲離線快取。

本次 47 個檔案不包含平台追蹤 SDK、玩家帳號、cookie、雲端存檔、房間紀錄、原服程式、原始 Git 歷史或完整開發工具鏈。HTTP 200 與雜湊比對證明資源可取得與內容相同；沒有在本次重新驗收原站實際遊玩、對戰或後端健康。封存包保留遠端設定，供查考；本社群分支仍使用既有本機服務。

## English record

On November 17, 2026 (Asia/Taipei), the public Bilibili page and its versioned game iframe returned HTTP 200. All 42 resources from the historical inventory were freshly downloaded and matched their previous SHA-256 hashes. Five additional files preserve the platform PWA manifest/service worker, public repository/author API responses and the existing permission conversation image. The repository API still returned 404; this does not distinguish deletion from private visibility.

The maintainer confirms the author's consent for the fork and further development. Formal open-source license terms remain unspecified. `resources.zip` is our capture of public distribution files, not an upstream source release. `manifest.json` records HTTP evidence and hashes. The verification command above runs offline. Gameplay, multiplayer and original backend health were not revalidated during this capture.
