# 來源、署名與第三方授權

歷史上游路徑為 [LankiYang/golden-hour](https://github.com/LankiYang/golden-hour)。2026-11-17 重新以未登入的 GitHub API 查詢仍回傳 404；這只能確認公開 API 無法取得，不能判定私人化或刪除。維護者提供的開發者署名為 **蒙哥汗马利@LankiYang**。這份獨立社群分支保存可編輯的網頁交付版本，以及重新開發的本機服務。原始碼的開發歷史、完整原始工具鏈與正式後端尚未取得。

維護者已確認取得原作者對 fork 與繼續開發的同意。README 所附對話圖片已隨 [2026-11-17 原站封存](upstream/2026-11-17/README.md) 保存於資源包的 `reference/fork-permission.png`，含原始連結與 SHA-256。這項同意與尚待確定的正式開源授權分別記錄；本分支沒有代原作者選定授權條款。

## 發行版資源

[來源清單](sources.json) 的每列對應一個已封存的公開資源。`upstreamSha256` 與 `upstreamBytes` 是取得時的位元組指紋；`candidatePath` 與 `candidateSha256` 指向本次整理的快照。標為 `unchanged` 的資源可逐位元組比對，`adapted` 表示已修改，`replaced` 表示以本地重建檔承接功能。曾用於定位遊戲的外層頁面標為 `omitted`。日後開發可用 `git log -- <path>` 追蹤變更。

2026-11-17 原站恢復可取得後，已重新下載上述 42 個資源，全部與既有 `upstreamSha256` 相同；另存平台 PWA 檔、公開 GitHub 回應及授權對話圖片。新的 [manifest](upstream/2026-11-17/manifest.json) 與 [原件 ZIP](upstream/2026-11-17/resources.zip) 是獨立的取得紀錄，既有來源清單仍保留歷史快照意義。

- 場景核心 `game/core/game.js` 來自展開的瀏覽器交付檔，保留原有執行邏輯和大型函式庫。部分符號仍為縮短名稱。啟動頁來自遊戲入口，移除了平台外殼與遠端設定。
- `game/assets/` 與 `game/icon.png` 保留取得版本。核心中的圖形庫與遊戲模型、圖示、文字及其他遊戲內容分別看待。fork 與開發已有原作者同意，原專案及上述素材的正式開源授權文件仍待取得。
- 客戶端整合了本機房間、競技武器授權、排行榜與逐收件者快照；`game/client/competitive-engine.js` 是本地可見性適配，`toy-fixture.js` 提供測試替身。SQLite 資料庫、玩家身分、實際雲檔與本機依賴不在候選內容內。
- `server/` 是依照客戶端協定重建的伺服器、測試與資料擷取工具。`world.json` 取樣自執行中的封存客戶端，含地圖碰撞、門窗、導航點與武器數值。多語系框架、文件與發布整理也由本分支加入。AimArena 僅作技術對照，程式碼與素材均未匯入。

## Mind the Shop 槍身

`game/assets/shop-weapons/` 的六個 GLB 首次匯入時從 Mind the Shop 的提交 `3b589b84231d7445ee9968be399b493cfda18c9f` 逐位元組取得。對應來源目錄為 `assets/models/`，來源檔名前綴依序為 `g_bull`、`chin_gi`、`lin_bei`，本分支改為 `gbull`、`chingi`、`linbei`。每對檔案都包含第一人稱槍身與 `_world_lod` 第三人稱槍身。貼圖內嵌在 GLB。來源清單中的 SHA-256 記錄最初封存的候選版本，可用來辨認歷史素材。

`game/client/shop-weapon-art.js` 將槍身、握點、瞄線、槍口與拋殼口接入 Golden Hour 的手臂。槍身採靜態網格，手部沿用原本武器類別的動畫。原廠造型與材質來自 Mind the Shop。在此提交的來源中可比對 `docs/open-demo/WEAPON_SLICE.md` 及 `assets/sources/open_demo_weapons/` 的模型清單。射速、容量、每發彈數和近距離傷害以來源為基礎；遠距離衰減、散布與後座力由本分支依酒店地圖調整。來源來自私人 repo，公開發布時的素材授權範圍仍待確認。

G-Bull 保留匯入時的兩個 GLB。Chin-Gi 與 Lin-Bei 在第一人稱及世界模型均換裝本分支製作的機械瞄具，原始檔可由上列 Mind the Shop 來源提交取得。新瞄具位於獨立的 `ChinGi_OpenIrons` 與 `LinBei_RaisedBead` 網格。修改準星時可在建模工具內同時檢查 `AimVisualSocket` 與 `FrontSightVisualSocket`：兩點在 X、Y 軸重合，前準星位於負 Z 方向。槍身高度由這條瞄線決定，眼睛至後瞄點的距離保存在客戶端的 `shop-weapon-art.js`。

原廠機械瞄具的靜止 ADS 以 960 × 600、相同視角量測。畫面正中央 192 × 120 像素內，槍身與手部的合計遮擋率，Chin-Gi 由 27.6% 降至 14.7%，Lin-Bei 由 32.1% 降至 15.9%。安裝光學瞄具時收起這兩組機械瞄具。`server/check_weapon_models.py` 會檢查前後瞄點的對齊、光學瞄具的切換與中央遮擋。

## 第三方聲明

- 展開的核心可辨識 Three.js r180。其 MIT 授權全文隨附於 [licenses/three-r180.txt](licenses/three-r180.txt)。[上游授權](https://github.com/mrdoob/three.js/blob/r180/LICENSE)
- 本分支另修改了 bundled renderer 的陰影快取、預熱與 context-loss 資源世代管理；這些是本地修改，並非原版 Three.js 行為。[修改與驗證紀錄](performance/browser-feedback.md)
- 本機服務相依於 `node-datachannel` 0.33.6，依 [package-lock.json](../package-lock.json) 下載對應平台的套件。套件列示 MPL 2.0；原生二進位與套件內其他相依授權由安裝套件提供。[node-datachannel](https://github.com/murat-dogan/node-datachannel)
- 本次彙整沒有替 Golden Hour 遊戲內容新增一份涵蓋全專案的授權。其他 LankiYang 專案的授權只對應各該專案。
