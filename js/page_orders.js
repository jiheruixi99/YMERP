/* ===== page_orders.js — 點餐明細匯入(精準理論消耗,取代人均估算) =====
   流程:上傳 POS「點餐明細(分析)」CSV → 逐列比對「菜單品名對照表」→
   有對到配方的列 × 數量 → 展開 BOM → 當天 FEFO 領用(取代估算的理論消耗)。
   同名品項可能因份量不同(200克/300克)有兩筆對照,靠「商品單價」自動分辨。 */
"use strict";

const PageOrders = {
  csvRows: null, csvHeaders: null,
  applyDate: null,

  render(c) {
    const dates = [...new Set(DB.get("posOrderItems").map(it => it.date))].sort().reverse();
    const unmatchedNames = [...new Set(
      DB.get("posOrderItems").filter(it => !it.matchedRecipeId).map(it => it.productName)
    )];
    const applied = new Set(DB.get("stockMovements").filter(m => m.refType === "點餐明細").map(m => m.refId));

    c.innerHTML = `
    <div class="alert info">💡 每天營業結束,把 POS「點餐明細(分析)」匯出的 CSV 匯入這裡。系統依「商品名稱」比對下方的<b>菜單對照表</b>,自動展開成原物料消耗,<b>取代</b>備料工單頁的人均估算(當天有明細資料時優先用這個)。</div>

    <div class="toolbar">
      <button class="btn primary" onclick="PageOrders.importCSV()">📥 匯入點餐明細 CSV</button>
      <button class="btn" onclick="PageOrders.editMap()">＋ 新增菜單對照</button>
      ${unmatchedNames.length ? `<span class="badge b-orange">${unmatchedNames.length} 個品名尚未對應</span>` : ""}
    </div>

    ${unmatchedNames.length ? `<div class="card">
      <h3>⚠️ 尚未對應到配方的品名</h3>
      ${UI.table(["商品名稱", "#出現次數", "操作"],
        unmatchedNames.map(name => {
          const n = DB.get("posOrderItems").filter(it => it.productName === name).length;
          return `<tr><td>${U.esc(name)}</td><td class="num">${n}</td>
            <td><button class="btn small primary" onclick="PageOrders.editMap(null,'${U.esc(name).replace(/'/g, "\\'")}')">建立對照</button></td></tr>`;
        }), "")}
      <p class="hint">套餐容器列本身(如「超值雙人餐」)通常對不到配方是正常的 — 它底下拆出的組成品項(五花肉、湯底…)才需要對應。</p>
    </div>` : ""}

    <div class="card">
      <h3>📅 已匯入的日期</h3>
      ${UI.table(["日期", "#明細筆數", "#已對應", "理論消耗", "操作"],
        dates.map(d => {
          const items = DB.get("posOrderItems").filter(it => it.date === d);
          const matched = items.filter(it => it.matchedRecipeId).length;
          return `<tr><td>${d}</td>
            <td class="num">${items.length}</td>
            <td class="num">${matched}/${items.length}</td>
            <td>${applied.has(d) ? '<span class="badge b-green">已套用</span>' : '<span class="badge b-gray">尚未套用</span>'}</td>
            <td><button class="btn small primary" onclick="PageOrders.apply('${d}')">套用/重算理論消耗</button>
                <button class="btn small" onclick="PageOrders.viewDate('${d}')">明細</button></td></tr>`;
        }), "尚無匯入記錄")}
    </div>

    <div class="card">
      <h3>🍽️ 菜單品名 → 配方 對照表</h3>
      ${UI.table(["商品名稱", "配方", "#比對單價", "點餐來源比對", "備註", "操作"],
        DB.get("menuMap").map(m => `<tr>
          <td><b>${U.esc(m.productName)}</b></td>
          <td>${U.esc(UI.recipeName(m.recipeId))}</td>
          <td class="num">${m.priceMatch != null ? U.fmt$(m.priceMatch) : "—"}</td>
          <td>${m.sourceMatch ? `<span class="badge b-blue">${U.esc(m.sourceMatch)}</span>` : "—"}</td>
          <td class="t-muted">${U.esc(m.note || "")}</td>
          <td><button class="btn small" onclick="PageOrders.editMap('${m.id}')">編輯</button>
              <button class="btn small ghost-red" onclick="PageOrders.delMap('${m.id}')">刪除</button></td></tr>`),
        "尚無對照,點上方「＋ 新增菜單對照」開始建檔")}
      <p class="hint">同一個商品名稱可以建多筆(不同份量對不同配方),系統依序用「點餐來源文字」→「商品單價」自動分辨。</p>
    </div>`;
  },

  /* ---- 菜單對照表 ---- */
  editMap(id, presetName) {
    const m = id ? DB.byId("menuMap", id) : { productName: presetName || "" };
    UI.modal(id ? "編輯菜單對照" : "新增菜單對照", `
      <div class="form-grid">
        <div class="full"><label class="fl">POS 商品名稱 *(需與匯入資料的「商品名稱」欄完全一致)</label>
          <input id="mm_name" value="${U.esc(m.productName || "")}" style="width:100%"></div>
        <div class="full"><label class="fl">對應配方 *</label>
          <select id="mm_rcp" style="width:100%">${UI.recipeOptions(m.recipeId)}</select></div>
        <div><label class="fl">比對單價(元,同名多份量時用來分辨,選填)</label>
          <input id="mm_price" type="number" step="any" value="${m.priceMatch != null ? m.priceMatch / 100 : ""}" style="width:100%"></div>
        <div><label class="fl">比對點餐來源(文字,選填)</label>
          <input id="mm_src" value="${U.esc(m.sourceMatch || "")}" placeholder="例:雙人 / 4人" style="width:100%"></div>
        <div class="full"><label class="fl">備註</label><input id="mm_note" value="${U.esc(m.note || "")}" style="width:100%"></div>
      </div>
      <p class="hint">同名品項份量不同時的分辨優先順序:①點餐來源文字比對(如「雙人」/「4人」)→ ②單價比對。兩邊都是 0 元又同名時,務必填「比對點餐來源」,否則系統會標為未對應(不會亂猜成本)。</p>`,
      {
        onOk() {
          const name = UI.val("mm_name"), rcpId = UI.val("mm_rcp");
          if (!name || !rcpId) { UI.toast("請填商品名稱並選配方", true); return false; }
          const patch = {
            productName: name, recipeId: rcpId,
            priceMatch: UI.val("mm_price") === "" ? null : U.toCents(UI.val("mm_price")),
            sourceMatch: UI.val("mm_src") || null,
            note: UI.val("mm_note")
          };
          if (id) DB.update("menuMap", id, patch); else DB.insert("menuMap", patch);
          const n = Domain.rematchOrderItems();
          UI.toast(`對照已儲存,已重新比對明細(${n} 筆現已對應)`);
          App.refresh();
        }
      });
  },

  delMap(id) {
    UI.confirm("確定刪除此對照?已匯入明細會變成未對應。", () => {
      DB.remove("menuMap", id); Domain.rematchOrderItems(); App.refresh();
    });
  },

  /* ---- 套用理論消耗 ---- */
  apply(date) {
    UI.confirm(`套用 ${date} 的點餐明細理論消耗?會扣庫存(FEFO 領用)。重複套用會先回沖再重算,不會重複扣。`, () => {
      const r = Domain.applyOrderConsumption(date);
      UI.toast(`已套用:${r.orders} 筆訂單項目 → ${r.ingredients} 項原物料扣庫存`);
      App.refresh();
    });
  },

  viewDate(date) {
    const items = U.sortBy(DB.get("posOrderItems").filter(it => it.date === date), it => it.invoiceNo);
    UI.modal("點餐明細 — " + date, UI.table(["發票號碼", "商品名稱", "點餐來源", "#數量", "#單價", "對應配方"],
      items.map(it => `<tr>
        <td class="mono">${U.esc(it.invoiceNo)}</td>
        <td>${U.esc(it.productName)}</td>
        <td class="t-muted">${U.esc(it.source || "")}</td>
        <td class="num">${it.qty}</td>
        <td class="num">${U.fmt$(it.unitPrice)}</td>
        <td>${it.matchedRecipeId ? U.esc(UI.recipeName(it.matchedRecipeId)) : '<span class="t-muted">未對應</span>'}</td>
      </tr>`)), { width: 860, hideOk: true });
  },

  /* ---- CSV 匯入 ---- */
  importCSV() {
    PageOrders.csvRows = null;
    UI.modal("匯入點餐明細(分析)CSV", `
      <p class="hint" style="margin-bottom:10px">從 POS 匯出「點餐明細(分析)」報表存成 CSV 後上傳。系統會記住欄位對應。</p>
      <input type="file" id="oi_file" accept=".csv,.txt" onchange="PageOrders.readCSV(this)">
      <div id="oi_mapBox" style="margin-top:12px"></div>`,
      { width: 860, okText: "匯入", onOk() { return PageOrders.doImport(); } });
  },

  readCSV(input) {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const rows = U.parseCSV(reader.result);
      if (rows.length < 2) { UI.toast("CSV 至少需要標題列+一筆資料", true); return; }
      PageOrders.csvHeaders = rows[0];
      PageOrders.csvRows = rows.slice(1);
      const saved = DB.setting("orderCsvMapping") || {};
      const fields = [["date", "建立日期 *"], ["invoice", "發票號碼(或交易序號)"], ["name", "商品名稱 *"], ["source", "點餐來源(分辨同名不同份量用)"], ["qty", "數量 *"], ["price", "商品單價"]];
      const guess = { date: /建立日期|日期/i, invoice: /發票號碼|交易序號/i, name: /商品名稱/i, source: /點餐來源/i, qty: /^數量$/i, price: /商品單價|單價/i };
      document.getElementById("oi_mapBox").innerHTML = `
        <div class="mini-title">欄位對應</div>
        <div class="form-grid">
        ${fields.map(([key, label]) => {
          let sel = saved[key];
          if (sel == null) { const gi = PageOrders.csvHeaders.findIndex(h => guess[key] && guess[key].test(h)); sel = gi >= 0 ? gi : ""; }
          return `<div><label class="fl">${label}</label>
            <select id="oimap_${key}" style="width:100%">
              <option value="">(不匯入)</option>
              ${PageOrders.csvHeaders.map((h, i) => `<option value="${i}" ${String(sel) === String(i) ? "selected" : ""}>${U.esc(h)}</option>`).join("")}
            </select></div>`;
        }).join("")}
        </div>
        <div class="mini-title">預覽(前 3 筆,共 ${PageOrders.csvRows.length} 筆)</div>
        ${UI.table(PageOrders.csvHeaders.map(h => h || "—"), PageOrders.csvRows.slice(0, 3).map(r => `<tr>${r.map(v => `<td>${U.esc(v)}</td>`).join("")}</tr>`))}`;
    };
    reader.readAsText(file, "UTF-8");
  },

  doImport() {
    if (!PageOrders.csvRows) { UI.toast("請先選擇 CSV 檔", true); return false; }
    const map = {};
    for (const key of ["date", "invoice", "name", "source", "qty", "price"]) {
      const v = UI.val("oimap_" + key);
      map[key] = v === "" ? null : parseInt(v);
    }
    if (map.date == null || map.name == null || map.qty == null) { UI.toast("「建立日期」「商品名稱」「數量」為必要欄位", true); return false; }
    DB.setting("orderCsvMapping", map);
    const rows = [];
    let bad = 0;
    for (const row of PageOrders.csvRows) {
      const rawDate = (row[map.date] || "").trim().replace(/\//g, "-");
      const m = rawDate.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
      if (!m) { bad++; continue; }
      const date = `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
      const productName = (row[map.name] || "").trim();
      const qty = parseFloat((row[map.qty] || "0").replace(/[^0-9.\-]/g, "")) || 0;
      if (!productName || qty <= 0) { bad++; continue; }
      rows.push({
        date, productName, qty,
        invoiceNo: map.invoice != null ? (row[map.invoice] || "").trim() : "",
        source: map.source != null ? (row[map.source] || "").trim() : "",
        unitPrice: map.price != null ? U.toCents((row[map.price] || "0").replace(/[^0-9.\-]/g, "")) : 0
      });
    }
    if (!rows.length) { UI.toast("沒有可匯入的資料列", true); return false; }
    const r = Domain.importOrderItems(rows);
    PageOrders.csvRows = null;
    UI.toast(`匯入完成:新增 ${r.added} 筆,重複略過 ${r.skipped} 筆${bad ? `,格式錯誤 ${bad} 筆` : ""}`);
    App.refresh();
  }
};

App.register("pr_orders", "生產 — 點餐明細(精準理論消耗)", PageOrders.render);
