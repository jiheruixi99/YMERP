/* ===== page_finance.js — 財報:月損益(總獲利)/ PT人力成本 / 支出登記 ===== */
"use strict";

const FIXED_EXP = ["水電", "租金", "瓦斯", "稅金"];        // 固定欄目,直接輸入數字
const CUSTOM_EXP = ["雜費", "維修", "行銷", "其他"];        // 需要時自己新增
const EXP_CATS = FIXED_EXP.concat(CUSTOM_EXP);

function monthOptions(sel) {
  const months = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(); d.setMonth(d.getMonth() - i);
    months.push(U.fmtDate(d).slice(0, 7));
  }
  return months.map(m => `<option ${m === sel ? "selected" : ""}>${m}</option>`).join("");
}

/* ---------------- 月財報(總獲利)★ ---------------- */
const PageProfit = {
  from: null, to: null,

  render(c) {
    const p = Domain.pnl(PageProfit.from || (PageProfit.from = U.monthStart()), PageProfit.to || (PageProfit.to = U.today()));
    const est = txt => `<span class="badge b-orange" title="此區間尚無實際登記,使用設定頁的備援估計值(依天數比例換算)">估</span> ${txt}`;

    // 近 6 個月獲利趨勢
    const trend = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(); d.setMonth(d.getMonth() - i);
      const m = U.fmtDate(d).slice(0, 7);
      const pp = Domain.monthlyPnl(m);
      if (pp.revenue > 0) trend.push({ x: m.slice(2), y: Math.round(pp.profit / 100), color: pp.profit >= 0 ? "#1e7d43" : "#c62f2f" });
    }

    const row = (label, amount, opts) => {
      opts = opts || {};
      return `<tr style="${opts.bold ? "background:#f4f6f9;font-weight:700" : ""}">
        <td style="${opts.indent ? "padding-left:28px" : ""}">${label}</td>
        <td class="num ${opts.cls || ""}">${opts.minus ? "−" : ""}${U.fmt$(Math.abs(amount))}</td>
        <td class="num t-muted">${p.revenue ? U.pct(Math.abs(amount) / p.revenue) : "—"}</td></tr>`;
    };

    let html = `
    ${dateRangeBar("PageProfit", PageProfit, `<span class="t-muted" style="font-size:12.5px">${p.rangeDays} 天內 ${p.salesDays} 天有營收記錄</span>`)}
    <div class="kpi-row">
      <div class="kpi"><div class="k-label">總營收</div><div class="k-value">${U.fmt$(p.revenue)}</div>
        <div class="k-note">${U.fmtNum(p.covers, 0)} 位來客</div></div>
      <div class="kpi"><div class="k-label">總支出</div><div class="k-value">${U.fmt$(p.totalCost)}</div></div>
      <div class="kpi ${p.profit >= 0 ? "good" : "bad"}"><div class="k-label">總獲利 ★</div>
        <div class="k-value">${p.profit < 0 ? "−" : ""}${U.fmt$(Math.abs(p.profit))}</div>
        <div class="k-note">淨利率 ${p.margin == null ? "—" : U.pct(p.margin)}</div></div>
      <div class="kpi"><div class="k-label">日均獲利</div>
        <div class="k-value" style="font-size:19px">${p.salesDays ? U.fmt$(Math.round(p.profit / p.salesDays)) : "—"}</div></div>
    </div>

    <div class="card">
      <h3>💹 損益表 <span class="sub">${rangeLabel(PageProfit)}</span></h3>
      <div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>項目</th><th class="num">金額</th><th class="num">占營收</th></tr></thead><tbody>
        ${row("<b>營業收入</b>", p.revenue, { bold: true })}
        ${row("現金", p.pay.cash, { indent: true })}
        ${row("信用卡", p.pay.card, { indent: true })}
        ${row("LINE Pay", p.pay.line, { indent: true })}
        ${row("全支付", p.pay.jko, { indent: true })}
        ${row("<b>進貨支出</b>", p.purchasesFood + p.purchasesMisc, { bold: true, minus: true, cls: "t-red" })}
        ${row("物料(食材)", p.purchasesFood, { indent: true, minus: true })}
        ${row("雜項(包材耗材)", p.purchasesMisc, { indent: true, minus: true })}
        ${row(`<b>人力成本</b>${p.laborEst ? " " + est("") : ` <span class="t-muted" style="font-weight:400;font-size:12px">(${p.laborCount} 筆登記)</span>`}`, p.labor, { bold: true, minus: true, cls: "t-red" })}
        ${row("<b>營業費用</b>" + (p.expEst ? " " + est("") : ""), p.expensesTotal, { bold: true, minus: true, cls: "t-red" })}
        ${U.sortBy(Object.entries(p.expByCat).filter(([k]) => k !== "稅金"), e => e[1], true)
          .map(([k, v]) => row(U.esc(k), v, { indent: true, minus: true })).join("")}
        ${row("<b>手續費</b>", p.feeTotal, { bold: true, minus: true, cls: "t-red" })}
        ${row(`信用卡(${U.pct(DB.setting("feeCardPct"), 1)})`, p.fees.card, { indent: true, minus: true })}
        ${row(`LINE Pay(${U.pct(DB.setting("feeLinePct"), 1)})`, p.fees.line, { indent: true, minus: true })}
        ${row(`全支付(${U.pct(DB.setting("feeJkoPct"), 1)})`, p.fees.jko, { indent: true, minus: true })}
        ${row("<b>稅金</b>", p.tax, { bold: true, minus: true, cls: "t-red" })}
        <tr style="background:${p.profit >= 0 ? "#e2f3e9" : "#fdeaea"};font-weight:800;font-size:15px">
          <td>＝ 區間總獲利</td>
          <td class="num ${p.profit >= 0 ? "t-green" : "t-red"}">${p.profit < 0 ? "−" : ""}${U.fmt$(Math.abs(p.profit))}</td>
          <td class="num">${p.margin == null ? "—" : U.pct(p.margin)}</td></tr>
      </tbody></table></div>
      ${(p.laborEst || p.expEst) ? `<p class="hint" style="margin-top:8px">⚠️ 標「估」的項目該月沒有實際登記,先用設定頁的備援估計值 — 到「人力成本」「支出登記」輸入實際數字後會自動改用實際值。</p>` : ""}
      <p class="hint">進貨支出來自每天 KEY 的進貨單(拍照進貨/採購驗收);手續費依設定頁費率 × 各支付方式營收自動計算。</p>
    </div>

    <div class="card">
      <h3>📊 近 6 個月獲利趨勢</h3>
      ${Chart.bar({ width: 760, height: 220, showVal: true, data: trend, yFmt: v => "NT$" + U.fmtNum(v, 0) })}
    </div>`;
    c.innerHTML = html;
  }
};

/* ---------------- PT 人力成本 ---------------- */
const PageLabor = {
  from: null, to: null,

  render(c) {
    const from = PageLabor.from || (PageLabor.from = U.monthStart());
    const to = PageLabor.to || (PageLabor.to = U.today());
    const logs = U.sortBy(DB.get("laborLogs").filter(l => l.date >= from && l.date <= to), l => l.date, true);
    const total = U.sum(logs, Domain.laborCost);
    const totalHours = U.sum(logs, l => l.hours || 0);
    // 依人員彙總
    const byName = {};
    for (const l of logs) {
      const e = byName[l.name] = byName[l.name] || { hours: 0, wage: 0, bonus: 0, insurance: 0 };
      e.hours += l.hours || 0;
      e.wage += Math.round((l.hourlyRate || 0) * (l.hours || 0));
      e.bonus += l.bonus || 0;
      e.insurance += l.insurance || 0;
    }

    c.innerHTML = `
    <div class="alert info">💡 公式:<b>時薪 × 時數 + 獎金 − 勞健保 = 人力成本</b>。每天(或每週彙總)登記 PT 班表即可,月財報自動加總。</div>
    ${dateRangeBar("PageLabor", PageLabor, `<div class="spacer"></div><button class="btn primary" onclick="PageLabor.edit()">＋ 登記人力</button>`)}
    <div class="kpi-row">
      <div class="kpi"><div class="k-label">人力成本合計</div><div class="k-value">${U.fmt$(total)}</div></div>
      <div class="kpi"><div class="k-label">總時數</div><div class="k-value">${U.fmtNum(totalHours)} 小時</div></div>
      <div class="kpi"><div class="k-label">平均時薪成本</div>
        <div class="k-value" style="font-size:19px">${totalHours ? U.fmt$(Math.round(total / totalHours)) : "—"}/hr</div></div>
    </div>
    <div class="card"><h3>依人員彙總 <span class="sub">${rangeLabel(PageLabor)}</span></h3>
      ${UI.table(["人員", "#時數", "#薪資", "#獎金", "#勞健保", "#小計"],
        U.sortBy(Object.entries(byName), e => e[1].wage, true).map(([name, e]) => `<tr>
          <td><b>${U.esc(name)}</b></td>
          <td class="num">${U.fmtNum(e.hours)}</td>
          <td class="num">${U.fmt$(e.wage)}</td>
          <td class="num">${e.bonus ? "+" + U.fmt$(e.bonus) : "—"}</td>
          <td class="num">${e.insurance ? "−" + U.fmt$(e.insurance) : "—"}</td>
          <td class="num"><b>${U.fmt$(e.wage + e.bonus - e.insurance)}</b></td></tr>`), "此區間尚無登記")}
    </div>
    <div class="card"><h3>登記明細</h3>
      ${UI.table(["日期", "人員", "#時薪", "#時數", "#獎金", "#勞健保", "#成本", "備註", "操作"],
        logs.slice(0, 80).map(l => `<tr>
          <td>${l.date}</td><td>${U.esc(l.name)}</td>
          <td class="num">${l.hourlyRate ? U.fmt$(l.hourlyRate) : "—"}</td>
          <td class="num">${l.hours || "—"}</td>
          <td class="num">${l.bonus ? U.fmt$(l.bonus) : "—"}</td>
          <td class="num">${l.insurance ? U.fmt$(l.insurance) : "—"}</td>
          <td class="num"><b>${U.fmt$(Domain.laborCost(l))}</b></td>
          <td class="t-muted">${U.esc(l.note || "")}</td>
          <td><button class="btn small" onclick="PageLabor.edit('${l.id}')">編輯</button>
              <button class="btn small ghost-red" onclick="DB.remove('laborLogs','${l.id}');App.refresh()">✕</button></td></tr>`),
        "此區間尚無登記")}
    </div>`;
  },

  edit(id) {
    const l = id ? DB.byId("laborLogs", id) : { date: U.today(), hourlyRate: 19500, hours: 6, bonus: 0, insurance: 0 };
    const names = [...new Set(DB.get("laborLogs").map(x => x.name))].filter(Boolean);
    UI.modal(id ? "編輯人力登記" : "登記人力", `
      <div class="form-grid">
        <div><label class="fl">日期 *</label><input id="lb_date" type="date" value="${l.date}" style="width:100%"></div>
        <div><label class="fl">人員 *</label><input id="lb_name" value="${U.esc(l.name || "")}" list="lb_names" style="width:100%">
          <datalist id="lb_names">${names.map(n => `<option value="${U.esc(n)}">`).join("")}</datalist></div>
        <div><label class="fl">時薪(元)</label><input id="lb_rate" type="number" step="any" value="${(l.hourlyRate || 0) / 100}" style="width:100%"></div>
        <div><label class="fl">時數</label><input id="lb_hours" type="number" step="0.5" value="${l.hours || 0}" style="width:100%"></div>
        <div><label class="fl">獎金(元)</label><input id="lb_bonus" type="number" step="any" value="${(l.bonus || 0) / 100}" style="width:100%"></div>
        <div><label class="fl">勞健保(元,扣除)</label><input id="lb_ins" type="number" step="any" value="${(l.insurance || 0) / 100}" style="width:100%"></div>
        <div class="full"><label class="fl">備註</label><input id="lb_note" value="${U.esc(l.note || "")}" style="width:100%"></div>
      </div>
      <p class="hint">成本 = 時薪×時數 + 獎金 − 勞健保。純勞健保月扣繳:時薪/時數填 0,只填勞健保即可。</p>`,
      {
        onOk() {
          const name = UI.val("lb_name");
          if (!UI.val("lb_date") || !name) { UI.toast("請填日期與人員", true); return false; }
          const patch = {
            date: UI.val("lb_date"), name,
            hourlyRate: U.toCents(UI.val("lb_rate")), hours: UI.num("lb_hours"),
            bonus: U.toCents(UI.val("lb_bonus")), insurance: U.toCents(UI.val("lb_ins")),
            note: UI.val("lb_note")
          };
          if (id) DB.update("laborLogs", id, patch); else DB.insert("laborLogs", patch);
          UI.toast("已登記,月財報將自動計入");
          App.refresh();
        }
      });
  }
};

/* ---------------- 支出登記(水電/租金/稅金…) ---------------- */
const PageExpense = {
  month: null,

  render(c) {
    const ym = PageExpense.month || U.thisMonth();
    PageExpense.month = ym;
    const list = U.sortBy(DB.get("expenses").filter(x => U.monthOf(x.date) === ym), x => x.date, true);
    const byCat = {};
    for (const x of list) byCat[x.category] = (byCat[x.category] || 0) + x.amount;
    const total = U.sum(list, x => x.amount);

    // 固定欄目每月一筆(找該月該類別的第一筆)
    const fixedEntry = cat => list.find(x => x.category === cat);
    const customList = list.filter(x => CUSTOM_EXP.includes(x.category));

    c.innerHTML = `
    <div class="alert info">💡 <b>固定費用</b>(水電/租金/瓦斯/稅金)直接在下面填數字按儲存即可;<b>其他支出</b>(雜費/維修…)需要時才新增。月財報自動歸類扣除。</div>
    <div class="toolbar">
      <label class="fl" style="margin:0">月份:</label>
      <select onchange="PageExpense.month=this.value;App.refresh()">${monthOptions(ym)}</select>
      <span class="badge b-gray">合計 ${U.fmt$(total)}</span>
    </div>

    <div class="card">
      <h3>📌 本月固定費用(直接輸入,自動儲存)</h3>
      <div class="form-grid">
        ${FIXED_EXP.map(cat => {
          const e = fixedEntry(cat);
          return `<div><label class="fl">${cat}(元)</label>
            <input id="fx_${cat}" type="number" step="any" value="${e ? e.amount / 100 : ""}" placeholder="0"
              style="width:100%" onchange="PageExpense.quickSave('${cat}')"></div>`;
        }).join("")}
      </div>
      <p class="hint">收到帳單就填進去,同月同類別再填會覆蓋更新;稅金雙月一次的月份留空即可。</p>
    </div>

    <div class="card">
      <h3>🧾 其他支出(雜費/維修/行銷…)
        <span class="sub" style="margin-left:auto"></span>
        <button class="btn small primary" onclick="PageExpense.edit()">＋ 新增</button></h3>
      ${UI.table(["日期", "類別", "#金額", "備註", "操作"],
        customList.map(x => `<tr>
          <td>${x.date}</td>
          <td><span class="badge b-gray">${U.esc(x.category)}</span></td>
          <td class="num"><b>${U.fmt$(x.amount)}</b></td>
          <td class="t-muted">${U.esc(x.note || "")}</td>
          <td><button class="btn small" onclick="PageExpense.edit('${x.id}')">編輯</button>
              <button class="btn small ghost-red" onclick="DB.remove('expenses','${x.id}');App.refresh()">✕</button></td></tr>`),
        "本月尚無其他支出")}
    </div>`;
  },

  // 固定欄目快速存檔:同月同類別更新,無則新增(存到該月 1 號)
  quickSave(cat) {
    const ym = PageExpense.month || U.thisMonth();
    const amt = U.toCents(UI.val("fx_" + cat));
    const exist = DB.get("expenses").find(x => U.monthOf(x.date) === ym && x.category === cat);
    if (amt <= 0) {
      if (exist) { DB.remove("expenses", exist.id); UI.toast(cat + " 已清除"); }
    } else if (exist) {
      DB.update("expenses", exist.id, { amount: amt });
      UI.toast(cat + " 已更新為 " + U.fmt$(amt));
    } else {
      DB.insert("expenses", { date: ym + "-01", category: cat, amount: amt, note: "" });
      UI.toast(cat + " 已登記 " + U.fmt$(amt));
    }
    App.refresh();
  },

  edit(id) {
    const x = id ? DB.byId("expenses", id) : { date: U.today(), category: "雜費" };
    const cats = id ? EXP_CATS : CUSTOM_EXP;
    UI.modal(id ? "編輯支出" : "新增其他支出", `
      <div class="form-grid">
        <div><label class="fl">日期 *</label><input id="ex_date" type="date" value="${x.date}" style="width:100%"></div>
        <div><label class="fl">類別 *</label><select id="ex_cat" style="width:100%">${cats.map(k => `<option ${k === x.category ? "selected" : ""}>${k}</option>`).join("")}</select></div>
        <div><label class="fl">金額(元)*</label><input id="ex_amt" type="number" step="any" value="${x.amount ? x.amount / 100 : ""}" style="width:100%"></div>
        <div class="full"><label class="fl">備註</label><input id="ex_note" value="${U.esc(x.note || "")}" style="width:100%"></div>
      </div>`,
      {
        onOk() {
          const amt = U.toCents(UI.val("ex_amt"));
          if (!UI.val("ex_date") || amt <= 0) { UI.toast("請填日期與金額", true); return false; }
          const patch = { date: UI.val("ex_date"), category: UI.val("ex_cat"), amount: amt, note: UI.val("ex_note") };
          if (id) DB.update("expenses", id, patch); else DB.insert("expenses", patch);
          UI.toast("已登記,月財報將自動計入");
          App.refresh();
        }
      });
  }
};

/* ---------------- 廠商進貨分析(叫了多少錢 / 占比) ---------------- */
const PageSupplierSpend = {
  from: null, to: null,

  // 依進貨單彙總各廠商:金額(與貨款單同一套四捨五入)、單數、品項次數
  summary(from, to) {
    const grs = DB.get("goodsReceipts").filter(g => g.date >= from && g.date <= to);
    const map = {};
    for (const g of grs) {
      const key = g.supplierId || "(未指定廠商)";
      if (!map[key]) map[key] = { supplierId: g.supplierId, amount: 0, orders: 0, lines: 0, lastDate: "" };
      const row = map[key];
      row.amount += U.sum(g.lines, l => U.lineAmt(l.qtyReceived, l.unitPrice));
      row.orders += 1;
      row.lines += g.lines.length;
      if (g.date > row.lastDate) row.lastDate = g.date;
    }
    const list = U.sortBy(Object.values(map), r => -r.amount);
    const total = U.sum(list, r => r.amount);
    list.forEach(r => r.share = total ? r.amount / total : 0);
    return { list, total, orderCount: grs.length };
  },

  render(c) {
    const from = PageSupplierSpend.from || (PageSupplierSpend.from = U.monthStart());
    const to = PageSupplierSpend.to || (PageSupplierSpend.to = U.today());
    const { list, total, orderCount } = PageSupplierSpend.summary(from, to);
    const top = list[0];

    // 各廠商在不同月份的金額,用來看「這家是不是變貴/叫更多」
    const bar = pct => `<div style="background:#e7ebf0;border-radius:4px;height:8px;overflow:hidden">
      <div style="width:${(pct * 100).toFixed(1)}%;height:100%;background:var(--accent)"></div></div>`;

    c.innerHTML = `
    <div class="alert info">💡 統計各廠商的進貨金額與占比,金額與貨款單同一套算法(每列四捨五入到整數元)。用途:看錢主要花在哪幾家、談判時心裡有底、發現某家占比突然變高。</div>
    ${dateRangeBar("PageSupplierSpend", PageSupplierSpend)}
    <div class="kpi-row">
      <div class="kpi"><div class="k-label">進貨總額</div><div class="k-value">${U.fmt$(total)}</div>
        <div class="k-note">${orderCount} 張進貨單 · ${list.length} 家廠商</div></div>
      <div class="kpi"><div class="k-label">最大廠商</div><div class="k-value" style="font-size:19px">${top ? U.esc(UI.supName(top.supplierId)) : "—"}</div>
        <div class="k-note">${top ? U.fmt$(top.amount) + "(" + U.pct(top.share) + ")" : "尚無資料"}</div></div>
      <div class="kpi ${top && top.share > 0.5 ? "warn" : ""}"><div class="k-label">集中度(前 3 家)</div>
        <div class="k-value">${list.length ? U.pct(U.sum(list.slice(0, 3), r => r.share)) : "—"}</div>
        <div class="k-note">${top && top.share > 0.5 ? "單一廠商過半,議價空間有限" : "分散度尚可"}</div></div>
    </div>
    <div class="card">
      <h3>🏢 各廠商進貨金額 <span class="sub">${rangeLabel(PageSupplierSpend)}</span></h3>
      ${UI.table(["廠商", "#進貨單數", "#品項次數", "#金額", "#占比", "占比圖", "最後進貨日"],
        list.map(r => `<tr>
          <td><b>${U.esc(UI.supName(r.supplierId))}</b></td>
          <td class="num">${r.orders}</td>
          <td class="num">${r.lines}</td>
          <td class="num"><b>${U.fmt$(r.amount)}</b></td>
          <td class="num">${U.pct(r.share)}</td>
          <td style="min-width:130px">${bar(r.share)}</td>
          <td class="t-muted">${r.lastDate || "—"}</td></tr>`),
        "此期間尚無進貨記錄")}
      ${list.length ? `<p style="text-align:right;margin-top:10px;font-weight:700">合計 ${U.fmt$(total)}</p>` : ""}
    </div>`;
  }
};

App.register("fi_profit", "財報 — 月損益 / 總獲利 ★", PageProfit.render);
App.register("fi_labor", "財報 — PT 人力成本", PageLabor.render);
App.register("fi_expense", "財報 — 支出登記(水電/稅金…)", PageExpense.render);
App.register("fi_supplier", "財報 — 廠商進貨分析(金額 / 占比)", PageSupplierSpend.render);
