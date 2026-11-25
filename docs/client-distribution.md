# Windows x64 可攜版

客戶端與無畫面專服各有獨立的 ZIP。玩家操作、舊版房主資料搬移及預設路徑見[隨包說明](../packaging/windows/README.txt)。兩個可攜版共用同一個專服資料位置，升級時解壓到新目錄即可。建議用原本的瀏覽器與設定檔開啟本機網址。

## 從 Git 提交建置與測試

在 Windows x64 建置機安裝 Git、Python 3.11 以上及 7-Zip。從 repo 根目錄執行以下指令。第一行就能產生可交付的兩個 ZIP 和 `SHA256SUMS.txt`。後兩行使用本機 Edge 進行解壓驗證。

```powershell
python packaging/build_windows.py --output dist
python -m pip install playwright
python packaging/check_windows.py dist
```

打包來源固定為 `HEAD` 的 Git 快照。修改遊戲後先提交再重建。腳本校驗固定版 Node 與 PortableGit 的 SHA-256，從後者只取 OpenSSL 執行檔、DLL 和授權。npm 模組從 lockfile 指定的來源取得並驗證完整性；建置機與玩家電腦均不需執行 npm 安裝。以 `--cache 目錄` 指定下載快取，所有輸入已備妥時可離線重建。版本及來源提交在 ZIP 的 `VERSION.txt`。

需要在本機 Windows 套件加入 v60115 的地圖及武器素材時，可將已取得的原版封存檔傳給同一個打包器。它會從指定的 Git 提交解出匯入工具，驗證封存與素材，再將匯入結果放入 ZIP。專服只帶地圖資料。選項為手動提供，常規 CI 打包走既有路徑。

```powershell
python packaging/build_windows.py --output dist --upstream-archive <resources.zip>
python packaging/check_windows.py dist
```


要驗證從原始碼版升級，執行 `python packaging/check_windows.py dist --previous 舊版專案路徑`，舊版需已安裝其 Node 相依。測試先在舊版完成一局、停服並搬移臨時 SQLite 和身分金鑰，接著用可攜版在原瀏覽器來源解鎖。另用空白設定檔驗證加密備份匯入。可用 `GH_LAN_IP` 指定實際區網 IPv4。

GitHub Actions 在 [Windows x64 portable release](../.github/workflows/windows-release.yml) 的 `release.published` 事件建置並測試兩包，成功後將兩個 ZIP 與校驗檔附到該 Release。手動執行 `workflow_dispatch` 只產生 Actions artifact；不會建立或發布 Release。若啟用 immutable releases，附件需在草稿階段先透過手動建置產生並附上，發布後 GitHub 會鎖定附件。

## 原始發行評估

建議首版提供 **Windows x64 可攜 ZIP**。玩家取得一份完整檔案後即可用 USB 或區網交給其他玩家。解壓後從啟動器選「單人訓練」、「開房」或「貼上邀請加入」，啟動器再開啟系統瀏覽器的固定本機網址。GitHub Releases 可將這份成品附在對應版本標籤下，下載頁應直接連到玩家包。GitHub 自動產生的原始碼 ZIP 仍需要安裝 Node.js 與相依套件。[GitHub Releases 說明](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases)

## 現有程式能支援的發行方式

| 方式 | 玩家首次遊玩的條件 | 適用情境 |
| --- | --- | --- |
| 可攜 ZIP ＋系統瀏覽器 | 包內備齊遊戲、Node、平台原生模組和開房用的 OpenSSL。系統需已有支援 WebGL 2 與 WebRTC 的瀏覽器。 | 單人、熱點開房、加入專服可共用一包，也方便離線活動分發。 |
| 靜態網站或 PWA | 首次仍須有可達的資源站，或由區網另設站點。現有配對流程還需要本機啟動器驗證專服指紋並轉送 API。 | 可提供下載入口或單人試玩。若要取代多人客戶端，需另設計首次載入、可信任前端及專服連線流程。 |
| 內嵌瀏覽器的桌面程式 | 分別封裝、更新各平台的桌面執行環境，並測試 WebGL、WebRTC、滑鼠鎖定與存檔搬移。 | 日後需要固定瀏覽器版本或原生整合時再評估。 |

## Windows x64 可行性驗證

在含空格的新目錄打包並啟動現有程式。樣包使用 Node 24.13.0、鎖定的 node-datachannel 0.33.6 及其 Windows x64 原生模組，另帶 OpenSSL、所需 DLL 與設定檔。啟動程序的 PATH 只留下包內 runtime 和 Windows System32，首次啟動成功產生主機金鑰、憑證與 SQLite，並經本機入口讀取首頁及透過 HTTPS 連到專服。暫存 ZIP 約 **46.1 MiB**，代表本次相依組合的量級。正式版大小還會受版本、授權文件及啟動介面影響。

## 發行前的工作

1. 建立可重跑的 Windows x64 打包流程，從乾淨版本及鎖定依賴取檔。附上版本、SHA-256、原生元件及其授權文件。包內只放程式和素材，每台房主第一次開房時自行產生金鑰。
2. 玩家入口以相對路徑啟動隨包工具，沿用 `127.0.0.1:48722` 及原來的瀏覽器設定檔，讓升級後仍可讀到 IndexedDB 帳號。將專服資料目錄放在版本目錄外。舊房主搬移整個資料目錄以保留 TLS 憑證、戰績簽發金鑰及 SQLite。跨裝置玩家用 `.ghsave` 搬移帳號。
3. 在兩台沒有 Node、npm 或 Git 的 Windows 電腦，以 USB 傳包，拔除熱點的 WAN 上行。驗收首次解壓、開房與加入、實際擊殺與結算、更新客戶端後解鎖原帳號，以及專服重啟後的排名。此次樣包測試使用已有瀏覽器的開發機。
4. 公開上傳完整玩家包前，依來源清單確認 Golden Hour 與 Mind the Shop 模型的再散布範圍。現有紀錄列有待確認的遊戲與素材授權。確認可發行的版本後，再把玩家包與校驗檔附到 Release。[素材來源與授權狀態](provenance.md)
