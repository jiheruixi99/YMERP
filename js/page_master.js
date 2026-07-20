/* ===== page_master.js — 主檔:食材/供應商/配方/價方案 ===== */
"use strict";

const CATS = ["生鮮蔬菜", "肉品", "海鮮", "菇菌", "豆製品", "火鍋料", "湯底料", "醬料原料", "飲料甜品", "包材耗材"];
const STORAGES = ["常溫", "冷藏", "冷凍"];
// 常見計價單位 → 1計價單位等於多少「克」(供重量類食材快速換算;非重量填 0=不換算)
const UNIT_TO_GRAM = { "公斤": 1000, "斤": 600, "台斤": 600, "克": 1, "公克": 1 };

/* ---------------- 食材品項 ---------------- */
const PageIng = {
  filterCat: "",
  kw: "",

  render(c) {
    let list = DB.get("ingredients");
    if (PageIng.filterCat) list = list.filter(i => i.category === PageIng.filterCat);
    if (PageIng.kw) list = list.filter(i => i.name.includes(PageIng.kw));
    c.innerHTML = `
    <div class="toolbar">
      <select onchange="PageIng.filterCat=this.value;App.refresh()">
        <option value="">全部分類</option>
        ${CATS.map(x => `<option ${x === PageIng.filterCat ? "selected" : ""}>${x}</option>`).join("")}
      </select>
      <input placeholder="搜尋品名…" value="${U.esc(PageIng.kw)}" oninput="PageIng.kw=this.value" onchange="App.refresh()">
      <div class="spacer"></div>
      <button class="btn primary" onclick="PageIng.edit()">＋ 新增食材</button>
    </div>
    <div class="alert info">💡 這裡是「食材主檔」— 定義每個品項的<b>計價單位</b>與<b>配方單位換算</b>(給 BOM 算成本用)。若你都從「報價建檔」新增品項,這頁只需偶爾來調整換算。</div>
    <div class="card">
    ${UI.table(["品名", "分類", "保存", "計價單位", "配方換算", "#現有庫存", "#最新單價", "季節", "操作"],
      list.map(i => {
        const qty = Domain.stockQty(i.id);
        const price = Domain.currentPrice(i.id);
        return `<tr>
          <td><b>${U.esc(i.name)}</b></td>
          <td><span class="badge b-gray">${U.esc(i.category)}</span></td>
          <td>${U.esc(i.storage)}</td>
          <td>${U.esc(i.stockUnit)}</td>
          <td class="t-muted">1${U.esc(i.stockUnit)} = ${U.fmtNum(i.stockToUse)}${U.esc(i.useUnit)}</td>
          <td class="num ${qty < i.safetyStock ? "t-red" : ""}">${U.fmtNum(qty)} ${U.esc(i.stockUnit)}</td>
          <td class="num">${price ? U.fmt$(price, 1) + "/" + U.esc(i.stockUnit) : "—"}</td>
          <td>${i.seasonal ? '<span class="badge b-blue">季節性</span>' : ""}</td>
          <td><button class="btn small" onclick="PageIng.edit('${i.id}')">編輯</button>
              <button class="btn small ghost-red" onclick="PageIng.del('${i.id}')">刪除</button></td>
        </tr>`;
      }))}
    </div>`;
  },

  edit(id, opts) {
    opts = opts || {};
    const i = id ? DB.byId("ingredients", id) : {
      category: "生鮮蔬菜", storage: "冷藏", stockUnit: "公斤", useUnit: "克",
      stockToUse: 1000, shelfLifeDays: 5, seasonal: false, safetyStock: 0, basePrice: 0
    };
    UI.modal(id ? "編輯食材:" + i.name : "新增食材", `
      <div class="form-grid">
        <div><label class="fl">品名 *</label><input id="f_name" value="${U.esc(i.name || "")}" style="width:100%"></div>
        <div><label class="fl">分類</label><select id="f_cat" style="width:100%">${CATS.map(x => `<option ${x === i.category ? "selected" : ""}>${x}</option>`).join("")}</select></div>
        <div><label class="fl">保存條件</label><select id="f_sto" style="width:100%">${STORAGES.map(x => `<option ${x === i.storage ? "selected" : ""}>${x}</option>`).join("")}</select></div>
      </div>
      <div class="mini-title">💰 計價 — 你怎麼買、怎麼算錢</div>
      <div class="form-grid">
        <div><label class="fl">計價單位</label>
          <input id="f_su" value="${U.esc(i.stockUnit)}" list="f_units" style="width:100%" onchange="PageIng.autoConv()">
          <datalist id="f_units"><option>公斤</option><option>斤</option><option>克</option><option>包</option><option>箱</option><option>桶</option><option>罐</option><option>瓶</option><option>盒</option></datalist></div>
        <div><label class="fl">參考單價(元 / 計價單位)</label><input id="f_price" type="number" step="any" value="${(i.basePrice || 0) / 100}" style="width:100%"></div>
        <div><label class="fl">安全庫存(計價單位)</label><input id="f_safe" type="number" step="any" value="${i.safetyStock}" style="width:100%"></div>
      </div>
      <div class="mini-title">🍲 配方換算 — 做菜(BOM)怎麼算用量</div>
      <div class="form-grid">
        <div><label class="fl">配方單位</label>
          <input id="f_uu" value="${U.esc(i.useUnit)}" list="f_useunits" style="width:100%">
          <datalist id="f_useunits"><option>克</option><option>份</option><option>杯</option><option>包</option></datalist></div>
        <div><label class="fl">1 計價單位 = ? 配方單位</label><input id="f_s2u" type="number" step="any" value="${i.stockToUse}" style="width:100%"></div>
      </div>
      <p class="hint" id="f_convhint"></p>
      <div class="mini-title">其他</div>
      <div class="form-grid">
        <div><label class="fl">效期天數</label><input id="f_life" type="number" value="${i.shelfLifeDays}" style="width:100%"></div>
        <div><label class="fl">預設供應商</label><select id="f_sup" style="width:100%">${UI.supOptions(i.defaultSupplierId || opts.supplierId)}</select></div>
        <div><label class="fl">季節性(菜價浮動大)</label><label style="display:flex;align-items:center;gap:6px;padding:7px 0"><input type="checkbox" id="f_season" ${i.seasonal ? "checked" : ""}> 價格隨季節波動</label></div>
      </div>`,
      {
        width: 720,
        onOk() {
          const name = UI.val("f_name");
          if (!name) { UI.toast("請輸入品名", true); return false; }
          const su = UI.val("f_su") || "計價單位";
          const patch = {
            name, category: UI.val("f_cat"), storage: UI.val("f_sto"),
            purchaseUnit: su, stockUnit: su, useUnit: UI.val("f_uu") || "克",
            purToStock: 1, stockToUse: UI.num("f_s2u") || 1,
            shelfLifeDays: UI.num("f_life") || 5, safetyStock: UI.num("f_safe"),
            basePrice: U.toCents(UI.val("f_price")), defaultSupplierId: UI.val("f_sup"),
            seasonal: UI.checked("f_season"), active: true
          };
          let ing;
          if (id) ing = DB.update("ingredients", id, patch);
          else ing = DB.insert("ingredients", patch);
          UI.toast("已儲存食材");
          // 延後開啟後續視窗,避免被外層 closeModal 立刻關掉
          if (opts.onDone) setTimeout(() => opts.onDone(ing), 0); else App.refresh();
        }
      });
    PageIng.autoConv();
  },

  // 選了公斤/斤等重量單位 → 自動填「1計價單位=?克」的換算 + 顯示範例
  autoConv() {
    const su = UI.val("f_su");
    const el = document.getElementById("f_convhint");
    const conv = document.getElementById("f_s2u");
    if (UNIT_TO_GRAM[su] && document.getElementById("f_uu")) {
      document.getElementById("f_uu").value = "克";
      if (conv && (!conv.value || conv.value === "1" || conv.value === "600" || conv.value === "1000"))
        conv.value = UNIT_TO_GRAM[su];
    }
    if (el) el.innerHTML = `範例:牛培根 計價單位「公斤」、單價 400、來 11.5 公斤就進 11.5;配方用「克」→ 1公斤=1000克,BOM 填 200 克即算 NT$80。<b>斤=600克、公斤=1000克</b>(菜品可註記在備註)。`;
  },

  del(id) {
    UI.confirm("確定刪除此食材?相關歷史記錄將保留但無法對應品名。", () => {
      DB.remove("ingredients", id); UI.toast("已刪除"); App.refresh();
    });
  }
};
App.register("m_ing", "主檔 — 食材品項", PageIng.render);

/* ---------------- 供應商 ---------------- */
const PageSup = {
  render(c) {
    c.innerHTML = `
    <div class="toolbar"><div class="spacer"></div>
      <button class="btn primary" onclick="PageSup.edit()">＋ 新增供應商</button></div>
    <div class="card">
    ${UI.table(["供應商", "聯絡人", "電話", "付款條件", "#供應品項數", "#近90天採購額", "#評級", "操作"],
      DB.get("suppliers").map(s => {
        const itemCount = new Set(DB.get("supplierPrices").filter(p => p.supplierId === s.id).map(p => p.ingredientId)).size;
        const from = U.addDays(U.today(), -90);
        const buyAmt = U.sum(DB.get("priceHistory").filter(p => p.supplierId === s.id && p.date >= from), p => 0); // 金額以進貨單為準,此處以次數呈現
        const buys = DB.get("priceHistory").filter(p => p.supplierId === s.id && p.date >= from).length;
        return `<tr>
          <td><b>${U.esc(s.name)}</b></td><td>${U.esc(s.contact || "")}</td><td>${U.esc(s.phone || "")}</td>
          <td>${U.esc(s.payTerms || "")}</td>
          <td class="num">${itemCount}</td>
          <td class="num">${buys} 次進貨</td>
          <td class="num">${s.rating ? "★" + s.rating : "—"}</td>
          <td><button class="btn small" onclick="PageSup.edit('${s.id}')">編輯</button>
              <button class="btn small ghost-red" onclick="PageSup.del('${s.id}')">刪除</button></td></tr>`;
      }))}
    </div>`;
  },
  edit(id) {
    const s = id ? DB.byId("suppliers", id) : { rating: 4 };
    UI.modal(id ? "編輯供應商" : "新增供應商", `
      <div class="form-grid">
        <div><label class="fl">名稱 *</label><input id="f_name" value="${U.esc(s.name || "")}" style="width:100%"></div>
        <div><label class="fl">聯絡人</label><input id="f_contact" value="${U.esc(s.contact || "")}" style="width:100%"></div>
        <div><label class="fl">電話</label><input id="f_phone" value="${U.esc(s.phone || "")}" style="width:100%"></div>
        <div><label class="fl">付款條件</label>
          <select id="f_terms" style="width:100%">${["月結30天", "月結60天", "貨到付款", "週結"].map(x => `<option ${x === s.payTerms ? "selected" : ""}>${x}</option>`).join("")}</select></div>
        <div><label class="fl">評級(1~5)</label><input id="f_rating" type="number" min="1" max="5" step="0.1" value="${s.rating || 4}" style="width:100%"></div>
        <div class="full"><label class="fl">備註</label><input id="f_note" value="${U.esc(s.note || "")}" style="width:100%"></div>
      </div>`,
      {
        onOk() {
          const name = UI.val("f_name");
          if (!name) { UI.toast("請輸入名稱", true); return false; }
          const patch = { name, contact: UI.val("f_contact"), phone: UI.val("f_phone"), payTerms: UI.val("f_terms"), rating: UI.num("f_rating"), note: UI.val("f_note") };
          if (id) DB.update("suppliers", id, patch); else DB.insert("suppliers", patch);
          UI.toast("已儲存"); App.refresh();
        }
      });
  },
  del(id) { UI.confirm("確定刪除此供應商?", () => { DB.remove("suppliers", id); App.refresh(); }); }
};
App.register("m_sup", "主檔 — 供應商", PageSup.render);

/* ---------------- 配方 BOM ---------------- */
const PageRcp = {
  editLines: [],

  render(c) {
    const groups = U.groupBy(DB.get("recipes"), r => r.category);
    // 固定順序 + 任何其他自訂分類自動接在後面(避免新分類的配方漏顯示)
    const fixed = ["肉品", "海鮮", "菜品", "湯底", "醬料", "自助吧", "半成品"];
    const order = fixed.concat(Object.keys(groups).filter(k => !fixed.includes(k)));
    let html = `
    <div class="alert info">💡 配方成本會隨「最新進貨價」自動更新。肉品/菜品類多為「單品每份用量」(例:牛培根 200克/份),系統自動算每份成本。斤=600克、公斤=1000克。</div>
    <div class="toolbar"><div class="spacer"></div>
      <button class="btn primary" onclick="PageRcp.edit()">＋ 新增配方</button></div>`;
    for (const cat of order) {
      const list = groups[cat];
      if (!list) continue;
      html += `<div class="card"><h3>${U.esc(cat)}</h3>` + UI.table(
        ["配方名稱", "#產出", "#整批成本", "#每份成本", "#每人用量", "用料數", "操作"],
        list.map(r => {
          const cost = Domain.recipeCost(r.id);
          return `<tr>
            <td><b>${U.esc(r.name)}</b>${r.note ? `<div class="hint">${U.esc(r.note)}</div>` : ""}</td>
            <td class="num">${r.yieldQty} ${U.esc(r.yieldUnit)}</td>
            <td class="num">${U.fmt$(cost)}</td>
            <td class="num"><b>${U.fmt$(Math.round(cost / (r.yieldQty || 1)), 1)}</b></td>
            <td class="num">${r.perCover ? r.perCover + " " + U.esc(r.yieldUnit) : "—"}</td>
            <td class="num">${r.lines.length}</td>
            <td><button class="btn small" onclick="PageRcp.edit('${r.id}')">編輯</button>
                <button class="btn small ghost-red" onclick="PageRcp.del('${r.id}')">刪除</button></td></tr>`;
        })) + `</div>`;
    }
    c.innerHTML = html;
  },

  edit(id) {
    const r = id ? DB.byId("recipes", id) : { category: "肉品", yieldQty: 1, yieldUnit: "份", perCover: 0, lines: [] };
    PageRcp.editLines = JSON.parse(JSON.stringify(r.lines || []));
    UI.modal(id ? "編輯配方:" + r.name : "新增配方", `
      <div class="form-grid">
        <div><label class="fl">配方名稱 *</label><input id="f_name" value="${U.esc(r.name || "")}" style="width:100%"></div>
        <div><label class="fl">類型</label><select id="f_cat" style="width:100%">${["肉品", "海鮮", "菜品", "湯底", "醬料", "自助吧", "半成品"].map(x => `<option ${x === r.category ? "selected" : ""}>${x}</option>`).join("")}</select></div>
        <div><label class="fl">產出份數</label><input id="f_yq" type="number" step="any" value="${r.yieldQty}" style="width:100%"></div>
        <div><label class="fl">產出單位</label><input id="f_yu" value="${U.esc(r.yieldUnit)}" style="width:100%"></div>
        <div><label class="fl">每人用量(0=不自動排產)</label><input id="f_pc" type="number" step="any" value="${r.perCover || 0}" style="width:100%"></div>
        <div class="full"><label class="fl">備註(菜品可註記斤/公斤)</label><input id="f_note" value="${U.esc(r.note || "")}" style="width:100%"></div>
      </div>
      <div class="mini-title">用料明細(原料以「配方單位」如克計;半成品以「產出單位」計)</div>
      <div id="rcpLines"></div>
      <div style="margin-top:8px;display:flex;gap:8px">
        <button class="btn small" onclick="PageRcp.addLine('ing')">＋ 加原物料</button>
        <button class="btn small" onclick="PageRcp.addLine('rcp')">＋ 加半成品/子配方</button>
      </div>`,
      {
        width: 860,
        onOk() {
          const name = UI.val("f_name");
          if (!name) { UI.toast("請輸入配方名稱", true); return false; }
          PageRcp.collectLines();
          const lines = PageRcp.editLines.filter(l => l.refId && l.qty > 0);
          if (!lines.length) { UI.toast("至少需要一筆用料", true); return false; }
          const patch = {
            name, category: UI.val("f_cat"), yieldQty: UI.num("f_yq") || 1, yieldUnit: UI.val("f_yu") || "份",
            perCover: UI.num("f_pc"), note: UI.val("f_note"), lines
          };
          if (id) DB.update("recipes", id, patch); else DB.insert("recipes", patch);
          UI.toast("已儲存配方"); App.refresh();
        }
      });
    PageRcp.renderLines(id);
  },

  // 單列成本(依最新進貨價)
  lineCost(l) {
    if (!l.refId || !l.qty) return 0;
    if (l.kind === "ing") {
      const ing = DB.byId("ingredients", l.refId);
      if (!ing) return 0;
      return Math.round((l.qty / (ing.stockToUse || 1)) * Domain.currentPrice(ing.id));
    }
    const sub = DB.byId("recipes", l.refId);
    if (!sub || !sub.yieldQty) return 0;
    return Math.round(l.qty * (Domain.recipeCost(sub.id) / sub.yieldQty));
  },

  renderLines(excludeId) {
    const box = document.getElementById("rcpLines");
    if (!box) return;
    const yq = UI.num("f_yq") || 1;
    box.innerHTML = PageRcp.editLines.map((l, idx) => {
      const unitLabel = l.kind === "ing"
        ? (DB.byId("ingredients", l.refId) ? DB.byId("ingredients", l.refId).useUnit : "配方單位")
        : (DB.byId("recipes", l.refId) ? DB.byId("recipes", l.refId).yieldUnit : "單位");
      const cost = PageRcp.lineCost(l);
      return `<div style="display:flex;gap:8px;margin-bottom:6px;align-items:center">
        <span class="badge ${l.kind === "ing" ? "b-green" : "b-blue"}">${l.kind === "ing" ? "原料" : "子配方"}</span>
        <select style="flex:1" onchange="PageRcp.editLines[${idx}].refId=this.value;PageRcp.renderLines('${excludeId || ""}')">
          ${l.kind === "ing" ? UI.ingOptions(l.refId) : UI.recipeOptions(l.refId, excludeId)}
        </select>
        <input type="number" step="any" style="width:90px" value="${l.qty || ""}" placeholder="數量"
          oninput="PageRcp.editLines[${idx}].qty=parseFloat(this.value)||0;PageRcp.renderLines('${excludeId || ""}')">
        <span style="width:44px;font-size:12px;color:var(--text-muted)">${U.esc(unitLabel)}</span>
        <span style="width:80px;text-align:right;font-size:12.5px;font-weight:700">${cost ? U.fmt$(cost, 1) : "—"}</span>
        <button class="btn small ghost-red" onclick="PageRcp.editLines.splice(${idx},1);PageRcp.renderLines('${excludeId || ""}')">✕</button>
      </div>`;
    }).join("") || `<div class="empty" style="padding:10px">尚無用料,請點下方按鈕新增</div>`;
    const total = U.sum(PageRcp.editLines, l => PageRcp.lineCost(l));
    box.innerHTML += `<div style="text-align:right;margin-top:8px;font-size:13px">整批成本 <b>${U.fmt$(total)}</b>　÷ ${yq} 份 = 每份 <b class="t-green">${U.fmt$(Math.round(total / yq), 1)}</b></div>`;
  },

  collectLines() { /* 值已由 oninput/onchange 即時寫回 editLines */ },

  addLine(kind) {
    PageRcp.editLines.push({ kind, refId: "", qty: 0 });
    PageRcp.renderLines();
  },

  del(id) {
    UI.confirm("確定刪除此配方?", () => { DB.remove("recipes", id); App.refresh(); });
  }
};
App.register("m_rcp", "主檔 — 配方 / BOM", PageRcp.render);

/* ---------------- 人頭價方案 ---------------- */
const PagePlan = {
  render(c) {
    c.innerHTML = `
    <div class="toolbar"><div class="spacer"></div>
      <button class="btn primary" onclick="PagePlan.edit()">＋ 新增方案</button></div>
    <div class="card">
    ${UI.table(["方案名稱", "適用日", "客層", "#價格", "狀態", "操作"],
      DB.get("pricePlans").map(p => `<tr>
        <td><b>${U.esc(p.name)}</b></td>
        <td><span class="badge ${p.dayType === "假日" ? "b-red" : "b-gray"}">${U.esc(p.dayType)}</span></td>
        <td>${U.esc(p.tier)}</td>
        <td class="num"><b>${U.fmt$(p.price)}</b></td>
        <td>${p.active ? '<span class="badge b-green">啟用</span>' : '<span class="badge b-gray">停用</span>'}</td>
        <td><button class="btn small" onclick="PagePlan.edit('${p.id}')">編輯</button>
            <button class="btn small ghost-red" onclick="PagePlan.del('${p.id}')">刪除</button></td></tr>`))}
    </div>`;
  },
  edit(id) {
    const p = id ? DB.byId("pricePlans", id) : { dayType: "平日", tier: "成人", active: true };
    UI.modal(id ? "編輯方案" : "新增方案", `
      <div class="form-grid">
        <div><label class="fl">方案名稱 *</label><input id="f_name" value="${U.esc(p.name || "")}" style="width:100%"></div>
        <div><label class="fl">適用日</label><select id="f_day" style="width:100%">${["平日", "假日", "全時段"].map(x => `<option ${x === p.dayType ? "selected" : ""}>${x}</option>`).join("")}</select></div>
        <div><label class="fl">客層</label><select id="f_tier" style="width:100%">${["成人", "兒童", "敬老", "加購"].map(x => `<option ${x === p.tier ? "selected" : ""}>${x}</option>`).join("")}</select></div>
        <div><label class="fl">價格(元)</label><input id="f_price" type="number" step="any" value="${(p.price || 0) / 100}" style="width:100%"></div>
        <div><label class="fl">啟用</label><label style="display:flex;align-items:center;gap:6px;padding:7px 0"><input type="checkbox" id="f_active" ${p.active ? "checked" : ""}> 啟用中</label></div>
      </div>`,
      {
        onOk() {
          if (!UI.val("f_name")) { UI.toast("請輸入名稱", true); return false; }
          const patch = { name: UI.val("f_name"), dayType: UI.val("f_day"), tier: UI.val("f_tier"), price: U.toCents(UI.val("f_price")), active: UI.checked("f_active") };
          if (id) DB.update("pricePlans", id, patch); else DB.insert("pricePlans", patch);
          UI.toast("已儲存"); App.refresh();
        }
      });
  },
  del(id) { UI.confirm("確定刪除此方案?", () => { DB.remove("pricePlans", id); App.refresh(); }); }
};
App.register("m_plan", "主檔 — 人頭價方案", PagePlan.render);
