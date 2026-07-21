/* ===== db.js — 資料層(localStorage 儲存,可匯出/匯入 JSON) ===== */
"use strict";

const DB_KEY = "hotpot_erp_v1";

const DB = {
  data: null,

  COLLECTIONS: [
    "suppliers", "ingredients", "supplierPrices", "purchaseOrders", "goodsReceipts",
    "priceHistory", "stockBatches", "stockMovements", "stockCounts", "wasteLogs",
    "recipes", "productionOrders", "salesDaily", "reservations", "forecasts", "pricePlans",
    "laborLogs", "expenses", "menuMap", "posOrderItems",
    "supplies", "supplyPurchases", "supplyCounts"
  ],

  DEFAULT_SETTINGS: {
    storeName: "蔬食火鍋自助吧",
    targetCostRate: 0.50,        // 目標食材成本率
    priceAlertPct: 0.15,         // 進貨價異常警示閾值(±15%)
    expiryWarnDays: 3,           // 效期預警天數
    coverDays: 3,                // 採購建議備貨天數
    weekendFactor: 1.35,         // 假日來客係數
    forecastBaseWeeks: 4,        // 預測取樣週數
    monthlyLabor: 28000000,      // 月人事成本備援估計(分)— 該月無人力登記時財報用這個
    monthlyRent: 12000000,       // 月租金備援估計(分)— 該月無支出登記時財報用這個
    monthlyUtility: 6000000,     // 月水電備援估計(分)
    monthlyOther: 3000000,       // 月雜項備援估計(分)
    feeCardPct: 0.02,            // 信用卡手續費率
    feeLinePct: 0.022,           // LINE Pay 手續費率
    feeJkoPct: 0.022,            // 全支付手續費率
    gasReservationUrl: "",       // 自有預約系統(GAS)端點
    posCsvMapping: null,         // POS 匯入欄位對應(記住上次設定)
    gasDbUrl: "",                // Google 試算表資料庫(GAS Web App URL)
    gasDbToken: "",              // 同步密碼(需與 GAS 程式內 TOKEN 一致)
    autoSync: true               // 自動同步(啟動時檢查+改資料後自動上傳)
  },

  load() {
    try {
      const raw = localStorage.getItem(DB_KEY);
      if (raw) {
        DB.data = JSON.parse(raw);
        // 補齊新欄位
        DB.COLLECTIONS.forEach(c => { if (!DB.data[c]) DB.data[c] = []; });
        DB.data.settings = Object.assign({}, DB.DEFAULT_SETTINGS, DB.data.settings || {});
        // 遷移:舊「行動支付」欄位歸入 LINE Pay
        for (const s of DB.data.salesDaily) {
          if (s.payLine == null && s.payMobile != null) { s.payLine = s.payMobile; s.payJko = s.payJko || 0; }
        }
        return;
      }
    } catch (e) { console.error("DB 載入失敗", e); }
    DB.reset(false);
  },

  reset(withSeed) {
    DB.data = { meta: { version: 1, createdAt: new Date().toISOString() }, settings: Object.assign({}, DB.DEFAULT_SETTINGS) };
    DB.COLLECTIONS.forEach(c => DB.data[c] = []);
    if (withSeed && typeof Seed !== "undefined") Seed.run();
    DB.save();
  },

  // skipTouch=true:同步作業寫入,不更新修改時間、不觸發自動上傳
  save(skipTouch) {
    if (DB._suspend) return;
    if (!skipTouch) {
      DB.data.meta.updatedAt = new Date().toISOString();
      if (typeof Sync !== "undefined" && !Sync._applying) Sync.markDirty();
    }
    try { localStorage.setItem(DB_KEY, JSON.stringify(DB.data)); }
    catch (e) { console.error("DB 儲存失敗", e); if (typeof UI !== "undefined") UI.toast("儲存失敗:" + e.message, true); }
  },

  get(coll) { return DB.data[coll]; },
  byId(coll, id) { return DB.data[coll].find(x => x.id === id); },

  insert(coll, obj) {
    if (!obj.id) obj.id = U.uid(coll.slice(0, 3));
    DB.data[coll].push(obj);
    DB.save();
    return obj;
  },
  update(coll, id, patch) {
    const o = DB.byId(coll, id);
    if (o) { Object.assign(o, patch); DB.save(); }
    return o;
  },
  remove(coll, id) {
    const i = DB.data[coll].findIndex(x => x.id === id);
    if (i >= 0) { DB.data[coll].splice(i, 1); DB.save(); }
  },

  setting(key, val) {
    if (val === undefined) return DB.data.settings[key];
    DB.data.settings[key] = val;
    DB.save();
  },

  exportJSON() {
    U.downloadFile(`火鍋店ERP備份_${U.today()}.json`, JSON.stringify(DB.data, null, 1), "application/json");
  },

  importJSON(text) {
    const obj = JSON.parse(text);
    if (!obj || !obj.meta || !obj.ingredients) throw new Error("格式不符:不是本系統的備份檔");
    DB.data = obj;
    DB.COLLECTIONS.forEach(c => { if (!DB.data[c]) DB.data[c] = []; });
    DB.data.settings = Object.assign({}, DB.DEFAULT_SETTINGS, DB.data.settings || {});
    DB.save();
  },

  // 補充匯入:只新增/更新指定資料表的記錄(依 id upsert),不動其他資料表、不動 settings。
  // 用於分批載入別人準備好的主檔資料(如菜單/配方批次),不會覆蓋你現有的真實資料。
  mergeImport(text) {
    const obj = typeof text === "string" ? JSON.parse(text) : text;
    if (!obj || !obj.collections) throw new Error("格式不符:需要 { collections: { 資料表名: [記錄...] } } 格式");
    let added = 0, updated = 0;
    DB._suspend = true;
    try {
      for (const [name, rows] of Object.entries(obj.collections)) {
        if (!DB.COLLECTIONS.includes(name) || !Array.isArray(rows)) continue;
        for (const row of rows) {
          if (row.id && DB.byId(name, row.id)) { Object.assign(DB.byId(name, row.id), row); updated++; }
          else { if (!row.id) row.id = U.uid(name.slice(0, 3)); DB.data[name].push(row); added++; }
        }
      }
    } finally { DB._suspend = false; DB.save(); }
    return { added, updated };
  }
};
