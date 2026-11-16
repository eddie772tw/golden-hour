# 原版連線證據與 AimArena 技術對照

查核日期為 2026-11-16。Golden Hour 封存檔與 AimArena 公開提交各自提供不同層次的證據。

| 問題 | Golden Hour 可驗證的行為 | AimArena-public 可核對的設計 |
| --- | --- | --- |
| 誰主持對局 | 封存客戶端向服務取得設定、訂閱房間和送出加入命令，等待服務回覆席位及狀態。本機版由 Node 管理所有房間、判定與計分。房主是遊戲內角色，建立房間的瀏覽器沒有轉送其他玩家封包的職責。 | Node 權威服務、Three.js 客戶端及確定性模擬。網路接入與房間生命週期分開。[README](https://github.com/LankiYang/AimArena-public/blob/e94200b2aef218c0b28f2210188e043b99eb9adf/README.md) |
| 怎麼送資料 | 封存客戶端含 WebTransport 與 WebRTC、JSON 控制事件和二進位輸入／快照。本機版以 HTTP 交換 SDP，建立瀏覽器到 Node 的 WebRTC；可靠通道送控制事件，狀態通道送輸入、快照。 | WebSocket 與 WebTransport 經由同一個 `attachGameClient` 接入大廳，握手與席位恢復共用。兩者協定欄位與傳輸組合不同。[接入層](https://github.com/LankiYang/AimArena-public/blob/e94200b2aef218c0b28f2210188e043b99eb9adf/game/server/net.ts) · [二進位協定](https://github.com/LankiYang/AimArena-public/blob/e94200b2aef218c0b28f2210188e043b99eb9adf/game/shared/protocol.ts) |
| 如何處理延遲及輸入暴增 | 本機服務依伺服器時間推進、依輸入序號丟棄舊資料。狀態通道壅塞時可略過快照。斷線保留席位 10 秒。 | 每人有輸入 FIFO 和伺服器時間預算，序號跳躍不能增加可執行時間；射擊回溯限制在當前至先前六個 tick。這兩個機制可各自做回放實驗。[輸入預算](https://github.com/LankiYang/AimArena-public/blob/e94200b2aef218c0b28f2210188e043b99eb9adf/game/server/player-input.ts) · [命中與回溯](https://github.com/LankiYang/AimArena-public/blob/e94200b2aef218c0b28f2210188e043b99eb9adf/game/server/combat.ts) |
| 房間增加時怎麼排程 | 本機版在一個迴圈內推進所有房間，限制累積補算量。每位收件者的可見快照各別產生。 | 房間之間利用 `setImmediate` 讓出 I/O 時間，也有可選的 worker 執行路徑。先量多房間的 tick 延遲及封包排隊，再評估是否需要隔離。[房間排程](https://github.com/LankiYang/AimArena-public/blob/e94200b2aef218c0b28f2210188e043b99eb9adf/game/server/room-pump.ts) · [worker 選項](https://github.com/LankiYang/AimArena-public/blob/e94200b2aef218c0b28f2210188e043b99eb9adf/game/server/room-execution.ts) |

封存客戶端的直接證據位於 [api-config.js](../game/client/api-config.js)、[lobby.js](../game/client/lobby.js)、[net.js](../game/client/net.js) 與 [webrtc.js](../game/client/webrtc.js)。它們支持「有中心服務的對戰協定」這項判斷。ICE 用於建立通道；僅憑客戶端無法還原正式環境是否設有 TURN、實際中繼比例、服務主機數量或後端語言。本機設定使用空 ICE 伺服器清單，測試範圍為同機不同瀏覽器設定檔。[本機服務](../server/server.mjs)

AimArena 的公開除錯版是同作者可執行的 5v5 參考專案。其依賴列出 Three.js、recast-navigation、three-mesh-bvh、esbuild 與 ws。Golden Hour 核心內可辨識 Three.js r180；AimArena 的套件版本與其他依賴僅適用於該快照。另一個多人作品 2d-dongsen 使用 PixiJS、ws 和獨立 Node 服務，顯示同一作者也會依遊戲選用不同的渲染技術。這些 repo 的公開資料沒有提供 Golden Hour 原服的提交血緣或程式碼對應。本次僅以連結與技術分析引用。[AimArena 依賴](https://github.com/LankiYang/AimArena-public/blob/e94200b2aef218c0b28f2210188e043b99eb9adf/package.json) · [2d-dongsen 依賴](https://github.com/LankiYang/2d-dongsen/blob/cf86bbf233df4b223462d33d26386914abda5eab/package.json)
