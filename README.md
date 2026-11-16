# Golden Hour 社群分支

[English (US)](README.en-US.md)

在瀏覽器中進入暮色酒店，進行 5 對 5 團隊死鬥或單人訓練。本分支從可執行的 Golden Hour 網頁版本恢復客戶端，另行實作本機對戰服務。歷史上游為 [LankiYang/golden-hour](https://github.com/LankiYang/golden-hour)。2026-11-16 查核時，GitHub 的公開 API 回傳 404，私人化或移除皆有可能。本分支從獨立的 Git 歷史開始。

## 開始遊玩

Windows x64 玩家解壓客戶端 ZIP，執行 `Play.cmd` 選單人、區網開房或貼邀請加入。無畫面專服另行解壓 Dedicated Server ZIP，執行 `Start-Server.cmd`。兩份均內附執行環境。詳見[可攜版打包、升級與驗證](docs/client-distribution.md)。

從原始碼啟動時，先安裝 Node.js 22.13 以上及支援 WebGL 2、WebRTC 的瀏覽器。在專案根目錄執行以下指令，Windows 也可直接執行 `Start.cmd`。

```sh
npm ci
npm start
```

開啟 [本機遊戲](http://127.0.0.1:48722/)。選「單人訓練」即可與九名電腦玩家對戰。「連線對戰」可建立房間，另開一個獨立瀏覽器設定檔即可代表第二位玩家加入。兩個分頁若共用設定檔，也會共用競技身分。遊戲選單右下角可切換簡體中文、美式英文、台灣繁體中文、標準日語與京都日語，選擇會儲存在該瀏覽器。

## 在熱點或區網對戰

在每台電腦先安裝依賴。房主在 PowerShell 執行 `.\server\dedicated\start.ps1 host 192.168.50.10`（換成自己的區網位址）；另一台電腦以 `join` 加完整邀請啟動。兩位玩家各自開啟本機網址，進入「連機對戰 → 本地帳號」建立或解鎖帳號。遊戲可在沒有外網時完成配對、裁定與戰績保存。Linux、無畫面專服、防火牆及存檔搬移步驟見[專服與區網操作說明](server/dedicated/README.md)。

## 對戰與武器進度

本機 Node 伺服器管理房間，經由 WebRTC DataChannel 接收輸入，以 60 Hz 模擬、30 Hz 送出逐玩家快照。預設只監聽 IPv4 loopback。原版客戶端另有 WebTransport 路徑。此版透過本機加密帳號驗證身分。公網 NAT 穿透與 TURN 尚待驗證。[原版與同作者遊戲的技術對照](docs/network-research.md)

使用 KR-7 累計 10 次伺服器確認的對人擊殺解鎖 VESPER；再以 VESPER 取得 10 次對人擊殺解鎖 M12。排行榜與解鎖共同讀取 SQLite 的擊殺紀錄。訓練、電腦對手和匯入的個人進度均不計入。重新連線或重送同一擊殺事件只計一次。帳號以 UUID 與持鑰簽章識別。玩家可以匯出加密的 .ghsave，在另一個瀏覽器設定檔或電腦以口令匯入；本服的戰績由 SQLite 與簽章紀錄保留。

## Mind the Shop 武器

開啟「槍匠」，選擇手槍、衝鋒槍或霰彈槍分頁，再用「槍械型號」切換。型號會儲存在目前的瀏覽器。下表列出未裝配件時的數值，傷害以每顆彈丸計算。

| 型號 | 彈匣 | 每分鐘發數 | 近距離傷害 | 選用理由 |
| --- | ---: | ---: | ---: | --- |
| G-Bull | 20 | 273 | 1 × 34 | 相較 STRIX 9 多五發，連續射擊較慢。 |
| Chin-Gi | 30 | 667 | 1 × 20 | 相較 VESPER 後座力小，較遠距離仍能保留單發傷害。 |
| Lin-Bei | 6 | 71 | 6 × 12 | 彈群較集中。命中滿血目標軀幹需要兩發，M12 九顆全中可一發擊倒。 |

三把槍搭配 Golden Hour 原有的手套、手臂與操作動畫。槍身使用 Mind the Shop 的第一人稱模型，其他玩家看見低多邊形版本。Chin-Gi 與 Lin-Bei 跟隨各自類別的解鎖門檻；伺服器分開記錄型號，只有 VESPER 的對人擊殺會推進 M12 門檻。線上彈道逐顆計算遮蔽物、命中與距離衰減，每次擊發只扣一發。

## 開發與驗證

- `game/core/game.js` 是從發行版展開的可編輯遊戲核心。`game/client/` 包含啟動、輸入、大廳與對戰客戶端。`game/i18n/` 存放語言資源。
- `server/` 包含重建的房間模擬、逐玩家可見性、戰績與對戰測試。`GH_DEV_PORT` 控制監聽埠，`GH_CAREER_DB` 指定 SQLite 路徑，預設為 `server/.local/career.sqlite`。測試可設為 `:memory:`。`GH_ROUND_SECONDS` 可設為 1–3600，預設 480。
- `npm test` 驗證協定、門檻、記分、遮蔽與語系契約。先以預設回合長度啟動空白測試服務，再安裝 Python Playwright（`python -m pip install playwright`）並執行 `python server/check_browser.py` 和 `python server/check_languages.py`。預設使用 Edge，可用 `GH_BROWSER` 指定 Chromium 執行檔。
- 使用 `?toy=alice` 測試本機模擬的 Toy 身分或雲端存檔。工具 `python server/extract_world.py` 可從執行中的客戶端重新取樣地圖與武器資料。
- 三個開發方向及驗收條件見[路線圖](docs/roadmap.md)。相關技術依據見[反作弊研究](docs/anti-cheat.md)與[新增語言指南](docs/localization.md)。

另可執行 `python server/check_weapon_models.py`，以已解鎖武器的訓練測試身分驗證三款槍身、雙手、瞄準、射擊與裝填。設定 `GH_WEAPON_CAPTURES` 為現有資料夾即可儲存各動作畫面。

## 開發者與來源

開發者 **蒙哥汗马利@LankiYang**。原版素材、核心程式及相依套件的來源與授權狀態見[來源說明](docs/provenance.md)。上游完整授權及遊戲素材的公開再散布權仍待確認。
