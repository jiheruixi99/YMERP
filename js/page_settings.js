/* ===== page_settings.js — 系統設定 / 備份 / 整合 ===== */
"use strict";

const PageSet = {
  render(c) {
    const s = DB.data.settings;
    c.innerHTML = `
    <div class="card">
      <h3>🎯 成本管控目標</h3>
      <div class="form-grid">
        <div><label class="fl">目標食材成本率(%)</label><input id="set_target" type="number" step="0.5" value="${(s.targetCostRate * 100).toFixed(1)}" style="width:100%"></div>
        <div><label class="fl">價格異常警示閾值(±%)</label><input id="set_alert" type="number" step="1" value="${(s.priceAlertPct * 100).toFixed(0)}" style="width:100%"></div>
        <div><label class="fl">效期預警天數</label><input id="set_expiry" type="number" value="${s.expiryWarnDays}" style="width:100%"></div>
        <div><label class="fl">採購建議備貨天數</label><input id="set_cover" type="number" value="${s.coverDays}" style="width:100%"></div>
        <div><label class="fl">預測取樣週數</label><input id="set_weeks" type="number" value="${s.forecastBaseWeeks}" style="width:100%"></div>
      </div>
    </div>
    <div class="card">
      <h3>💳 手續費率(供月財報自動計算)</h3>
      <div class="form-grid">
        <div><label class="fl">信用卡(%)</label><input id="set_feecard" type="number" step="0.1" value="${(s.feeCardPct * 100).toFixed(1)}" style="width:100%"></div>
        <div><label class="fl">LINE Pay(%)</label><input id="set_feeline" type="number" step="0.1" value="${(s.feeLinePct * 100).toFixed(1)}" style="width:100%"></div>
        <div><label class="fl">全支付(%)</label><input id="set_feejko" type="number" step="0.1" value="${(s.feeJkoPct * 100).toFixed(1)}" style="width:100%"></div>
      </div>
      <p class="hint">月財報的手續費 = 各支付方式當月營收 × 上面費率,自動扣除。</p>
    </div>
    <div class="card">
      <h3>🧑‍🍳 備援估計值(該月沒有實際登記時,財報用這些估)</h3>
      <div class="form-grid">
        <div><label class="fl">人事成本(元/月)</label><input id="set_labor" type="number" value="${s.monthlyLabor / 100}" style="width:100%"></div>
        <div><label class="fl">租金(元/月)</label><input id="set_rent" type="number" value="${s.monthlyRent / 100}" style="width:100%"></div>
        <div><label class="fl">水電(元/月)</label><input id="set_util" type="number" value="${s.monthlyUtility / 100}" style="width:100%"></div>
        <div><label class="fl">雜項(元/月)</label><input id="set_other" type="number" value="${s.monthlyOther / 100}" style="width:100%"></div>
      </div>
      <p class="hint">正式使用請到「財報 → 人力成本 / 支出登記」輸入實際數字,有實際登記的月份會自動改用實際值。</p>
    </div>
    <div class="card">
      <h3>🔗 系統整合(Adapter)</h3>
      <div class="form-row">
        <label class="fl">自有預約系統(GAS)Web App URL</label>
        <input id="set_gas" value="${U.esc(s.gasReservationUrl || "")}" placeholder="https://script.google.com/macros/s/…/exec" style="width:100%">
        <p class="hint">訂位頁的「同步」會呼叫 <span class="mono">{URL}?action=listReservations</span>,期望回傳 JSON 陣列(date / time / name / phone / partySize / status / note)。GAS 需部署為「任何人可存取」。若欄位不同,告訴開發者調整對應即可。</p>
      </div>
      <div class="form-row">
        <label class="fl">肚肚 POS 營收匯入</label>
        <p class="hint">目前採 CSV 匯入(銷售→每日營收→匯入),欄位對應可自訂並會記住。若肚肚方案開通 API,可再加做自動抓取。</p>
      </div>
      <button class="btn primary" onclick="PageSet.save()">💾 儲存所有設定</button>
    </div>
    <div class="card">
      <h3>☁️ 雲端資料庫(Google 試算表)</h3>
      <p class="hint" style="margin-bottom:10px">試算表<b>只當資料庫</b> — 所有輸入都在 ERP 操作,資料自動同步到你的 Google 試算表(每種資料一個工作表,可隨時打開查看)。多裝置(店裡平板+家裡電腦)共用同一份資料、換裝置資料不遺失。<b>架設步驟見資料夾內「試算表資料庫架設說明.md」</b>(約 5 分鐘,跟預約系統同做法)。</p>
      <div class="form-grid">
        <div class="full"><label class="fl">GAS Web App URL</label>
          <input id="set_gasdb" value="${U.esc(s.gasDbUrl || "")}" placeholder="https://script.google.com/macros/s/…/exec" style="width:100%"></div>
        <div><label class="fl">同步密碼(需與 GAS 程式內 TOKEN 相同)</label>
          <input id="set_gastoken" type="password" value="${U.esc(s.gasDbToken || "")}" style="width:100%" autocomplete="off"></div>
        <div><label class="fl">自動同步</label>
          <label style="display:flex;align-items:center;gap:6px;padding:7px 0"><input type="checkbox" id="set_autosync" ${s.autoSync ? "checked" : ""}> 開啟時檢查+改資料後 45 秒自動上傳</label></div>
      </div>
      <div class="toolbar" style="margin-top:10px">
        <button class="btn" onclick="PageSet.save();Sync.testConnection()">🔌 測試連線</button>
        <button class="btn" onclick="PageSet.save();Sync.buildStructure()">🧱 建立完整資料表結構</button>
        <button class="btn" onclick="PageSet.save();Sync.smart(false)">☁️ 立即同步</button>
        <button class="btn" onclick="PageSet.save();UI.confirm('將以本機資料完整覆蓋雲端試算表,確定?',()=>Sync.forcePush())">⬆ 上傳全部(本機→雲端)</button>
        <button class="btn ghost-red" onclick="PageSet.save();UI.confirm('將以雲端試算表完整覆蓋本機資料,確定?(建議先匯出備份)',()=>Sync.forcePull())">⬇ 下載全部(雲端→本機)</button>
      </div>
    </div>
    <div class="card">
      <h3>💾 資料備份 / 還原</h3>
      <p class="hint" style="margin-bottom:10px">資料儲存在此瀏覽器內(localStorage)。<b>請定期匯出 JSON 備份</b>,避免清除瀏覽器資料造成遺失;備份檔也可搬到其他電腦匯入。</p>
      <div class="toolbar">
        <button class="btn primary" onclick="DB.exportJSON();UI.toast('已下載備份檔')">📤 匯出完整備份(JSON)</button>
        <label class="btn">📥 匯入備份還原(完整覆蓋)<input type="file" accept=".json" style="display:none" onchange="PageSet.importBackup(this)"></label>
        <label class="btn">➕ 匯入補充資料(只新增/更新,不覆蓋)<input type="file" accept=".json" style="display:none" onchange="PageSet.mergeImport(this)"></label>
      </div>
      <p class="hint">「補充資料」用於載入他人準備好的批次主檔(如菜單/配方對照),只會新增或更新指定資料表,不會動到你其他既有資料。</p>
      <div class="mini-title">資料量</div>
      ${UI.table(["資料表", "#筆數"], DB.COLLECTIONS.map(coll =>
        `<tr><td>${coll}</td><td class="num">${DB.get(coll).length}</td></tr>`))}
    </div>
    <div class="card">
      <h3>⚠️ 重置</h3>
      <div class="toolbar">
        <button class="btn ghost-red" onclick="PageSet.resetSeed()">重置為示範資料(Seed)</button>
        <button class="btn ghost-red" onclick="PageSet.resetEmpty()">清空為全新空系統</button>
      </div>
      <p class="hint">重置前建議先匯出備份。「示範資料」含 90 天營運情境,可完整展示成本閉環;「全新空系統」保留主檔結構但無任何資料。</p>
    </div>`;
  },

  save() {
    DB.data.settings.targetCostRate = UI.num("set_target") / 100 || 0.5;
    DB.data.settings.priceAlertPct = UI.num("set_alert") / 100 || 0.15;
    DB.data.settings.expiryWarnDays = UI.num("set_expiry") || 3;
    DB.data.settings.coverDays = UI.num("set_cover") || 3;
    DB.data.settings.forecastBaseWeeks = UI.num("set_weeks") || 4;
    DB.data.settings.feeCardPct = UI.num("set_feecard") / 100;
    DB.data.settings.feeLinePct = UI.num("set_feeline") / 100;
    DB.data.settings.feeJkoPct = UI.num("set_feejko") / 100;
    DB.data.settings.monthlyLabor = U.toCents(UI.val("set_labor"));
    DB.data.settings.monthlyRent = U.toCents(UI.val("set_rent"));
    DB.data.settings.monthlyUtility = U.toCents(UI.val("set_util"));
    DB.data.settings.monthlyOther = U.toCents(UI.val("set_other"));
    DB.data.settings.gasReservationUrl = UI.val("set_gas");
    DB.data.settings.gasDbUrl = UI.val("set_gasdb");
    DB.data.settings.gasDbToken = UI.val("set_gastoken");
    DB.data.settings.autoSync = UI.checked("set_autosync");
    DB.save();
    if (typeof Sync !== "undefined") Sync.init();
    UI.toast("設定已儲存");
    App.refresh();
  },

  importBackup(input) {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        DB.importJSON(reader.result);
        UI.toast("備份還原完成");
        App.refresh();
      } catch (e) { UI.toast("還原失敗:" + e.message, true); }
    };
    reader.readAsText(file, "UTF-8");
  },

  mergeImport(input) {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const r = DB.mergeImport(reader.result);
        if (typeof Domain !== "undefined" && Domain.rematchOrderItems) Domain.rematchOrderItems();
        UI.toast(`補充匯入完成:新增 ${r.added} 筆、更新 ${r.updated} 筆`);
        App.refresh();
      } catch (e) { UI.toast("匯入失敗:" + e.message, true); }
    };
    reader.readAsText(file, "UTF-8");
  },

  resetSeed() {
    UI.confirm("將清除目前全部資料並載入示範資料,確定?(建議先匯出備份)", () => {
      DB.reset(true); UI.toast("已重置為示範資料"); App.refresh();
    });
  },
  resetEmpty() {
    UI.confirm("將清除目前全部資料成為空系統,確定?(建議先匯出備份)", () => {
      DB.reset(false); UI.toast("已清空系統"); App.refresh();
    });
  }
};

App.register("sys_set", "系統 — 設定 / 備份 / 整合", PageSet.render);
