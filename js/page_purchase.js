/* ===== page_purchase.js — 採購/進貨驗收/價格趨勢/採購建議 ===== */
"use strict";

/* 進貨照片本機儲存(存瀏覽器 localStorage,不進 DB.data、不同步到試算表
   —— 照片體積大,放進 Google 試算表會超過單格上限並拖慢同步,故只留在本機供事後核對)。
   有容量上限,超過時自動丟掉最舊的照片(保留最近的進貨照片)。 */
const GRPhoto = {
  KEY: "hotpot_erp_grPhotos",
  BUDGET: 3500000, // 約 3.5MB 給照片用
  _load() { try { return JSON.parse(localStorage.getItem(GRPhoto.KEY) || "{}"); } catch (e) { return {}; } },
  get(grId) { return GRPhoto._load()[grId] || null; },
  set(grId, dataUrl) {
    if (!dataUrl) { GRPhoto.remove(grId); return; }
    const map = GRPhoto._load();
    delete map[grId];          // 移到最後 = 視為最新
    map[grId] = dataUrl;
    let keys = Object.keys(map);
    while (JSON.stringify(map).length > GRPhoto.BUDGET && keys.length > 1) delete map[keys.shift()];
    try { localStorage.setItem(GRPhoto.KEY, JSON.stringify(map)); }
    catch (err) {
      while (keys.length > 0) {
        delete map[keys.shift()];
        try { localStorage.setItem(GRPhoto.KEY, JSON.stringify(map)); return; } catch (e2) { /* 繼續丟最舊的 */ }
      }
    }
  },
  remove(grId) {
    const map = GRPhoto._load();
    if (map[grId]) { delete map[grId]; try { localStorage.setItem(GRPhoto.KEY, JSON.stringify(map)); } catch (e) {} }
  }
};

const PagePurchase = {
  poLines: [],
  trendIng: "i_cabbage",

  /* ---------------- 進貨登記(每天 Key 各廠商進貨表) ---------------- */
  renderPO(c) {
    const grs = U.sortBy(DB.get("goodsReceipts"), g => g.date, true);
    c.innerHTML = `
    <div class="alert info">💡 每天 Key 各廠商的進貨表:選供應商(只列該廠商品項)→ 輸入品項/數量/單價 → 入庫。入庫後自動更新庫存、最新單價(BOM 成本跟著更新)、價格趨勢。可隨時<b>看明細、修改、刪除</b>更正。</div>
    <div class="toolbar"><div class="spacer"></div>
      <button class="btn primary" onclick="PagePhotoGR.open()">＋ 進貨登記</button></div>
    <div class="card"><h3>進貨記錄</h3>
    ${UI.table(["進貨日", "供應商", "#品項數", "#金額", "備註", "操作"],
      grs.slice(0, 60).map(g => {
        const amt = U.sum(g.lines, l => U.lineAmt(l.qtyReceived, l.unitPrice));
        return `<tr><td>${g.date}${(g.hasPhoto || GRPhoto.get(g.id)) ? ' <span title="有送貨單照片">📷</span>' : ""}</td>
        <td>${U.esc(UI.supName(g.supplierId))}</td>
        <td class="num">${g.lines.length}</td>
        <td class="num"><b>${U.fmt$(amt)}</b></td>
        <td class="t-muted" style="font-size:12px">${U.esc(g.note || "")}</td>
        <td><button class="btn small" onclick="PagePhotoGR.view('${g.id}')">明細</button>
            <button class="btn small" onclick="PagePhotoGR.open('${g.id}')">修改</button>
            <button class="btn small ghost-red" onclick="PagePhotoGR.del('${g.id}')">刪除</button></td></tr>`;
      }), "尚無進貨記錄,點右上「＋ 進貨登記」開始")}
    </div>`;
  },

  /* ---------------- 價格趨勢 ---------------- */
  gotoTrend(ingId) { PagePurchase.trendIng = ingId; App.go("p_trend"); },

  renderTrend(c) {
    const ing = DB.byId("ingredients", PagePurchase.trendIng) || DB.get("ingredients")[0];
    if (ing) PagePurchase.trendIng = ing.id;
    const stats = ing ? Domain.priceStats(ing.id) : null;
    const alerts = Domain.priceAlerts();

    let statHtml = "";
    let chartHtml = `<div class="empty">此品項尚無進貨價格記錄</div>`;
    let subHtml = "";
    if (stats) {
      const hist90 = stats.hist.filter(h => h.date >= U.addDays(U.today(), -120));
      chartHtml = Chart.line({
        width: 900, height: 260,
        series: [{ name: ing.name + " 進貨價", color: "#c62f2f", data: hist90.map(h => ({ x: U.mdLabel(h.date), y: +(h.unitPrice / 100).toFixed(1) })) }],
        yFmt: v => "NT$" + U.fmtNum(v, 0), forceLegend: true
      });
      statHtml = `<div class="kpi-row">
        <div class="kpi"><div class="k-label">最新進貨價</div><div class="k-value">${U.fmt$(stats.latest.unitPrice, 1)}</div><div class="k-note">/${U.esc(ing.stockUnit)}(${stats.latest.date})</div></div>
        <div class="kpi ${stats.chgPrev > 0.01 ? "bad" : stats.chgPrev < -0.01 ? "good" : ""}"><div class="k-label">與前次比</div><div class="k-value">${stats.chgPrev == null ? "—" : U.pct(stats.chgPrev)}</div></div>
        <div class="kpi ${stats.chg30 > 0.01 ? "bad" : stats.chg30 < -0.01 ? "good" : ""}"><div class="k-label">30 天漲跌</div><div class="k-value">${stats.chg30 == null ? "—" : U.pct(stats.chg30)}</div></div>
        <div class="kpi"><div class="k-label">去年同期比</div><div class="k-value">${stats.chgYoy == null ? "—" : U.pct(stats.chgYoy)}</div><div class="k-note">${stats.chgYoy == null ? "無去年資料" : "季節波動參考"}</div></div>
      </div>`;
      if (stats.abnormal) {
        const subs = Domain.substitutes(ing.id);
        subHtml = `<div class="alert warn">⚠️ <b>${U.esc(ing.name)}</b> 價格異常(超過 ±${U.pct(DB.setting("priceAlertPct"), 0)} 閾值)。
          ${subs.length ? "同分類價格穩定的替代方向:" + subs.map(s => `<b>${U.esc(s.ing.name)}</b>(${U.fmt$(Domain.currentPrice(s.ing.id), 1)}/${U.esc(s.ing.stockUnit)})`).join("、") : "同分類暫無穩定替代品。"}
          可考慮調整備料配比或菜色設計。</div>`;
      }
    }

    c.innerHTML = `
    <div class="toolbar">
      <label class="fl" style="margin:0">品項:</label>
      <select onchange="PagePurchase.trendIng=this.value;App.refresh()" style="min-width:220px">${UI.ingOptions(PagePurchase.trendIng)}</select>
      ${ing && ing.seasonal ? '<span class="badge b-blue">季節性品項</span>' : ""}
    </div>
    ${subHtml}${statHtml}
    <div class="card"><h3>📈 進貨價格歷史(近 120 天)</h3>${chartHtml}</div>
    <div class="card">
      <h3>🚨 全品項價格異常清單</h3>
      ${UI.table(["品項", "分類", "#最新價", "#前次比", "#30天漲跌", "#去年同期比", ""],
        alerts.map(a => `<tr>
          <td><b>${U.esc(a.ing.name)}</b></td>
          <td><span class="badge b-gray">${U.esc(a.ing.category)}</span></td>
          <td class="num">${U.fmt$(a.stats.latest.unitPrice, 1)}/${U.esc(a.ing.stockUnit)}</td>
          <td class="num">${UI.pctBadge(a.stats.chgPrev)}</td>
          <td class="num">${UI.pctBadge(a.stats.chg30)}</td>
          <td class="num">${UI.pctBadge(a.stats.chgYoy)}</td>
          <td><button class="btn small" onclick="PagePurchase.gotoTrend('${a.ing.id}')">看趨勢</button></td></tr>`),
        "目前無價格異常品項")}
    </div>`;
  },

  /* ---------------- 採購建議 ---------------- */
  renderSuggest(c) {
    const suggs = Domain.purchaseSuggestions();
    const bySup = U.groupBy(suggs.filter(s => s.supplierId), s => s.supplierId);
    c.innerHTML = `
    <div class="alert info">💡 建議量 = 近 14 天日均消耗 × 備貨 ${DB.setting("coverDays")} 天 + 安全庫存 − 現有庫存,並依供應商報價自動比價。可一鍵帶入進貨登記。</div>
    <div class="toolbar">
      ${Object.entries(bySup).map(([supId, list]) =>
        `<button class="btn primary" onclick="PagePurchase.createFromSuggest('${supId}')">帶入進貨:${U.esc(UI.supName(supId))}(${list.length} 項)</button>`).join("")}
    </div>
    <div class="card">
    ${UI.table(["品項", "#現有庫存", "#日均消耗", "#建議採購", "最優供應商", "#最新報價", "價格提醒"],
      suggs.map(s => `<tr>
        <td><b>${U.esc(s.ing.name)}</b></td>
        <td class="num">${U.fmtNum(s.stock)} ${U.esc(s.ing.stockUnit)}</td>
        <td class="num">${U.fmtNum(s.daily)} ${U.esc(s.ing.stockUnit)}/日</td>
        <td class="num"><b>${s.purQty} ${U.esc(s.ing.purchaseUnit)}</b></td>
        <td>${U.esc(UI.supName(s.supplierId))}${s.prices.length > 1 ? ` <span class="badge b-green">比價 ${s.prices.length} 家</span>` : ""}</td>
        <td class="num">${s.best ? U.fmt$(s.best.unitPrice, 1) + "/" + U.esc(s.ing.stockUnit) : U.fmt$(Domain.currentPrice(s.ing.id), 1) + "/" + U.esc(s.ing.stockUnit)}</td>
        <td>${s.abnormal ? `<span class="badge b-red">漲價中 ${s.chg30 != null ? U.pct(s.chg30) : ""}</span> <button class="btn small" onclick="PagePurchase.gotoTrend('${s.ing.id}')">替代建議</button>` : '<span class="t-muted">正常</span>'}</td>
      </tr>`), "目前庫存充足,無採購建議")}
    </div>`;
  },

  createFromSuggest(supplierId) {
    const suggs = Domain.purchaseSuggestions().filter(s => s.supplierId === supplierId);
    const lines = suggs.map(s => ({
      ingredientId: s.ing.id, qty: s.purQty,
      unitPrice: Math.round((s.best ? s.best.unitPrice : Domain.currentPrice(s.ing.id)) * (s.ing.purToStock || 1)),
      expiry: ""
    }));
    App.go("p_po");
    PagePhotoGR.open(null, { supplierId, rows: lines });
  }
};

/* ---------------- 供應商報價建檔 ----------------
   輸入一次「食材 × 供應商 × 價格」,之後開採購單、算成本、比價全部自動帶入;
   每次收貨驗收也會自動回寫最新價,不必重複輸入。 */
const PageQuote = {
  kw: "",
  filterSup: "",

  render(c) {
    let list = DB.get("supplierPrices").map(q => ({ q, ing: DB.byId("ingredients", q.ingredientId), sup: DB.byId("suppliers", q.supplierId) }))
      .filter(o => o.ing && o.sup);
    if (PageQuote.kw) list = list.filter(o => o.ing.name.includes(PageQuote.kw));
    if (PageQuote.filterSup) list = list.filter(o => o.q.supplierId === PageQuote.filterSup);
    list = U.sortBy(list, o => o.ing.category + o.ing.name);

    c.innerHTML = `
    <div class="alert info">💡 這裡是你建檔物料的主要入口:一次填「品項 × 供應商 × 價格」,新品項可直接建立(會自動寫進食材主檔)。之後進貨自動帶價、BOM 成本自動算、多家供應商自動比價。進貨後最新價會自動回寫,平常不用回來改。</div>
    <div class="toolbar">
      <input placeholder="搜尋品名…" value="${U.esc(PageQuote.kw)}" oninput="PageQuote.kw=this.value" onchange="App.refresh()">
      <select onchange="PageQuote.filterSup=this.value;App.refresh()">
        <option value="">全部供應商</option>
        ${DB.get("suppliers").map(s => `<option value="${s.id}" ${s.id === PageQuote.filterSup ? "selected" : ""}>${U.esc(s.name)}</option>`).join("")}
      </select>
      <div class="spacer"></div>
      <button class="btn" onclick="PageSup.edit()">＋ 新增供應商</button>
      <button class="btn primary" onclick="PageQuote.edit()">＋ 建檔品項/報價</button>
    </div>
    <div class="card">
    ${UI.table(["品項", "分類", "供應商", "#報價(計價單位)", "生效日", "#最新進貨價", "比價", "操作"],
      list.map(o => {
        const cur = Domain.currentPrice(o.ing.id);
        const others = DB.get("supplierPrices").filter(x => x.ingredientId === o.ing.id && x.id !== o.q.id);
        const isBest = !others.some(x => x.unitPrice < o.q.unitPrice);
        return `<tr>
          <td><b>${U.esc(o.ing.name)}</b></td>
          <td><span class="badge b-gray">${U.esc(o.ing.category)}</span></td>
          <td>${U.esc(o.sup.name)}</td>
          <td class="num"><b>${U.fmt$(o.q.unitPrice, 1)}</b>/${U.esc(o.ing.stockUnit)}</td>
          <td>${o.q.effectiveDate || "—"}</td>
          <td class="num">${cur ? U.fmt$(cur, 1) : "—"}</td>
          <td>${others.length ? (isBest ? '<span class="badge b-green">最低價</span>' : '<span class="badge b-orange">有更低價</span>') : '<span class="t-muted">單一</span>'}</td>
          <td><button class="btn small" onclick="PageQuote.edit('${o.q.id}')">改價</button>
              <button class="btn small" onclick="PageIng.edit('${o.ing.id}')">品項設定</button>
              <button class="btn small ghost-red" onclick="PageQuote.del('${o.q.id}')">刪除</button></td>
        </tr>`;
      }), "尚無建檔,點右上「＋ 建檔品項/報價」開始")}
    </div>`;
  },

  edit(id, presetIngId) {
    const q = id ? DB.byId("supplierPrices", id) : { effectiveDate: U.today(), ingredientId: presetIngId || "" };
    const ing = DB.byId("ingredients", q.ingredientId);
    UI.modal(id ? "修改報價" : "建檔品項 / 報價", `
      <div class="form-grid">
        <div class="full"><label class="fl">食材品項 *</label>
          <div style="display:flex;gap:8px">
            <select id="q_ing" style="flex:1" onchange="PageQuote.unitHint()" ${id ? "disabled" : ""}>${UI.ingOptions(q.ingredientId)}</select>
            ${id ? "" : `<button class="btn small" onclick="PageQuote.newIng()">＋ 新品項</button>`}
          </div></div>
        <div class="full"><label class="fl">供應商 *</label>
          <select id="q_sup" style="width:100%" ${id ? "disabled" : ""}>${UI.supOptions(q.supplierId)}</select></div>
        <div><label class="fl">報價(元 / 計價單位)*</label><input id="q_price" type="number" step="any" value="${q.unitPrice ? q.unitPrice / 100 : ((ing && ing.basePrice) ? ing.basePrice / 100 : "")}" style="width:100%"></div>
        <div><label class="fl">生效日</label><input id="q_date" type="date" value="${q.effectiveDate || U.today()}" style="width:100%"></div>
      </div>
      <p class="hint" id="q_hint"></p>`,
      {
        onOk() {
          const ingId = id ? q.ingredientId : UI.val("q_ing");
          const supId = id ? q.supplierId : UI.val("q_sup");
          const price = U.toCents(UI.val("q_price"));
          if (!ingId || !supId || price <= 0) { UI.toast("請選擇品項、供應商並輸入報價", true); return false; }
          const patch = { supplierId: supId, ingredientId: ingId, unitPrice: price, effectiveDate: UI.val("q_date") || U.today() };
          if (id) DB.update("supplierPrices", id, patch);
          else {
            const dup = DB.get("supplierPrices").find(x => x.supplierId === supId && x.ingredientId === ingId);
            if (dup) DB.update("supplierPrices", dup.id, patch);
            else DB.insert("supplierPrices", patch);
          }
          UI.toast("已建檔,進貨/成本計算自動帶入");
          App.refresh();
        }
      });
    PageQuote.unitHint();
  },

  // 內建新增食材主檔,建好後回到報價視窗並自動選取
  newIng() {
    const supId = UI.val("q_sup");
    UI.closeModal();
    PageIng.edit(null, {
      supplierId: supId,
      onDone(ing) {
        PageQuote.edit(null, ing.id);
        const el = document.getElementById("q_sup");
        if (el && supId) el.value = supId;
        PageQuote.unitHint();
      }
    });
  },

  unitHint() {
    const el = document.getElementById("q_hint");
    if (!el) return;
    const ing = DB.byId("ingredients", UI.val("q_ing"));
    if (!ing) { el.textContent = "選現有品項,或按「＋ 新品項」建立(會一併寫入食材主檔)。"; return; }
    el.innerHTML = `此品項計價單位「${U.esc(ing.stockUnit)}」,報價即每 ${U.esc(ing.stockUnit)} 的價格;配方換算 1${U.esc(ing.stockUnit)} = ${U.fmtNum(ing.stockToUse)}${U.esc(ing.useUnit)}。`;
  },

  del(id) { UI.confirm("確定刪除此報價?", () => { DB.remove("supplierPrices", id); App.refresh(); }); }
};

/* ---------------- 進貨登記(照片可對照 + 手動輸入 → 入庫;可修改/刪除) ---------------- */
const PagePhotoGR = {
  rows: [],
  editId: null,   // 修改中的進貨單 id
  photo: null,    // 本次進貨附的送貨單照片(dataURL,存本機)

  // open() 新增 / open(grId) 修改 / open(null,{supplierId,rows}) 帶入預填
  // preset 優先於資料庫內容 — 中途去建新品項再回來時,才不會把打到一半的明細洗掉
  open(grId, preset) {
    PagePhotoGR.editId = grId || null;
    const gr = grId ? DB.byId("goodsReceipts", grId) : null;
    const supId = (preset && preset.supplierId) || (gr ? gr.supplierId : "");
    const date = (preset && preset.date) || (gr ? gr.date : U.today());
    PagePhotoGR.rows = (preset && preset.rows)
      ? JSON.parse(JSON.stringify(preset.rows))
      : (gr ? gr.lines.map(l => ({ ingredientId: l.ingredientId, qty: l.qtyReceived, unitPrice: l.unitPrice, expiry: l.expiry || "" })) : []);
    PagePhotoGR.photo = (preset && preset.photo !== undefined) ? preset.photo : (grId ? GRPhoto.get(grId) : null);
    UI.modal(grId ? "修改進貨單" : "進貨登記", `
      <div class="form-grid">
        <div><label class="fl">供應商 *(選了只列該廠商品項)</label><select id="pg_sup" style="width:100%" onchange="PagePhotoGR.renderRows()">${UI.supOptions(supId)}</select></div>
        <div><label class="fl">進貨日期</label><input id="pg_date" type="date" value="${date}" style="width:100%"></div>
        <div class="full">
          <label class="fl">送貨單照片(選填,存本機、事後可在「明細」核對有無打錯;不上傳雲端、不佔試算表)</label>
          <input type="file" accept="image/*" capture="environment" onchange="PagePhotoGR.readImage(this)">
        </div>
      </div>
      <div id="pg_preview" style="margin:10px 0"></div>
      <div class="toolbar" style="margin-bottom:8px">
        <button class="btn primary small" onclick="PagePhotoGR.addRow()">＋ 加一列</button>
        <span class="hint">選品項自動帶入建檔價;單價 = 每計價單位(公斤/箱/包…),價格浮動直接改</span>
      </div>
      <div id="pg_rows"></div>
      <p class="hint" style="margin-top:8px">確認入庫後:自動加庫存批號(效期依品項效期天數帶入)、寫入最新單價(BOM 成本跟著更新)、更新報價建檔。</p>`,
      {
        width: 920, okText: grId ? "✅ 儲存修改" : "✅ 確認入庫",
        onOk() { return PagePhotoGR.post(); }
      });
    if (!PagePhotoGR.rows.length) PagePhotoGR.addRow();
    else PagePhotoGR.renderRows();
    PagePhotoGR.showPreview();
  },

  showPreview() {
    const pv = document.getElementById("pg_preview");
    if (!pv) return;
    pv.innerHTML = PagePhotoGR.photo
      ? `<img src="${PagePhotoGR.photo}" style="max-width:100%;max-height:340px;border:1px solid var(--line);border-radius:8px">
         <div><button class="btn small ghost-red" style="margin-top:6px" onclick="PagePhotoGR.photo=null;PagePhotoGR.showPreview()">移除照片</button></div>`
      : "";
  },

  view(grId) {
    const g = DB.byId("goodsReceipts", grId);
    if (!g) return;
    const amt = U.sum(g.lines, l => U.lineAmt(l.qtyReceived, l.unitPrice));
    const localPhoto = GRPhoto.get(grId);
    const cloudOn = typeof Sync !== "undefined" && Sync.configured();
    const photoBox = localPhoto
      ? `<div class="mini-title" style="margin-top:14px">📷 送貨單照片(核對用)</div>
         <img src="${localPhoto}" style="max-width:100%;border:1px solid var(--line);border-radius:8px">`
      : (g.hasPhoto && cloudOn
        ? `<div class="mini-title" style="margin-top:14px">📷 送貨單照片(核對用)</div>
           <div id="gr_photo_load"><p class="hint">☁️ 從雲端硬碟載入照片中…</p></div>`
        : (g.hasPhoto
          ? `<p class="hint" style="margin-top:12px">(這張有照片,但目前沒設定雲端硬碟,無法在這台裝置載入。請到設定頁填雲端資料庫。)</p>`
          : ""));
    UI.modal("進貨明細 — " + g.date + "(" + UI.supName(g.supplierId) + ")",
      UI.table(["品項", "#數量", "#單價", "#小計", "效期"],
        g.lines.map(l => {
          const ing = DB.byId("ingredients", l.ingredientId);
          return `<tr><td>${U.esc(UI.ingName(l.ingredientId))}</td>
          <td class="num">${U.fmtNum(l.qtyReceived)} ${ing ? U.esc(ing.stockUnit) : ""}</td>
          <td class="num">${U.fmt$(l.unitPrice)}</td>
          <td class="num">${U.fmt$(U.lineAmt(l.qtyReceived, l.unitPrice))}</td>
          <td>${l.expiry || "—"}</td></tr>`;
        })) + `<p style="text-align:right;margin-top:8px;font-weight:700">合計 ${U.fmt$(amt)}</p>` + photoBox,
      { hideOk: true, width: 640 });
    // 本機沒有但雲端有 → 非同步抓下來,同時存本機快取
    if (!localPhoto && g.hasPhoto && cloudOn) {
      Sync.getPhoto(grId).then(url => {
        const box = document.getElementById("gr_photo_load");
        if (!box) return; // 使用者已關閉視窗
        if (url) {
          GRPhoto.set(grId, url);
          box.innerHTML = `<img src="${url}" style="max-width:100%;border:1px solid var(--line);border-radius:8px">`;
        } else {
          box.innerHTML = `<p class="hint">雲端找不到這張照片(可能未上傳成功)。</p>`;
        }
      }).catch(e => {
        const box = document.getElementById("gr_photo_load");
        if (box) box.innerHTML = `<p class="hint">照片載入失敗:${U.esc(e.message)}</p>`;
      });
    }
  },

  del(grId) {
    UI.confirm("確定刪除此進貨單?會一併回沖它建立的庫存與價格記錄(尚未消耗的批號)。", () => {
      Domain.reverseGoodsReceipt(grId);
      DB.remove("goodsReceipts", grId);
      GRPhoto.remove(grId);
      if (typeof Sync !== "undefined" && Sync.configured()) Sync.deletePhoto(grId).catch(() => {});
      UI.toast("已刪除進貨單並回沖庫存");
      App.refresh();
    });
  },

  readImage(input) {
    const file = input.files[0];
    if (!file) return;
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, 1200 / Math.max(img.width, img.height));
      const cv = document.createElement("canvas");
      cv.width = Math.round(img.width * scale);
      cv.height = Math.round(img.height * scale);
      cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
      PagePhotoGR.photo = cv.toDataURL("image/jpeg", 0.7);
      PagePhotoGR.showPreview();
      URL.revokeObjectURL(url);
    };
    img.src = url;
  },

  addRow() {
    PagePhotoGR.rows.push({ rawName: "", ingredientId: "", qty: 1, unitPrice: 0, expiry: "" });
    PagePhotoGR.renderRows();
  },

  renderRows() {
    const box = document.getElementById("pg_rows");
    if (!box) return;
    if (!PagePhotoGR.rows.length) {
      box.innerHTML = `<div class="empty" style="padding:14px">尚無明細 — 點「＋ 加一列」開始輸入</div>`;
      return;
    }
    const supId = UI.val("pg_sup");
    box.innerHTML = `<div class="tbl-wrap"><table class="tbl">
      <thead><tr><th>品項 *</th><th class="num">數量</th><th class="num">單價(元/計價單位)</th><th class="num">小計</th><th>效期(選填)</th><th></th></tr></thead>
      <tbody>` + PagePhotoGR.rows.map((r, idx) => {
        const ing = DB.byId("ingredients", r.ingredientId);
        return `<tr style="${r.ingredientId ? "" : "background:#fdf3e3"}">
          <td><select style="min-width:200px" onchange="PagePhotoGR.setRow(${idx},'ingredientId',this.value)">${UI.ingOptionsBySupplier(supId, r.ingredientId)}<option value="__new__">➕ 叫了新品 — 新增品項…</option></select></td>
          <td class="num"><input type="number" step="any" value="${r.qty}" style="width:80px" oninput="PagePhotoGR.updateAmt(${idx},'qty',this.value)">${ing ? " " + U.esc(ing.stockUnit) : ""}</td>
          <td class="num"><input type="number" step="any" value="${r.unitPrice ? r.unitPrice / 100 : ""}" style="width:90px" oninput="PagePhotoGR.updateAmt(${idx},'unitPrice',this.value)"></td>
          <td class="num"><b id="pg_sub_${idx}">${U.fmt$(U.lineAmt(r.qty, r.unitPrice))}</b></td>
          <td><input type="date" value="${r.expiry || ""}" style="width:135px" onchange="PagePhotoGR.rows[${idx}].expiry=this.value"></td>
          <td><button class="btn small ghost-red" onclick="PagePhotoGR.rows.splice(${idx},1);PagePhotoGR.renderRows()">✕</button></td>
        </tr>`;
      }).join("") + `</tbody></table></div>
      <p class="hint" style="margin-top:6px">合計:<b id="pg_total" style="font-size:14px">${U.fmt$(PagePhotoGR.total())}</b>(橘底列=尚未對應品項,不會入庫)</p>`;
  },

  total() { return U.sum(PagePhotoGR.rows, r => U.lineAmt(r.qty, r.unitPrice)); },

  // 數量/單價改動時即時更新該列小計與合計。
  // 只改文字、不重繪整個表格 — 重繪會把輸入框換掉導致游標跳走(打「200」變成要點三次)。
  updateAmt(idx, key, val) {
    const num = parseFloat(val) || 0;
    PagePhotoGR.rows[idx][key] = (key === "unitPrice") ? Math.round(num * 100) : num;
    const r = PagePhotoGR.rows[idx];
    const sub = document.getElementById("pg_sub_" + idx);
    if (sub) sub.textContent = U.fmt$(U.lineAmt(r.qty, r.unitPrice));
    const tot = document.getElementById("pg_total");
    if (tot) tot.textContent = U.fmt$(PagePhotoGR.total());
  },

  setRow(idx, key, val) {
    // 選到「➕ 叫了新品」→ 先去建食材主檔,建完自動填回這一列
    if (key === "ingredientId" && val === "__new__") { PagePhotoGR.newIngForRow(idx); return; }
    PagePhotoGR.rows[idx][key] = val;
    if (key === "ingredientId") {
      const ing = DB.byId("ingredients", val);
      if (ing) {
        // 效期不自動帶入(使用者要求),需要時自己填
        // 自動帶入該供應商的建檔價(每計價單位),可再手動修改
        if (!PagePhotoGR.rows[idx].unitPrice) {
          const supId = UI.val("pg_sup");
          const quote = supId ? U.sortBy(DB.get("supplierPrices").filter(q => q.supplierId === supId && q.ingredientId === val), q => q.effectiveDate, true)[0] : null;
          // 報價 → 最近進價 → 建檔時填的參考單價(新品項還沒有前兩者)
          PagePhotoGR.rows[idx].unitPrice = quote ? quote.unitPrice : (Domain.currentPrice(val) || ing.basePrice || 0);
        }
      }
    }
    PagePhotoGR.renderRows();
  },

  // 叫到主檔還沒有的新品 → 就地建檔。
  // 先把打到一半的整張單存起來,建完品項再原封不動開回來,只把新品項填進觸發的那一列。
  newIngForRow(idx) {
    const keep = {
      editId: PagePhotoGR.editId,
      supplierId: UI.val("pg_sup"),
      date: UI.val("pg_date"),
      rows: JSON.parse(JSON.stringify(PagePhotoGR.rows)),
      photo: PagePhotoGR.photo
    };
    UI.closeModal();
    PageIng.edit(null, {
      supplierId: keep.supplierId,
      onDone(ing) {
        PagePhotoGR.open(keep.editId, keep);
        PagePhotoGR.setRow(idx, "ingredientId", ing.id);  // 自動帶價並重繪
        UI.toast(`已建檔「${ing.name}」並填入第 ${idx + 1} 列`);
      },
      onCancel() { PagePhotoGR.open(keep.editId, keep); }   // 放棄建檔也要把單子還回來
    });
  },

  post() {
    const supplierId = UI.val("pg_sup");
    if (!supplierId) { UI.toast("請選擇供應商", true); return false; }
    const date = UI.val("pg_date") || U.today();
    const valid = PagePhotoGR.rows.filter(r => r.ingredientId && r.qty > 0);
    if (!valid.length) { UI.toast("沒有可入庫的明細(需對應品項且數量>0)", true); return false; }
    // 修改:先回沖舊進貨單
    const grId = PagePhotoGR.editId || U.uid("gr");
    if (PagePhotoGR.editId) Domain.reverseGoodsReceipt(grId);
    const grLines = [];
    for (const r of valid) {
      const ing = DB.byId("ingredients", r.ingredientId);
      // 數量與單價皆以「計價單位」(=庫存單位)直接計
      const stockUnitPrice = r.unitPrice;
      const batchNo = "P" + date.replace(/-/g, "") + "-" + ing.name.slice(0, 2);
      Domain.addStock(ing.id, r.qty, date, r.expiry || null, batchNo, "進貨", "進貨", grId, stockUnitPrice);
      if (stockUnitPrice > 0) {
        DB.insert("priceHistory", { ingredientId: ing.id, supplierId, unitPrice: stockUnitPrice, date, grId });
        const q = DB.get("supplierPrices").find(x => x.supplierId === supplierId && x.ingredientId === ing.id);
        if (q) DB.update("supplierPrices", q.id, { unitPrice: stockUnitPrice, effectiveDate: date });
        else DB.insert("supplierPrices", { supplierId, ingredientId: ing.id, unitPrice: stockUnitPrice, effectiveDate: date });
      }
      grLines.push({ ingredientId: ing.id, qtyReceived: r.qty, unitPrice: r.unitPrice, batchNo, expiry: r.expiry || null });
    }
    const rec = { id: grId, date, lines: grLines, source: "manual", supplierId, hasPhoto: !!PagePhotoGR.photo };
    if (PagePhotoGR.editId) DB.update("goodsReceipts", grId, rec);
    else DB.insert("goodsReceipts", rec);
    GRPhoto.set(grId, PagePhotoGR.photo);   // 本機快取(即時看)
    // 照片同步到雲端硬碟(跨裝置可看);沒設定雲端就只留本機
    const photoForCloud = PagePhotoGR.photo;
    if (typeof Sync !== "undefined" && Sync.configured()) {
      if (photoForCloud) {
        Sync.savePhoto(grId, photoForCloud)
          .then(() => { GRPhoto.cloudIds && GRPhoto.cloudIds.add(grId); })
          .catch(e => UI.toast("照片上傳雲端失敗(本機仍留存):" + e.message, true));
      } else if (PagePhotoGR.editId) {
        Sync.deletePhoto(grId).catch(() => {});
      }
    }
    UI.toast(PagePhotoGR.editId ? "進貨單已修改" : `進貨完成:${grLines.length} 品項已入庫`);
    PagePhotoGR.editId = null;
    PagePhotoGR.photo = null;
    App.refresh();
  }
};

App.register("p_po", "供應鏈 — 進貨登記", PagePurchase.renderPO);
App.register("p_quote", "供應鏈 — 供應商報價建檔", PageQuote.render);
App.register("p_trend", "供應鏈 — 食材價格趨勢", PagePurchase.renderTrend);
App.register("p_sugg", "供應鏈 — 採購建議(比價)", PagePurchase.renderSuggest);
