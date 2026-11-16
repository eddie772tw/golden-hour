# Electron／Tauri 再評估：是否更容易接近性能驗收

**後續實測已完成：** [Stage9桌面宿主screen](browser-render-60hz.md#desktop-host-screen)及
[機器證據](evidence/stage9-desktop-screen.json)使用目前b3b產品core跑完Edge→Electron→Tauri→Edge，
四個有效run皆保留完整native AI與8項exact輸出。Edge前後47.36→51.77FPS／low13.03→16.99有漂移；
Electron51.76／low21.37僅單輪尾部較好，Tauri53.61／low16.93與末Edge尾部相近。
沒有宿主達成穩定60FPS或完整1%low>45，**不支持正式遷移或勝出判定**。
這次未量完整程序樹記憶體、整合發行包冷啟動或新包大小；原型保留獨立Node，不能視為最終最低負擔。
以下研究記錄保留screen前的推論與試驗規劃，不能把其中「尚未執行」讀成後續screen的現況。

研究日期：**2026-11-17，Asia/Taipei**。本次只讀既有原型、最新實機證據及官方文件，沒有修改 main、正式遷移、啟動 GPU 或另跑桌面性能測試。官方文件描述能力／ownership；性能結論仍須同工作負載實測。

## 決策先行

**值得保留一次低成本的三宿主版本差異 screen；目前不值得先正式遷移。** 單純包裝不會自動移走 WebAudio graph lifecycle 或 Three 的 CPU submission；但同屬 Chromium 也不能推論延遲相同，版本、分支、GC、ANGLE、程序配置確實可能影響本案。Electron／Tauri 的價值應由新 runtime 的完整工作負載與 trace 決定，不能沿用 e3f040c 舊 FPS 排名。

最直接的新宿主能力之一是受控 renderer GC；它已有官方實作路徑，但 root 的 Edge 實測已否證目前每120ticks策略：峰值變小，完整尾部表現反而惡化，因此不產品化、不接著掃頻率。另一條是獨立 audio owner；現有 cross-site host probe 已證明可以保護 parent responsiveness，同時也證明200ms child stall 會累積音訊命令、錯過起音。**只有隔離 owner 仍不足以接受；需先降低 churn／保護音訊排程。**

驗收維持：1920×1080、High效果與反射最高30Hz、完整 native AI 3600ticks，穩定60FPS或完整1%low>45。不能用靜音、削減 AI、局部區間或刪掉 GC 幀達標；1%low沿現有 harness 完整計算，不拿單一P99或平均FPS替代。

## 已定位的瓶頸與新反證

Root同一281.6ms幀的 trace 證據：31.99ms GC，加上212.02ms WebAudio `RequestToDeleteHandlersOnMainThread` 相關工作，該task CPU209.16ms。兩組 dry-cue 診斷把建立節點約113k降至48k，native cleanup峰值224.8→55.7ms；晚期組133.1→73.4ms。這支持 graph churn／回收是高價值原因，但 dry cue改了聲音，不能作產品解法。渲染診斷的 main約7ms、reflection約8.3ms（含shadow）也表明仍有 CPU submission 預算；CPU／GPU可重疊，不能把不同scope耗時直接相加成可回收量。

### 已完成的受控GC screen：負結果

來源：`evidence/gc-small-batch-native-high-1.json`，root每120ticks送一次CDP `collectGarbage`，共29次，完整8個logical exports exact。下列為單輪診斷比較，不是多配對產品驗收：

| 完整指標 | Product Stage3比較輪 | 每120ticks受控GC |
| --- | ---: | ---: |
| FPS | 50.72 | 52.87 |
| 完整1%low | 17.01 | 12.87 |
| P99 | 38.6ms | 59.4ms |
| 最大幀 | 261.3ms | 114.2ms |
| >50ms頻率 | 6.95/min | 35.38/min |

29次CDP round trip平均107.7ms、最大172.4ms，包含排隊與回應等待，不能當純GC CPU。最大尖峰下降不足以抵銷更頻繁的慢幀。這個策略已失敗；桌面能呼叫同一GC接口，不代表桌面便因此更接近驗收。

### 已完成的 audio owner host probe：部分成功、起音品質失敗

來源：`astra/audio/host-probe/results-root-idle-1/{same,cross}.json` 與 `results-root-stall200-1/{same,cross}.json`；瀏覽器版本157.0.4341.60。Cross-site case已由trace確認 parent/child不同PID／thread，parent gesture可使child AudioContext running。Idle測試3ms與32ms提前量各10批，未miss首音。

Synthetic200ms child stall時，cross parent最大issue delay約15.1ms，same-process約174.2ms；隔離確實保護了parent。然而cross有25個late commands；3ms提前量首音miss3/10，32ms miss4/10，最差lead約−138.9ms。32ms lookahead也不足以遮住200ms owner停頓。Same-process的「無miss」不代表較好：parent本身已被延後送出，目標時間按實際送出計算，必須一起看issue delay。這是synthetic owner/transport試驗，不是完整遊戲或真正native cleanup的音訊接受證據。

## 原型與版本盤點

| 宿主 | 已核對資料 | 證據界線 |
| --- | --- | --- |
| 最新Edge | `pipeline-native-observation-high-1.json`及dry-late raw `browserVersion=157.0.4341.60`；system記RX9070XT、ANGLE D3D11／driver32.0.32015.7029 | 這是最新觀測runtime。Edge產品版本不可冒充完整upstream Chromium build號。 |
| Electron | `electron-shell/package.json`固定45.3.3；本地exe File/ProductVersion45.3.3；`electron-high-electron-runtime.json`實際 `process.versions.chrome=156.0.8078.100`、V8 `15.6.75.57-electron.0`、Node24.22.3 | runtime capture來自舊client，僅作binary/version inventory，不能作新工作負載性能證據。官方45.3.3 release列同Chromium／Node版本。 |
| Tauri | `tauri-shell/Cargo.toml`固定Tauri2.12.2、tauri-build2.7.2；`t-final-high-system.json`實際WebView2 `157.0.4341.46` | 舊測量的實際版本；目前磁碟仍有157.0.4341.46等runtime目錄，但新launch實際選用版本必須重錄。Evergreen可更新，不能把舊capture當未來保證。 |

Electron官方45.3.3 release列Chromium156.0.8078.100，所查該版本release note的具體變更是Node與DevTools相關，沒有宣告本案bulk WebAudio deletion延遲已修復。[Electron 45.3.3官方release](https://releases.electronjs.org/release/v45.3.3)

已核對一項相關upstream修復：`ce5005e`／原始`e8cfa01`改善running但未pull graph時的AudioHandler disposal defer條件，屬生命週期／安全時點修復，沒有承諾將大量刪除切成小budget。Electron對應156.0.8078.100的`audio_node.cc`已含non-closed條件；同版本DeferredTaskHandler仍將orphan deletion投遞回main thread並在graph lock下clear。這不能證明各runtime延遲相同，也不能把這個已存在的修復當換殼後必有收益。[官方修復](https://github.com/chromium/chromium/commit/ce5005e549f3)、[156 AudioNode來源](https://raw.githubusercontent.com/chromium/chromium/156.0.8078.100/third_party/blink/renderer/modules/webaudio/audio_node.cc)、[156 DeferredTaskHandler來源](https://github.com/chromium/chromium/blob/156.0.8078.100/third_party/blink/renderer/modules/webaudio/deferred_task_handler.cc)

本次沒有找到一項已核實、可對上目前Edge/WebView2/Electron全部分支的「本案200ms大批handler deletion已被限時分批」修復；這是查證範圍內的未找到，不是宣稱不存在。若新版本screen有差異，需再按實際revision／backport查來源與trace。

### 舊原型能重用什麼

`work/perf-e3f040c/electron-shell/main.cjs`為正常可見1920×1080 BrowserWindow，nodeIntegration=false、contextIsolation/sandbox=true、backgroundThrottling=false；預設spawn獨立portable Node server，`GH_PROBE_CLIENT`可選client路徑。`tauri-shell/src/main.rs`也spawn同一Node服務，以WebView2載入loopback URL，現有code可重用來做新client screen。

這些原型未建立native mixer、AudioWorklet owner或render worker；Rust／Node主程序存在，不代表遊戲熱路徑已搬過去。Electron保留獨立Node是刻意降低驗證風險，**不是最終整合的最低負擔**。整合server可能減少重複runtime／程序，也可能碰到native module ABI、server lifetime與阻塞工作；不會直接消除renderer內WebAudio cleanup。

舊包確實存在：`outputs/runtime-comparison/package-sizes.json`記Electron ZIP207,546,622 bytes、解壓503,328,534 bytes；Tauri ZIP51,793,011 bytes、解壓137,666,046 bytes。它們是**e3f040c舊原型包盤點**，不是新runtime發行包預測；Tauri包不含WebView2，兩者保留共同Node/client。不能只拿該ZIP差距宣布新架構記憶體或驗收勝負。

## 架構能力對本案的實際關係

Electron沿用Chromium多程序架構；main是Node環境，BrowserWindow的網頁在renderer執行。Tauri的Rust core與WebView也是分離角色；Windows實際內容由WebView2處理。WebView2包含browser、renderer、GPU、audio service等程序，且不同WebView可以共享renderer。這些程序名稱不能用來推論AudioContext graph控制物件已離開該網頁owner。[Electron process model](https://www.electronjs.org/docs/latest/tutorial/process-model)、[Tauri process model](https://v2.tauri.app/concept/process-model/)、[WebView2 process model](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/process-model)

| 方向 | 對已定位瓶頸的可能作用 | 是否單純包裝／主要限制 |
| --- | --- | --- |
| 正常BrowserWindow／WebView包裝 | 版本、profile、排程／compositor／ANGLE分支差異可能改變成本；目前無可保證回收的ms | 低成本screen可做；不會自動減少113k節點或移走main graph owner。 |
| 受控renderer GC | 可改變回收時點；120ticks策略已降低最大尖峰但惡化完整尾部 | 官方API存在，該策略實測失敗，不繼續調頻率或當預設解法。 |
| 獨立audio BrowserWindow／WebView | 可把owner GC／deletion阻塞移離game renderer，保留較多既有WebAudio DSP | 必須改cue transport、clock／RNG ownership、啟動與生命週期；既有host probe顯示audio仍會miss，單獨不夠。 |
| 少量長命AudioWorklet nodes／WASM DSP | 減少臨時graph nodes及相關native lifecycle，DSP可在audio rendering thread | 瀏覽器也能做；不是將現有AudioContext直接transfer到普通Worker。需驗音色、filter/envelope、空間感、尾音、起音與XRUN。 |
| native mixer＋專用audio callback | 可繞開搬移cue的WebAudio graph churn；Tauri可用Rust，Electron可經native addon／utility process | 需重做DSP／聲音資源／時鐘／裝置處理及IPC，成本大於換殼。不是Tauri裝上就自動有的能力。 |
| OffscreenCanvas render owner worker | 可能隔離UI main阻塞或搬CPU submission | Web標準已有；Three scene、input/HUD、physics／AI snapshot ownership才是主要工作，總工作不會憑空消失。 |
| Electron offscreen BrowserWindow輸出 | 用bitmap或shared GPU texture取得網頁內容 | 跟OffscreenCanvas worker不同；bitmap模式有GPU→CPU copy。不是降低目前render submission／WebAudio CPU的捷徑。 |

WebAudio的AudioWorkletProcessor在audio rendering thread，而AudioWorkletNode仍是main側graph節點；因此只有把大量短命圖操作改成少量長命DSP owner，才對準目前原因。BaseAudioContext的Blink IDL仍暴露於Window；普通Node/Web Worker不能直接接管既有DOM AudioContext。[Chrome AudioWorklet說明](https://developer.chrome.com/blog/audio-worklet/)、[Blink BaseAudioContext IDL](https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/modules/webaudio/base_audio_context.idl)

Electron utilityProcess提供Node子程序與MessagePort；Tauri commands可呼叫Rust，async command走async task，但這些都不等同即時audio callback。CPAL官方提供Windows等native音訊後端／callback scheduling能力，可作native方案的底層候選，仍需自己完成mixer與聲音等價驗證。[Electron utilityProcess](https://www.electronjs.org/docs/latest/api/utility-process)、[Tauri Rust commands](https://v2.tauri.app/develop/calling-rust/)、[CPAL官方專案](https://github.com/RustAudio/cpal)

OffscreenCanvas可轉移canvas控制並供worker使用；Electron offscreen API則提供BrowserWindow畫面擷取／共享texture，兩者的ownership與copy成本不同。[HTML OffscreenCanvas標準](https://html.spec.whatwg.org/multipage/canvas.html#the-offscreencanvas-interface)、[Electron offscreen rendering](https://www.electronjs.org/docs/latest/tutorial/offscreen-rendering)

## GC宿主控制：API可行，但本次策略不可採用

Electron可由可信任host使用`webContents.debugger.attach()`與`sendCommand('HeapProfiler.collectGarbage')`；WebView2原生有`ICoreWebView2.CallDevToolsProtocolMethod`。Tauri可經Windows平台`with_webview` bridge呼叫COM接口；這不是已存在的通用Tauri前端GC API，bridge版本要固定。它們不需要公開remote-debugging port，也不必把任意CDP命令暴露給網頁。[Electron Debugger API](https://www.electronjs.org/docs/latest/api/debugger)、[WebView2原生CDP API](https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/win32/icorewebview2#calldevtoolsprotocolmethod)、[Tauri with_webview](https://docs.rs/tauri/latest/tauri/webview/struct.Webview.html#method.with_webview)

官方CDP定義把HeapProfiler標為experimental，collectGarbage無budget／handler數參數。V8實作將強制GC工作排到foreground task runner；async回應不表示GC不會阻塞renderer，也不保證WebAudio跨執行緒tail/deletion已drain。Electron main的Node GC也不是game renderer的GC。桌面可封裝受控transport與版本，不提供「只刪下一小批handler」的現成API。[官方CDP定義](https://raw.githubusercontent.com/ChromeDevTools/devtools-protocol/master/json/js_protocol.json)、[V8 inspector實作](https://raw.githubusercontent.com/v8/v8/main/src/inspector/v8-heap-profiler-agent-impl.cc)

Root已用原Edge完成更便宜的可否證試驗，且完整low失敗。因此此處不提議先加桌面GC產品開關，也不以平均FPS52.87肯定它。未來若有新的實作級證據或不同ownership假說，應另立試驗；目前120ticks策略到此為止。

## 最小後續試驗與停止條件

**先做完正在進行的保聲低churn方案。** 它直接改變已定位原因，且可在瀏覽器驗證；不要因桌面研究重新做已完成的idle／synthetic owner probe。Owner方案需結合降低child stall或有效排程，不能靠把lookahead加到200ms隱藏問題。

若root安排版本差異screen，重用兩個殼而不整合Node、不改DSP。凍結同一client/core、相同音效／AI／High與seed；用新隔離profile，初始直接saved High，等待runtimeReady＋gfx.whenReady。確認真正drawing buffer1920×1080、DPR/renderScale、硬體backend、前景/focus、反射頻率。每宿主重錄實際product/runtime/V8版本，不能用UA主版本代替完整版本。

第一階段只需Edge→Electron→Tauri→Edge的四個完整3600tick screen，保留所有慢幀及8exports；不用先跑冷啟動×音訊×畫質的大矩陣。若一個宿主顯示有意義的尾改善，再安排該宿主與Edge的配對trace與無profile正式重測。四輪是篩選，不能單輪宣布達標。

可否證條件：同等cue／節點數、相同聲音與draw負載下，runtime是否實際減少GC／native deletion長task或CPU submission，且完整1%low、P95/P99、長幀頻率改善？如果只有版本名、平均FPS或max單一值改善，或者靠節點數／視效／AI改變才變快，就不歸因於宿主包裝。只改宿主仍跨不過驗收，不繼續付出正式遷移成本。

成本估計屬工程判斷，不是已完成工作量：重用殼與新source驗證約半日至一日；三宿主screen與選中者配對約半日至一日加GPU排程；Tauri原生GC bridge約半日至一日但現策略已否決，不值得先做。完整audio owner整合、device／clock／cue／RNG語義一般是數日級；native mixer或render owner改造是更大的工作包，不能與一個殼的工時混為一談。實際成本取決於Astra原型的保聲證據，不重建通用IPC框架。

## 使用者指定的競爭指標保留

只有screen晉級後才補齊整套比較，且**全程使用新runtime證據**：

- 全process tree：host、renderer、GPU、audio／network service、獨立Node及新增audio owner。記private commit與working set口徑；後者共享頁面可能重複，不能當VRAM。用已知低擾動／分階段memory採樣，不讓昂貴tree refresh混成幀時間收益。
- 冷啟動：process spawn→runtimeReady＋gfx.whenReady，獨立profile/cache政策清楚；進場另外量click→第一個正常playing submission與LIVE。圖像暖機、音訊準備時間都算，不移到未量測區間。
- 完整native AI：同3600ticks／同8exports與聲音事件；完整1%low、P95、P99、>33.3／50／100ms頻率與最大幀。GC／deletion／IPC／新增owner慢幀全部納入，不靠截短或隱藏bad interval。
- 真發行包：量實際ZIP／installer與解壓bytes、檔案數／SHA及依賴。Tauri Evergreen小包與fixed WebView2自含包是不同口徑；Electron打包Chromium，而Node獨立／整合分別註明。

WebView2 Evergreen會自動更新；fixed runtime可固定版本但需要自己分發／維護。Tauri官方提供多種安裝策略，不能把不含engine的小ZIP與Electron自含engine包當相同交付。[Microsoft runtime分發策略](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/evergreen-vs-fixed-version)、[Tauri Windows installer選項](https://v2.tauri.app/distribute/windows-installer/)

**最後建議：目前更容易接近驗收的路徑仍是保聲降低audio churn，並處理已量到的render CPU。桌面保留為版本差異／host控制／發行候選；GC已跑的策略與單純audio-owner隔離都不足以接受。若要先試一個桌面宿主，Electron既有殼與本地Debugger API整合較省驗證工，這是試驗成本排序，不是性能勝出判定。**

所有上述官方URL於2026-11-17查閱。`local-evidence.json`保存研究階段讀到的runtime inventory與host-probe摘要；後續三宿主screen結果與界線見本文頂部Stage9連結。
