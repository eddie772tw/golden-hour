# 原版相容伺服器連線

本分支可在連線大廳選擇「原版相容伺服器」，以封存原版客戶端的公開協定連線並加入遊戲。原作者伺服器程式與 Git 歷史仍未取得；實作依據為 [2026-11-17 重新取得的客戶端原件](upstream/2026-11-17/README.md) 中的 `client/pvp.js`、`net.js`、`webrtc.js`、`lobby.js` 與 `api-config.js`。

## 使用方式

1. 啟動本分支客戶端，開啟「連線對戰 → 選擇對戰伺服器」。
2. 類型選「原版相容伺服器」，填入完整 HTTPS origin，例如 `https://example.org:8008`，不可含帳密、路徑或查詢參數。預填值來自封存原版 HTML 的 API origin；不代表正式服務目前已驗收。
3. 按「切換並重新載入」，輸入對戰呼號，選快速加入、建立房間或從大廳／代碼加入。
4. 離開房間後，可在相同選單選回「本地／社群伺服器」。切換會重新載入，確保帳號與武器從啟動時就使用正確模式。

也可使用 `http://127.0.0.1:48722/?server=https%3A%2F%2Fexample.org%3A8008&pvp=1`。`server` 參數明確啟用原版相容模式；移除該參數則使用既有本地模式。HTTP 僅允許 localhost／loopback 測試。

## 武器限制

| 已儲存的 Shop 型號 | 原版相容模式實際使用 |
| --- | --- |
| G-Bull (`gbull`) | STRIX 9 (`pistol`) |
| Chin-Gi (`chingi`) | VESPER 9 (`smg`) |
| Lin-Bei (`linbei`) | M12 (`shotgun`) |

KR-7 (`ar`) 保持原樣。限制從頁面啟動套用，包含單人訓練、槍匠、第一人稱／世界模型、武器定義及裝備封包。Shop 模型不下載、不掛載，型號選單停用；重生、切副武器、加入失敗與自動重連也不會解除限制。封包層將三個 Shop ID 轉回同類原版 ID，接收快照時僅接受原版四個索引 `ar/smg/shotgun/pistol`。原本的型號偏好不會被覆寫，回到本地模式即可恢復。

三把原版主武器為 KR-7、VESPER、M12，另有 STRIX 9 副武器。伺服器仍決定實際武器可用性及權威數值；本分支不會替遠端伺服器核發解鎖資格。

## 連線與帳號

- 原版相容模式不開啟本地 Vault、不要求本地 admission ticket，不呼叫本地 `/api/auth/*`、`/api/career`、`/api/invite` 或同步本地專服戰績。握手保留原版名稱、快速加入／公開開房、房間與續接欄位；本地 ticket、profile 憑證不會送至遠端。
- WebRTC SDP POST 不含 `Authorization: Bearer undefined` 或本地票券；WebTransport 與 WebRTC 的既有選擇／備援、輸入、快照、續接及離房流程共用。
- 對方需要提供原版 `/api/config`、`/api/rooms/events`，以及宣告的 WebRTC SDP／WebTransport 服務。WebRTC 使用 `gh-pvp-v1` 的 `reliable`、`state` DataChannel；原版二進位協定與裝備索引保持一致。
- 直接跨來源連線需要對方允許客戶端 origin 的 CORS，包含 SSE、設定與 JSON SDP POST。既有 TLS 信任與信令 origin 校驗保留；瀏覽器的證書、CORS、防火牆或 UDP 限制仍會讓加入失敗，UI 會提供錯誤與原有檢查證書入口。
- 相容模式不套用本地專服的武器擊殺解鎖規則、不顯示本地排行榜，也不把遠端擊殺／結算記入本地帳號的競技進度。原站 Toy 身分、雲檔與排行榜整合沒有重新接入。

## 驗證與限制

`npm test` 包含 URL／origin 校驗、原版模式啟動前的型號回退與偏好保留、Shop 模型停用、送出封包的武器與憑證限制，以及快照索引相容性測試。

```sh
python server/check_original_compatible.py
```

上述瀏覽器檢查需要 Python Playwright 與 Edge（可用 `GH_BROWSER` 指定 Chromium 執行檔），自行啟停兩個專用 loopback 測試服務與記憶體資料庫。它使用實際瀏覽器 WebRTC，檢查 UI 加入、匿名 SDP／hello、移動 ACK、射擊／換彈、保留席位重連、三種武器回退、偏好保留，以及從切換選單返回本地模式後的帳號／Shop 對戰。設定 `GH_COMPAT_CAPTURES` 可保存選單畫面。

`server/fixtures/original-server.mjs` 是依封存原版客戶端協定撰寫的本機測試替身，模擬仍沿用本分支 `Room`。測試結果只能證明本機協定與客戶端流程，不能視為原作者正式伺服器、公網 NAT／TURN、實體雙機或 WebTransport 路徑的本次驗收。原作者正式服務的 CORS、證書、房間及對戰仍需另行實測。

2026-11-17 本地驗證：`npm test` 168 項通過；上述 Edge／實際 WebRTC 檢查通過，包含兩次 welcome 的同席位續接、輸入 ACK 12，以及原版模式 → 本地帳號／G-Bull 模式的完整切換。專服打包清單也已加入 `server-target.js`，以獨立暫存目錄載入打包用的 `server/room.mjs`，確認模組依賴完整。

## English

Select an original-compatible server in the multiplayer lobby, enter its HTTPS origin and reload. The URL's `server` parameter fixes the mode for the page lifetime. The client uses the archived anonymous protocol and never sends local admission/account credentials. Shop models, stats and equip IDs fall back to their original family equivalents; saved model preferences survive the switch. Local account progression and leaderboards are isolated from remote matches.

The server must expose the original config, room directory and WebRTC/WebTransport protocol, with suitable TLS and CORS. The browser check above exercises a local protocol fixture and the existing local authenticated server. It does not establish acceptance against the author's production server.
