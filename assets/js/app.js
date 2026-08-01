(() => {
  "use strict";

  const CONFIG = window.APP_CONFIG;
  const state = {
    profile: null,
    page: "dashboard",
    chart: null,
    products: [],
    suppliers: [],
    salesCart: [],
    purchaseCart: [],
    syncing: false
  };

  const pageMeta = {
    dashboard: ["لوحة التحكم", "ملخص نشاط المؤسسة"],
    sales: ["المبيعات", "إنشاء الفواتير ومتابعتها"],
    inventory: ["المخزون", "الأصناف والكميات وحدود النقص"],
    purchases: ["المشتريات", "استلام القطع من الموردين"],
    suppliers: ["الموردون", "بيانات الموردين وحساباتهم"],
    returns: ["المرتجعات", "إرجاع الفواتير وإعادة الكميات"],
    "stock-count": ["جرد المخزون", "مقارنة الكمية الفعلية بالنظام"],
    reports: ["التقارير", "الأرباح والضريبة ودوران المخزون"],
    users: ["المستخدمون والصلاحيات", "إدارة الموظفين وربط العمليات بهم"],
    audit: ["سجل العمليات", "متابعة من قام بكل إجراء"],
    settings: ["الإعدادات", "بيانات المنشأة وحالة النظام"]
  };

  const roles = {
    admin: "مدير",
    sales: "موظف مبيعات",
    inventory: "مشرف مخزون"
  };

  const els = {};
  document.addEventListener("DOMContentLoaded", init);

  async function init() {
    Object.assign(els, {
      setupScreen: byId("setupScreen"), loginScreen: byId("loginScreen"), app: byId("app"),
      loginForm: byId("loginForm"), loginEmail: byId("loginEmail"), loginPassword: byId("loginPassword"), loginStatus: byId("loginStatus"),
      logoutBtn: byId("logoutBtn"), mainNav: byId("mainNav"), pageContent: byId("pageContent"),
      pageTitle: byId("pageTitle"), pageSubtitle: byId("pageSubtitle"), sidebar: byId("sidebar"), menuBtn: byId("menuBtn"),
      currentUserName: byId("currentUserName"), currentUserRole: byId("currentUserRole"), currentUserAvatar: byId("currentUserAvatar"),
      modalRoot: byId("modalRoot"), toastRoot: byId("toastRoot"), printRoot: byId("printRoot"),
      syncIndicator: byId("syncIndicator"), syncLabel: byId("syncLabel"), syncDetails: byId("syncDetails")
    });

    if (!Api.isConfigured) {
      showOnly(els.setupScreen);
      return;
    }

    bindGlobalEvents();
    const session = await Api.session();
    if (session) await bootApp();
    else showOnly(els.loginScreen);

    Api.onAuthChange(async (event, sessionData) => {
      if (event === "SIGNED_OUT" || !sessionData) showOnly(els.loginScreen);
    });

    if ("serviceWorker" in navigator) navigator.serviceWorker.register("service-worker.js").catch(() => {});
  }

  function bindGlobalEvents() {
    els.loginForm.addEventListener("submit", login);
    els.logoutBtn.addEventListener("click", logout);
    els.mainNav.addEventListener("click", (event) => {
      const button = event.target.closest("[data-page]");
      if (!button) return;
      navigate(button.dataset.page);
      els.sidebar.classList.remove("open");
    });
    els.menuBtn.addEventListener("click", () => els.sidebar.classList.toggle("open"));
    window.addEventListener("online", () => { updateSyncIndicator(); syncNow(); });
    window.addEventListener("offline", updateSyncIndicator);
    window.addEventListener("localqueuechange", updateSyncIndicator);
    window.addEventListener("datachanged", () => refreshCurrentPage(false));
    document.addEventListener("click", (event) => {
      if (event.target.matches("[data-close-modal]")) closeModal();
    });
    document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeModal(); });
  }

  async function login(event) {
    event.preventDefault();
    els.loginStatus.textContent = "جارٍ تسجيل الدخول...";
    try {
      await Api.signIn(els.loginEmail.value.trim(), els.loginPassword.value);
      els.loginForm.reset();
      await bootApp();
    } catch (error) {
      els.loginStatus.textContent = Api.normalizeError(error);
    }
  }

  async function logout() {
    try { await Api.signOut(); } catch (_) {}
    state.profile = null;
    showOnly(els.loginScreen);
  }

  async function bootApp() {
    try {
      state.profile = await Api.currentProfile();
      applyUser();
      showOnly(els.app);
      await updateSyncIndicator();
      await navigate("dashboard");
      if (navigator.onLine) syncNow();
    } catch (error) {
      toast(Api.normalizeError(error), "error");
      await Api.signOut().catch(() => {});
      showOnly(els.loginScreen);
    }
  }

  function applyUser() {
    const profile = state.profile;
    els.currentUserName.textContent = profile.full_name || profile.email || "مستخدم";
    els.currentUserRole.textContent = roles[profile.role] || profile.role;
    els.currentUserAvatar.textContent = (profile.full_name || "ي").trim().charAt(0);
    document.querySelectorAll("[data-roles]").forEach((node) => {
      const allowed = node.dataset.roles.split(",");
      node.classList.toggle("hidden", !allowed.includes(profile.role));
    });
  }

  async function navigate(page) {
    const button = els.mainNav.querySelector(`[data-page="${page}"]`);
    if (!button || button.classList.contains("hidden")) page = "dashboard";
    state.page = page;
    els.mainNav.querySelectorAll(".nav-item").forEach((node) => node.classList.toggle("active", node.dataset.page === page));
    const [title, subtitle] = pageMeta[page] || pageMeta.dashboard;
    els.pageTitle.textContent = title;
    els.pageSubtitle.textContent = subtitle;
    els.pageContent.innerHTML = loadingHtml();
    await refreshCurrentPage(true);
  }

  async function refreshCurrentPage(force = false) {
    const renderers = {
      dashboard: renderDashboard, sales: renderSales, inventory: renderInventory, purchases: renderPurchases,
      suppliers: renderSuppliers, returns: renderReturns, "stock-count": renderStockCount,
      reports: renderReports, users: renderUsers, audit: renderAudit, settings: renderSettings
    };
    try { await (renderers[state.page] || renderDashboard)(force); }
    catch (error) { els.pageContent.innerHTML = errorHtml(Api.normalizeError(error)); }
  }

  async function updateSyncIndicator() {
    const count = await LocalDB.queueCount().catch(() => 0);
    els.syncIndicator.classList.remove("offline", "error");
    if (!navigator.onLine) {
      els.syncIndicator.classList.add("offline");
      els.syncLabel.textContent = "بدون إنترنت";
      els.syncDetails.textContent = count ? `${count} عملية بانتظار المزامنة` : "البيانات المحلية متاحة";
    } else if (count) {
      els.syncIndicator.classList.add("offline");
      els.syncLabel.textContent = "بانتظار المزامنة";
      els.syncDetails.textContent = `${count} عملية معلّقة`;
    } else {
      els.syncLabel.textContent = "متصل";
      els.syncDetails.textContent = "تمت المزامنة";
    }
  }

  async function syncNow() {
    if (state.syncing || !navigator.onLine) return;
    state.syncing = true;
    els.syncLabel.textContent = "جارٍ المزامنة";
    try {
      const result = await Api.syncQueue(({ index, total }) => {
        els.syncDetails.textContent = `${index + 1} من ${total}`;
      });
      if (result.synced) toast(`تمت مزامنة ${result.synced} عملية`, "success");
      if (result.failed) toast(`تعذرت مزامنة ${result.failed} عملية وتحتاج مراجعة`, "warning");
    } finally {
      state.syncing = false;
      await updateSyncIndicator();
    }
  }

  async function renderDashboard(force) {
    const from = startOfMonth();
    const to = today();
    const summary = await Api.dashboard(from, to, force);
    const data = summary || {};
    const dashboardCards = state.profile.role === "admin"
      ? [
          statCard("مبيعات الشهر", money(data.sales_total), `${data.sales_count || 0} فاتورة`, "🧾"),
          statCard("صافي الربح", money(data.net_profit), "بعد تكلفة القطع والمرتجعات", "💰"),
          statCard("قيمة المخزون", money(data.inventory_value), `${data.products_count || 0} صنف`, "📦"),
          statCard("أصناف ناقصة", number(data.low_stock_count), "تحتاج إعادة طلب", "⚠️")
        ]
      : state.profile.role === "sales"
        ? [
            statCard("مبيعات الشهر", money(data.sales_total), `${data.sales_count || 0} فاتورة`, "🧾"),
            statCard("عدد الفواتير", number(data.sales_count), "خلال الشهر الحالي", "▦"),
            statCard("عدد الأصناف", number(data.products_count), "أصناف متاحة للبيع", "📦"),
            statCard("أصناف ناقصة", number(data.low_stock_count), "تنبيه للمخزون", "⚠️")
          ]
        : [
            statCard("قيمة المخزون", money(data.inventory_value), "حسب التكلفة قبل الضريبة", "💳"),
            statCard("عدد الأصناف", number(data.products_count), "الأصناف النشطة", "📦"),
            statCard("أصناف ناقصة", number(data.low_stock_count), "تحتاج إعادة طلب", "⚠️"),
            statCard("اقتراحات شراء", number((data.purchase_suggestions || []).length), "أصناف مقترحة", "🛒")
          ];
    els.pageContent.innerHTML = `
      ${offlineBanner()}
      <section class="grid grid-4">${dashboardCards.join("")}</section>
      <section class="grid grid-2" style="margin-top:16px">
        <div class="panel">
          <div class="panel-header"><div><h2>${state.profile.role === "inventory" ? "حالة المخزون" : "المبيعات خلال 30 يومًا"}</h2><p>${state.profile.role === "inventory" ? "مقارنة الأصناف المتوفرة والناقصة" : "القيمة اليومية شامل الضريبة"}</p></div></div>
          <div class="chart-wrap"><canvas id="salesChart"></canvas></div>
        </div>
        <div class="panel">
          ${state.profile.role === "sales"
            ? `<div class="panel-header"><div><h2>تنبيه المخزون</h2><p>الأصناف الناقصة تحتاج متابعة مشرف المخزون</p></div><button class="link-btn" data-go="inventory">عرض المخزون</button></div><div class="empty-state"><div class="empty-icon">⚠️</div><strong>${number(data.low_stock_count)} صنف تحت حد النقص</strong></div>`
            : `<div class="panel-header"><div><h2>الأصناف المقترح شراؤها</h2><p>حسب حد النقص ومبيعات آخر 30 يومًا</p></div><button class="link-btn" data-go="purchases">فتح المشتريات</button></div><div id="suggestionsBox">${renderSuggestions(data.purchase_suggestions || [])}</div>`}
        </div>
      </section>
      <section class="panel" style="margin-top:16px">
        <div class="panel-header"><div><h2>آخر العمليات</h2><p>آخر المبيعات والمشتريات والمرتجعات</p></div></div>
        ${simpleActivityTable(data.recent_activity || [])}
      </section>`;
    bindGoButtons();
    drawDashboardChart(data);
  }

  function renderSuggestions(items) {
    if (!items.length) return emptyState("لا توجد أصناف تحتاج شراء حاليًا", "✓");
    return `<div class="table-wrap"><table class="data-table" style="min-width:600px"><thead><tr><th>الصنف</th><th>المخزون</th><th>حد النقص</th><th>المباع 30 يوم</th><th>المقترح</th></tr></thead><tbody>${items.slice(0,10).map(item => `
      <tr><td>${escapeHtml(item.name)}</td><td>${number(item.stock_quantity)}</td><td>${number(item.min_stock)}</td><td>${number(item.sold_30_days)}</td><td><span class="badge badge-warning">${number(item.suggested_quantity)}</span></td></tr>`).join("")}</tbody></table></div>`;
  }

  function simpleActivityTable(items) {
    if (!items.length) return emptyState("ما فيه عمليات مسجلة حتى الآن", "▦");
    return `<div class="table-wrap"><table class="data-table"><thead><tr><th>العملية</th><th>المرجع</th><th>القيمة</th><th>الموظف</th><th>التاريخ</th></tr></thead><tbody>${items.map(item => `
      <tr><td>${escapeHtml(item.type_label || item.type)}</td><td>${escapeHtml(item.reference || "—")}</td><td>${money(item.amount)}</td><td>${escapeHtml(item.employee || "—")}</td><td>${dateTime(item.created_at)}</td></tr>`).join("")}</tbody></table></div>`;
  }

  function drawDashboardChart(data) {
    if (!window.Chart) return;
    if (state.chart) state.chart.destroy();
    const ctx = byId("salesChart");
    if (!ctx) return;
    if (state.profile.role === "inventory") {
      const low = Number(data.low_stock_count || 0);
      const available = Math.max(0, Number(data.products_count || 0) - low);
      state.chart = new Chart(ctx, {
        type: "doughnut",
        data: { labels: ["متوفر", "تحت حد النقص"], datasets: [{ data: [available, low] }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom" } } }
      });
      return;
    }
    const points = data.daily_sales || [];
    state.chart = new Chart(ctx, {
      type: "line",
      data: { labels: points.map(p => shortDate(p.day)), datasets: [{ label: "المبيعات", data: points.map(p => Number(p.total || 0)), tension: .3, fill: false }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
    });
  }

  async function renderInventory(force) {
    state.products = await Api.products(force);
    const suggestions = await Api.suggestedOrders(force).catch(() => []);
    const canEdit = ["admin", "inventory"].includes(state.profile.role);
    els.pageContent.innerHTML = `
      ${offlineBanner()}
      <div class="page-actions">
        <div class="search-box"><input id="inventorySearch" placeholder="ابحث بالاسم أو رقم القطعة أو الباركود"></div>
        <div class="action-group">
          <button id="scanInventoryBtn" class="btn btn-light">مسح باركود</button>
          ${canEdit ? '<button id="addProductBtn" class="btn btn-primary">+ إضافة صنف</button>' : ""}
        </div>
      </div>
      <section class="grid grid-4" style="margin-bottom:16px">
        ${statCard("عدد الأصناف", number(state.products.length), "الأصناف النشطة", "📦")}
        ${statCard("إجمالي الكمية", number(sum(state.products, "stock_quantity")), "قطعة في المخزون", "▦")}
        ${statCard("قيمة المخزون", money(state.products.reduce((a,p)=>a+Number(p.stock_quantity)*Number(p.purchase_price),0)), "حسب سعر الشراء", "💳")}
        ${statCard("ناقص", number(suggestions.length), "تحت الحد أو سريع البيع", "⚠️")}
      </section>
      <section class="panel">
        <div class="table-wrap"><table class="data-table"><thead><tr><th>الصنف</th><th>رقم القطعة</th><th>الباركود</th><th>الشراء</th><th>البيع</th><th>المخزون</th><th>حد النقص</th><th>الحالة</th><th></th></tr></thead><tbody id="inventoryRows">${inventoryRows(state.products, canEdit)}</tbody></table></div>
      </section>`;
    byId("inventorySearch").addEventListener("input", (e) => {
      const q = normalize(e.target.value);
      const filtered = state.products.filter(p => normalize(`${p.name} ${p.sku} ${p.barcode || ""}`).includes(q));
      byId("inventoryRows").innerHTML = inventoryRows(filtered, canEdit);
    });
    byId("addProductBtn")?.addEventListener("click", () => openProductModal());
    byId("scanInventoryBtn")?.addEventListener("click", () => openBarcodeScanner(code => {
      byId("inventorySearch").value = code;
      byId("inventorySearch").dispatchEvent(new Event("input"));
    }));
    byId("inventoryRows").addEventListener("click", (e) => {
      const edit = e.target.closest("[data-edit-product]");
      if (edit) openProductModal(state.products.find(p => p.id === edit.dataset.editProduct));
    });
  }

  function inventoryRows(products, canEdit) {
    if (!products.length) return `<tr><td colspan="9">${emptyState("لا توجد أصناف", "📦")}</td></tr>`;
    return products.map(p => {
      const low = Number(p.stock_quantity) <= Number(p.min_stock);
      const image = p.image_path ? `<img class="product-thumb" src="${Api.publicImageUrl(p.image_path)}" alt="">` : `<span class="product-thumb">🔧</span>`;
      return `<tr><td><div class="product-cell">${image}<div><strong>${escapeHtml(p.name)}</strong><small>${escapeHtml(p.category || "بدون تصنيف")}</small></div></div></td>
        <td><span class="code-pill">${escapeHtml(p.sku)}</span></td><td>${escapeHtml(p.barcode || "—")}</td><td>${money(p.purchase_price)}</td><td>${money(p.sale_price)}</td>
        <td><strong>${number(p.stock_quantity)}</strong></td><td>${number(p.min_stock)}</td><td>${low ? '<span class="badge badge-danger">ناقص</span>' : '<span class="badge badge-success">متوفر</span>'}</td>
        <td>${canEdit ? `<button class="btn btn-light btn-sm" data-edit-product="${p.id}">تعديل</button>` : ""}</td></tr>`;
    }).join("");
  }

  function openProductModal(product = null) {
    const isEdit = Boolean(product);
    openModal(`${isEdit ? "تعديل" : "إضافة"} صنف`, `
      <form id="productForm">
        <div class="form-grid form-grid-2">
          <label class="field"><span class="required">اسم القطعة</span><input name="name" value="${escapeAttr(product?.name || "")}" required maxlength="160"></label>
          <label class="field"><span class="required">رقم القطعة</span><input name="sku" value="${escapeAttr(product?.sku || "")}" required maxlength="80" dir="ltr"></label>
          <label class="field"><span>الباركود</span><div style="display:flex;gap:7px"><input name="barcode" value="${escapeAttr(product?.barcode || "")}" maxlength="100" dir="ltr"><button id="scanProductBarcode" type="button" class="btn btn-light">مسح</button></div></label>
          <label class="field"><span>التصنيف</span><input name="category" value="${escapeAttr(product?.category || "")}" maxlength="80"></label>
          <label class="field"><span class="required">تكلفة الشراء قبل الضريبة</span><input name="purchase_price" type="number" min="0" step="0.01" value="${product?.purchase_price ?? 0}" required></label>
          <label class="field"><span class="required">سعر البيع</span><input name="sale_price" type="number" min="0" step="0.01" value="${product?.sale_price ?? 0}" required></label>
          <label class="field"><span>الكمية الافتتاحية</span><input name="stock_quantity" type="number" min="0" step="1" value="${product?.stock_quantity ?? 0}" ${isEdit ? "readonly" : ""}><small>${isEdit ? "تعديل الكمية يتم عبر شراء أو بيع أو جرد." : "تُستخدم عند إنشاء الصنف لأول مرة."}</small></label>
          <label class="field"><span>حد النقص</span><input name="min_stock" type="number" min="0" step="1" value="${product?.min_stock ?? 0}"></label>
          <label class="field"><span>صورة القطعة</span><input name="image" type="file" accept="image/*"><small>ترفع إلى مساحة Supabase Storage.</small></label>
          <label class="field"><span>ملاحظات</span><textarea name="notes" rows="3">${escapeHtml(product?.notes || "")}</textarea></label>
        </div>
      </form>`, [
        { label: "إلغاء", className: "btn-light", close: true },
        { label: "حفظ", className: "btn-primary", id: "saveProductModal" }
      ], "modal-lg");
    byId("scanProductBarcode").addEventListener("click", () => openBarcodeScanner(code => {
      document.querySelector('#productForm [name="barcode"]').value = code;
    }));
    byId("saveProductModal").addEventListener("click", async () => {
      const form = byId("productForm");
      if (!form.reportValidity()) return;
      const fd = new FormData(form);
      const payload = {
        ...(product?.id ? { id: product.id } : {}),
        name: String(fd.get("name")).trim(), sku: String(fd.get("sku")).trim(), barcode: blankToNull(fd.get("barcode")), category: blankToNull(fd.get("category")),
        purchase_price: Number(fd.get("purchase_price")), sale_price: Number(fd.get("sale_price")), min_stock: Number(fd.get("min_stock") || 0), notes: blankToNull(fd.get("notes")),
        ...(isEdit ? {} : { stock_quantity: Number(fd.get("stock_quantity") || 0) })
      };
      setButtonBusy(byId("saveProductModal"), true);
      try {
        let saved = await Api.saveProduct(payload);
        const file = fd.get("image");
        if (file?.size) {
          const path = await Api.uploadProductImage(file, saved.id);
          saved = await Api.saveProduct({ id: saved.id, image_path: path });
        }
        closeModal(); toast("تم حفظ الصنف", "success"); await renderInventory(true);
      } catch (error) { toast(Api.normalizeError(error), "error"); setButtonBusy(byId("saveProductModal"), false); }
    });
  }

  async function renderSuppliers(force) {
    state.suppliers = await Api.suppliers(force);
    els.pageContent.innerHTML = `
      ${offlineBanner()}
      <div class="page-actions"><div class="search-box"><input id="supplierSearch" placeholder="ابحث باسم المورد أو الهاتف"></div><button id="addSupplierBtn" class="btn btn-primary">+ إضافة مورد</button></div>
      <section class="panel"><div class="table-wrap"><table class="data-table"><thead><tr><th>اسم المورد</th><th>رقم الهاتف</th><th>الحساب البنكي / الآيبان</th><th>ملاحظات</th><th></th></tr></thead><tbody id="supplierRows">${supplierRows(state.suppliers)}</tbody></table></div></section>`;
    byId("supplierSearch").addEventListener("input", (e) => {
      const q = normalize(e.target.value); byId("supplierRows").innerHTML = supplierRows(state.suppliers.filter(s => normalize(`${s.name} ${s.phone || ""}`).includes(q)));
    });
    byId("addSupplierBtn").addEventListener("click", () => openSupplierModal());
    byId("supplierRows").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-edit-supplier]"); if (btn) openSupplierModal(state.suppliers.find(s => s.id === btn.dataset.editSupplier));
    });
  }

  function supplierRows(items) {
    if (!items.length) return `<tr><td colspan="5">${emptyState("لا يوجد موردون", "🏭")}</td></tr>`;
    return items.map(s => `<tr><td><strong>${escapeHtml(s.name)}</strong></td><td dir="ltr">${escapeHtml(s.phone || "—")}</td><td dir="ltr">${escapeHtml(s.bank_account || "—")}</td><td>${escapeHtml(s.notes || "—")}</td><td><button class="btn btn-light btn-sm" data-edit-supplier="${s.id}">تعديل</button></td></tr>`).join("");
  }

  function openSupplierModal(supplier = null) {
    openModal(supplier ? "تعديل مورد" : "إضافة مورد", `
      <form id="supplierForm" class="form-grid form-grid-2">
        <label class="field"><span class="required">اسم المورد</span><input name="name" required value="${escapeAttr(supplier?.name || "")}"></label>
        <label class="field"><span>رقم الهاتف</span><input name="phone" dir="ltr" value="${escapeAttr(supplier?.phone || "")}"></label>
        <label class="field"><span>الحساب البنكي / الآيبان</span><input name="bank_account" dir="ltr" value="${escapeAttr(supplier?.bank_account || "")}"></label>
        <label class="field"><span>ملاحظات</span><textarea name="notes">${escapeHtml(supplier?.notes || "")}</textarea></label>
      </form>`, [{label:"إلغاء",className:"btn-light",close:true},{label:"حفظ",className:"btn-primary",id:"saveSupplierModal"}]);
    byId("saveSupplierModal").addEventListener("click", async () => {
      const form = byId("supplierForm"); if (!form.reportValidity()) return; const fd = new FormData(form);
      try {
        await Api.saveSupplier({ ...(supplier?.id ? {id:supplier.id}:{}), name:String(fd.get("name")).trim(), phone:blankToNull(fd.get("phone")), bank_account:blankToNull(fd.get("bank_account")), notes:blankToNull(fd.get("notes")) });
        closeModal(); toast("تم حفظ المورد", "success"); await renderSuppliers(true);
      } catch (error) { toast(Api.normalizeError(error), "error"); }
    });
  }

  async function renderSales(force) {
    state.products = await Api.products(force);
    const sales = await Api.sales({ limit: 60 }, force);
    if (!state.salesCart.length) state.salesCart = [];
    els.pageContent.innerHTML = `
      ${offlineBanner()}
      <div class="split-layout">
        <section class="panel">
          <div class="panel-header"><div><h2>إضافة القطع</h2><p>لا يوجد اسم مشتري أو عميل في النظام.</p></div><button id="scanSaleBtn" class="btn btn-light btn-sm">مسح باركود</button></div>
          <div class="search-box" style="margin-bottom:12px"><input id="saleProductSearch" placeholder="رقم القطعة، الاسم أو الباركود"></div>
          <div class="table-wrap" style="max-height:470px"><table class="data-table"><thead><tr><th>الصنف</th><th>المتوفر</th><th>السعر</th><th></th></tr></thead><tbody id="saleProductRows">${saleProductRows(state.products)}</tbody></table></div>
        </section>
        <section class="panel">
          <div class="panel-header"><div><h2>الفاتورة الحالية</h2><p id="saleInvoiceNo">${generateInvoiceNumber("S")}</p></div><button id="clearSaleCart" class="link-btn">تفريغ</button></div>
          <div id="salesCartBox"></div>
          <label class="field" style="margin-top:12px"><span>ملاحظات الفاتورة</span><textarea id="saleNotes" rows="2"></textarea></label>
          <button id="completeSaleBtn" class="btn btn-success full-width" style="margin-top:14px">إتمام البيع</button>
        </section>
      </div>
      <section class="panel" style="margin-top:18px">
        <div class="panel-header"><div><h2>آخر فواتير البيع</h2><p>كل فاتورة مرتبطة بالموظف المنفذ</p></div></div>
        <div class="table-wrap"><table class="data-table"><thead><tr><th>رقم الفاتورة</th><th>التاريخ</th><th>الموظف</th><th>الإجمالي</th><th>الحالة</th><th></th></tr></thead><tbody>${salesRows(sales)}</tbody></table></div>
      </section>`;
    renderSalesCart();
    byId("saleProductSearch").addEventListener("input", e => {
      const q = normalize(e.target.value); byId("saleProductRows").innerHTML = saleProductRows(state.products.filter(p => normalize(`${p.name} ${p.sku} ${p.barcode || ""}`).includes(q)));
    });
    byId("saleProductRows").addEventListener("click", e => { const b=e.target.closest("[data-add-sale]"); if(b) addToSalesCart(b.dataset.addSale); });
    byId("clearSaleCart").addEventListener("click", () => { state.salesCart=[]; renderSalesCart(); });
    byId("scanSaleBtn").addEventListener("click", () => openBarcodeScanner(code => {
      const p=state.products.find(x=>x.barcode===code||x.sku===code); if(p) addToSalesCart(p.id); else toast("الباركود غير موجود في المخزون","warning");
    }));
    byId("completeSaleBtn").addEventListener("click", completeSale);
    els.pageContent.querySelectorAll("[data-view-sale]").forEach(b=>b.addEventListener("click",()=>openSaleDetails(b.dataset.viewSale)));
    els.pageContent.querySelectorAll("[data-return-sale]").forEach(b=>b.addEventListener("click",()=>openReturnModal(b.dataset.returnSale)));
  }

  function saleProductRows(products) {
    if (!products.length) return `<tr><td colspan="4">${emptyState("لا توجد نتائج", "🔧")}</td></tr>`;
    return products.map(p=>`<tr><td><strong>${escapeHtml(p.name)}</strong><br><small>${escapeHtml(p.sku)}</small></td><td>${number(p.stock_quantity)}</td><td>${money(p.sale_price)}</td><td><button class="btn btn-primary btn-sm" data-add-sale="${p.id}" ${Number(p.stock_quantity)<=0?"disabled":""}>إضافة</button></td></tr>`).join("");
  }

  function addToSalesCart(productId) {
    const product=state.products.find(p=>p.id===productId); if(!product)return;
    const item=state.salesCart.find(i=>i.product_id===productId);
    if(item){ if(item.quantity<Number(product.stock_quantity)) item.quantity+=1; else return toast("وصلت للكمية المتوفرة","warning"); }
    else state.salesCart.push({product_id:product.id,name:product.name,sku:product.sku,quantity:1,unit_price:Number(product.sale_price),available:Number(product.stock_quantity)});
    renderSalesCart();
  }

  function renderSalesCart() {
    const box=byId("salesCartBox"); if(!box)return;
    if(!state.salesCart.length){box.innerHTML=emptyState("أضف قطعًا إلى الفاتورة","🧾");return;}
    const totals=cartTotals(state.salesCart,"unit_price");
    box.innerHTML=`<div class="cart-list">${state.salesCart.map((i,index)=>`<div class="cart-item"><div><strong>${escapeHtml(i.name)}</strong><small>${escapeHtml(i.sku)}</small></div><label class="field"><span>الكمية</span><input data-sale-qty="${index}" type="number" min="1" max="${i.available}" value="${i.quantity}"></label><label class="field"><span>السعر</span><input data-sale-price="${index}" type="number" min="0" step="0.01" value="${i.unit_price}" ${state.profile.role === "admin" ? "" : "readonly"}></label><button class="close-btn" data-remove-sale="${index}">×</button></div>`).join("")}</div>${cartSummary(totals)}`;
    box.querySelectorAll("[data-sale-qty]").forEach(input=>input.addEventListener("input",()=>{const i=state.salesCart[Number(input.dataset.saleQty)];i.quantity=Math.max(1,Math.min(i.available,Number(input.value)||1));renderSalesCart();}));
    box.querySelectorAll("[data-sale-price]").forEach(input=>input.addEventListener("input",()=>{state.salesCart[Number(input.dataset.salePrice)].unit_price=Math.max(0,Number(input.value)||0);renderSalesCart();}));
    box.querySelectorAll("[data-remove-sale]").forEach(btn=>btn.addEventListener("click",()=>{state.salesCart.splice(Number(btn.dataset.removeSale),1);renderSalesCart();}));
  }

  async function completeSale() {
    if(!state.salesCart.length)return toast("الفاتورة فارغة","warning");
    const invoiceNumber=byId("saleInvoiceNo").textContent;
    const payload={invoiceNumber,saleDate:new Date().toISOString(),notes:byId("saleNotes").value.trim(),clientRequestId:crypto.randomUUID(),items:state.salesCart.map(i=>({product_id:i.product_id,quantity:i.quantity,unit_price:i.unit_price,vat_rate:Number(CONFIG.business.defaultVatRate||15)}))};
    setButtonBusy(byId("completeSaleBtn"),true);
    try{
      const result=await Api.completeSale(payload,true);
      if(result.queued) toast("تم حفظ الفاتورة محليًا وستُزامن عند عودة الإنترنت","warning"); else toast("تمت عملية البيع","success");
      state.salesCart=[]; await renderSales(true);
    }catch(error){toast(Api.normalizeError(error),"error");setButtonBusy(byId("completeSaleBtn"),false);}
  }

  function salesRows(sales) {
    if(!sales.length)return `<tr><td colspan="6">${emptyState("لا توجد فواتير بيع","🧾")}</td></tr>`;
    return sales.map(s=>`<tr><td><span class="code-pill">${escapeHtml(s.invoice_number)}</span></td><td>${dateTime(s.sale_date)}</td><td>${escapeHtml(s.profiles?.full_name||"—")}</td><td>${money(s.total)}</td><td>${saleStatus(s.status)}</td><td class="actions-cell"><button class="btn btn-light btn-sm" data-view-sale="${s.id}">عرض</button>${s.status!=="returned"?`<button class="btn btn-warning btn-sm" data-return-sale="${s.id}">إرجاع</button>`:""}</td></tr>`).join("");
  }

  async function openSaleDetails(id) {
    try { const sale=await Api.sale(id); showSaleInvoice(sale); } catch(error){toast(Api.normalizeError(error),"error");}
  }

  function showSaleInvoice(sale) {
    const html=invoiceHtml(sale);
    openModal(`فاتورة ${sale.invoice_number}`,html,[{label:"إغلاق",className:"btn-light",close:true},{label:"حفظ PDF",className:"btn-secondary",id:"pdfSale"},{label:"طباعة",className:"btn-primary",id:"printSale"}],"modal-lg");
    byId("printSale").addEventListener("click",()=>printInvoiceHtml(html));
    byId("pdfSale").addEventListener("click",()=>saveInvoicePdf(html,sale.invoice_number));
  }

  async function renderPurchases(force) {
    [state.products,state.suppliers]=await Promise.all([Api.products(force),Api.suppliers(force)]);
    const purchases=await Api.purchases({limit:60},force);
    els.pageContent.innerHTML=`${offlineBanner()}<div class="split-layout"><section class="panel"><div class="panel-header"><div><h2>اختيار القطع</h2><p>تسجيل الاستلام يرفع المخزون تلقائيًا</p></div></div><div class="search-box" style="margin-bottom:12px"><input id="purchaseProductSearch" placeholder="ابحث عن قطعة"></div><div class="table-wrap" style="max-height:470px"><table class="data-table"><thead><tr><th>الصنف</th><th>المخزون</th><th>آخر تكلفة</th><th></th></tr></thead><tbody id="purchaseProductRows">${purchaseProductRows(state.products)}</tbody></table></div></section>
      <section class="panel"><div class="panel-header"><div><h2>فاتورة الشراء</h2><p>بيانات المورد والفاتورة</p></div><button id="clearPurchaseCart" class="link-btn">تفريغ</button></div><div class="form-grid form-grid-2"><label class="field"><span class="required">المورد</span><select id="purchaseSupplier"><option value="">اختر المورد</option>${state.suppliers.map(s=>`<option value="${s.id}">${escapeHtml(s.name)}</option>`).join("")}</select></label><label class="field"><span class="required">رقم فاتورة المورد</span><input id="purchaseInvoiceNo"></label></div><div id="purchaseCartBox" style="margin-top:14px"></div><label class="field" style="margin-top:12px"><span>ملاحظات</span><textarea id="purchaseNotes" rows="2"></textarea></label><button id="completePurchaseBtn" class="btn btn-success full-width" style="margin-top:14px">تسجيل الاستلام</button></section></div>
      <section class="panel" style="margin-top:18px"><div class="panel-header"><div><h2>آخر فواتير الشراء</h2><p>تزيد الكميات مباشرة عند التسجيل</p></div></div><div class="table-wrap"><table class="data-table"><thead><tr><th>رقم الفاتورة</th><th>المورد</th><th>التاريخ</th><th>الموظف</th><th>الإجمالي</th></tr></thead><tbody>${purchaseRows(purchases)}</tbody></table></div></section>`;
    renderPurchaseCart();
    byId("purchaseProductSearch").addEventListener("input",e=>{const q=normalize(e.target.value);byId("purchaseProductRows").innerHTML=purchaseProductRows(state.products.filter(p=>normalize(`${p.name} ${p.sku}`).includes(q)));});
    byId("purchaseProductRows").addEventListener("click",e=>{const b=e.target.closest("[data-add-purchase]");if(b)addToPurchaseCart(b.dataset.addPurchase);});
    byId("clearPurchaseCart").addEventListener("click",()=>{state.purchaseCart=[];renderPurchaseCart();});
    byId("completePurchaseBtn").addEventListener("click",completePurchase);
  }

  function purchaseProductRows(products){if(!products.length)return `<tr><td colspan="4">${emptyState("لا توجد أصناف","📦")}</td></tr>`;return products.map(p=>`<tr><td><strong>${escapeHtml(p.name)}</strong><br><small>${escapeHtml(p.sku)}</small></td><td>${number(p.stock_quantity)}</td><td>${money(p.purchase_price)}</td><td><button class="btn btn-primary btn-sm" data-add-purchase="${p.id}">إضافة</button></td></tr>`).join("");}
  function addToPurchaseCart(id){const p=state.products.find(x=>x.id===id);if(!p)return;const item=state.purchaseCart.find(i=>i.product_id===id);if(item)item.quantity+=1;else state.purchaseCart.push({product_id:p.id,name:p.name,sku:p.sku,quantity:1,unit_cost:Number(p.purchase_price)});renderPurchaseCart();}
  function renderPurchaseCart(){const box=byId("purchaseCartBox");if(!box)return;if(!state.purchaseCart.length){box.innerHTML=emptyState("أضف القطع المستلمة","🛒");return;}const totals=cartTotals(state.purchaseCart,"unit_cost");box.innerHTML=`<div class="cart-list">${state.purchaseCart.map((i,index)=>`<div class="cart-item"><div><strong>${escapeHtml(i.name)}</strong><small>${escapeHtml(i.sku)}</small></div><label class="field"><span>الكمية</span><input data-purchase-qty="${index}" type="number" min="1" value="${i.quantity}"></label><label class="field"><span>التكلفة شاملة الضريبة</span><input data-purchase-cost="${index}" type="number" min="0" step="0.01" value="${i.unit_cost}"></label><button class="close-btn" data-remove-purchase="${index}">×</button></div>`).join("")}</div>${cartSummary(totals)}`;box.querySelectorAll("[data-purchase-qty]").forEach(i=>i.addEventListener("input",()=>{state.purchaseCart[Number(i.dataset.purchaseQty)].quantity=Math.max(1,Number(i.value)||1);renderPurchaseCart();}));box.querySelectorAll("[data-purchase-cost]").forEach(i=>i.addEventListener("input",()=>{state.purchaseCart[Number(i.dataset.purchaseCost)].unit_cost=Math.max(0,Number(i.value)||0);renderPurchaseCart();}));box.querySelectorAll("[data-remove-purchase]").forEach(b=>b.addEventListener("click",()=>{state.purchaseCart.splice(Number(b.dataset.removePurchase),1);renderPurchaseCart();}));}
  async function completePurchase(){if(!byId("purchaseSupplier").value)return toast("اختر المورد","warning");if(!byId("purchaseInvoiceNo").value.trim())return toast("أدخل رقم فاتورة المورد","warning");if(!state.purchaseCart.length)return toast("أضف قطعة واحدة على الأقل","warning");const payload={supplierId:byId("purchaseSupplier").value,invoiceNumber:byId("purchaseInvoiceNo").value.trim(),purchaseDate:new Date().toISOString(),notes:byId("purchaseNotes").value.trim(),clientRequestId:crypto.randomUUID(),items:state.purchaseCart.map(i=>({product_id:i.product_id,quantity:i.quantity,unit_cost:i.unit_cost,vat_rate:Number(CONFIG.business.defaultVatRate||15)}))};setButtonBusy(byId("completePurchaseBtn"),true);try{const result=await Api.recordPurchase(payload,true);toast(result.queued?"تم حفظ الشراء محليًا بانتظار المزامنة":"تم تسجيل الشراء وزيادة المخزون",result.queued?"warning":"success");state.purchaseCart=[];await renderPurchases(true);}catch(error){toast(Api.normalizeError(error),"error");setButtonBusy(byId("completePurchaseBtn"),false);}}
  function purchaseRows(items){if(!items.length)return `<tr><td colspan="5">${emptyState("لا توجد فواتير شراء","🛒")}</td></tr>`;return items.map(p=>`<tr><td>${escapeHtml(p.invoice_number)}</td><td>${escapeHtml(p.suppliers?.name||"—")}</td><td>${dateTime(p.purchase_date)}</td><td>${escapeHtml(p.profiles?.full_name||"—")}</td><td>${money(p.total)}</td></tr>`).join("");}

  async function renderReturns(force){const items=await Api.returns({limit:100},force);const sales=await Api.sales({limit:100},force);els.pageContent.innerHTML=`${offlineBanner()}<div class="page-actions"><div class="search-box"><input id="returnInvoiceSearch" placeholder="ابحث برقم فاتورة البيع"></div><button id="startReturnBtn" class="btn btn-warning">إرجاع فاتورة</button></div><section class="panel"><div class="table-wrap"><table class="data-table"><thead><tr><th>الفاتورة</th><th>التاريخ</th><th>السبب</th><th>الموظف</th><th>القيمة</th></tr></thead><tbody>${returnsRows(items)}</tbody></table></div></section>`;byId("startReturnBtn").addEventListener("click",()=>{const q=byId("returnInvoiceSearch").value.trim();const sale=sales.find(s=>s.invoice_number===q)||sales.find(s=>s.invoice_number.includes(q));if(!sale)return toast("أدخل رقم فاتورة بيع صحيحة","warning");openReturnModal(sale.id);});}
  function returnsRows(items){if(!items.length)return `<tr><td colspan="5">${emptyState("لا توجد مرتجعات","↩")}</td></tr>`;return items.map(r=>`<tr><td>${escapeHtml(r.sales?.invoice_number||"—")}</td><td>${dateTime(r.return_date)}</td><td>${escapeHtml(r.reason)}</td><td>${escapeHtml(r.profiles?.full_name||"—")}</td><td>${money(r.total)}</td></tr>`).join("");}
  async function openReturnModal(saleId){try{const sale=await Api.sale(saleId);const available=sale.sale_items.filter(i=>Number(i.quantity)>Number(i.returned_quantity||0));if(!available.length)return toast("جميع كميات الفاتورة مرتجعة","warning");openModal(`إرجاع فاتورة ${sale.invoice_number}`,`<form id="returnForm"><label class="field"><span class="required">سبب الإرجاع</span><textarea id="returnReason" required></textarea></label><div class="table-wrap" style="margin-top:14px"><table class="data-table"><thead><tr><th>الصنف</th><th>المباع</th><th>المرتجع سابقًا</th><th>كمية الإرجاع</th></tr></thead><tbody>${available.map(i=>`<tr><td>${escapeHtml(i.name_snapshot)}</td><td>${number(i.quantity)}</td><td>${number(i.returned_quantity||0)}</td><td><input data-return-item="${i.id}" data-product-id="${i.product_id}" data-max="${Number(i.quantity)-Number(i.returned_quantity||0)}" type="number" min="0" max="${Number(i.quantity)-Number(i.returned_quantity||0)}" value="0" style="width:110px"></td></tr>`).join("")}</tbody></table></div></form>`,[{label:"إلغاء",className:"btn-light",close:true},{label:"تأكيد الإرجاع",className:"btn-warning",id:"confirmReturn"}],"modal-lg");byId("confirmReturn").addEventListener("click",async()=>{const reason=byId("returnReason").value.trim();if(!reason)return toast("اكتب سبب الإرجاع","warning");const returnItems=[...document.querySelectorAll("[data-return-item]")].map(i=>({sale_item_id:i.dataset.returnItem,product_id:i.dataset.productId,quantity:Number(i.value)||0})).filter(i=>i.quantity>0);if(!returnItems.length)return toast("حدد كمية مرتجعة","warning");try{const result=await Api.returnSale({saleId:sale.id,invoiceNumber:sale.invoice_number,reason,items:returnItems,clientRequestId:crypto.randomUUID()},true);closeModal();toast(result.queued?"تم حفظ المرتجع محليًا":"تم الإرجاع وإعادة الكمية للمخزون",result.queued?"warning":"success");await refreshCurrentPage(true);}catch(error){toast(Api.normalizeError(error),"error");}});}catch(error){toast(Api.normalizeError(error),"error");}}

  async function renderStockCount(force){state.products=await Api.products(force);const counts=await Api.counts(force);els.pageContent.innerHTML=`${offlineBanner()}<div class="page-actions"><div><strong>جرد جديد</strong><div class="helper">أدخل الكمية الفعلية، وسيظهر الفرق مباشرة.</div></div><button id="saveCountBtn" class="btn btn-success">اعتماد الجرد</button></div><section class="panel"><div class="search-box" style="margin-bottom:12px"><input id="countSearch" placeholder="ابحث عن صنف"></div><div class="table-wrap"><table class="data-table"><thead><tr><th>الصنف</th><th>المتوقع</th><th>الفعلي</th><th>الفرق</th><th>سبب الفرق</th></tr></thead><tbody id="countRows">${countRows(state.products)}</tbody></table></div><label class="field" style="margin-top:14px"><span>ملاحظات الجرد</span><textarea id="countNotes" rows="2"></textarea></label></section><section class="panel" style="margin-top:16px"><div class="panel-header"><div><h2>عمليات الجرد السابقة</h2></div></div><div class="table-wrap"><table class="data-table"><thead><tr><th>التاريخ</th><th>الموظف</th><th>عدد الأصناف</th><th>إجمالي الفروقات</th></tr></thead><tbody>${countsRows(counts)}</tbody></table></div></section>`;bindCountInputs();byId("countSearch").addEventListener("input",e=>{const q=normalize(e.target.value);byId("countRows").innerHTML=countRows(state.products.filter(p=>normalize(`${p.name} ${p.sku}`).includes(q)));bindCountInputs();});byId("saveCountBtn").addEventListener("click",completeCount);}
  function countRows(products){return products.map(p=>`<tr><td><strong>${escapeHtml(p.name)}</strong><br><small>${escapeHtml(p.sku)}</small></td><td data-expected="${p.id}">${number(p.stock_quantity)}</td><td><input data-count-actual="${p.id}" data-expected-value="${Number(p.stock_quantity)}" type="number" min="0" step="1" value="${Number(p.stock_quantity)}" style="width:110px"></td><td data-count-diff="${p.id}">0</td><td><input data-count-reason="${p.id}" placeholder="هالك، فقدان، زيادة..." disabled></td></tr>`).join("");}
  function bindCountInputs(){document.querySelectorAll("[data-count-actual]").forEach(i=>i.addEventListener("input",()=>{const diff=(Number(i.value)||0)-Number(i.dataset.expectedValue);const cell=document.querySelector(`[data-count-diff="${i.dataset.countActual}"]`);const reason=document.querySelector(`[data-count-reason="${i.dataset.countActual}"]`);cell.textContent=number(diff);cell.innerHTML=diff===0?"0":`<span class="badge ${diff>0?"badge-info":"badge-danger"}">${diff>0?"+":""}${number(diff)}</span>`;reason.disabled=diff===0;}));}
  async function completeCount(){const items=[...document.querySelectorAll("[data-count-actual]")].map(i=>({product_id:i.dataset.countActual,actual_quantity:Number(i.value)||0,reason:document.querySelector(`[data-count-reason="${i.dataset.countActual}"]`)?.value.trim()||""}));if(!items.length)return;setButtonBusy(byId("saveCountBtn"),true);try{const result=await Api.completeCount({countDate:new Date().toISOString(),notes:byId("countNotes").value.trim(),items,clientRequestId:crypto.randomUUID()},true);toast(result.queued?"تم حفظ الجرد محليًا":"تم اعتماد الجرد وتسجيل الفروقات",result.queued?"warning":"success");await renderStockCount(true);}catch(error){toast(Api.normalizeError(error),"error");setButtonBusy(byId("saveCountBtn"),false);}}
  function countsRows(items){if(!items.length)return `<tr><td colspan="4">${emptyState("لا توجد عمليات جرد","✓")}</td></tr>`;return items.map(c=>`<tr><td>${dateTime(c.count_date)}</td><td>${escapeHtml(c.profiles?.full_name||"—")}</td><td>${c.inventory_count_items?.length||0}</td><td>${number((c.inventory_count_items||[]).reduce((a,i)=>a+Math.abs(Number(i.difference||0)),0))}</td></tr>`).join("");}

  async function renderReports(force){const from=firstDayOfYear(),to=today();els.pageContent.innerHTML=`<div class="page-actions"><div class="filters"><input id="reportFrom" type="date" value="${from}"><input id="reportTo" type="date" value="${to}"><button id="runReports" class="btn btn-primary">تحديث</button></div><button id="printReport" class="btn btn-light">طباعة التقرير</button></div><div id="reportContent">${loadingHtml()}</div>`;byId("runReports").addEventListener("click",()=>loadReports(true));byId("printReport").addEventListener("click",()=>window.print());await loadReports(force);}
  async function loadReports(force){const from=byId("reportFrom").value,to=byId("reportTo").value,box=byId("reportContent");box.innerHTML=loadingHtml();try{const [pl,vat,turnover]=await Promise.all([Api.profitLoss(from,to,force),Api.vatReport(from,to,force),Api.turnover(from,to,force)]);box.innerHTML=`<section class="grid grid-4">${statCard("صافي المبيعات",money(pl.net_sales),`${pl.sales_count||0} فاتورة`,"🧾")}${statCard("تكلفة البضاعة",money(pl.cost_of_goods),"تكلفة القطع المباعة","📦")}${statCard("مجمل الربح",money(pl.gross_profit),"قبل المصاريف الأخرى","💰")}${statCard("هامش الربح",`${number(pl.margin_percent)}%`,"من صافي المبيعات","📈")}</section><section class="grid grid-3" style="margin-top:16px">${statCard("ضريبة المبيعات",money(vat.output_vat),"ضريبة مستحقة","+")}${statCard("ضريبة المشتريات",money(vat.input_vat),"ضريبة قابلة للخصم","−")}${statCard("صافي الضريبة",money(vat.net_vat),"المبيعات ناقص المشتريات","⚖️")}</section><section class="panel" style="margin-top:16px"><div class="panel-header"><div><h2>سرعة دوران المخزون</h2><p>الأكثر والأقل مبيعًا خلال الفترة</p></div></div><div class="table-wrap"><table class="data-table"><thead><tr><th>الصنف</th><th>الكمية المباعة</th><th>تكلفة المبيعات</th><th>المخزون الحالي</th><th>معدل الدوران</th><th>التصنيف</th></tr></thead><tbody>${turnoverRows(turnover||[])}</tbody></table></div></section>`;}catch(error){box.innerHTML=errorHtml(Api.normalizeError(error));}}
  function turnoverRows(items){if(!items.length)return `<tr><td colspan="6">${emptyState("لا توجد بيانات كافية","📊")}</td></tr>`;return items.map(i=>`<tr><td>${escapeHtml(i.name)}</td><td>${number(i.quantity_sold)}</td><td>${money(i.cost_of_goods)}</td><td>${number(i.current_stock)}</td><td>${number(i.turnover_rate)}</td><td>${i.turnover_rate>=2?'<span class="badge badge-success">سريع</span>':i.turnover_rate>=.5?'<span class="badge badge-info">متوسط</span>':'<span class="badge badge-warning">بطيء</span>'}</td></tr>`).join("");}

  async function renderUsers(force){const users=await Api.profiles(force);els.pageContent.innerHTML=`<div class="page-actions"><div><strong>المستخدمون</strong><div class="helper">المدير ينشئ الحسابات ويحدد الصلاحية.</div></div><button id="addUserBtn" class="btn btn-primary">+ إضافة مستخدم</button></div><section class="grid grid-3" style="margin-bottom:16px">${statCard("المديرون",number(users.filter(u=>u.role==="admin").length),"صلاحية كاملة","👑")}${statCard("المبيعات",number(users.filter(u=>u.role==="sales").length),"بيع ومرتجعات","🧾")}${statCard("المخزون",number(users.filter(u=>u.role==="inventory").length),"مشتريات وجرد","📦")}</section><section class="panel"><div class="table-wrap"><table class="data-table"><thead><tr><th>الاسم</th><th>البريد</th><th>الدور</th><th>الحالة</th><th>تاريخ الإنشاء</th><th></th></tr></thead><tbody>${users.map(u=>`<tr><td>${escapeHtml(u.full_name||"—")}</td><td dir="ltr">${escapeHtml(u.email||"—")}</td><td>${roleBadge(u.role)}</td><td>${u.is_active?'<span class="badge badge-success">نشط</span>':'<span class="badge badge-danger">موقوف</span>'}</td><td>${dateTime(u.created_at)}</td><td>${u.id!==state.profile.id?`<button class="btn btn-light btn-sm" data-edit-user="${u.id}">تعديل</button>`:""}</td></tr>`).join("")}</tbody></table></div></section><section class="panel" style="margin-top:16px"><div class="panel-header"><div><h2>ملخص الصلاحيات</h2></div></div><div class="role-permissions"><div class="permission-row"><strong>مدير</strong><span>جميع الصلاحيات والتقارير والمستخدمين</span></div><div class="permission-row"><strong>موظف مبيعات</strong><span>المبيعات والمرتجعات وعرض المخزون</span></div><div class="permission-row"><strong>مشرف مخزون</strong><span>الأصناف والموردون والمشتريات والجرد</span></div></div></section>`;byId("addUserBtn").addEventListener("click",()=>openUserModal());document.querySelectorAll("[data-edit-user]").forEach(b=>b.addEventListener("click",()=>openUserModal(users.find(u=>u.id===b.dataset.editUser))));}
  function openUserModal(user=null){openModal(user?"تعديل مستخدم":"إضافة مستخدم",`<form id="userForm" class="form-grid form-grid-2"><label class="field"><span class="required">الاسم</span><input name="full_name" required value="${escapeAttr(user?.full_name||"")}"></label><label class="field"><span class="required">البريد</span><input name="email" type="email" required value="${escapeAttr(user?.email||"")}" ${user?"readonly":""}></label>${user?"":'<label class="field"><span class="required">كلمة مرور مؤقتة</span><input name="password" type="password" minlength="8" required></label>'}<label class="field"><span class="required">الصلاحية</span><select name="role"><option value="sales" ${user?.role==="sales"?"selected":""}>موظف مبيعات</option><option value="inventory" ${user?.role==="inventory"?"selected":""}>مشرف مخزون</option><option value="admin" ${user?.role==="admin"?"selected":""}>مدير</option></select></label>${user?`<label class="inline-check"><input name="is_active" type="checkbox" ${user.is_active?"checked":""}> المستخدم نشط</label>`:""}</form>`,[{label:"إلغاء",className:"btn-light",close:true},{label:"حفظ",className:"btn-primary",id:"saveUser"}]);byId("saveUser").addEventListener("click",async()=>{const form=byId("userForm");if(!form.reportValidity())return;const fd=new FormData(form);try{if(user)await Api.manageUser("update",{userId:user.id,fullName:String(fd.get("full_name")).trim(),role:fd.get("role"),isActive:fd.get("is_active")==="on"});else await Api.manageUser("create",{email:String(fd.get("email")).trim(),password:String(fd.get("password")),fullName:String(fd.get("full_name")).trim(),role:fd.get("role")});closeModal();toast("تم حفظ المستخدم","success");await renderUsers(true);}catch(error){toast(Api.normalizeError(error),"error");}});}

  async function renderAudit(force){const rows=await Api.audit(300,force);els.pageContent.innerHTML=`<section class="panel"><div class="panel-header"><div><h2>آخر 300 عملية</h2><p>يسجل النظام المستخدم والإجراء والكيان والوقت</p></div><button id="refreshAudit" class="btn btn-light">تحديث</button></div><div class="table-wrap"><table class="data-table"><thead><tr><th>الموظف</th><th>الإجراء</th><th>النوع</th><th>المرجع</th><th>التفاصيل</th><th>التاريخ</th></tr></thead><tbody>${rows.length?rows.map(r=>`<tr><td>${escapeHtml(r.profiles?.full_name||"نظام")}</td><td>${escapeHtml(r.action)}</td><td>${escapeHtml(r.entity_type)}</td><td>${escapeHtml(r.entity_id||"—")}</td><td><small>${escapeHtml(JSON.stringify(r.details||{}))}</small></td><td>${dateTime(r.created_at)}</td></tr>`).join(""):`<tr><td colspan="6">${emptyState("لا توجد سجلات","🛡️")}</td></tr>`}</tbody></table></div></section>`;byId("refreshAudit").addEventListener("click",()=>renderAudit(true));}

  async function renderSettings(){const queue=await LocalDB.listQueue(["pending","failed","processing"]);els.pageContent.innerHTML=`<section class="grid grid-2"><div class="panel"><div class="panel-header"><div><h2>بيانات المنشأة</h2></div></div><div class="form-grid"><label class="field"><span>اسم المنشأة</span><input value="${escapeAttr(CONFIG.business.name)}" readonly></label><label class="field"><span>السجل التجاري</span><input value="${escapeAttr(CONFIG.business.commercialRegistration)}" readonly></label><label class="field"><span>الموقع</span><input value="${escapeAttr(CONFIG.business.address)}" readonly></label><label class="field"><span>الرقم الضريبي</span><input value="${escapeAttr(CONFIG.business.vatNumber||"غير مضاف")}" readonly></label></div><p class="helper">تُعدل هذه القيم من ملف <code>assets/js/config.js</code>.</p></div><div class="panel"><div class="panel-header"><div><h2>حالة النظام</h2></div></div><div class="permission-row"><strong>الإصدار</strong><span>${escapeHtml(CONFIG.appVersion)}</span></div><div class="permission-row"><strong>الاتصال</strong><span>${navigator.onLine?"متصل":"بدون إنترنت"}</span></div><div class="permission-row"><strong>العمليات المعلقة</strong><span>${queue.length}</span></div><div class="permission-row"><strong>الاستضافة</strong><span>GitHub Pages + Supabase</span></div><button id="syncNowBtn" class="btn btn-primary full-width" style="margin-top:14px">مزامنة الآن</button></div></section><section class="panel" style="margin-top:16px"><div class="panel-header"><div><h2>طابور المزامنة</h2><p>العمليات التي أُنشئت وقت انقطاع الإنترنت</p></div></div>${queue.length?`<div class="table-wrap"><table class="data-table"><thead><tr><th>العملية</th><th>الحالة</th><th>المحاولات</th><th>آخر خطأ</th><th>التاريخ</th><th></th></tr></thead><tbody>${queue.map(q=>`<tr><td>${escapeHtml(q.label||q.type)}</td><td>${queueStatus(q.status)}</td><td>${q.retries||0}</td><td>${escapeHtml(q.lastError||"—")}</td><td>${dateTime(q.createdAt)}</td><td>${q.status === "failed" ? `<button class="btn btn-danger btn-sm" data-discard-queue="${q.id}">حذف</button>` : ""}</td></tr>`).join("")}</tbody></table></div>`:emptyState("لا توجد عمليات معلقة","✓")}</section>`;byId("syncNowBtn").addEventListener("click",syncNow);document.querySelectorAll("[data-discard-queue]").forEach((button)=>button.addEventListener("click",async()=>{await LocalDB.removeQueue(button.dataset.discardQueue);toast("تم حذف العملية المعلقة","success");await renderSettings();await updateSyncIndicator();}));}

  function openBarcodeScanner(onDetected) {
    if (!navigator.mediaDevices?.getUserMedia) return toast("الكاميرا غير مدعومة في هذا الجهاز", "error");
    if (!("BarcodeDetector" in window)) return toast("المسح المباشر غير مدعوم في هذا المتصفح. استخدم قارئ باركود خارجي أو اكتب الرقم.", "warning");

    const wrapper = document.createElement("div");
    wrapper.className = "modal";
    wrapper.id = "barcodeScannerModal";
    wrapper.innerHTML = `<div class="modal-backdrop"></div><section class="modal-card"><header class="modal-header"><h2>مسح الباركود</h2><button class="close-btn" data-cancel-scanner>×</button></header><div class="modal-body"><div class="camera-wrap"><video id="barcodeVideo" autoplay playsinline></video><div class="camera-guide"></div></div><p class="helper">وجّه الكاميرا نحو الباركود. تعمل الميزة عبر HTTPS.</p></div><footer class="modal-footer"><button class="btn btn-light" data-cancel-scanner>إلغاء</button></footer></section>`;
    els.modalRoot.appendChild(wrapper);

    const video = wrapper.querySelector("#barcodeVideo");
    let stream;
    let active = true;
    const stop = () => {
      active = false;
      stream?.getTracks().forEach((track) => track.stop());
      wrapper.remove();
    };
    wrapper.querySelectorAll("[data-cancel-scanner], .modal-backdrop").forEach((node) => node.addEventListener("click", stop));

    navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } } }).then((mediaStream) => {
      stream = mediaStream;
      video.srcObject = mediaStream;
      const detector = new BarcodeDetector({ formats: ["code_128", "ean_13", "ean_8", "upc_a", "upc_e", "qr_code"] });
      const scan = async () => {
        if (!active) return;
        try {
          const codes = await detector.detect(video);
          if (codes.length) {
            const value = codes[0].rawValue;
            stop();
            onDetected(value);
            return;
          }
        } catch (_) {}
        requestAnimationFrame(scan);
      };
      scan();
    }).catch(() => {
      stop();
      toast("تعذر فتح الكاميرا", "error");
    });
  }

  function openModal(title, body, buttons=[], size=""){els.modalRoot.innerHTML=`<div class="modal"><div class="modal-backdrop" data-close-modal></div><section class="modal-card ${size}"><header class="modal-header"><h2>${escapeHtml(title)}</h2><button class="close-btn" data-close-modal>×</button></header><div class="modal-body">${body}</div>${buttons.length?`<footer class="modal-footer">${buttons.map(b=>`<button ${b.id?`id="${b.id}"`:""} class="btn ${b.className||"btn-light"}" ${b.close?"data-close-modal":""}>${escapeHtml(b.label)}</button>`).join("")}</footer>`:""}</section></div>`;}
  function closeModal(){els.modalRoot.innerHTML="";}

  function invoiceHtml(sale){const b=CONFIG.business;return `<article class="invoice-sheet" id="invoiceSheet"><header class="invoice-head"><div><h1>${escapeHtml(b.name)}</h1><div>السجل التجاري: ${escapeHtml(b.commercialRegistration)}</div><div>${escapeHtml(b.address)}</div>${b.vatNumber?`<div>الرقم الضريبي: ${escapeHtml(b.vatNumber)}</div>`:""}</div><div><strong>فاتورة ضريبية مبسطة</strong><div>رقم: ${escapeHtml(sale.invoice_number)}</div><div>${dateTime(sale.sale_date)}</div></div></header><div class="invoice-meta"><div><strong>الموظف:</strong> ${escapeHtml(sale.profiles?.full_name||"—")}</div><div><strong>الحالة:</strong> ${stripHtml(saleStatus(sale.status))}</div></div><table class="invoice-table"><thead><tr><th>#</th><th>رقم القطعة</th><th>الوصف</th><th>الكمية</th><th>السعر</th><th>الضريبة</th><th>الإجمالي</th></tr></thead><tbody>${(sale.sale_items||[]).map((i,n)=>`<tr><td>${n+1}</td><td>${escapeHtml(i.sku_snapshot)}</td><td>${escapeHtml(i.name_snapshot)}</td><td>${number(i.quantity)}</td><td>${money(i.unit_price)}</td><td>${money(i.line_vat)}</td><td>${money(i.line_total)}</td></tr>`).join("")}</tbody></table><div class="invoice-totals"><div><span>قبل الضريبة</span><strong>${money(sale.subtotal)}</strong></div><div><span>الضريبة</span><strong>${money(sale.vat)}</strong></div><div class="grand"><span>الإجمالي</span><strong>${money(sale.total)}</strong></div></div>${sale.notes?`<div class="invoice-footer"><strong>ملاحظات:</strong> ${escapeHtml(sale.notes)}</div>`:""}<div class="invoice-footer">لا تحتوي الفاتورة على اسم مشتري أو عميل. تم إصدارها بواسطة النظام الإلكتروني للمؤسسة.</div></article>`;}
  function printInvoiceHtml(html){els.printRoot.innerHTML=html;setTimeout(()=>window.print(),100);}
  async function saveInvoicePdf(html,numberValue){els.printRoot.innerHTML=html;const sheet=els.printRoot.querySelector(".invoice-sheet");els.printRoot.style.display="block";try{const canvas=await html2canvas(sheet,{scale:2,backgroundColor:"#ffffff"});const img=canvas.toDataURL("image/jpeg",.95);const {jsPDF}=window.jspdf;const pdf=new jsPDF("p","mm","a4");pdf.addImage(img,"JPEG",0,0,210,297);pdf.save(`${numberValue}.pdf`);}catch(error){toast("تعذر إنشاء PDF","error");}finally{els.printRoot.style.display="";}}

  function cartTotals(items,priceKey){const rate=Number(CONFIG.business.defaultVatRate||15)/100;const total=items.reduce((a,i)=>a+Number(i.quantity)*Number(i[priceKey]),0);const subtotal=total/(1+rate);return{subtotal,vat:total-subtotal,total};}
  function cartSummary(t){return `<div class="cart-summary"><div class="summary-row"><span>قبل الضريبة</span><strong>${money(t.subtotal)}</strong></div><div class="summary-row"><span>الضريبة</span><strong>${money(t.vat)}</strong></div><div class="summary-row total"><span>الإجمالي</span><strong>${money(t.total)}</strong></div></div>`;}
  function saleStatus(status){return status==="returned"?'<span class="badge badge-danger">مرتجعة</span>':status==="partial_return"?'<span class="badge badge-warning">مرتجع جزئي</span>':'<span class="badge badge-success">مكتملة</span>';}
  function roleBadge(role){const cls=role==="admin"?"badge-danger":role==="inventory"?"badge-info":"badge-success";return `<span class="badge ${cls}">${roles[role]||escapeHtml(role)}</span>`;}
  function queueStatus(status){return status==="failed"?'<span class="badge badge-danger">فشل</span>':status==="processing"?'<span class="badge badge-info">جارٍ</span>':'<span class="badge badge-warning">معلق</span>';}
  function offlineBanner(){return navigator.onLine?"":'<div class="offline-banner">أنت تعمل بدون إنترنت. البيانات المعروضة من آخر مزامنة، والعمليات الجديدة ستُرسل عند عودة الاتصال.</div>';}
  function bindGoButtons(){document.querySelectorAll("[data-go]").forEach(b=>b.addEventListener("click",()=>navigate(b.dataset.go)));}
  function loadingHtml(){return '<div class="empty-state"><div class="empty-icon">⏳</div><strong>جارٍ تحميل البيانات...</strong></div>';}
  function errorHtml(message){return `<div class="alert alert-danger"><strong>تعذر تحميل الصفحة:</strong> ${escapeHtml(message)}</div>`;}
  function emptyState(text,icon){return `<div class="empty-state"><div class="empty-icon">${icon}</div><strong>${escapeHtml(text)}</strong></div>`;}
  function statCard(label,value,small,icon){return `<article class="stat-card"><span class="stat-icon">${icon}</span><span class="stat-label">${escapeHtml(label)}</span><strong>${value}</strong><small>${escapeHtml(small)}</small></article>`;}
  function toast(message,type=""){const node=document.createElement("div");node.className=`toast ${type}`;node.textContent=message;els.toastRoot.appendChild(node);setTimeout(()=>node.remove(),4200);}
  function setButtonBusy(button,busy){if(!button)return;button.disabled=busy;if(busy){button.dataset.label=button.textContent;button.textContent="جارٍ الحفظ...";}else if(button.dataset.label){button.textContent=button.dataset.label;}}
  function showOnly(target){[els.setupScreen,els.loginScreen,els.app].forEach(e=>e?.classList.add("hidden"));target.classList.remove("hidden");}
  function byId(id){return document.getElementById(id);}
  function blankToNull(value){const v=String(value||"").trim();return v||null;}
  function normalize(value){return String(value||"").trim().toLowerCase();}
  function sum(items,key){return items.reduce((a,i)=>a+Number(i[key]||0),0);}
  function money(value){return new Intl.NumberFormat(CONFIG.locale||"ar-SA",{style:"currency",currency:CONFIG.currency||"SAR",minimumFractionDigits:2}).format(Number(value||0));}
  function number(value){return new Intl.NumberFormat(CONFIG.locale||"ar-SA",{maximumFractionDigits:2}).format(Number(value||0));}
  function today(){const d=new Date();return localIso(d);}
  function startOfMonth(){const d=new Date();d.setDate(1);return localIso(d);}
  function firstDayOfYear(){const d=new Date();d.setMonth(0,1);return localIso(d);}
  function localIso(d){const y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,"0"),day=String(d.getDate()).padStart(2,"0");return `${y}-${m}-${day}`;}
  function dateTime(value){if(!value)return "—";return new Intl.DateTimeFormat("ar-SA",{dateStyle:"medium",timeStyle:"short"}).format(new Date(value));}
  function shortDate(value){if(!value)return "";return new Intl.DateTimeFormat("ar-SA",{month:"short",day:"numeric"}).format(new Date(value));}
  function generateInvoiceNumber(prefix){const d=new Date();return `${prefix}-${d.getFullYear()}${String(d.getMonth()+1).padStart(2,"0")}${String(d.getDate()).padStart(2,"0")}-${String(Date.now()).slice(-6)}`;}
  function escapeHtml(value){return String(value??"").replace(/[&<>'"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]));}
  function escapeAttr(value){return escapeHtml(value);}
  function stripHtml(value){const div=document.createElement("div");div.innerHTML=value;return div.textContent;}
})();
