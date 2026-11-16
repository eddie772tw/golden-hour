# 射擊遊戲的反作弊與伺服器可見性

公開資料查核日期為 2026-11-16。以下整理廠商公開的行為、效果，以及本分支可驗證的對應點。

## Call of Duty

RICOCHET 官方將 Server Culling 描述為逐玩家決定應該傳送哪些遊戲資訊。隱藏的資料從未傳到裝置，直接讀取客戶端資料的透視工具便無從取得這部分狀態。官方頁面沒有列出敵人包圍盒、幾何判定的取樣點或提前顯示的時間。2023 年的報告另記錄 Cloaking 等針對被判定作弊者的局內處置。兩者適用對象不同，無法由 Cloaking 的效果推導一般玩家的快照格式。[RICOCHET 官方說明](https://www.callofduty.com/ricochet) · [Season 04 進度報告，2023 年 6 月](https://www.callofduty.com/blog/2023/06/call-of-duty-ricochet-anti-cheat-season-04-update)

## VALORANT

Riot 工程團隊描述了 Fog of War 的開發過程。只向角色中心打射線會漏掉牆角露出的部分；多射線測試又占用伺服器時間。團隊改用預先計算的潛在可見集合（PVS），將地圖分格，只要兩格之間有一部分可能互見，就保留資料。重新可見時，也要恢復角色已進行中的動作，並考慮網路傳輸需要時間。這解釋了為何應測試「正常玩家何時第一次看見敵人」，而不只是測試「牆後封包少了多少位元組」。[Riot 工程文章，2020-04-14](https://www.riotgames.com/en/news/demolishing-wallhacks-valorants-fog-war)

## Rainbow Six Siege

Ubisoft 公開資料描述三種用途。Gameplay Violations 從遊戲行為找出違反規則的事件；MouseTrap 針對主機平台偽裝輸入裝置，團隊同時關注誤判；QB 透過向玩家分發不同執行檔來增加竄改成本。官方也報告資料分析與 BattlEye 的處置數量。封禁數沒有提供全體作弊者的分母，不能換算成偵測率。瀏覽器版能借鏡的是以伺服器資料驗證動作，以及在處置前量測誤判。瀏覽器沒有原生執行檔分派或主機手把認證的同等條件。[Y9S4 Player Protection](https://www.ubisoft.com/en-gb/game/rainbow-six/siege/news-updates/23HvPOVDBapE7jokNWIa1E/player-protection---y9s4-update) · [Player Protection，2024-10-25](https://www.ubisoft.com/en-us/game/rainbow-six/siege/news-updates/7EowDNiZbP0grYCmMgBCjW)

## 本分支的邊界與實驗

- **快照與旁路。** 現有可見性判定把對手及武器的範圍投影到地圖實牆。單一牆面完整遮擋時，該收件者的快照省略角色，射擊事件也省略槍口座標。客戶端清除模型、場上角色和插值歷史，記分板保留公開的人名與比分。家具、樓板、動態及多牆組合仍有覆蓋缺口。牆後精確槍聲也會省略。下一步可用雙視角回放記錄轉角、門窗、蹲姿、重生時的首次顯示時間及各通道洩漏欄位。
- **戰績與授權。** 伺服器依致死命中時的實際武器記錄擊殺，以房間、回合與擊殺序號去重。雙方必須是不同身分、敵對、連線中的真人席位。門檻與排行榜讀取同一組事件，客戶端上傳的總分或舊雲檔無法解鎖武器。兩人合作互刷或一人控制多個設定檔仍可產生形式有效的擊殺。可先對固定對手比例、短時間重複死亡與正常小型房間做對照，保留人工複查樣本。單一指標不足以決定封禁。
- **驗收方式。** 以一名觀察者與同場另一名接收者比較實際封包，再比較兩端顯示。模擬掉包、快速橫移與重連，量測錯誤隱藏、錯誤顯示、收到資料到模型出現的延遲。資料來源、實際已驗證的測項與待做實驗分別見[對戰測試](../server/test.mjs)、[雙客戶端測試](../server/check_browser.py)與[路線圖](roadmap.md)。
