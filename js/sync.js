/* ===== sync.js — Google 試算表資料庫同步(GAS 後端) =====
   架構:所有輸入在 ERP → 本機即時儲存 → 同步到試算表(每個資料表一個工作表)。
   智慧同步規則:比較 本機修改時間 / 雲端修改時間 / 上次同步時間,
   只有一邊有變 → 自動推/拉;兩邊都有變 → 讓使用者選。
   變更偵測:每個資料表算雜湊,只上傳有改動的表,加快速度。 */
"use strict";

const PUSH_HASH_KEY = "hotpot_erp_pushHashes";

const Sync = {
  _applying: false,   // 套用雲端資料中(避免觸發 markDirty 迴圈)
  _busy: false,
  _timer: null,

  configured() { return !!DB.setting("gasDbUrl"); },

  /* ---- 底層呼叫(text/plain 避免 CORS preflight,GAS 標準作法) ---- */
  async call(action, extra) {
    const res = await fetch(DB.setting("gasDbUrl"), {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(Object.assign({ action, token: DB.setting("gasDbToken") || "" }, extra || {}))
    });
    let j;
    try { j = await res.json(); }
    catch (e) { throw new Error("回應不是 JSON — 請確認 GAS 已部署為 Web App 且「任何人可存取」"); }
    if (!j.ok) throw new Error(j.error || "未知錯誤");
    return j;
  },

  hash(s) { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return h; },

  /* ---- 上傳(只推有變更的資料表;force=true 全部重推) ---- */
  async push(force) {
    const last = force ? {} : JSON.parse(localStorage.getItem(PUSH_HASH_KEY) || "{}");
    const collections = {}, newHashes = {};
    for (const c of DB.COLLECTIONS) {
      const s = JSON.stringify(DB.data[c]);
      const h = Sync.hash(s);
      newHashes[c] = h;
      if (last[c] !== h) collections[c] = DB.data[c];
    }
    const updatedAt = DB.data.meta.updatedAt || new Date().toISOString();
    await Sync.call("pushAll", { data: { collections, settings: DB.data.settings, updatedAt } });
    localStorage.setItem(PUSH_HASH_KEY, JSON.stringify(newHashes));
    DB.data.meta.lastSyncAt = updatedAt;
    DB.save(true);
    return Object.keys(collections).length;
  },

  /* ---- 下載(整份覆蓋本機) ---- */
  async pull() {
    const j = await Sync.call("pullAll", {});
    const d = j.data || {};
    if (!d.updatedAt || !d.collections || !Object.keys(d.collections).length)
      throw new Error("雲端試算表還是空的,請先「上傳全部」");
    Sync._applying = true;
    try {
      DB.data.settings = Object.assign({}, DB.DEFAULT_SETTINGS, d.settings || {});
      for (const c of DB.COLLECTIONS) DB.data[c] = Array.isArray(d.collections[c]) ? d.collections[c] : [];
      DB.data.meta.updatedAt = d.updatedAt;
      DB.data.meta.lastSyncAt = d.updatedAt;
      DB.save(true);
      const hashes = {};
      for (const c of DB.COLLECTIONS) hashes[c] = Sync.hash(JSON.stringify(DB.data[c]));
      localStorage.setItem(PUSH_HASH_KEY, JSON.stringify(hashes));
    } finally { Sync._applying = false; }
    App.refresh();
  },

  /* ---- 智慧同步 ---- */
  async smart(quiet) {
    if (!Sync.configured()) { if (!quiet) { App.go("sys_set"); UI.toast("請先在設定頁填入試算表 GAS 端點", true); } return; }
    if (Sync._busy) return;
    Sync._busy = true;
    Sync.setStatus("⏳ 同步中…");
    try {
      const m = await Sync.call("meta", {});
      const cloudAt = m.updatedAt || "";
      const localAt = DB.data.meta.updatedAt || "";
      const syncAt = DB.data.meta.lastSyncAt || "";
      const localDirty = localAt > syncAt;
      const cloudNewer = cloudAt > syncAt && cloudAt !== localAt;

      if (!cloudAt) { // 雲端全空 → 首次上傳
        const n = await Sync.push(true);
        Sync.setStatus("✅ " + Sync.timeLabel());
        if (!quiet) UI.toast(`首次上傳完成(${n} 個資料表)`);
      } else if (cloudNewer && localDirty) {
        Sync.setStatus("⚠️ 兩邊都有變更");
        if (quiet) { UI.toast("⚠️ 本機與雲端(其他裝置)都有變更,請點右上「☁️ 同步」選擇保留哪邊", true); }
        else Sync.conflictDialog(cloudAt, localAt);
      } else if (localDirty) {
        const n = await Sync.push();
        Sync.setStatus("✅ " + Sync.timeLabel());
        if (!quiet) UI.toast(n ? `已上傳 ${n} 個資料表` : "已同步");
      } else if (cloudNewer) {
        await Sync.pull();
        Sync.setStatus("✅ " + Sync.timeLabel());
        UI.toast("已下載雲端最新資料(來自其他裝置)");
      } else {
        Sync.setStatus("✅ " + Sync.timeLabel());
        if (!quiet) UI.toast("已是最新,不需同步");
      }
    } catch (e) {
      console.error(e);
      Sync.setStatus("❌ 同步失敗");
      if (!quiet) UI.toast("同步失敗:" + e.message, true);
    } finally { Sync._busy = false; }
  },

  conflictDialog(cloudAt, localAt) {
    UI.modal("⚠️ 資料衝突", `
      <p style="line-height:1.8;font-size:13.5px">本機與雲端(可能來自另一台裝置)都有未同步的變更:</p>
      <table class="tbl" style="margin:10px 0">
        <tr><td>本機最後修改</td><td class="mono">${U.esc(localAt.replace("T", " ").slice(0, 19))}</td></tr>
        <tr><td>雲端最後修改</td><td class="mono">${U.esc(cloudAt.replace("T", " ").slice(0, 19))}</td></tr>
      </table>
      <p class="hint">選「以本機為準」會覆蓋雲端;選「以雲端為準」會覆蓋本機(建議先到設定頁匯出 JSON 備份)。</p>
      <div class="toolbar" style="margin-top:14px">
        <button class="btn primary" onclick="UI.closeModal();Sync.forcePush()">⬆ 以本機為準(上傳覆蓋)</button>
        <button class="btn" onclick="UI.closeModal();Sync.forcePull()">⬇ 以雲端為準(下載覆蓋)</button>
      </div>`, { hideOk: true, width: 520 });
  },

  async forcePush() {
    try { Sync.setStatus("⏳ 上傳中…"); await Sync.push(true); Sync.setStatus("✅ " + Sync.timeLabel()); UI.toast("已用本機資料覆蓋雲端"); }
    catch (e) { Sync.setStatus("❌ 同步失敗"); UI.toast("上傳失敗:" + e.message, true); }
  },
  async forcePull() {
    try { Sync.setStatus("⏳ 下載中…"); await Sync.pull(); Sync.setStatus("✅ " + Sync.timeLabel()); UI.toast("已用雲端資料覆蓋本機"); }
    catch (e) { Sync.setStatus("❌ 同步失敗"); UI.toast("下載失敗:" + e.message, true); }
  },

  async testConnection() {
    try {
      const j = await Sync.call("ping", {});
      UI.toast("✅ 連線成功:" + (j.name || "試算表"));
    } catch (e) { UI.toast("❌ 連線失敗:" + e.message, true); }
  },

  // 依欄位定義在試算表建立全部 20 個資料表的工作表(空表也帶欄位標題)
  async buildStructure() {
    if (!Sync.configured()) { UI.toast("請先填入試算表 GAS 端點與密碼", true); return; }
    try {
      UI.toast("建立資料表結構中…");
      const j = await Sync.call("buildStructure", {});
      UI.toast(`✅ 已建立完整結構:共 ${j.total} 個資料表(本次新建 ${j.built.length} 個空工作表)`);
    } catch (e) {
      UI.toast("❌ 建立失敗:" + e.message + "(若說未知 action,請先更新 GAS 程式並重新部署)", true);
    }
  },

  /* ---- 改資料後自動上傳(45 秒防抖) ---- */
  markDirty() {
    Sync.setStatus("🔸 有未同步變更");
    if (!Sync.configured() || !DB.setting("autoSync")) return;
    clearTimeout(Sync._timer);
    Sync._timer = setTimeout(() => Sync.smart(true), 45000);
  },

  timeLabel() {
    const d = new Date();
    return "已同步 " + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
  },

  setStatus(txt) {
    const el = document.getElementById("syncStatus");
    if (el) el.textContent = txt;
  },

  init() {
    const bar = document.getElementById("topbar");
    if (bar && !document.getElementById("syncBtn")) {
      const wrap = document.createElement("span");
      wrap.style.cssText = "display:flex;align-items:center;gap:8px";
      wrap.innerHTML = `<span id="syncStatus" style="font-size:12px;color:var(--text-muted)"></span>
        <button class="btn small" id="syncBtn" onclick="Sync.smart(false)">☁️ 同步</button>`;
      bar.insertBefore(wrap, document.getElementById("todayLabel"));
    }
    if (Sync.configured()) {
      Sync.setStatus((DB.data.meta.updatedAt || "") > (DB.data.meta.lastSyncAt || "") ? "🔸 有未同步變更" : "");
      if (DB.setting("autoSync")) setTimeout(() => Sync.smart(true), 800);
    } else {
      Sync.setStatus("未設定雲端");
    }
  }
};
