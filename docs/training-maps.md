# 離線訓練地圖

單人訓練使用原生酒店作為預設地圖。匯入 v60115 的本機資產後，選單也會列出裝卸貨場（`shipment@3`）及地下變電站（`sublevel-07@4`）。選擇地圖後，等待畫面顯示可部署再按部署。載入中可取消，結算後可用同一張圖再來一局，退出會回到主選單並還原酒店。

## 本機匯入

用 Python 執行下列指令，並把路徑指向 v60115 封存的 `resources.zip`。

```console
python scripts/import_maps.py <resources.zip>
```

匯入器會先比對封存 ZIP 與 12 個成員的 SHA-256，接著將已驗證的檔案寫到腳本所在工作樹的 `game/assets/maps/`。該目錄由 Git 忽略。目錄根層為 `catalog.json`，各圖使用 `<id>/<version>/manifest.json`、`world.json`、`gameplay.json`，以及適用於新圖的 `scene.glb`。酒店 `hotel@2` 的版本化資料也會匯入，瀏覽器沿用已內建的酒店場景和遊戲邏輯。

## 客戶端共用 API

- `loadMapCatalog({ signal })` 在目錄未匯入時回傳只有 `hotel/builtin` 的清單。
- `loadMapData({ id, version }, { signal })` 回傳 `{ manifest, world, gameplay }`。若明確請求 `hotel/builtin`，世界及玩法資料欄位為 `null`。版本參數使用字串。
- `prepareMap(gh, { id, version }, { signal })` 驗證並解碼本機地圖，回傳可交給 `installMap` 的結果。若放棄使用，呼叫結果的 `dispose()`。`hotel/builtin` 及 `hotel/2` 使用原生場景，無須另外解碼。
- `installMap(gh, prepared)` 在對局之外同步安裝碰撞、導航、出生點及渲染場景，並回傳清理函式。安裝後可讀取 `gh.debug.world.cols` 建立專服客戶端預測的世界。由呼叫端管理對局生命週期，在離開、切換地圖或連線失敗時先清理。
- API 位於 `game/client/maps/map-assets.js` 和 `game/client/maps/map-runtime.js`。瀏覽器的場景 SHA-256 驗證使用 Web Crypto，透過 loopback 或 HTTPS 供應遊戲頁面。

## 測試

匯入後在有 Python Playwright 及 Edge 的環境執行 `python server/check_training_maps.py`。測試會啟動獨立的 loopback 靜態伺服器，檢查取消下載、兩張新地圖的渲染與出生、AI 路徑與移動、重玩、退出時釋放場景物件和貼圖，以及原生酒店回歸。測試瀏覽器會攔截跨來源請求。

## GLB 解碼器來源

附加模組使用核心既有的 Three.js r180 實例。下表為改寫匯入路徑前的官方檔案指紋。Meshopt 解碼模組的內容逐位元組相同，內嵌的 WASM 來自 meshoptimizer 0.22。[Three.js MIT](licenses/three-r180.txt) · [meshoptimizer MIT](licenses/meshoptimizer-0.22.txt)

| 官方檔案 | 原始 SHA-256 |
| --- | --- |
| [GLTFLoader.js](https://github.com/mrdoob/three.js/blob/r180/examples/jsm/loaders/GLTFLoader.js) | `67ac5551fdafa6e349bd80c8f8e5e39c136d6b2fb1ad647db9abb21dc86f9e4a` |
| [BufferGeometryUtils.js](https://github.com/mrdoob/three.js/blob/r180/examples/jsm/utils/BufferGeometryUtils.js) | `fda7e946b8e0b5ab39b779206589e7a1079a22eb24efb89d7223e03fdfb1f751` |
| [meshopt_decoder.module.js](https://github.com/mrdoob/three.js/blob/r180/examples/jsm/libs/meshopt_decoder.module.js) | `784315b6959c85459eab77f51776158cc381d7e7d77b919ff7c4935f088a7c5c` |
