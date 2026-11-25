# 熱點、區網邀請與專用伺服器

Windows x64 的專服 ZIP 可直接執行 `Start-Server.cmd`，玩家另取客戶端 ZIP 執行 `Play.cmd`。從舊版移轉 SQLite、憑證與簽發金鑰的步驟見[隨包說明](../../packaging/windows/README.txt)。

從原始碼啟動時，先在每部要遊玩的電腦安裝 Node.js 22.13 以上，在 repo 根目錄執行一次 `npm ci`。專服首次建立 TLS 憑證需 OpenSSL。Windows 也會尋找 Git for Windows 內附的 OpenSSL；其他位置可設 `GH_OPENSSL`。先備妥依賴，遊玩時可斷開外網。

1. 玩家先連到同一 Wi-Fi、乙太網路或房主建立的手機／電腦熱點。房主查出自己在該網段的 IPv4。以下以 `192.168.50.10` 為例。
2. 房主執行下方的 `host`，並開啟終端機列出的本機網址。把終端機的完整 `gh1://…` 邀請交給其他玩家。
3. 其他玩家在自己的電腦用 `join` 加上完整邀請，也開啟**自己電腦上**顯示的網址。遊戲前端、帳號私鑰和口令均留在本機。請在同一瀏覽器設定檔中使用固定的客戶端埠。
4. 進入「連機對戰」→「本地帳號」，輸入名稱與口令後建立帳號。已有帳號可解鎖，或先輸入口令再「匯入存檔」。房主選「建立房間」，其他人從清單選房或輸入八位房碼。房內「房間邀請」包含主機指紋與房碼，新的加入端以此啟動會預填房碼。
5. 「本地帳號」可改名、設定頭像、查看已簽署的累計戰績及匯出 `.ghsave`。搬移到新電腦時攜帶檔案與口令。已有同 UUID 存檔時先解鎖再匯入，保留每台主機可驗證的最新戰績。不同帳號請使用獨立瀏覽器設定檔。遺失口令時沒有官方重設服務。

Windows PowerShell（從 repo 根目錄執行）

```powershell
.\server\dedicated\start.ps1 host 192.168.50.10
.\server\dedicated\start.ps1 join '完整邀請'
```

Linux 或 macOS

```sh
sh server/dedicated/start.sh host 192.168.50.10
sh server/dedicated/start.sh join '完整邀請'
```

無畫面專服將 `host` 換成 `serve`。各平台也可直接執行 `node server/dedicated/launch.mjs serve 192.168.50.10`。同一熱點上不要開啟用戶端隔離。房碼只在選定主機上查詢，首版以邀請定位主機。

| 設定 | 預設與用途 |
| --- | --- |
| `GH_SERVER_PORT` | TCP 48723，專服 HTTPS 信令與房間清單。 |
| RTC | UDP 49100–49200，開放給可加入的玩家網段。能讀取清單但無法進場時檢查 UDP 與熱點隔離。 |
| `GH_CLIENT_PORT` | TCP 48722，只監聽玩家自己電腦的 loopback。與 `npm start` 使用相同預設埠，擇一執行。 |
| `GH_DATA_DIR` | 預設 `server/.local/dedicated/`。備份整個目錄以保留 TLS 憑證、戰績簽發身分與資料庫。更換 TLS 憑證後重新分發邀請。 |
| `GH_ROUND_SECONDS` | 預設 480，測試可縮短回合。 |

主機驗證玩家持有帳號私鑰，每次進房與重連各用一張新票。SQLite 以 UUID 計分並記錄完成的回合。在擊殺、結算及下次解鎖時，客戶端會向主機補領累計簽章紀錄。存檔保留各主機的紀錄。配對時，客戶端用邀請的 TLS 指紋驗證戰績簽發者，只回傳該服最新一份簽章紀錄。首次到訪的專服收到空清單。專服依自己的資料庫重算武器解鎖及排行榜。此版本更動配對協定，請同時更新客戶端與專服，原有 .ghsave 可以沿用。匯入多份備份取各主機最新的有效紀錄，同服多次補領不會累加。頭像與裝備偏好會隨備份搬移，頭像目前只在本機帳號頁顯示。

可在已安裝 Python Playwright 與 Edge 的電腦執行 `python server/check_lan.py`。設定 `GH_LAN_IP` 可指定區網介面。測試使用獨立臨時資料庫、兩個 loopback 客戶端、實際 RTC 對局與重啟後的匯入驗證。

## 多地圖 TDM

自營大廳的地圖選單列出主機可開設的地圖。預設的程序酒店可直接使用。若要遊玩已匯入的 v60115 地圖，請用玩家端的鎖定雜湊匯入流程裝好本機資產，再依主機的目錄選擇。可從原始碼工作樹執行匯入指令。

```powershell
python scripts/import_maps.py '<本機 v60115 resources.zip>'
```

匯入後重啟專服以重讀目錄，玩家端重新整理大廳。無畫面專服需要同一版的 catalog、manifest、world 與 gameplay JSON。玩家端從自己的本機來源讀取並核對地圖資料，再依 manifest 核對 GLB 的 SHA-256。開房、快速加入及重連以地圖 ID、版本和內容 revision 配對。房碼與邀請仍以既有方式使用，沒有多地圖功能的舊客戶端可繼續加入程序酒店。主機的憑證、戰績資料庫與存檔位置沿用既有設定。

`node --test server/community-maps.test.mjs` 可在沒有外部素材時驗證每房權威行為。已安裝 Playwright 和 Edge 時，可執行 `node server/check_community_maps.mjs shipment/3` 驗證兩個本機客戶端的地圖載入、配對、重連、結算與再戰。可把 `shipment/3` 換成 `hotel/builtin` 驗證程序酒店。
