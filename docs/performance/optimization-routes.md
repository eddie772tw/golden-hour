# Antigravity 概念重評與下一階段優化路線

日期：2026-11-17。研究基準 main `f6258e3020a7e3a2b979aaf1f8eb2a3dfbe2aa4e`，core SHA256 `1a3f0d7eb26a97c6516dca88d2696d7774dd096fe2991e1eb22dabd1b208ee34`。三個研究代理分別負責音訊、renderer 狀態／GTAO、骨骼裁剪／提交管線；root 負責交叉審查與成本排序。本輪研究不改遊戲 runtime，沒有新的瀏覽器、GPU 或音訊硬體量測。

## 決策

**Antigravity 的節點重用、渲染狀態重用與可見性剔除概念值得繼續。上一輪的具體實作錯誤不等於這些方向沒有優化價值。** 先把問題縮到能保留聲音、畫面、AI 與生命週期契約的 owner，再做可否證的小實驗；避免以全域快取一次承擔所有未知路徑。

兩條成本預算分開推進：

- **穩態 16.67 ms 預算**：調查每幀 renderer metadata／材質選取、骨骼及幾何提交、各 pass 的有效可見集合。這些可能影響平均 FPS、P95／P99。
- **清理與排程尖峰**：調查音訊 handler 批次析構、GC、主執行緒長任務。它們主要威脅最大幀時間、P99.9、1% low 及長幀頻率；改善尖峰可能不移動 P99 或平均 FPS。

原版瀏覽器目標保留 1080p High、反射最高 30 Hz、完整原生戰術 AI／感知／尋路、死亡／布娃娃、手榴彈、K9 與固定自機輸入。音訊事件到輸出先驗收 20 ms，不能以少建節點或遊戲 FPS 改善代替端點量測。

## 為何不能只押音訊或只押渲染

既有 19,955.816 ms 輕 trace 的 renderer main thread 上，canonical audio deletion 累計 125.392 ms，其中最大一筆 91.338 ms：總量約占視窗 **0.628%**，單峰占該類總量 **72.84%**。這同時支持「值得處理析構尖峰」與「不能用它解釋全部穩態差距」。比例不是可回收時間保證，也不是預測 FPS 增益。

舊 loop diagnostic 的 render CPU 平均約 8.445 ms；另一個較重診斷的 whole-render GPU 稀疏均值約 11.237 ms。這是不同診斷、不同樣本集合，CPU／GPU 會重疊，不可相加。近期玻璃候選完整 ABBA 仍約 55–57 FPS，且兩 arm 範圍重疊，尚未建立可靠平均收益。資料與限制分別見 [loop-cost analysis](loop-cost-1-analysis.md)、[thread/route evidence](browser-post-main.md) 及 [Antigravity review](audio-latency-audit.md)。

## 第一批候選

| 路線 | 本輪新增支持 | 最小下一步 | 不能先宣稱 |
|---|---|---|---|
| **穩態：保守人物姿態邊界與逐 pass 裁剪** | 現有 body 每隊 28,468 頂點、34 骨；可預計算每骨影響頂點的 rest AABB，隨 pose 變換這些盒子，避免每幀掃全部頂點。離線v2以實際角色 update／物理方法與 `getVertexPosition` 檢查26個姿態、740,168個CPU頂點，0個超界。 | 先完成 CPU／理想 shader 與 Float32 邊界契約；在矩陣更新後、render 可見性判斷前，每 rig 產生一份保守邊界。獨立計 main／reflection／shadow 的剔除量與 bounds CPU成本。 | 沒有全場 GPU 像素驗證或性能結果；不能沿用原報告的每幀頂點節省數。 |
| **穩態：玻璃碎片只上傳變動區間** | `_simulate` 只要部分碎片改變，就會標記兩個各115,200 bytes的attributes整份更新；FX另一個pool已有active-prefix更新，不能泛稱所有pool都浪費。 | 先量Ew碎片實際bytes與driver CPU；只累積positions／normals各自dirty範圍，跨catch-up／未upload幀保留，讓Three在真正upload後清除。 | 230,400 bytes×60只是13.824MB/s理論上限，還不是實際歸因或收益；range太碎也會增加API成本。 |
| **穩態：只在 GTAO normal pass 分開幾何種類狀態** | 抽取目前真正 D/o0/y0/h0 的簡化 fixture，plain／skin／instance 共12 draws：共享狀態重建參數12次，per-kind 分開後3次。 | 先量 current main 的 normal-pass churn，再選完整 metadata slots 或真 Material specialization；保留 draw order、canonical invalidation、uniform owner/list、dispose/context 及 RNG。 | 這是 mocked backend 的機制證據，不是真 NormalMaterial shader 或毫秒數；少 getParameters 不等於少 program binds／draw calls。 |
| **長幀：只回收明確不逃逸的 casing leaf-envelope GainNode** | 已證全域 gain 回收仍有 stale writer；current source 重播929歷史 cues，可辨識7,673個 tone/noise envelope gains。保留原生 sources、filters、routing／T.out 可先避開大部分語義改寫。 | 先做有限容量、有 owner／generation／state 的狹窄 pool；驗原生 PCM／排程，再用原生負載比較 cleanup 尖峰與長幀。 | 覆蓋面僅歷史 all-family 配置約6.83%的未扣成本上限，不是 current browser 占比；不預設比先前15.3% node減量卻無FPS優勢的 Worklet 更快。 |

這四條是「值得先驗證」的路線，不是已測得收益的排名。音訊走最小因果 screen；渲染則先用低開銷 owner 計數決定 bounds 或 normal 狀態分離何者先投入。

## 音訊：修正型別仍不足以讓全域 pool 安全

CPU-only 的實際 owner 序列 `slideStart(carpet) → currentTime=end+1ms → v() sweep → slideStop()` 重現：voices 已空，但 `o.slide` 仍持有舊 T，後續仍對已 disconnect 的舊 output gain 取消排程／寫 setTarget。無 pool 時它只改舊節點；若節點已重租，就會誤改新 voice。只在 acquire／release 檢查 generation，攔不住 raw AudioParam 的舊 writer。

因此第一版只涵蓋 casing S0 的 `T.tone/noise` leaf envelope，排除 T.out、music onended、lastShot、slide、menu／lounge／K9 等外部持有路徑。擴大前要逐 owner 證明後續 writer 也受到租用身分控制。Biquad／Delay 的參數重設不等於清掉 DSP 歷史；保留新建 filter/delay 是可行的中間方案。

929 cues 的 current-source 虛擬 factory census：24,374 次 casing 配置，其中7,673個 eligible gains（31.48%）；原生 source、RNG、start/end/gain 描述相符。這不是原生 handler 數量或成本量測。下一步若只少 factory calls，cleanup／GC 尖峰沒有改善訊號，就停止擴大；若只改善尾端，就如實按尾端優化驗收，不報平均60 FPS或20 ms達標。

Chromium 的 [AudioNode ownership](https://raw.githubusercontent.com/chromium/chromium/main/third_party/blink/renderer/modules/webaudio/audio_node.cc) 與 [deferred cleanup](https://raw.githubusercontent.com/chromium/chromium/main/third_party/blink/renderer/modules/webaudio/deferred_task_handler.cc) 也說明 disconnect、wrapper生命週期與 handler retirement 是不同層次。官方 upstream 用於機制核對，不等於當次 Edge binary 的逐版本成本證據。

## 裁剪與 renderer：保留通用契約，限制優化範圍

root交叉審查另發現：當權重和不等於1且bind inverse有平移，r180 CPU helper與理想shader的加權順序存在 `(1-S)*translation` 差異。v2已加入兩種實數語義的union，並以單點toy case驗證；這仍不是Float32 GPU誤差證明。

人物候選需涵蓋正權重／權重和、bind 矩陣、mesh world transform、Float32 GPU palette、布娃娃與 respawn／rig切換。bounds 不可讀被剔除後未更新的舊 boneTexture；必須依目前骨骼矩陣更新。武器附件、第一人稱、K9 與 shader 額外位移是獨立 owner。不可因離開畫面就停掉 AI、感知、尋路、死亡或物理流程。

固定1.45半徑在本輪已測姿態也沒有漏頂點；目前不能說原半徑必然錯誤，同樣不能靠少量姿態證明所有可達狀態安全。動態 envelope 的價值是建立可推導、可測試的保守邊界。主流引擎也有相同取捨：[Unity 官方](https://docs.unity.com/en-us/engine/6000.6/manual/assets-and-media/asset-types/mesh/troubleshooting-skinned-mesh-renderer-visibility) 明列腳本骨骼變形與 ragdoll 可能超出預估 bounds；[Three r180 SkinnedMesh來源](https://raw.githubusercontent.com/mrdoob/three.js/r180/src/objects/SkinnedMesh.js) 指出動畫邊界需隨姿態更新。這些支持概念，不是本 prototype 的速度證明；實作仍以本地 Three r180 bundle 為準。

normal-only state separation 的 metadata 分支要完整保存同時刻快照，不可拼接舊 program 與新 metadata；uniformsList 需和 program／uniforms owner一致，仍執行逐物件與骨骼 upload。真材質 specialization 可借原 D 維持狀態，但新增 UUID／建構可能改 RNG，callback identity／共享 uniform語義亦需守住。兩分支都不能靠刪 guard 提高命中率。

## 後順位路線與暫緩項

- **GTAO 線／點 registry**：概念可成立，但 `childadded/removed` 不向 scene root 冒泡，必須涵蓋 nested add/remove/attach/reparent、detach及品質重建。`traverseVisible` 是更小的對照，但會略過 hidden ancestor；若 normal pass callback 再顯示 ancestor，語義可能不同。先量 current walk 成本，不能以總節點數推導節省毫秒。
- **動態 upload owner census**：既有 render-scope buffer payload 約932.5 MB／33,061 calls，包含少量暫停收尾；simulation scopes沒有GL upload。約15MB/s本身不能證明頻寬瓶頸；先分 FX／glass／instances 的 payload、dirty versions、active count與updateRanges，再考慮只更新變動範圍。Bone／其他 texture upload不在這份buffer計數內。
- **更廣持久 routing 或 Worklet mixer**：只在狹窄screen與handler歸屬支持時擴大。owner隔離已保護parent heartbeat，但子owner仍有約116ms cleanup與110ms source lateness，不能把搬移owner當20ms解法。
- **大範圍迴圈 presentation split**：現有可重複工作的混合階段上限僅25.1ms／60.223s；其中更少才真正可移除。666ms no-render工作大多會搬到另一個render callback，並非消失。先保留已有音訊／HUD呈現解耦，除非新profile推翻這個成本排序。
- **再做相同 shader warmup**：compileAsync／真實pipeline draws／fence與已測候選已有證據；新material/version重選不等於重新編譯shader。只有新trace指出尚未覆蓋的首次compile／upload／layout路徑，才擴充預熱，避免重複已無穩定收益的試驗。

## 下一輪實驗順序

1. 各代理先在隔離候選中完成離線正確性與owner邊界：音訊lease／舊writer／PCM；bounds數值與生命週期；normal state／uniform／context。未知路徑走既有正確流程。
2. 在current main做一輪短、被動、限定active ticks的診斷：normal參數重建／list、bounds及各pass剔除率、原生音訊cleanup／GC時間。逐draw shadow對照只用於診斷，不帶進乾淨FPS輪。
3. 通過者才整合並由root序列執行同一1080p High完整AI場景；每次只改一個因素，保留全部first-use／長幀與八項輸出。幀時間與聲音／像素oracle分開，記cold／entry／完整active window、P95／P99／P99.9、1%low、長幀與process-tree memory。差異落在既有漂移內就不報性能收益。

原生音訊端點／PID／時鐘關聯工作仍留在Godot獨立分支。這份研究不改已知端點證據的歸屬缺口，也不把任何架構概念宣稱為20ms已達標。

## 本機研究產物

詳細報告與可重跑離線probe位於 `D:/Golden-Hour/outputs/optimization-routes/`：`audio.md`、`render-cache.md`、`culling-pipeline.md`，以及相應source hashes與JSON結果。它們是研究證據，不是已合併runtime。產物SHA256、離線檢查摘要及限制見 [machine evidence](evidence/optimization-routes-2026-11-17.json)。原始Antigravity實作備份仍保留於 `outputs/antigravity-review/20261117-072650Z/`。
