Golden Hour — Windows x64

玩家包：解壓整個資料夾，雙擊 Play.cmd。選 1 進入單人訓練、2 在熱點或區網開房、3 貼上完整 gh1:// 邀請加入。開房時從清單選其他玩家能到達的網卡。在瀏覽器建立房間後，可複製含房碼的邀請。遊玩期間保持終端機開啟；Ctrl+C 結束。需要 Windows 10/11 x64 與支援 WebGL 2、WebRTC 的系統瀏覽器。

專服包：雙擊 Start-Server.cmd，選區網 IPv4，將顯示的邀請交給玩家。在終端機執行 Start-Server.cmd serve 192.168.50.10 可指定網卡。專服可無畫面運行。區網需允許 TCP 48723、UDP 49100–49200。

升級：關閉舊程式，將新版解壓到新資料夾。玩家使用原瀏覽器設定檔和 http://127.0.0.1:48722（或原本設定的 GH_CLIENT_PORT）即可用原口令解鎖。換機或換設定檔，先從本地帳號選單匯出 .ghsave，再到新設定檔匯入。

兩個包共用 %LOCALAPPDATA%\Golden Hour\dedicated 作為預設房主資料夾。從原始碼版升級，首次啟動前關閉舊主機，將 server\.local\dedicated 整個資料夾複製到上述位置；包含 host.key、host.crt、career.sqlite 及存在的 SQLite 附屬檔。也可設定 GH_DATA_DIR 指向原資料夾。請勿用舊檔覆寫已經遊玩過的新資料夾。原本使用 npm start 開多人房的本機服，請在停服後將 server\.local\career.sqlite 及其附屬檔複製到尚未使用的 dedicated 目錄。首次開房會產生新的 TLS 邀請，並沿用資料庫內的戰績與簽發金鑰。不同主機的排名各自保存。

Client: extract the whole folder, run Play.cmd, and select Solo, Host or Join. Enter the full gh1:// invitation for Join. Keep the console open while playing. The headless server has its own archive and Start-Server.cmd. Both include Node, OpenSSL and the native WebRTC module.

Updates: keep the same Windows account, browser profile and local URL. Both packages store host data outside the installation under %LOCALAPPDATA%\Golden Hour\dedicated. When upgrading a source-based host, stop it and copy its whole server\.local\dedicated folder there before first launch, or point GH_DATA_DIR at its existing directory. Back up this directory and export your encrypted .ghsave before moving computers.

Developer credit: 蒙哥汗马利@LankiYang. See docs/provenance.md and licenses/.
