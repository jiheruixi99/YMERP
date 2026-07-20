/* ===== page_sales.js — 每日營收(POS匯入)/ 來客預測 / 訂位 ===== */
"use strict";

const PageSales = {
  csvRows: null,
  csvHeaders: null,

  /* ---------------- 每日營收 ---------------- */
  render(c) {
    const list = U.sortBy(DB.get("salesDaily"), s => s.date, true).slice(0, 40);
    c.innerHTML = `
    <div class="toolbar">
      <div class="spacer"></div>
      <button class="btn" onclick="PageSales.calc()">🧮 來客數計算(依人頭價)</button>
      <button class="btn" onclick="PageSales.reconCSV()">🔍 POS 對帳比對(CSV)</button>
      <button class="btn" onclick="PageSales.importCSV()">📥 匯入肚肚 POS 日報(CSV)</button>
      <button class="btn primary" onclick="PageSales.edit()">＋ 手動輸入營收</button>
    </div>
    <div class="card">
      <h3>近 30 天營收與來客</h3>
      ${Chart.line({
        width: 900, height: 230,
        series: [
          { name: "營收(千元)", color: "#1f5fa8", data: U.sortBy(list.slice(0, 30), s => s.date).map(s => ({ x: U.mdLabel(s.date), y: Math.round(s.revenue / 100000) })) },
          { name: "來客數", color: "#c62f2f", data: U.sortBy(list.slice(0, 30), s => s.date).map(s => ({ x: U.mdLabel(s.date), y: s.covers })) }
        ]
      })}
    </div>
    <div class="card">
      <h3>每日營收記錄</h3>
      ${UI.table(["日期", "星期", "#營業額", "#來客", "#客單價", "#現金", "#信用卡", "#LINE Pay", "#全支付", "來源", "操作"],
        list.map(s => `<tr>
          <td>${s.date}</td><td>${U.isWeekend(s.date) ? `<span class="badge b-red">週${U.weekdayName(s.date)}</span>` : "週" + U.weekdayName(s.date)}</td>
          <td class="num"><b>${U.fmt$(s.revenue)}</b></td>
          <td class="num">${s.covers}</td>
          <td class="num">${U.fmt$(s.covers ? Math.round(s.revenue / s.covers) : 0)}</td>
          <td class="num">${U.fmt$(s.payCash || 0)}</td>
          <td class="num">${U.fmt$(s.payCard || 0)}</td>
          <td class="num">${U.fmt$(s.payLine != null ? s.payLine : (s.payMobile || 0))}</td>
          <td class="num">${U.fmt$(s.payJko || 0)}</td>
          <td><span class="badge b-gray">${U.esc(s.source === "csv" ? "POS匯入" : s.source === "seed" ? "示範" : "手動")}</span></td>
          <td><button class="btn small" onclick="PageSales.edit('${s.id}')">編輯</button></td>
        </tr>`))}
    </div>`;
  },

  edit(id) {
    const s = id ? DB.byId("salesDaily", id) : { date: U.today(), revenue: 0, covers: 0, payCash: 0, payCard: 0, payLine: 0, payJko: 0, addons: 0 };
    const sLine = s.payLine != null ? s.payLine : (s.payMobile || 0);
    UI.modal(id ? "編輯營收:" + s.date : "手動輸入每日營收", `
      <div class="form-grid">
        <div><label class="fl">日期 *</label><input id="f_date" type="date" value="${s.date}" style="width:100%"></div>
        <div><label class="fl">營業額(元)*</label><input id="f_rev" type="number" step="any" value="${s.revenue / 100 || ""}" style="width:100%"></div>
        <div><label class="fl">來客數 *</label><input id="f_cov" type="number" value="${s.covers || ""}" style="width:100%"></div>
        <div><label class="fl">加購金額(元)</label><input id="f_add" type="number" step="any" value="${(s.addons || 0) / 100}" style="width:100%"></div>
        <div><label class="fl">現金(元)</label><input id="f_cash" type="number" step="any" value="${(s.payCash || 0) / 100}" style="width:100%"></div>
        <div><label class="fl">信用卡(元)</label><input id="f_card" type="number" step="any" value="${(s.payCard || 0) / 100}" style="width:100%"></div>
        <div><label class="fl">LINE Pay(元)</label><input id="f_line" type="number" step="any" value="${sLine / 100}" style="width:100%"></div>
        <div><label class="fl">全支付(元)</label><input id="f_jko" type="number" step="any" value="${(s.payJko || 0) / 100}" style="width:100%"></div>
      </div>
      <p class="hint">各支付方式金額會用於月財報的手續費計算(費率在設定頁)。</p>`,
      {
        onOk() {
          const date = UI.val("f_date"), revenue = U.toCents(UI.val("f_rev")), covers = UI.num("f_cov");
          if (!date || revenue <= 0) { UI.toast("請輸入日期與營業額", true); return false; }
          const patch = {
            date, revenue, covers, avgSpend: covers ? Math.round(revenue / covers) : 0,
            payCash: U.toCents(UI.val("f_cash")), payCard: U.toCents(UI.val("f_card")),
            payLine: U.toCents(UI.val("f_line")), payJko: U.toCents(UI.val("f_jko")),
            addons: U.toCents(UI.val("f_add")), source: id ? (DB.byId("salesDaily", id).source || "manual") : "manual"
          };
          const dup = DB.get("salesDaily").find(x => x.date === date && x.id !== id);
          if (dup) { UI.toast("該日期已有營收記錄,請改用編輯", true); return false; }
          if (id) DB.update("salesDaily", id, patch); else DB.insert("salesDaily", patch);
          // 回填預測實際值
          const f = DB.get("forecasts").find(x => x.date === date);
          if (f) DB.update("forecasts", f.id, { actual: covers });
          UI.toast("已儲存營收"); App.refresh();
        }
      });
  },

  /* ---- CSV 匯入(欄位對應可設定 = ImportAdapter) ---- */
  importCSV() {
    UI.modal("匯入肚肚 POS 日報(CSV)", `
      <p class="hint" style="margin-bottom:10px">步驟:選擇 CSV 檔 → 設定欄位對應(系統會記住)→ 預覽 → 匯入。金額單位:元;日期格式 YYYY-MM-DD 或 YYYY/MM/DD。</p>
      <input type="file" id="csvFile" accept=".csv,.txt" onchange="PageSales.readCSV(this)">
      <div id="csvMapBox" style="margin-top:12px"></div>`,
      {
        width: 860, okText: "匯入",
        onOk() { return PageSales.doImport(); }
      });
  },

  readCSV(input) {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const rows = U.parseCSV(reader.result);
      if (rows.length < 2) { UI.toast("CSV 至少需要標題列+一筆資料", true); return; }
      PageSales.csvHeaders = rows[0];
      PageSales.csvRows = rows.slice(1);
      const saved = DB.setting("posCsvMapping") || {};
      const fields = [["date", "日期 *"], ["revenue", "營業額 *"], ["covers", "來客數"], ["cash", "現金"], ["card", "信用卡"], ["line", "LINE Pay"], ["jko", "全支付"], ["addons", "加購金額"]];
      const guess = { date: /日期|date/i, revenue: /營業額|營收|total|amount/i, covers: /來客|人數|covers/i, cash: /現金/i, card: /刷卡|信用/i, line: /line|賴/i, jko: /全支付|jko|街口/i, addons: /加購/i };
      document.getElementById("csvMapBox").innerHTML = `
        <div class="mini-title">欄位對應</div>
        <div class="form-grid">
        ${fields.map(([key, label]) => {
          let sel = saved[key];
          if (sel == null) { const gi = PageSales.csvHeaders.findIndex(h => guess[key] && guess[key].test(h)); sel = gi >= 0 ? gi : ""; }
          return `<div><label class="fl">${label}</label>
            <select id="map_${key}" style="width:100%">
              <option value="">(不匯入)</option>
              ${PageSales.csvHeaders.map((h, i) => `<option value="${i}" ${String(sel) === String(i) ? "selected" : ""}>${U.esc(h)}</option>`).join("")}
            </select></div>`;
        }).join("")}
        </div>
        <div class="mini-title">預覽(前 3 筆)</div>
        ${UI.table(PageSales.csvHeaders.map(h => h || "—"), PageSales.csvRows.slice(0, 3).map(r => `<tr>${r.map(v => `<td>${U.esc(v)}</td>`).join("")}</tr>`))}`;
    };
    reader.readAsText(file, "UTF-8");
  },

  doImport() {
    if (!PageSales.csvRows) { UI.toast("請先選擇 CSV 檔", true); return false; }
    const map = {};
    for (const key of ["date", "revenue", "covers", "cash", "card", "line", "jko", "addons"]) {
      const v = UI.val("map_" + key);
      map[key] = v === "" ? null : parseInt(v);
    }
    if (map.date == null || map.revenue == null) { UI.toast("「日期」與「營業額」為必要欄位", true); return false; }
    DB.setting("posCsvMapping", map);
    let ok = 0, skip = 0, bad = 0;
    for (const row of PageSales.csvRows) {
      const rawDate = (row[map.date] || "").trim().replace(/\//g, "-");
      const m = rawDate.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
      if (!m) { bad++; continue; }
      const date = `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
      const revenue = U.toCents((row[map.revenue] || "0").replace(/[^0-9.\-]/g, ""));
      if (revenue <= 0) { bad++; continue; }
      if (DB.get("salesDaily").find(s => s.date === date)) { skip++; continue; }
      const num = key => map[key] == null ? 0 : U.toCents((row[map[key]] || "0").replace(/[^0-9.\-]/g, ""));
      const covers = map.covers == null ? 0 : parseInt((row[map.covers] || "0").replace(/[^0-9]/g, "")) || 0;
      DB.insert("salesDaily", {
        date, revenue, covers, avgSpend: covers ? Math.round(revenue / covers) : 0,
        payCash: num("cash"), payCard: num("card"), payLine: num("line"), payJko: num("jko"), addons: num("addons"), source: "csv"
      });
      const f = DB.get("forecasts").find(x => x.date === date);
      if (f && covers) DB.update("forecasts", f.id, { actual: covers });
      ok++;
    }
    PageSales.csvRows = null;
    UI.toast(`匯入完成:成功 ${ok} 筆,已存在略過 ${skip} 筆,格式錯誤 ${bad} 筆`, bad > 0);
    App.refresh();
  },

  /* ---- POS 對帳比對:上傳 CSV,逐日比對系統內營收/來客 ---- */
  reconRows: null,

  reconCSV() {
    PageSales.csvRows = null;
    UI.modal("POS 對帳比對(CSV)", `
      <p class="hint" style="margin-bottom:10px">上傳肚肚 POS 日報 CSV,系統逐日比對「POS 金額/來客」與「系統內記錄」,找出差異與缺漏。此功能<b>只比對、不會改資料</b>;確認後可逐筆補入或覆蓋。</p>
      <input type="file" id="csvFile" accept=".csv,.txt" onchange="PageSales.readCSV(this)">
      <div id="csvMapBox" style="margin-top:12px"></div>
      <div id="reconResult" style="margin-top:12px"></div>`,
      { width: 900, okText: "開始比對", onOk() { return PageSales.doRecon(); } });
  },

  doRecon() {
    if (!PageSales.csvRows) { UI.toast("請先選擇 CSV 檔", true); return false; }
    const map = {};
    for (const key of ["date", "revenue", "covers", "cash", "card", "line", "jko", "addons"]) {
      const v = UI.val("map_" + key);
      map[key] = v === "" ? null : parseInt(v);
    }
    if (map.date == null || map.revenue == null) { UI.toast("「日期」與「營業額」為必要欄位", true); return false; }
    DB.setting("posCsvMapping", map);
    const rows = [];
    for (const row of PageSales.csvRows) {
      const rawDate = (row[map.date] || "").trim().replace(/\//g, "-");
      const m = rawDate.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
      if (!m) continue;
      const date = `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
      const revenue = U.toCents((row[map.revenue] || "0").replace(/[^0-9.\-]/g, ""));
      const covers = map.covers == null ? null : parseInt((row[map.covers] || "0").replace(/[^0-9]/g, "")) || 0;
      const erp = DB.get("salesDaily").find(s => s.date === date);
      let status, cls;
      if (!erp) { status = "系統缺此日"; cls = "b-orange"; }
      else if (erp.revenue === revenue && (covers == null || erp.covers === covers)) { status = "相符 ✓"; cls = "b-green"; }
      else { status = "有差異"; cls = "b-red"; }
      rows.push({
        date, posRev: revenue, posCovers: covers,
        erpRev: erp ? erp.revenue : null, erpCovers: erp ? erp.covers : null,
        erpId: erp ? erp.id : null, status, cls,
        raw: { cash: map.cash != null ? U.toCents((row[map.cash] || "0").replace(/[^0-9.\-]/g, "")) : 0,
               card: map.card != null ? U.toCents((row[map.card] || "0").replace(/[^0-9.\-]/g, "")) : 0,
               line: map.line != null ? U.toCents((row[map.line] || "0").replace(/[^0-9.\-]/g, "")) : 0,
               jko: map.jko != null ? U.toCents((row[map.jko] || "0").replace(/[^0-9.\-]/g, "")) : 0,
               addons: map.addons != null ? U.toCents((row[map.addons] || "0").replace(/[^0-9.\-]/g, "")) : 0 }
      });
    }
    if (!rows.length) { UI.toast("CSV 中沒有可辨識的日期資料", true); return false; }
    PageSales.reconRows = U.sortBy(rows, r => r.date);
    PageSales.renderRecon();
    return false; // 停留在視窗顯示結果
  },

  renderRecon() {
    const box = document.getElementById("reconResult");
    if (!box) return;
    const rows = PageSales.reconRows;
    const nDiff = rows.filter(r => r.status === "有差異").length;
    const nMiss = rows.filter(r => r.status === "系統缺此日").length;
    box.innerHTML = `
      <div class="mini-title">比對結果:共 ${rows.length} 天|相符 ${rows.length - nDiff - nMiss}|差異 ${nDiff}|系統缺 ${nMiss}</div>
      ${UI.table(["日期", "#POS 金額", "#系統金額", "#金額差", "#POS 來客", "#系統來客", "狀態", "處理"],
        rows.map((r, idx) => {
          const diff = r.erpRev == null ? null : r.posRev - r.erpRev;
          return `<tr>
            <td>${r.date}</td>
            <td class="num">${U.fmt$(r.posRev)}</td>
            <td class="num">${r.erpRev == null ? "—" : U.fmt$(r.erpRev)}</td>
            <td class="num ${diff ? "t-red" : ""}">${diff == null ? "—" : (diff > 0 ? "+" : "") + U.fmt$(diff).replace("NT$", "")}</td>
            <td class="num">${r.posCovers == null ? "—" : r.posCovers}</td>
            <td class="num">${r.erpCovers == null ? "—" : r.erpCovers}</td>
            <td><span class="badge ${r.cls}">${r.status}</span></td>
            <td>${r.status === "系統缺此日" ? `<button class="btn small primary" onclick="PageSales.applyRecon(${idx},'insert')">補入</button>` :
                 r.status === "有差異" ? `<button class="btn small" onclick="PageSales.applyRecon(${idx},'overwrite')">以POS覆蓋</button>` : ""}</td>
          </tr>`;
        }))}
      ${(nDiff + nMiss) ? `<div style="margin-top:10px"><button class="btn primary" onclick="PageSales.applyRecon(-1,'all')">一鍵處理全部(補入缺漏+以POS覆蓋差異)</button></div>` : ""}`;
  },

  applyRecon(idx, mode) {
    const doOne = r => {
      const covers = r.posCovers || (r.erpCovers || 0);
      const rec = {
        date: r.date, revenue: r.posRev, covers,
        avgSpend: covers ? Math.round(r.posRev / covers) : 0,
        payCash: r.raw.cash, payCard: r.raw.card, payLine: r.raw.line, payJko: r.raw.jko, addons: r.raw.addons, source: "csv"
      };
      if (r.erpId) DB.update("salesDaily", r.erpId, rec);
      else DB.insert("salesDaily", rec);
      const f = DB.get("forecasts").find(x => x.date === r.date);
      if (f && covers) DB.update("forecasts", f.id, { actual: covers });
      r.erpRev = r.posRev; r.erpCovers = covers; r.status = "相符 ✓"; r.cls = "b-green";
      if (!r.erpId) r.erpId = DB.get("salesDaily").find(s => s.date === r.date).id;
    };
    if (mode === "all") {
      let n = 0;
      for (const r of PageSales.reconRows) if (r.status !== "相符 ✓") { doOne(r); n++; }
      UI.toast(`已處理 ${n} 天`);
    } else {
      doOne(PageSales.reconRows[idx]);
      UI.toast(PageSales.reconRows[idx].date + " 已" + (mode === "insert" ? "補入" : "覆蓋"));
    }
    PageSales.renderRecon();
  },

  /* ---- 來客數計算:輸入各客層人數 → 依人頭價方案自動算營收 ---- */
  calc() {
    UI.modal("🧮 來客數 → 營收計算(依人頭價方案)", `
      <div class="form-grid">
        <div><label class="fl">日期</label><input id="cal_date" type="date" value="${U.today()}" onchange="PageSales.calcInputs()" style="width:100%"></div>
        <div><label class="fl">加購金額(元,飲料/酒水等)</label><input id="cal_addon" type="number" step="any" value="0" oninput="PageSales.calcUpdate()" style="width:100%"></div>
        <div><label class="fl">實際營業額(元,選填 → 比對差異)</label><input id="cal_actual" type="number" step="any" oninput="PageSales.calcUpdate()" style="width:100%"></div>
      </div>
      <div class="mini-title">各客層人數(依「人頭價方案」主檔自動列出)</div>
      <div id="calPlans"></div>
      <div id="calOut" style="margin-top:12px"></div>`,
      {
        width: 720, okText: "存為當日營收",
        onOk() {
          const r = PageSales.calcCompute();
          if (!r || r.covers <= 0) { UI.toast("請至少輸入一個客層人數", true); return false; }
          const date = UI.val("cal_date") || U.today();
          const revenue = r.actual > 0 ? r.actual : r.total;
          const rec = { date, revenue, covers: r.covers, avgSpend: Math.round(revenue / r.covers), addons: r.addon, source: "calc" };
          const dup = DB.get("salesDaily").find(x => x.date === date);
          if (dup) DB.update("salesDaily", dup.id, rec); else DB.insert("salesDaily", rec);
          const f = DB.get("forecasts").find(x => x.date === date);
          if (f) DB.update("forecasts", f.id, { actual: r.covers });
          UI.toast(`已存 ${date} 營收 ${U.fmt$(revenue)}(${r.covers} 位)`);
          App.refresh();
        }
      });
    PageSales.calcInputs();
  },

  calcActivePlans() {
    const date = UI.val("cal_date") || U.today();
    const dayType = U.isWeekend(date) ? "假日" : "平日";
    return DB.get("pricePlans").filter(p => p.active && (p.dayType === "全時段" || p.dayType === dayType));
  },

  calcInputs() {
    const box = document.getElementById("calPlans");
    if (!box) return;
    const date = UI.val("cal_date") || U.today();
    const plans = PageSales.calcActivePlans();
    box.innerHTML = `<p class="hint" style="margin-bottom:8px">${date}(週${U.weekdayName(date)})判定為 <b>${U.isWeekend(date) ? "假日" : "平日"}</b>,適用以下方案:</p>` +
      (plans.length ? plans.map(p => `
      <div style="display:flex;gap:10px;align-items:center;margin-bottom:6px">
        <span style="flex:1">${U.esc(p.name)} <span class="t-muted">(${U.fmt$(p.price)}/位)</span></span>
        <input id="cal_n_${p.id}" type="number" min="0" placeholder="0" style="width:100px" oninput="PageSales.calcUpdate()"> 位
      </div>`).join("") : `<div class="alert warn">沒有適用的人頭價方案,請先到「主檔 → 人頭價方案」建立。</div>`);
    PageSales.calcUpdate();
  },

  calcCompute() {
    const plans = PageSales.calcActivePlans();
    let covers = 0, total = 0;
    for (const p of plans) {
      const n = UI.num("cal_n_" + p.id);
      covers += n; total += n * p.price;
    }
    const addon = U.toCents(UI.val("cal_addon"));
    total += addon;
    const actual = U.toCents(UI.val("cal_actual"));
    return { covers, total, addon, actual };
  },

  calcUpdate() {
    const out = document.getElementById("calOut");
    if (!out) return;
    const r = PageSales.calcCompute();
    let cmp = "";
    if (r.actual > 0) {
      const diff = r.actual - r.total;
      cmp = `<tr><td>實際營業額</td><td class="num">${U.fmt$(r.actual)}</td></tr>
        <tr><td>差異(實際 − 理論)</td><td class="num ${Math.abs(diff) > 100 ? "t-red" : "t-green"}"><b>${diff > 0 ? "+" : ""}${U.fmt$(diff)}</b>${r.total ? "(" + U.pct(diff / r.total) + ")" : ""}</td></tr>`;
    }
    out.innerHTML = UI.table(["計算結果", "#金額"], [
      `<tr><td>總來客數</td><td class="num"><b>${r.covers} 位</b></td></tr>`,
      `<tr><td>理論營業額(人頭價×人數+加購)</td><td class="num"><b>${U.fmt$(r.total)}</b></td></tr>`,
      `<tr><td>理論客單價</td><td class="num">${r.covers ? U.fmt$(Math.round(r.total / r.covers)) : "—"}</td></tr>`,
      cmp
    ].filter(Boolean));
  }
};

/* ---------------- 來客預測 ---------------- */
const PageForecast = {
  render(c) {
    // 未來 7 天預測
    const future = [];
    for (let d = 0; d <= 7; d++) {
      const date = U.addDays(U.today(), d);
      future.push({ date, fc: Domain.forecastCovers(date) });
    }
    const acc = Domain.forecastAccuracy(30);
    const mape = acc.length ? U.sum(acc.filter(a => a.err != null), a => Math.abs(a.err)) / acc.filter(a => a.err != null).length : null;

    c.innerHTML = `
    <div class="alert info">💡 MVP 規則:預測 = 近 ${DB.setting("forecastBaseWeeks")} 週「同星期」平均來客,與現有訂位人數取較大值。預測驅動備料工單與採購建議(閉環起點)。</div>
    <div class="kpi-row">
      <div class="kpi"><div class="k-label">明日預測來客</div><div class="k-value">${future[1].fc.predicted} 位</div>
        <div class="k-note">訂位 ${future[1].fc.reservations} 位</div></div>
      <div class="kpi ${mape != null && mape < 0.15 ? "good" : "warn"}"><div class="k-label">近30天平均誤差(MAPE)</div>
        <div class="k-value">${mape == null ? "—" : U.pct(mape)}</div><div class="k-note">越低表示備料越準</div></div>
    </div>
    <div class="card">
      <h3>🔮 未來 7 天來客預測</h3>
      ${UI.table(["日期", "星期", "#同星期均值", "#現有訂位", "#預測來客 ★", "備料"],
        future.map(f => `<tr>
          <td>${f.date}</td>
          <td>${U.isWeekend(f.date) ? `<span class="badge b-red">週${U.weekdayName(f.date)}</span>` : "週" + U.weekdayName(f.date)}</td>
          <td class="num">${f.fc.base}</td>
          <td class="num">${f.fc.reservations}</td>
          <td class="num"><b style="font-size:15px">${f.fc.predicted}</b></td>
          <td><button class="btn small" onclick="PageProd.date='${f.date}';App.go('pr_mo')">→ 產生備料</button></td>
        </tr>`))}
    </div>
    <div class="card">
      <h3>🎯 預測 vs 實際(近 30 天)</h3>
      ${Chart.line({
        width: 900, height: 230,
        series: [
          { name: "預測", color: "#1f5fa8", data: acc.map(a => ({ x: U.mdLabel(a.date), y: a.predicted })) },
          { name: "實際", color: "#c62f2f", data: acc.map(a => ({ x: U.mdLabel(a.date), y: a.actual })) }
        ]
      })}
    </div>`;
  }
};

/* ---------------- 訂位管理 ---------------- */
const PageResv = {
  filterDate: null,

  render(c) {
    const date = PageResv.filterDate || U.today();
    PageResv.filterDate = date;
    const list = U.sortBy(DB.get("reservations").filter(r => r.date === date), r => r.time);
    const totalPax = U.sum(list.filter(r => r.status !== "取消"), r => r.partySize);
    const gasUrl = DB.setting("gasReservationUrl");
    const recent = DB.get("reservations").filter(r => r.date >= U.addDays(U.today(), -30) && r.date < U.today());
    const noshow = recent.filter(r => r.status === "No-show").length;

    c.innerHTML = `
    <div class="toolbar">
      <label class="fl" style="margin:0">日期:</label>
      <input type="date" value="${date}" onchange="PageResv.filterDate=this.value;App.refresh()">
      <span class="badge b-blue">${date} 共 ${totalPax} 位</span>
      <div class="spacer"></div>
      <button class="btn" onclick="PageResv.sync()" ${gasUrl ? "" : "title='請先到 設定 填入自有預約系統(GAS)端點'"}>🔄 同步自有預約系統</button>
      <button class="btn primary" onclick="PageResv.edit()">＋ 新增訂位</button>
    </div>
    ${!gasUrl ? `<div class="alert warn">尚未設定自有預約系統(GAS)端點 — 可到「設定/備份」填入 Web App URL 後一鍵同步;目前可手動輸入或由預約系統匯出後補登。</div>` : ""}
    <div class="kpi-row">
      <div class="kpi"><div class="k-label">近 30 天 No-show</div><div class="k-value">${noshow} 組</div>
        <div class="k-note">No-show 率 ${recent.length ? U.pct(noshow / recent.length) : "—"}</div></div>
      <div class="kpi"><div class="k-label">今日訂位</div><div class="k-value">${U.sum(DB.get("reservations").filter(r => r.date === U.today() && r.status !== "取消"), r => r.partySize)} 位</div></div>
    </div>
    <div class="card">
      <h3>📅 ${date}(週${U.weekdayName(date)})訂位清單</h3>
      ${UI.table(["時間", "姓名", "電話", "#人數", "狀態", "備註", "操作"],
        list.map(r => {
          const st = { "已預約": "b-blue", "已到": "b-green", "No-show": "b-red", "取消": "b-gray" }[r.status] || "b-gray";
          return `<tr>
            <td><b>${U.esc(r.time || "")}</b></td><td>${U.esc(r.name)}</td><td class="mono">${U.esc(r.phone || "")}</td>
            <td class="num">${r.partySize}</td>
            <td><span class="badge ${st}">${r.status}</span></td>
            <td class="t-muted">${U.esc(r.note || "")}</td>
            <td>
              ${r.status === "已預約" ? `<button class="btn small" onclick="DB.update('reservations','${r.id}',{status:'已到'});App.refresh()">報到</button>
                <button class="btn small" onclick="DB.update('reservations','${r.id}',{status:'No-show'});App.refresh()">No-show</button>` : ""}
              <button class="btn small" onclick="PageResv.edit('${r.id}')">編輯</button>
            </td></tr>`;
        }), "此日期尚無訂位")}
    </div>`;
  },

  edit(id) {
    const r = id ? DB.byId("reservations", id) : { date: PageResv.filterDate || U.today(), time: "18:00", partySize: 2, status: "已預約" };
    UI.modal(id ? "編輯訂位" : "新增訂位", `
      <div class="form-grid">
        <div><label class="fl">日期 *</label><input id="f_date" type="date" value="${r.date}" style="width:100%"></div>
        <div><label class="fl">時間</label><input id="f_time" type="time" value="${r.time || ""}" style="width:100%"></div>
        <div><label class="fl">姓名 *</label><input id="f_name" value="${U.esc(r.name || "")}" style="width:100%"></div>
        <div><label class="fl">電話</label><input id="f_phone" value="${U.esc(r.phone || "")}" style="width:100%"></div>
        <div><label class="fl">人數 *</label><input id="f_pax" type="number" value="${r.partySize}" style="width:100%"></div>
        <div><label class="fl">狀態</label><select id="f_status" style="width:100%">${["已預約", "已到", "No-show", "取消"].map(x => `<option ${x === r.status ? "selected" : ""}>${x}</option>`).join("")}</select></div>
        <div class="full"><label class="fl">備註</label><input id="f_note" value="${U.esc(r.note || "")}" style="width:100%"></div>
      </div>`,
      {
        onOk() {
          const name = UI.val("f_name"), pax = UI.num("f_pax");
          if (!name || pax <= 0) { UI.toast("請輸入姓名與人數", true); return false; }
          const patch = { date: UI.val("f_date"), time: UI.val("f_time"), name, phone: UI.val("f_phone"), partySize: pax, status: UI.val("f_status"), note: UI.val("f_note") };
          if (id) DB.update("reservations", id, patch); else DB.insert("reservations", patch);
          UI.toast("已儲存訂位"); App.refresh();
        }
      });
  },

  /* 自有預約系統(GAS)同步:GET {url}?action=listReservations
     期望回傳 JSON 陣列,欄位:date/time/name/phone/partySize(或 people)/status/note */
  async sync() {
    const url = DB.setting("gasReservationUrl");
    if (!url) { App.go("sys_set"); UI.toast("請先在設定頁填入 GAS 端點 URL", true); return; }
    UI.toast("同步中…");
    try {
      const res = await fetch(url + (url.includes("?") ? "&" : "?") + "action=listReservations");
      const data = await res.json();
      const list = Array.isArray(data) ? data : (data.reservations || data.data || []);
      if (!Array.isArray(list)) throw new Error("回傳格式非陣列");
      let ok = 0, skip = 0;
      for (const r of list) {
        const date = String(r.date || "").slice(0, 10).replace(/\//g, "-");
        const pax = parseInt(r.partySize || r.people || r.pax || 0) || 0;
        if (!date || !pax) continue;
        const dup = DB.get("reservations").find(x => x.date === date && x.name === (r.name || "") && x.time === (r.time || ""));
        if (dup) { skip++; continue; }
        DB.insert("reservations", {
          date, time: r.time || "", name: r.name || "(未填)", phone: r.phone || "",
          partySize: pax, status: r.status || "已預約", note: r.note || "", source: "gas"
        });
        ok++;
      }
      UI.toast(`同步完成:新增 ${ok} 筆,略過重複 ${skip} 筆`);
      App.refresh();
    } catch (e) {
      console.error(e);
      UI.toast("同步失敗:" + e.message + "(請確認 GAS 已部署為「任何人可存取」並支援 action=listReservations)", true);
    }
  }
};

App.register("sd_sales", "銷售 — 每日營收(POS 匯入)", PageSales.render);
App.register("sd_fc", "銷售 — 來客預測(閉環起點)", PageForecast.render);
App.register("sd_resv", "銷售 — 訂位管理", PageResv.render);
