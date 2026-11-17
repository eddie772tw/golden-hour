# 原服延遲與重新握手追查

2026-11-17（Asia/Taipei）在相同 Windows 主機，使用 localhost 客戶端與 `https://cod.apikeygame.top:8008` 的匿名實際對戰。原服後端原始碼與內部指標仍不可取得。

## 確認的觸發點

- 重新下載線上的原版 `client/net.js`、`webrtc.js` 與 `api-config.js`，依 HTTP `Content-Encoding: gzip` 解壓後，SHA-256 與本 repo 封存檔完全相符。原版同樣以 5 秒快照 watchdog 決定是否重連；RTC 的兩個通道與本分支協商參數相同。
- 修正前完整遊戲的 45 秒觀察中，建立了 5 條 RTC，4 次中斷都由快照 watchdog 主動觸發，快照年齡為 5.0–5.9 秒。觸發前 ICE 還在 connected，沒有對應的 ICE disconnected／failed。
- 只載入未修改行為的原版 net／webrtc 模組、沿用 localhost 固定訊令閘道的無 3D 對照，也重現 2 次 watchdog 重連。這不是原版平台／Toy 登入驗收，但排除了必須由本分支渲染才會觸發的假設。
- 對照的 ICE candidate 往返為 64–86 ms，應用 ping 可達 3.3 秒；快照與可靠事件會間歇性一起停止送達。HTTP config／SDP 已成功，遊戲 DataChannel 不經本機 HTTP 閘道。因此不能將這段遊戲內停頓歸因於閘道轉送延遲，也不能把應用 ping 當作純粹的網路傳播時間。

能確認的範圍是 RTC 資料通道的傳送／處理發生停頓，接著原版繼承的 watchdog 銷毀連線，額外增加 SDP／DTLS 握手及暫停操作。僅有客戶端觀察，尚不能區分原服排程、SCTP 實作及實際路徑丟包各自的貢獻。Pion 有與零重傳通道相關的 [FORWARD-TSN／SACK 問題報告](https://github.com/pion/sctp/issues/505)，只能作為相關假設，不能證明原服使用該版本或就是本次原因。修改封包存活時間／重傳次數的試驗未取得有效改善，正式版本保留原版協商參數。

## 修正

1. 超過既有 5 秒快照期限時，若 RTC 仍 connected，先發出一次 ping 探測，給既有寫入期限（預設 5 秒）的恢復窗口。這個窗口不因收到 pong 而延長；必須收到有效且更新的權威快照才能解除停頓。
2. 等待時顯示提示、送出中性輸入，停用移動、射擊及近戰。新快照回來後恢復操作，保留原有游標鎖定，不為短暫停頓強制打開暫停選單。
3. 探測逾時、通道真的關閉或 ICE 既有中斷處理觸發時，仍走席位續接。WebTransport 的原有逾時路徑保留。原服身分、武器回退、TLS 驗證與固定訊令轉送規則保持相同。
4. 原版在每次 welcome 後立即把重試計數歸零，造成「短暫加入 → 再次停頓」可反覆回到最短重試間隔。現在必須持續一個快照期限收到健康狀態後才清除退避；使用者主動重新加入會開始新的重試計數。
5. `GH.debug.network` 增加成功連線／中斷次數、最後中斷原因、快照停頓／原連線恢復次數與最長快照年齡。RTC 保留第一個關閉原因，區分快照逾時、資料通道錯誤、ICE 中斷及寫入失敗；不保存 SDP、候選 IP、席位憑證或帳號資料。

## 驗證

`server/connection-health.test.mjs` 驗證延遲後原連線恢復、單次探測、pong 不延長死快照期限、持續斷流時只觸發一次續接、未連通／WebTransport 路徑、退避重設時機、中性輸入及第一個 RTC 關閉原因。完整 Node 測試共 176 項通過。本機 Edge 相容性檢查亦涵蓋同席位續接、移動 ACK、射擊／換彈、三把 Shop 武器回退，以及回到本地帳號的流程。

修正後的兩段真實原服觀察結果：

| 情境 | 觀察 | 結果 |
| --- | --- | --- |
| 無 3D 協定客戶端 | 40 秒，316 快照 | 3 次停頓均在原連線恢復；最長 7.184 秒，1 次成功握手、0 次重連 |
| 完整遊戲與畫面 | 60 秒，922 快照、ACK 3684 | 1 次在原連線恢復；另有 2 次較長停頓超過期限而正常續接；最後收到新快照並離房 |

這些是不同時間的公網觀察，不是固定丟包率下的效能 A/B，不能據此宣稱延遲降低百分比或全面消除重連。兩次額外完整遊戲嘗試在首次 welcome 前逾時，當時 config 與 SDP 回覆均為 200；也保留在證據中，未當作驗收通過。

另一次嚴格 60 秒完整遊戲檢查完成加入、移動 ACK 與原版副武器驗證，收到 592 個快照；但結尾 25 秒內未取得新的快照，腳本正確回報失敗並離房。共三次嚴格檢查失敗均保留，不能以另一輪短時間恢復成功取代這個限制。[去識別數值與來源雜湊](original-network-2026-11-17.json)

可重跑 `GH_ORIGINAL_LIVE=1` 的 `server/check_original_live.py`，預設觀察 60 秒，最後要求新的權威狀態並離房。`noReconnects` 和 `freshStateAtEnd` 分別表示是否沒有重連、是否仍有新狀態，兩者不可互相替代。這次修正降低了可恢復停頓造成的額外握手；原服的首次握手失敗與長時間資料停頓仍是限制。

## English

The live upstream files still match the archived distribution. Its five-second snapshot watchdog also reproduces the disconnects with unmodified upstream connection modules, without this fork's renderer. ICE remained connected with roughly 64–86 ms candidate RTT while application pings and both data lanes stalled. This localizes the symptom to RTC data delivery/processing, but does not establish a specific server library defect or network loss cause.

The client now probes a still-connected RTC once and allows one bounded recovery window. Only fresh authoritative state clears it; a pong cannot keep a dead state lane alive indefinitely. Movement and combat are suspended during the stall. Sustained snapshots, rather than a welcome alone, reset retry backoff. Diagnostics record counts and close reasons without credentials or SDP. The original channel negotiation and account/security boundaries are preserved.

Real-server checks demonstrated three recoveries without another handshake in a 40-second protocol run. A 60-second full-game run received 922 snapshots and ended with fresh state, but still needed two reconnects after longer stalls. Two additional initial joins timed out despite successful HTTP config/SDP. The change mitigates avoidable handshake churn; it does not eliminate the remaining upstream latency or guarantee stable initial admission.

A stricter 60-second game check joined, acknowledged movement and received 592 snapshots, but failed its final fresh-state requirement and left normally. All three strict failures are retained in the [sanitized evidence](original-network-2026-11-17.json); they are not reported as passing acceptance.
