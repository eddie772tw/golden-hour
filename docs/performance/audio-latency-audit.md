# Antigravity 音訊與渲染優化實作複查

日期：2026-11-17。目標維持原版瀏覽器 1920×1080、High、反射最高 30 Hz、完整戰術 AI；音訊先驗收 20 ms。本文件區分程式碼變更、正確性檢查與尚未完成的性能驗收。

## 先確認實作，再開始審查

收到時 main HEAD 是 `9d99a3be7d3a26d67012b09512764335679ca5e0`；Antigravity 留下未提交的 `game/core/game.js`，36 行新增、13 行刪除，以及本文件。確實實作了音訊節點池、source `onended`、人物／玻璃裁剪、材質變體快取、反射地面隱藏與 GTAO 可見性快取，並非只有建議。

輸入 core SHA256：`6e03df491757c8b492615ce307470eeb7a49b2dc4abb34bcc4ae5d57d0f9b9bc`。修改前已逐位元備份 core、原始報告、Git diff 與雜湊至：

`D:/Golden-Hour/outputs/antigravity-review/20261117-072650Z/`

`antigravity-original.zip`、`incoming.patch`、`manifest.json` 保留輸入原貌。大型原始量測與備份不放進 Git。

## 審查結果及處理

| 項目 | 程式碼與重現結果 | 處理 |
|---|---|---|
| Gain／Biquad 池 | BiquadFilterNode 同樣有 `.gain` 且沒有 `.playbackRate`，回收函式的第一分支會將它推入 gain 池。下一次配置增益時會取得濾波器。另無重複入池保護，兩個配置可能取得同一節點；濾波器歷史訊號狀態也不能只靠取消 AudioParam 排程重設。 | 撤回這次池化；恢復既有原生配置／釋放流程。沒有宣稱解決 handler 析構。 |
| source onended | 新增 disconnect／buffer=null，但 voice 的 srcs 與共享 PCM cache 仍持有各自參照。未提供堆積快照或 trace 證明可以避免 Old Space 或析構長幀。 | 撤回新增 callback，保留現有 voice 生命週期。 |
| 全域材質 8 槽快取 | 僅還原部分 renderer metadata。實際 D→o0 路徑中，共享材質在 linear 輸出下畫 plain／skin，改為 sRGB 後畫 skin／plain，plain 會錯取舊 linear program。每次 draw 也會新建快取記錄物件。 | 撤回這次快取；原有經測試的 shadow 材質分組保留。 |
| GTAO _ptsLines | 首次走訪後新增 Line2，下一次 normal-buffer pass 不會隱藏它。 | 恢復動態場景走訪。 |
| 人物與 Bot 裁剪 | 固定 1.45 半徑與一般 boundingSphere 存在檢查，沒有涵蓋所有姿態、附件與布娃娃變形的保守邊界證據。此處是證據不足，未宣稱已重現人物消失。 | 撤回這次全面啟用裁剪。 |
| 城市地面從反射隱藏 | 以實際 QM.render 投影檢查，極端向上視角未通過「所有頂點都在斜 near plane 外」的保守條件。這不是完整多邊形裁剪或像素差異證明。 | 撤回隱藏候選，避免將未成立的充分條件當成像素等價。 |
| 窗框內的殘留破裂玻璃 | t.mesh 是固定殘留窗格；落下碎片另在 this.shards。_breakCell 只將被刪格子的三角形歸零，存活三角形不移動。實際 Three.js 包圍球測試覆蓋 x／z 兩方向、遠離原點的窗格與逐格刪除。 | 保留一次性 computeBoundingSphere 與裁剪候選；移除無依據的半徑乘 1.5。動態碎片維持原設定。 |

新增的三條回歸檢查在輸入程式碼上均失敗：錯誤音訊節點類型、GTAO 漏掉新增線段、跨輸出色彩空間取錯 program。撤回對應變更後通過。音訊檢查同時防止重複釋放造成活躍節點別名，並檢查零 dB 濾波器配置。

可執行檢查：

```powershell
npm test
node --test server/node-lifecycle.test.mjs server/shadow-variants.test.mjs server/fractured-pane.test.mjs
```

本輪本機單元測試 **153/153 通過**。這驗證程式邊界，不代表完整場景 FPS、GPU 像素等價或音訊實體輸出已達標。修改前失敗記錄與修改後完整測試輸出保存在 `regression-before.txt`、`tests-after.txt`。

## 更正音訊端點證據

原報告宣稱追溯關閉 PID 歸屬缺口，並將約 99.5 ms 精確拆成六階段。未找到支持這些結論的新原始量測，故撤回這些宣稱：

- 原始 endpoint-default-1/run/endpoint-result.json 的確記錄 99.4948–99.6299 ms、相關係數約 0.999999684，並標示 physicalSpeakerMeasured=false。這是共享模式 loopback 的首個可識別樣本，不能稱為實體揚聲器延遲。
- 舊紀錄的擁有 PID 579072 與音訊 session 活躍 PID 560284 仍需當次父子樹、建立時間、命令列與端點資料關聯。後來新增 Toolhelp32／GetProcessTimes 程式碼能支援新一輪紀錄，不能反向建立舊量測沒有保存的親緣證據。
- 該 fixture 是 48 kHz dry casing。沒有支持 44.1→48 kHz 重取樣、HRTF 或精確 79.99 ms APO 耗時的階段量測。八個聲道不等於八個封包；本輪證據不能推出「所有 WASAPI 共享端點固定 80 ms 下限」。
- 兩個容量上限 256 的陣列不等於 72 個固定 voice slots，也不能阻止仍持續建立的 source／oscillator／delay 等所有原生 handler 析構。

原始端點資料位於 `D:/Golden-Hour/work/godot-native/audio/simultaneous/casing-endpoint/`。原始延遲與 PID 缺口保留，不以推導數字填補未量測環節。

Microsoft 的[低延遲音訊說明](https://learn.microsoft.com/en-us/windows-hardware/drivers/audio/low-latency-audio)將應用程式緩衝、APO、驅動與硬體列為路徑環節，APO 延遲依實作而異。[IAudioClient3 週期查詢](https://learn.microsoft.com/en-us/windows/win32/api/audioclient/nf-audioclient-iaudioclient3-getsharedmodeengineperiod)需要依格式及裝置取得可用週期。

## 下一階段優先順序

1. 驗證固定玻璃裁剪：完整固定 AI 的乾淨成對測試，另做暫停場景 A-B-B-A 像素對照；檢查可見玻璃貢獻，不能將全黑或遮蔽畫面當成功。
2. 音訊先補端點與 PID／時鐘的當次關聯證據，再決定架構修改。既有 latencyHint 與 source Worklet 局部試驗均未建立達標優勢，不重複宣稱微調能達成 20 ms。
3. 若重啟持久 voice／節點設計，先處理精確類型、租用生命週期、非同步結束回呼與舊參照、參數排程及濾波器狀態，再做原生 PCM 對照及完整負載 handler trace。這是未實作方案，不能算成本輪性能改善。
4. 人物裁剪需用真實頂點變形涵蓋姿態、武器與布娃娃，才重新評估；避免再次改動通用 renderer program 選取契約來換取未量測的小幅收益。

Chromium 的[原生清理實作](https://raw.githubusercontent.com/chromium/chromium/main/third_party/blink/renderer/modules/webaudio/deferred_task_handler.cc)將待刪 handler 排程至主執行緒清除。減少 JS 配置或斷線呼叫不直接證明已控制 native 析構批次。既有完整場景證據與限制見 [browser-post-main.md](browser-post-main.md)。

## 完整場景重新量測

以原版 Edge、AMD Radeon RX 9070 XT、1080p High、反射最高 30 Hz，按基準 A1 → 候選 B1 → 候選 B2 → 基準 A2 的順序執行。每輪使用新瀏覽器 context／storage／HTTP cache，保留 OS／driver cache；九名原生 AI 各運行 3,600 ticks，涵蓋尋路、死亡、布娃娃、手榴彈與 K9 分支。

| 輪次 | 平均 FPS | 1% low FPS | P95 ms | P99 ms | 最大 ms | >50 ms 次／分 |
|---|---:|---:|---:|---:|---:|---:|
| 基準 A1 | 55.445 | 20.858 | 24.6 | 31.1 | 180.0 | 6.966 |
| 候選 B1 | 56.870 | 21.915 | 22.9 | 28.1 | 193.4 | 5.969 |
| 候選 B2 | 56.883 | 21.930 | 23.1 | 29.0 | 159.0 | 5.972 |
| 基準 A2 | 56.954 | 22.356 | 23.1 | 29.1 | 142.4 | 6.968 |

四輪八項邏輯輸出皆完全一致，console errors／warnings 均為零。兩個 arm 的 FPS 範圍重疊，每組只有兩輪；尚未建立可靠的持續 FPS 收益。這些是完整 active window 的 render submission intervals，並非實體顯示 present；不能把暖機後補充視窗替代完整視窗驗收。60 FPS 與 1% low >45 FPS 均未達成。音訊端點本輪未重新量測。

B1 與 B2 僅新增註解行的 CRLF／LF 不同；保留兩份實際 source hash，並以正規化後逐位元相等確認沒有邏輯差異。B2 與最終核心檔案 hash 相同。

原始輸入備份、四輪結果、runner 與像素診斷保存在本輪輸出目錄；精簡指標、原始檔 SHA256、來源 hash 與限制見 [antigravity-review-2026-11-17.json](evidence/antigravity-review-2026-11-17.json)。原報告沒有附原始量測的頂點節省量、每幀 CPU 節省量及音訊延遲分解均不採用。


## 暫停場景裁剪像素對照

獨立診斷輪在固定 AI 完整場景結束後暫停，使用原有玻璃 oracle 的相機、曝光備份／還原與 A-B-B-A 流程。兩個 arm 使用同一份單通道玻璃材質；A 關閉殘留窗格裁剪，B 開啟裁剪。場內其他殘留窗格也同時切換，動態碎片不變。

三片仍有存活三角形的玻璃，涵蓋正反兩面與正面／斜角，共 **12/12 視角通過**。每個視角 A/A、B/B 穩定，A/B 全畫面 RGBA 改變通道數為零；隱藏玻璃的額外對照確認 ROI 有可見貢獻，排除全遮蔽畫面的假成功。GL errors 與還原錯誤均為零。

這些固定視角的每次完整渲染，renderer 計數減少 **40–64 次 draw call、7,096–13,276 個 triangles**。數字包含當次強制更新的反射、陰影與其他 pass，不能當作一般遊戲每幀的平均或 GPU 時間。這證明候選在所測視角減少提交且保留像素，沒有證明持續 60 FPS，也不涵蓋所有可能相機位置。診斷輪未納入四輪乾淨 FPS 結果。
