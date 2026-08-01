/**
 * ============================================================
 *  نظام فواتير ومخزون - مؤسسة يوسف عيد المطيري
 *  الإصدار المحسن (V2)
 *  يعتمد على التخزين المحلي (LocalStorage) بدون خادم
 * ============================================================
 */

(() => {
  'use strict';

  // ============================================================
  //  الثوابت والبيانات الثابتة
  // ============================================================

  const BUSINESS = Object.freeze({
    name: 'مؤسسة يوسف عيد المطيري لقطع غيار السيارات',
    commercialRegistration: '7054534024',
    address: 'C2MH+P5، الصناعية، حفر الباطن 39925'
  });

  const STORAGE_KEYS = Object.freeze({
    settings: 'yousefAutoPartsInvoiceSettingsV2',
    history: 'yousefAutoPartsInvoiceHistoryV2',
    products: 'yousefAutoPartsProductsV1',
    movements: 'yousefAutoPartsMovementsV1'
  });

  const MAX_HISTORY = 100;
  const MAX_MOVEMENTS = 1000;

  // ============================================================
  //  وحدة التخزين (Storage)
  // ============================================================

  const Storage = {
    write(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
        return true;
      } catch (error) {
        console.error('تعذر حفظ البيانات محليًا', error);
        UI.showStatus('مساحة الحفظ في المتصفح ممتلئة. نزّل نسخة احتياطية ثم احذف بعض الفواتير القديمة.', true);
        return false;
      }
    },

    read(key, fallback = null) {
      try {
        const raw = localStorage.getItem(key);
        return raw === null ? fallback : JSON.parse(raw);
      } catch (error) {
        console.warn('تعذر قراءة البيانات المحلية', error);
        return fallback;
      }
    },

    readHistory() {
      const current = this.read(STORAGE_KEYS.history, null);
      if (Array.isArray(current)) return current;
      const old = this.read('yousefAutoPartsInvoiceHistoryV1', []);
      return Array.isArray(old) ? old : [];
    }
  };

  // ============================================================
  //  وحدة الأدوات المساعدة (Utilities)
  // ============================================================

  const Utils = {
    toLatinDigits(value) {
      const arabic = '٠١٢٣٤٥٦٧٨٩';
      const persian = '۰۱۲۳۴۵۶۷۸۹';
      return String(value ?? '')
        .replace(/[٠-٩]/g, d => String(arabic.indexOf(d)))
        .replace(/[۰-۹]/g, d => String(persian.indexOf(d)));
    },

    normalizeWhatsapp(value) {
      let digits = this.toLatinDigits(value).replace(/\D/g, '');
      if (digits.startsWith('00')) digits = digits.slice(2);
      if (digits.startsWith('05') && digits.length === 10) digits = `966${digits.slice(1)}`;
      else if (digits.startsWith('5') && digits.length === 9) digits = `966${digits}`;
      return digits.slice(0, 15);
    },

    makeId(prefix) {
      if (window.crypto?.randomUUID) return `${prefix}-${window.crypto.randomUUID()}`;
      return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    },

    generateInvoiceNumber() {
      const now = new Date();
      const y = now.getFullYear();
      const m = String(now.getMonth() + 1).padStart(2, '0');
      const d = String(now.getDate()).padStart(2, '0');
      const rand = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
      return `INV-${y}${m}${d}-${rand}`;
    },

    todayIso() {
      const now = new Date();
      const offset = now.getTimezoneOffset();
      return new Date(now.getTime() - offset * 60000).toISOString().slice(0, 10);
    },

    currentTimeIso() {
      const now = new Date();
      return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    },

    formatDate(value) {
      if (!value) return '—';
      const date = new Date(`${value}T12:00:00`);
      return new Intl.DateTimeFormat('en-GB', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
    },

    formatTime(value) {
      if (!value) return '—';
      const match = String(value).match(/^(\d{1,2}):(\d{2})/);
      if (!match) return '—';
      return `${match[1].padStart(2, '0')}:${match[2]}`;
    },

    formatDateTime(value) {
      const date = new Date(value || Date.now());
      if (Number.isNaN(date.getTime())) return '—';
      return new Intl.DateTimeFormat('en-GB', {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hour12: false
      }).format(date);
    },

    formatMoney(value) {
      return `${this.formatNumber(value)} ريال`;
    },

    formatNumber(value) {
      return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        .format(Number(value) || 0);
    },

    formatQuantity(value) {
      return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 })
        .format(Number(value) || 0);
    },

    fixedNumber(value) {
      return (Number(value) || 0).toFixed(2);
    },

    nonNegative(value, fallback) {
      const num = Number(value);
      return Number.isFinite(num) && num >= 0 ? num : fallback;
    },

    positive(value, fallback) {
      const num = Number(value);
      return Number.isFinite(num) && num > 0 ? num : fallback;
    },

    clamp(value, min, max) {
      const num = Number(value);
      if (!Number.isFinite(num)) return min;
      return Math.min(max, Math.max(min, num));
    },

    normalizeSearch(value) {
      return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
    },

    safeFileName(value) {
      return String(value || 'invoice').replace(/[\\/:*?"<>|]+/g, '-').trim() || 'invoice';
    },

    escapeHtml(value) {
      return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
    },

    downloadBlob(blob, fileName) {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },

    aggregateLinkedItems(items) {
      const map = new Map();
      items.forEach(item => {
        if (!item.productId) return;
        const qty = this.positive(item.quantity, 1);
        map.set(item.productId, (map.get(item.productId) || 0) + qty);
      });
      return map;
    }
  };

  // ============================================================
  //  وحدة الواجهة (UI) - إدارة DOM والتفاعل
  // ============================================================

  const UI = {
    els: {},

    init() {
      this.els = {
        sellerVatNumber: document.getElementById('sellerVatNumber'),
        logoUpload: document.getElementById('logoUpload'),
        logoStatus: document.getElementById('logoStatus'),
        logoPreviewWrap: document.getElementById('logoPreviewWrap'),
        logoPreview: document.getElementById('logoPreview'),
        removeLogoBtn: document.getElementById('removeLogoBtn'),
        invoiceTitle: document.getElementById('invoiceTitle'),
        invoiceNumber: document.getElementById('invoiceNumber'),
        invoiceDate: document.getElementById('invoiceDate'),
        invoiceTime: document.getElementById('invoiceTime'),
        whatsappNumber: document.getElementById('whatsappNumber'),
        taxIncluded: document.getElementById('taxIncluded'),
        taxRate: document.getElementById('taxRate'),
        itemsBody: document.getElementById('itemsBody'),
        addItemBtn: document.getElementById('addItemBtn'),
        addFromInventoryBtn: document.getElementById('addFromInventoryBtn'),
        subtotalAmount: document.getElementById('subtotalAmount'),
        taxAmount: document.getElementById('taxAmount'),
        totalAmount: document.getElementById('totalAmount'),
        invoiceTerms: document.getElementById('invoiceTerms'),
        qrCanvas: document.getElementById('qrCanvas'),
        qrHint: document.getElementById('qrHint'),
        savePdfBtn: document.getElementById('savePdfBtn'),
        sharePdfBtn: document.getElementById('sharePdfBtn'),
        printBtn: document.getElementById('printBtn'),
        newInvoiceBtn: document.getElementById('newInvoiceBtn'),
        actionStatus: document.getElementById('actionStatus'),

        productsBtn: document.getElementById('productsBtn'),
        openProductsBtn: document.getElementById('openProductsBtn'),
        openMovementsBtn: document.getElementById('openMovementsBtn'),
        exportBackupBtn: document.getElementById('exportBackupBtn'),
        importBackupInput: document.getElementById('importBackupInput'),
        statProducts: document.getElementById('statProducts'),
        statUnits: document.getElementById('statUnits'),
        statLowStock: document.getElementById('statLowStock'),
        statCostValue: document.getElementById('statCostValue'),
        statSaleValue: document.getElementById('statSaleValue'),
        lowStockPreview: document.getElementById('lowStockPreview'),

        productsModal: document.getElementById('productsModal'),
        closeProductsBtn: document.getElementById('closeProductsBtn'),
        productForm: document.getElementById('productForm'),
        productId: document.getElementById('productId'),
        productName: document.getElementById('productName'),
        productPartNumber: document.getElementById('productPartNumber'),
        productBarcode: document.getElementById('productBarcode'),
        productBrand: document.getElementById('productBrand'),
        productCostPrice: document.getElementById('productCostPrice'),
        productSalePrice: document.getElementById('productSalePrice'),
        productStock: document.getElementById('productStock'),
        productMinStock: document.getElementById('productMinStock'),
        productVehicles: document.getElementById('productVehicles'),
        productShelf: document.getElementById('productShelf'),
        productNotes: document.getElementById('productNotes'),
        resetProductBtn: document.getElementById('resetProductBtn'),
        productSearch: document.getElementById('productSearch'),
        exportProductsCsvBtn: document.getElementById('exportProductsCsvBtn'),
        productsBody: document.getElementById('productsBody'),
        productsEmpty: document.getElementById('productsEmpty'),

        productPickerModal: document.getElementById('productPickerModal'),
        closePickerBtn: document.getElementById('closePickerBtn'),
        pickerSearch: document.getElementById('pickerSearch'),
        pickerList: document.getElementById('pickerList'),

        movementsModal: document.getElementById('movementsModal'),
        closeMovementsBtn: document.getElementById('closeMovementsBtn'),
        movementsList: document.getElementById('movementsList'),

        historyBtn: document.getElementById('historyBtn'),
        historyModal: document.getElementById('historyModal'),
        closeHistoryBtn: document.getElementById('closeHistoryBtn'),
        historyList: document.getElementById('historyList'),

        invoicePrintContainer: document.getElementById('invoicePrintContainer')
      };
    },

    showStatus(message, isError = false) {
      const el = this.els.actionStatus;
      if (!el) return;
      el.textContent = message;
      el.style.color = isError ? '#b42318' : '#456173';
    },

    openModal(modal) {
      if (!modal) return;
      modal.classList.add('active');
      modal.setAttribute('aria-hidden', 'false');
      document.body.classList.add('modal-open');
    },

    closeModal(modal) {
      if (!modal) return;
      modal.classList.remove('active');
      modal.setAttribute('aria-hidden', 'true');
      if (!document.querySelector('.modal.active')) {
        document.body.classList.remove('modal-open');
      }
    },

    resetProductForm() {
      const f = this.els;
      f.productForm.reset();
      f.productId.value = '';
      f.productCostPrice.value = '0';
      f.productSalePrice.value = '0';
      f.productStock.value = '0';
      f.productMinStock.value = '2';
      f.productName.focus();
    }
  };

  // ============================================================
  //  وحدة الأعمال (Business) - البيانات الأساسية
  // ============================================================

  const Business = {
    getInfo() {
      return { ...BUSINESS };
    }
  };

  // ============================================================
  //  وحدة المخزون (Inventory)
  // ============================================================

  const Inventory = {
    products: [],
    movements: [],

    load() {
      this.products = Storage.read(STORAGE_KEYS.products, [])
        .map(this.normalizeProduct)
        .filter(p => p.id && p.name);
      this.movements = Storage.read(STORAGE_KEYS.movements, [])
        .slice(0, MAX_MOVEMENTS);
    },

    save() {
      Storage.write(STORAGE_KEYS.products, this.products);
      Storage.write(STORAGE_KEYS.movements, this.movements.slice(0, MAX_MOVEMENTS));
    },

    normalizeProduct(p) {
      return {
        id: String(p.id || Utils.makeId('prd')),
        name: String(p.name || '').trim(),
        partNumber: String(p.partNumber || '').trim(),
        barcode: String(p.barcode || '').trim(),
        brand: String(p.brand || '').trim(),
        vehicles: String(p.vehicles || '').trim(),
        costPrice: Utils.nonNegative(p.costPrice, 0),
        salePrice: Utils.nonNegative(p.salePrice, 0),
        stock: Utils.nonNegative(p.stock, 0),
        minStock: Utils.nonNegative(p.minStock, 0),
        shelf: String(p.shelf || '').trim(),
        notes: String(p.notes || '').trim(),
        createdAt: p.createdAt || new Date().toISOString(),
        updatedAt: p.updatedAt || new Date().toISOString()
      };
    },

    find(id) {
      return this.products.find(p => p.id === id) || null;
    },

    addMovement({ product, type, quantity, beforeStock, afterStock, invoiceNumber = '', note = '' }) {
      this.movements.unshift({
        id: Utils.makeId('mov'),
        productId: product.id,
        productName: product.name,
        partNumber: product.partNumber,
        type,
        quantity: Number(quantity) || 0,
        beforeStock: Number(beforeStock) || 0,
        afterStock: Number(afterStock) || 0,
        invoiceNumber,
        note,
        createdAt: new Date().toISOString()
      });
      this.save();
    },

    getStats() {
      return this.products.reduce((acc, p) => {
        acc.units += p.stock;
        acc.cost += p.stock * p.costPrice;
        acc.sale += p.stock * p.salePrice;
        if (p.stock <= p.minStock) acc.low += 1;
        return acc;
      }, { units: 0, cost: 0, sale: 0, low: 0 });
    },

    getLowProducts() {
      return this.products
        .filter(p => p.stock <= p.minStock)
        .sort((a, b) => a.stock - b.stock)
        .slice(0, 6);
    },

    stockStatus(product) {
      if (product.stock <= 0) return { label: 'منتهي', className: 'out' };
      if (product.stock <= product.minStock) return { label: 'منخفض', className: 'low' };
      return { label: 'متوفر', className: 'available' };
    },

    search(query) {
      const q = Utils.normalizeSearch(query);
      if (!q) return this.products;
      return this.products.filter(p =>
        Utils.normalizeSearch([
          p.name, p.partNumber, p.barcode, p.brand,
          p.vehicles, p.shelf, p.notes
        ].join(' ')).includes(q)
      );
    }
  };

  // ============================================================
  //  وحدة الفاتورة (Invoice)
  // ============================================================

  const Invoice = {
    state: {
      items: [],
      nextItemId: 1,
      logoDataUrl: '',
      qrText: '',
      invoiceCommitted: false
    },

    addItem(item = {}, makeEditable = true) {
      if (makeEditable) this.ensureEditable();
      const model = {
        id: this.state.nextItemId++,
        productId: String(item.productId || ''),
        partNumber: String(item.partNumber || ''),
        description: String(item.description || ''),
        quantity: Utils.positive(item.quantity, 1),
        unitPrice: Utils.nonNegative(item.unitPrice, 0)
      };
      this.state.items.push(model);
      this.renderItems();
      this.recalculate();
    },

    ensureEditable() {
      if (!this.state.invoiceCommitted) return;
      this.state.invoiceCommitted = false;
      UI.els.invoiceNumber.value = Utils.generateInvoiceNumber();
      UI.showStatus('تم إنشاء رقم فاتورة جديد لأن الفاتورة السابقة كانت معتمدة ومخصومة من المخزون.');
    },

    calculateItem(item) {
      const rate = Utils.clamp(UI.els.taxRate.value, 0, 100) / 100;
      const gross = Utils.nonNegative(item.unitPrice, 0) * Utils.positive(item.quantity, 1);
      let subtotal, tax, total;
      if (UI.els.taxIncluded.checked && rate > 0) {
        total = gross;
        subtotal = total / (1 + rate);
        tax = total - subtotal;
      } else {
        subtotal = gross;
        tax = subtotal * rate;
        total = subtotal + tax;
      }
      return { subtotal, tax, total };
    },

    getTotals() {
      return this.state.items.reduce((acc, item) => {
        const v = this.calculateItem(item);
        acc.subtotal += v.subtotal;
        acc.tax += v.tax;
        acc.total += v.total;
        return acc;
      }, { subtotal: 0, tax: 0, total: 0 });
    },

    recalculate() {
      this.updateRowAmounts();
      const totals = this.getTotals();
      UI.els.subtotalAmount.textContent = Utils.formatMoney(totals.subtotal);
      UI.els.taxAmount.textContent = Utils.formatMoney(totals.tax);
      UI.els.totalAmount.textContent = Utils.formatMoney(totals.total);
    },

    updateRowAmounts() {
      const rows = UI.els.itemsBody.querySelectorAll('tr[data-id]');
      rows.forEach(row => {
        const id = Number(row.dataset.id);
        const item = this.state.items.find(it => it.id === id);
        if (!item) return;
        const v = this.calculateItem(item);
        row.querySelector('[data-value="subtotal"]').textContent = Utils.formatNumber(v.subtotal);
        row.querySelector('[data-value="tax"]').textContent = Utils.formatNumber(v.tax);
        row.querySelector('[data-value="total"]').textContent = Utils.formatNumber(v.total);
      });
    },

    renderItems() {
      const tbody = UI.els.itemsBody;
      const fragment = document.createDocumentFragment();
      this.state.items.forEach((item, index) => {
        const product = item.productId ? Inventory.find(item.productId) : null;
        const linked = Boolean(product);
        const stockText = linked
          ? `<small class="linked-stock ${product.stock <= product.minStock ? 'low' : ''}">من المخزون — المتوفر ${Utils.formatQuantity(product.stock)}</small>`
          : `<small class="manual-item-label">بند يدوي</small>`;
        const tr = document.createElement('tr');
        tr.dataset.id = item.id;
        tr.innerHTML = `
          <td>${index + 1}</td>
          <td>
            <input class="part-number-input" data-field="partNumber" value="${Utils.escapeHtml(item.partNumber)}" maxlength="60" placeholder="اختياري" ${linked ? 'readonly' : ''}>
          </td>
          <td>
            <input class="description-input" data-field="description" value="${Utils.escapeHtml(item.description)}" maxlength="160" placeholder="اسم القطعة أو وصفها" ${linked ? 'readonly' : ''}>
            ${stockText}
          </td>
          <td><input class="latin-digits" lang="en-US" dir="ltr" data-field="quantity" type="number" min="0.01" step="0.01" value="${item.quantity}"></td>
          <td><input class="latin-digits" lang="en-US" dir="ltr" data-field="unitPrice" type="number" min="0" step="0.01" value="${item.unitPrice}"></td>
          <td class="amount-cell" data-value="subtotal">0.00</td>
          <td class="amount-cell" data-value="tax">0.00</td>
          <td class="amount-cell" data-value="total">0.00</td>
          <td><button class="delete-item" data-delete-item type="button" aria-label="حذف البند">×</button></td>
        `;
        fragment.appendChild(tr);
      });
      tbody.innerHTML = '';
      tbody.appendChild(fragment);
      this.updateRowAmounts();
    },

    getInvoiceData() {
      const totals = this.getTotals();
      return {
        version: 2,
        title: UI.els.invoiceTitle.value.trim() || 'فاتورة',
        number: UI.els.invoiceNumber.value.trim() || Utils.generateInvoiceNumber(),
        date: UI.els.invoiceDate.value || Utils.todayIso(),
        time: UI.els.invoiceTime.value || Utils.currentTimeIso(),
        whatsappNumber: Utils.normalizeWhatsapp(UI.els.whatsappNumber.value),
        vatNumber: UI.els.sellerVatNumber.value.trim(),
        taxRate: Utils.clamp(UI.els.taxRate.value, 0, 100),
        taxIncluded: UI.els.taxIncluded.checked,
        terms: UI.els.invoiceTerms.value.trim(),
        logoDataUrl: this.state.logoDataUrl,
        inventoryCommitted: this.state.invoiceCommitted,
        items: this.state.items.map(item => ({
          productId: item.productId,
          partNumber: item.partNumber.trim(),
          description: item.description.trim(),
          quantity: Utils.positive(item.quantity, 1),
          unitPrice: Utils.nonNegative(item.unitPrice, 0)
        })),
        totals: totals,
        savedAt: new Date().toISOString()
      };
    },

    validate() {
      const f = UI.els;
      if (!f.invoiceNumber.value.trim()) {
        UI.showStatus('أدخل رقم الفاتورة.', true);
        f.invoiceNumber.focus();
        return false;
      }
      const hasValidItem = this.state.items.some(item =>
        (item.description.trim() || item.partNumber.trim()) &&
        Utils.nonNegative(item.unitPrice, 0) > 0
      );
      if (!hasValidItem) {
        UI.showStatus('أضف بندًا واحدًا على الأقل مع رقم قطعة أو وصف وسعر.', true);
        return false;
      }
      const vat = f.sellerVatNumber.value.trim();
      if (vat && vat.length !== 15) {
        UI.showStatus('الرقم الضريبي يجب أن يتكون من 15 رقمًا.', true);
        f.sellerVatNumber.focus();
        return false;
      }
      if (!this.state.invoiceCommitted) {
        const requested = Utils.aggregateLinkedItems(this.state.items);
        for (const [productId, qty] of requested.entries()) {
          const product = Inventory.find(productId);
          if (!product) {
            UI.showStatus('أحد المنتجات المرتبطة بالمخزون تم حذفه. احذف البند وأضفه من جديد.', true);
            return false;
          }
          if (qty > product.stock) {
            UI.showStatus(`الكمية المطلوبة من "${product.name}" هي ${Utils.formatQuantity(qty)} والمتوفر ${Utils.formatQuantity(product.stock)} فقط.`, true);
            return false;
          }
        }
      }
      return true;
    },

    commitInventory(data) {
      const history = Storage.readHistory();
      const existing = history.find(e => e.number === data.number);
      if (existing && existing.inventoryCommitted) {
        data.inventoryCommitted = true;
        this.state.invoiceCommitted = true;
        return { changed: false, linkedCount: 0, already: true };
      }

      const requested = Utils.aggregateLinkedItems(data.items);
      let linkedCount = 0;
      requested.forEach((quantity, productId) => {
        const product = Inventory.find(productId);
        if (!product) return;
        const before = product.stock;
        product.stock = Math.max(0, product.stock - quantity);
        product.updatedAt = new Date().toISOString();
        linkedCount++;
        Inventory.addMovement({
          product,
          type: 'sale',
          quantity: -quantity,
          beforeStock: before,
          afterStock: product.stock,
          invoiceNumber: data.number
        });
      });

      data.inventoryCommitted = true;
      data.inventoryCommittedAt = new Date().toISOString();
      this.state.invoiceCommitted = true;
      Inventory.save();
      return { changed: linkedCount > 0, linkedCount, already: false };
    },

    saveHistory(data) {
      const history = Storage.readHistory();
      const idx = history.findIndex(e => e.number === data.number);
      if (idx >= 0) history.splice(idx, 1);
      const record = {
        ...data,
        inventoryCommitted: Boolean(data.inventoryCommitted),
        inventoryCommittedAt: data.inventoryCommittedAt || '',
        logoDataUrl: ''
      };
      history.unshift(record);
      Storage.write(STORAGE_KEYS.history, history.slice(0, MAX_HISTORY));
    },

    loadHistory(index) {
      const entry = Storage.readHistory()[index];
      if (!entry) return;
      const f = UI.els;
      f.invoiceTitle.value = entry.title || 'فاتورة ضريبية مبسطة';
      f.invoiceNumber.value = entry.number || Utils.generateInvoiceNumber();
      f.invoiceDate.value = entry.date || Utils.todayIso();
      f.invoiceTime.value = entry.time || Utils.currentTimeIso();
      f.whatsappNumber.value = entry.whatsappNumber || '';
      f.sellerVatNumber.value = String(entry.vatNumber || '').replace(/\D/g, '').slice(0, 15);
      f.taxRate.value = String(entry.taxRate ?? 15);
      f.taxIncluded.checked = entry.taxIncluded !== false;
      f.invoiceTerms.value = entry.terms || '';
      this.state.invoiceCommitted = Boolean(entry.inventoryCommitted);

      this.state.items = [];
      this.state.nextItemId = 1;
      const items = Array.isArray(entry.items) && entry.items.length ? entry.items : [{}];
      items.forEach(item => {
        this.state.items.push({
          id: this.state.nextItemId++,
          productId: String(item.productId || ''),
          partNumber: String(item.partNumber || ''),
          description: String(item.description || ''),
          quantity: Utils.positive(item.quantity, 1),
          unitPrice: Utils.nonNegative(item.unitPrice, 0)
        });
      });
      this.renderItems();
      this.recalculate();
      this.saveSettings();
      QR.refresh();
      UI.closeModal(UI.els.historyModal);
      UI.showStatus(entry.inventoryCommitted
        ? 'تم فتح الفاتورة المعتمدة. أي تعديل عليها ينشئ رقم فاتورة جديد حتى لا يُخصم المخزون مرتين.'
        : 'تم فتح الفاتورة.');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },

    saveSettings() {
      const settings = {
        vatNumber: UI.els.sellerVatNumber.value.trim(),
        taxRate: Utils.clamp(UI.els.taxRate.value, 0, 100),
        taxIncluded: UI.els.taxIncluded.checked,
        invoiceTitle: UI.els.invoiceTitle.value,
        terms: UI.els.invoiceTerms.value,
        logoDataUrl: this.state.logoDataUrl
      };
      Storage.write(STORAGE_KEYS.settings, settings);
    },

    loadSettings() {
      const saved = Storage.read(STORAGE_KEYS.settings, null) ||
                    Storage.read('yousefAutoPartsInvoiceSettingsV1', null);
      if (!saved || typeof saved !== 'object') return;
      const f = UI.els;
      f.sellerVatNumber.value = String(saved.vatNumber || '').replace(/\D/g, '').slice(0, 15);
      f.taxRate.value = String(saved.taxRate ?? 15);
      f.taxIncluded.checked = saved.taxIncluded !== false;
      f.invoiceTitle.value = String(saved.invoiceTitle || 'فاتورة ضريبية مبسطة');
      f.invoiceTerms.value = String(saved.terms || '');
      this.state.logoDataUrl = String(saved.logoDataUrl || '');
      this.updateLogoPreview();
    },

    updateLogoPreview() {
      const has = Boolean(this.state.logoDataUrl);
      UI.els.logoPreviewWrap.hidden = !has;
      if (has) {
        UI.els.logoPreview.src = this.state.logoDataUrl;
        UI.els.logoStatus.textContent = 'صورة المحل محفوظة داخل هذا الجهاز وتظهر في الفاتورة.';
      } else {
        UI.els.logoPreview.removeAttribute('src');
        UI.els.logoStatus.textContent = 'تظهر الصورة في بيانات المحل والفاتورة. PNG أو JPG أو WebP، بحد أقصى 2 ميجابايت.';
      }
    },

    async handleLogoUpload(file) {
      if (!file) return;
      if (!file.type.startsWith('image/')) {
        UI.showStatus('الملف المختار ليس صورة.', true);
        return false;
      }
      if (file.size > 2 * 1024 * 1024) {
        UI.showStatus('حجم صورة المحل أكبر من 2 ميجابايت.', true);
        return false;
      }
      try {
        const dataUrl = await this.resizeImage(file, 500, 500, 0.88);
        this.state.logoDataUrl = dataUrl;
        this.updateLogoPreview();
        this.saveSettings();
        UI.showStatus('تم حفظ الشعار داخل هذا الجهاز.');
        return true;
      } catch (error) {
        UI.showStatus('تعذر قراءة الشعار المختار.', true);
        console.error(error);
        return false;
      }
    },

    resizeImage(file, maxWidth, maxHeight, quality) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = reject;
        reader.onload = () => {
          const img = new Image();
          img.onerror = reject;
          img.onload = () => {
            const ratio = Math.min(maxWidth / img.width, maxHeight / img.height, 1);
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(img.width * ratio));
            canvas.height = Math.max(1, Math.round(img.height * ratio));
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            resolve(canvas.toDataURL('image/webp', quality));
          };
          img.src = String(reader.result);
        };
        reader.readAsDataURL(file);
      });
    },

    removeLogo() {
      this.state.logoDataUrl = '';
      this.updateLogoPreview();
      this.saveSettings();
      UI.showStatus('تم حذف صورة المحل.');
    }
  };

  // ============================================================
  //  وحدة QR Code
  // ============================================================

  const QR = {
    async refresh() {
      const canvas = UI.els.qrCanvas;
      this.clearCanvas(canvas);
      const vat = UI.els.sellerVatNumber.value.trim();
      if (vat.length !== 15) {
        Invoice.state.qrText = '';
        UI.els.qrHint.textContent = vat ? 'الرقم الضريبي يجب أن يكون 15 رقمًا.' : 'أدخل الرقم الضريبي لإظهار رمز QR.';
        return;
      }

      const data = Invoice.getInvoiceData();
      const payload = this.createPayload({
        sellerName: BUSINESS.name,
        vatNumber: vat,
        timestamp: this.invoiceTimestamp(data.date, data.time),
        total: Utils.fixedNumber(data.totals.total),
        tax: Utils.fixedNumber(data.totals.tax)
      });
      Invoice.state.qrText = payload;

      try {
        await this.draw(canvas, payload, 160);
        UI.els.qrHint.textContent = 'رمز QR جاهز.';
      } catch (error) {
        Invoice.state.qrText = '';
        UI.els.qrHint.textContent = 'تعذر إنشاء رمز QR.';
        console.error(error);
      }
    },

    createPayload({ sellerName, vatNumber, timestamp, total, tax }) {
      const encoder = new TextEncoder();
      const fields = [sellerName, vatNumber, timestamp, total, tax];
      const bytes = [];
      fields.forEach((value, index) => {
        const encoded = encoder.encode(String(value));
        if (encoded.length > 255) throw new Error('قيمة QR طويلة جدًا');
        bytes.push(index + 1, encoded.length, ...encoded);
      });
      let binary = '';
      new Uint8Array(bytes).forEach(byte => { binary += String.fromCharCode(byte); });
      return btoa(binary);
    },

    draw(canvas, text, width) {
      return new Promise((resolve, reject) => {
        if (!window.QRCode || typeof window.QRCode.toCanvas !== 'function') {
          reject(new Error('مكتبة QR غير متاحة'));
          return;
        }
        window.QRCode.toCanvas(canvas, text, {
          width,
          margin: 1,
          errorCorrectionLevel: 'M',
          color: { dark: '#111827', light: '#ffffff' }
        }, error => error ? reject(error) : resolve());
      });
    },

    clearCanvas(canvas) {
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    },

    invoiceTimestamp(dateValue, timeValue) {
      const date = dateValue || Utils.todayIso();
      const time = timeValue || Utils.currentTimeIso();
      const parsed = new Date(`${date}T${time}:00`);
      return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
    }
  };

  // ============================================================
  //  وحدة طباعة وإنشاء PDF
  // ============================================================

  const Print = {
    async renderPrint(data) {
      const rows = data.items.map((item, index) => {
        const v = Invoice.calculateItem(item);
        return `
          <tr>
            <td>${index + 1}</td>
            <td>${Utils.escapeHtml(item.partNumber || '—')}</td>
            <td class="desc">${Utils.escapeHtml(item.description || '—')}</td>
            <td>${Utils.formatNumber(item.quantity)}</td>
            <td>${Utils.formatNumber(item.unitPrice)}</td>
            <td>${Utils.formatNumber(v.subtotal)}</td>
            <td>${Utils.formatNumber(v.tax)}</td>
            <td>${Utils.formatNumber(v.total)}</td>
          </tr>`;
      }).join('');

      const logo = data.logoDataUrl
        ? `<img class="print-logo" src="${data.logoDataUrl}" alt="شعار المنشأة">`
        : '<div></div>';
      const vatLine = data.vatNumber
        ? `<div><strong>الرقم الضريبي:</strong> ${Utils.escapeHtml(data.vatNumber)}</div>`
        : '';
      const terms = data.terms
        ? `<div class="print-terms"><strong>ملاحظات وشروط:</strong><br>${Utils.escapeHtml(data.terms)}</div>`
        : '';
      const qrBlock = Invoice.state.qrText
        ? `<div class="print-qr"><canvas id="printQrCanvas" width="130" height="130"></canvas><div>رمز QR</div></div>`
        : '<div></div>';

      const container = UI.els.invoicePrintContainer;
      container.innerHTML = `
        <div class="print-sheet">
          <div class="print-header">
            <div>${logo}</div>
            <div class="print-header-center">
              <h1>${Utils.escapeHtml(data.title)}</h1>
              <p>${Utils.escapeHtml(BUSINESS.name)}</p>
            </div>
            <div class="print-meta">
              <div><strong>رقم الفاتورة:</strong><br><span dir="ltr">${Utils.escapeHtml(data.number)}</span></div>
              <div><strong>التاريخ:</strong><br><span dir="ltr">${Utils.escapeHtml(Utils.formatDate(data.date))}</span></div>
              <div><strong>الوقت:</strong><br><span dir="ltr">${Utils.escapeHtml(Utils.formatTime(data.time))}</span></div>
            </div>
          </div>

          <div class="print-business">
            <div><strong>اسم المنشأة:</strong> ${Utils.escapeHtml(BUSINESS.name)}</div>
            <div><strong>السجل التجاري:</strong> ${Utils.escapeHtml(BUSINESS.commercialRegistration)}</div>
            <div class="wide"><strong>الموقع:</strong> ${Utils.escapeHtml(BUSINESS.address)}</div>
            ${vatLine}
          </div>

          <table class="print-table">
            <thead>
              <tr>
                <th>#</th><th>رقم القطعة</th><th>الوصف</th><th>الكمية</th><th>سعر الوحدة</th><th>قبل الضريبة</th><th>الضريبة</th><th>الإجمالي</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>

          <div class="print-bottom">
            <div class="print-summary">
              <div><span>المجموع قبل الضريبة</span><strong>${Utils.formatMoney(data.totals.subtotal)}</strong></div>
              <div><span>ضريبة القيمة المضافة (${Utils.formatNumber(data.taxRate)}%)</span><strong>${Utils.formatMoney(data.totals.tax)}</strong></div>
              <div><span>الإجمالي شامل الضريبة</span><strong>${Utils.formatMoney(data.totals.total)}</strong></div>
            </div>
            ${qrBlock}
          </div>
          ${terms}
          <div class="print-footer">
            ${Utils.escapeHtml(BUSINESS.name)} — السجل التجاري <span dir="ltr">${Utils.escapeHtml(BUSINESS.commercialRegistration)}</span>
            <br>تاريخ ووقت الطباعة: <span dir="ltr">${Utils.escapeHtml(Utils.formatDateTime(new Date().toISOString()))}</span>
          </div>
        </div>`;

      if (Invoice.state.qrText) {
        const printCanvas = document.getElementById('printQrCanvas');
        await QR.draw(printCanvas, Invoice.state.qrText, 130);
      }
      return container.querySelector('.print-sheet');
    },

    async createPdfBlob(data) {
      if (!window.html2canvas || !window.jspdf?.jsPDF) {
        throw new Error('مكتبات PDF غير متاحة');
      }
      const sheet = await this.renderPrint(data);
      await document.fonts?.ready;
      const container = UI.els.invoicePrintContainer;
      const previous = { left: container.style.left, top: container.style.top, zIndex: container.style.zIndex };
      container.style.left = '0';
      container.style.top = '0';
      container.style.zIndex = '-1';

      try {
        const canvas = await window.html2canvas(sheet, {
          scale: 2,
          backgroundColor: '#ffffff',
          useCORS: true,
          logging: false,
          windowWidth: sheet.scrollWidth,
          windowHeight: sheet.scrollHeight
        });
        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
        const pageWidthMm = 210;
        const pageHeightMm = 297;
        const pageHeightPx = Math.floor(canvas.width * pageHeightMm / pageWidthMm);
        let offsetY = 0;
        let page = 0;
        while (offsetY < canvas.height) {
          const sliceHeight = Math.min(pageHeightPx, canvas.height - offsetY);
          const pageCanvas = document.createElement('canvas');
          pageCanvas.width = canvas.width;
          pageCanvas.height = sliceHeight;
          pageCanvas.getContext('2d').drawImage(canvas, 0, offsetY, canvas.width, sliceHeight, 0, 0, canvas.width, sliceHeight);
          const imageData = pageCanvas.toDataURL('image/jpeg', 0.94);
          const imageHeightMm = sliceHeight * pageWidthMm / canvas.width;
          if (page > 0) pdf.addPage();
          pdf.addImage(imageData, 'JPEG', 0, 0, pageWidthMm, imageHeightMm, undefined, 'FAST');
          offsetY += sliceHeight;
          page++;
        }
        return pdf.output('blob');
      } finally {
        container.style.left = previous.left;
        container.style.top = previous.top;
        container.style.zIndex = previous.zIndex;
      }
    }
  };

  // ============================================================
  //  وحدة واتساب
  // ============================================================

  const WhatsApp = {
    buildMessage(data) {
      return [
        `فاتورة من ${BUSINESS.name}`,
        `رقم الفاتورة: ${data.number}`,
        `التاريخ: ${Utils.formatDate(data.date)}`,
        `الوقت: ${Utils.formatTime(data.time)}`,
        `الإجمالي: ${Utils.formatMoney(data.totals.total)}`,
        'تم تجهيز ملف الفاتورة بصيغة PDF.'
      ].join('\n');
    },

    buildUrl(numberValue, message) {
      const number = Utils.normalizeWhatsapp(numberValue);
      const encoded = encodeURIComponent(message);
      return number
        ? `https://wa.me/${number}?text=${encoded}`
        : `https://api.whatsapp.com/send?text=${encoded}`;
    }
  };

  // ============================================================
  //  وحدة التحكم الرئيسية (Controller) - ربط الأحداث والتهيئة
  // ============================================================

  const App = {
    init() {
      UI.init();
      Invoice.loadSettings();
      Inventory.load();
      this.setupEventListeners();
      this.initializeInvoice();
      this.renderDashboard();
      this.renderProductsTable();
      this.renderProductPicker();
      this.applyLatinInputs();
    },

    initializeInvoice() {
      const f = UI.els;
      f.invoiceDate.value = Utils.todayIso();
      f.invoiceTime.value = Utils.currentTimeIso();
      f.invoiceNumber.value = Utils.generateInvoiceNumber();
      Invoice.addItem({}, false);
      Invoice.recalculate();
      QR.refresh();
    },

    setupEventListeners() {
      const f = UI.els;

      // بنود الفاتورة - استخدم دوال سهمية للحفاظ على السياق
      f.addItemBtn.addEventListener('click', () => Invoice.addItem());
      f.addFromInventoryBtn.addEventListener('click', () => this.openProductPicker());

      f.itemsBody.addEventListener('input', this.handleItemInput.bind(this));
      f.itemsBody.addEventListener('click', this.handleItemClick.bind(this));

      // تغييرات الفاتورة
      [f.invoiceTitle, f.invoiceDate, f.invoiceTime, f.taxRate, f.invoiceTerms].forEach(el =>
        el.addEventListener('input', this.handleInvoiceChange.bind(this))
      );
      f.invoiceNumber.addEventListener('input', () => {
        Invoice.recalculate();
        QR.refresh();
      });
      f.taxIncluded.addEventListener('change', this.handleInvoiceChange.bind(this));
      f.sellerVatNumber.addEventListener('input', () => {
        f.sellerVatNumber.value = Utils.toLatinDigits(f.sellerVatNumber.value).replace(/\D/g, '').slice(0, 15);
        Invoice.saveSettings();
        QR.refresh();
      });
      f.whatsappNumber.addEventListener('input', () => {
        f.whatsappNumber.value = Utils.toLatinDigits(f.whatsappNumber.value).replace(/[^0-9+]/g, '').slice(0, 18);
      });

      // الشعار
      f.logoUpload.addEventListener('change', async (e) => {
        const file = e.target.files?.[0];
        if (file) {
          await Invoice.handleLogoUpload(file);
          e.target.value = '';
        }
      });
      f.removeLogoBtn.addEventListener('click', () => Invoice.removeLogo());

      // أزرار الإجراءات
      f.savePdfBtn.addEventListener('click', () => this.runAction(f.savePdfBtn, this.savePdf.bind(this)));
      f.sharePdfBtn.addEventListener('click', () => this.runAction(f.sharePdfBtn, this.sharePdf.bind(this)));
      f.printBtn.addEventListener('click', () => this.runAction(f.printBtn, this.printInvoice.bind(this)));
      f.newInvoiceBtn.addEventListener('click', () => this.newInvoice());

      // إدارة المنتجات
      [f.productsBtn, f.openProductsBtn].forEach(btn => btn.addEventListener('click', () => this.openProducts()));
      f.closeProductsBtn.addEventListener('click', () => UI.closeModal(f.productsModal));
      f.productsModal.querySelectorAll('[data-close-products]').forEach(el =>
        el.addEventListener('click', () => UI.closeModal(f.productsModal))
      );
      f.productForm.addEventListener('submit', this.saveProduct.bind(this));
      f.resetProductBtn.addEventListener('click', () => UI.resetProductForm());
      f.productSearch.addEventListener('input', () => this.renderProductsTable());
      f.productsBody.addEventListener('click', this.handleProductTableClick.bind(this));
      f.exportProductsCsvBtn.addEventListener('click', () => this.exportProductsCsv());

      // منتقي المنتجات
      f.closePickerBtn.addEventListener('click', () => UI.closeModal(f.productPickerModal));
      f.productPickerModal.querySelectorAll('[data-close-picker]').forEach(el =>
        el.addEventListener('click', () => UI.closeModal(f.productPickerModal))
      );
      f.pickerSearch.addEventListener('input', () => this.renderProductPicker());
      f.pickerList.addEventListener('click', this.handlePickerClick.bind(this));

      // حركات المخزون
      f.openMovementsBtn.addEventListener('click', () => this.openMovements());
      f.closeMovementsBtn.addEventListener('click', () => UI.closeModal(f.movementsModal));
      f.movementsModal.querySelectorAll('[data-close-movements]').forEach(el =>
        el.addEventListener('click', () => UI.closeModal(f.movementsModal))
      );

      // نسخ احتياطية
      f.exportBackupBtn.addEventListener('click', () => this.exportBackup());
      f.importBackupInput.addEventListener('change', (e) => this.importBackup(e));

      // الفواتير المحفوظة
      f.historyBtn.addEventListener('click', () => this.openHistory());
      f.closeHistoryBtn.addEventListener('click', () => UI.closeModal(f.historyModal));
      f.historyModal.querySelectorAll('[data-close-history]').forEach(el =>
        el.addEventListener('click', () => UI.closeModal(f.historyModal))
      );

      // مفتاح Esc
      document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        UI.closeModal(f.productsModal);
        UI.closeModal(f.productPickerModal);
        UI.closeModal(f.movementsModal);
        UI.closeModal(f.historyModal);
      });
    },

    handleInvoiceChange() {
      Invoice.ensureEditable();
      const rate = Utils.clamp(UI.els.taxRate.value, 0, 100);
      if (String(rate) !== UI.els.taxRate.value && document.activeElement !== UI.els.taxRate) {
        UI.els.taxRate.value = String(rate);
      }
      Invoice.recalculate();
      Invoice.saveSettings();
      QR.refresh();
    },

    handleItemInput(e) {
      const input = e.target.closest('input[data-field]');
      if (!input) return;
      Invoice.ensureEditable();
      const row = input.closest('tr[data-id]');
      const item = Invoice.state.items.find(it => it.id === Number(row.dataset.id));
      if (!item) return;
      const field = input.dataset.field;
      if (field === 'quantity') item.quantity = Utils.positive(input.value, 1);
      else if (field === 'unitPrice') item.unitPrice = Utils.nonNegative(input.value, 0);
      else item[field] = input.value;
      Invoice.recalculate();
      QR.refresh();
    },

    handleItemClick(e) {
      const btn = e.target.closest('[data-delete-item]');
      if (!btn) return;
      Invoice.ensureEditable();
      const row = btn.closest('tr[data-id]');
      const id = Number(row.dataset.id);
      if (Invoice.state.items.length === 1) {
        const first = Invoice.state.items[0];
        Invoice.state.items[0] = { id: first.id, productId: '', partNumber: '', description: '', quantity: 1, unitPrice: 0 };
      } else {
        Invoice.state.items = Invoice.state.items.filter(it => it.id !== id);
      }
      Invoice.renderItems();
      Invoice.recalculate();
      QR.refresh();
    },

    openProductPicker() {
      if (!Inventory.products.length) {
        this.openProducts();
        UI.showStatus('أضف منتجات للمخزون أولًا.', true);
        return;
      }
      UI.els.pickerSearch.value = '';
      this.renderProductPicker();
      UI.openModal(UI.els.productPickerModal);
      setTimeout(() => UI.els.pickerSearch.focus(), 50);
    },

    handlePickerClick(e) {
      const btn = e.target.closest('[data-picker-add]');
      if (!btn) return;
      const productId = btn.dataset.pickerAdd;
      const product = Inventory.find(productId);
      if (!product) return;
      if (product.stock <= 0) {
        UI.showStatus(`المنتج "${product.name}" منتهي من المخزون.`, true);
        return;
      }
      Invoice.ensureEditable();
      const existing = Invoice.state.items.find(it => it.productId === product.id);
      if (existing) {
        if (existing.quantity + 1 > product.stock) {
          UI.showStatus(`الكمية المطلوبة من "${product.name}" أكبر من المتوفر.`, true);
          return;
        }
        existing.quantity += 1;
        Invoice.renderItems();
        Invoice.recalculate();
        QR.refresh();
        UI.closeModal(UI.els.productPickerModal);
        UI.showStatus(`تمت زيادة كمية ${product.name} في الفاتورة.`);
        return;
      }
      const emptyManual = Invoice.state.items.find(it =>
        !it.productId && !it.partNumber.trim() && !it.description.trim() && Number(it.unitPrice) === 0
      );
      const model = {
        productId: product.id,
        partNumber: product.partNumber,
        description: product.name,
        quantity: 1,
        unitPrice: product.salePrice
      };
      if (emptyManual) {
        Object.assign(emptyManual, model);
        Invoice.renderItems();
        Invoice.recalculate();
      } else {
        Invoice.addItem(model, false);
      }
      QR.refresh();
      UI.closeModal(UI.els.productPickerModal);
      UI.showStatus(`تمت إضافة ${product.name} من المخزون.`);
    },

    renderProductPicker() {
      const list = UI.els.pickerList;
      const query = UI.els.pickerSearch.value;
      const products = Inventory.search(query);
      if (!products.length) {
        list.innerHTML = '<div class="history-empty">ما لقيت منتج مطابق.</div>';
        return;
      }
      const fragment = document.createDocumentFragment();
      products.forEach(product => {
        const status = Inventory.stockStatus(product);
        const div = document.createElement('article');
        div.className = 'picker-product';
        div.innerHTML = `
          <div>
            <h3>${Utils.escapeHtml(product.name)}</h3>
            <p>${Utils.escapeHtml([product.partNumber, product.brand, product.vehicles].filter(Boolean).join(' — ') || 'بدون تفاصيل إضافية')}</p>
            <div class="picker-meta">
              <span>السعر: <b>${Utils.formatMoney(product.salePrice)}</b></span>
              <span>المتوفر: <b>${Utils.formatQuantity(product.stock)}</b></span>
              <span class="stock-badge ${status.className}">${status.label}</span>
            </div>
          </div>
          <button class="btn btn-primary" type="button" data-picker-add="${product.id}" ${product.stock <= 0 ? 'disabled' : ''}>إضافة</button>
        `;
        fragment.appendChild(div);
      });
      list.innerHTML = '';
      list.appendChild(fragment);
    },

    // --- إدارة المنتجات ---
    openProducts() {
      this.renderProductsTable();
      UI.openModal(UI.els.productsModal);
      setTimeout(() => UI.els.productSearch.focus(), 50);
    },

    renderProductsTable() {
      const tbody = UI.els.productsBody;
      const empty = UI.els.productsEmpty;
      const query = UI.els.productSearch.value;
      const products = Inventory.search(query);
      empty.hidden = products.length > 0;
      const fragment = document.createDocumentFragment();
      products.forEach(product => {
        const status = Inventory.stockStatus(product);
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td class="product-name-cell">
            <strong>${Utils.escapeHtml(product.name)}</strong>
            <small>${Utils.escapeHtml([product.brand, product.vehicles, product.shelf ? `رف ${product.shelf}` : ''].filter(Boolean).join(' — '))}</small>
          </td>
          <td>${Utils.escapeHtml(product.partNumber || '—')}</td>
          <td>${Utils.escapeHtml(product.barcode || '—')}</td>
          <td>${Utils.formatNumber(product.costPrice)}</td>
          <td>${Utils.formatNumber(product.salePrice)}</td>
          <td><strong>${Utils.formatQuantity(product.stock)}</strong></td>
          <td><span class="stock-badge ${status.className}">${status.label}</span></td>
          <td>
            <div class="table-actions">
              <button type="button" class="mini-btn add" data-product-add="${product.id}" ${product.stock <= 0 ? 'disabled' : ''}>للفاتورة</button>
              <button type="button" class="mini-btn edit" data-product-edit="${product.id}">تعديل</button>
              <button type="button" class="mini-btn delete" data-product-delete="${product.id}">حذف</button>
            </div>
          </td>
        `;
        fragment.appendChild(tr);
      });
      tbody.innerHTML = '';
      tbody.appendChild(fragment);
    },

    handleProductTableClick(e) {
      const target = e.target.closest('[data-product-add], [data-product-edit], [data-product-delete]');
      if (!target) return;
      const id = target.dataset.productAdd || target.dataset.productEdit || target.dataset.productDelete;
      if (target.dataset.productAdd) {
        this.addProductToInvoice(id);
        UI.closeModal(UI.els.productsModal);
      } else if (target.dataset.productEdit) {
        this.editProduct(id);
      } else if (target.dataset.productDelete) {
        this.deleteProduct(id);
      }
    },

    addProductToInvoice(productId) {
      const product = Inventory.find(productId);
      if (!product) return;
      if (product.stock <= 0) {
        UI.showStatus(`المنتج "${product.name}" منتهي من المخزون.`, true);
        return;
      }
      Invoice.ensureEditable();
      const existing = Invoice.state.items.find(it => it.productId === product.id);
      if (existing) {
        if (existing.quantity + 1 > product.stock) {
          UI.showStatus(`الكمية المطلوبة من "${product.name}" أكبر من المتوفر.`, true);
          return;
        }
        existing.quantity += 1;
        Invoice.renderItems();
        Invoice.recalculate();
        QR.refresh();
        UI.showStatus(`تمت زيادة كمية ${product.name} في الفاتورة.`);
        return;
      }
      const emptyManual = Invoice.state.items.find(it =>
        !it.productId && !it.partNumber.trim() && !it.description.trim() && Number(it.unitPrice) === 0
      );
      const model = {
        productId: product.id,
        partNumber: product.partNumber,
        description: product.name,
        quantity: 1,
        unitPrice: product.salePrice
      };
      if (emptyManual) {
        Object.assign(emptyManual, model);
        Invoice.renderItems();
        Invoice.recalculate();
      } else {
        Invoice.addItem(model, false);
      }
      QR.refresh();
      UI.showStatus(`تمت إضافة ${product.name} من المخزون.`);
    },

    editProduct(id) {
      const product = Inventory.find(id);
      if (!product) return;
      const f = UI.els;
      f.productId.value = product.id;
      f.productName.value = product.name;
      f.productPartNumber.value = product.partNumber;
      f.productBarcode.value = product.barcode;
      f.productBrand.value = product.brand;
      f.productCostPrice.value = product.costPrice;
      f.productSalePrice.value = product.salePrice;
      f.productStock.value = product.stock;
      f.productMinStock.value = product.minStock;
      f.productVehicles.value = product.vehicles;
      f.productShelf.value = product.shelf;
      f.productNotes.value = product.notes;
      f.productForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
      f.productName.focus();
    },

    deleteProduct(id) {
      const product = Inventory.find(id);
      if (!product) return;
      if (!window.confirm(`متأكد من حذف المنتج "${product.name}"؟ الفواتير القديمة ما راح تنحذف.`)) return;
      Inventory.products = Inventory.products.filter(p => p.id !== id);
      Invoice.state.items.forEach(it => {
        if (it.productId === id) it.productId = '';
      });
      Inventory.save();
      UI.resetProductForm();
      this.renderDashboard();
      this.renderProductsTable();
      this.renderProductPicker();
      UI.showStatus(`تم حذف المنتج ${product.name}.`);
    },

    saveProduct(e) {
      e.preventDefault();
      const f = UI.els;
      const name = f.productName.value.trim();
      const salePrice = Utils.nonNegative(f.productSalePrice.value, 0);
      const stock = Utils.nonNegative(f.productStock.value, 0);
      if (!name) {
        window.alert('اكتب اسم المنتج.');
        f.productName.focus();
        return;
      }

      const part = f.productPartNumber.value.trim();
      const barcode = f.productBarcode.value.trim();
      const editingId = f.productId.value;
      const duplicate = Inventory.products.find(p =>
        p.id !== editingId && (
          (part && p.partNumber && p.partNumber.toLowerCase() === part.toLowerCase()) ||
          (barcode && p.barcode && p.barcode === barcode)
        )
      );
      if (duplicate && !window.confirm(`يوجد منتج مشابه باسم "${duplicate.name}". هل تبي تحفظ المنتج رغم ذلك؟`)) return;

      const values = Inventory.normalizeProduct({
        id: editingId || Utils.makeId('prd'),
        name,
        partNumber: part,
        barcode,
        brand: f.productBrand.value,
        vehicles: f.productVehicles.value,
        costPrice: f.productCostPrice.value,
        salePrice,
        stock,
        minStock: f.productMinStock.value,
        shelf: f.productShelf.value,
        notes: f.productNotes.value
      });

      const existingIndex = Inventory.products.findIndex(p => p.id === editingId);
      if (existingIndex >= 0) {
        const existing = Inventory.products[existingIndex];
        values.createdAt = existing.createdAt;
        values.updatedAt = new Date().toISOString();
        Inventory.products[existingIndex] = values;
        if (values.stock !== existing.stock) {
          const diff = values.stock - existing.stock;
          Inventory.addMovement({
            product: values,
            type: diff > 0 ? 'restock' : 'adjustment',
            quantity: diff,
            beforeStock: existing.stock,
            afterStock: values.stock,
            note: 'تعديل يدوي من إدارة المنتجات'
          });
        }
        UI.showStatus(`تم تحديث المنتج ${values.name}.`);
      } else {
        Inventory.products.unshift(values);
        if (values.stock > 0) {
          Inventory.addMovement({
            product: values,
            type: 'initial',
            quantity: values.stock,
            beforeStock: 0,
            afterStock: values.stock,
            note: 'رصيد افتتاحي'
          });
        }
        UI.showStatus(`تمت إضافة المنتج ${values.name}.`);
      }

      Inventory.save();
      UI.resetProductForm();
      this.renderDashboard();
      this.renderProductsTable();
      this.renderProductPicker();
    },

    // --- لوحة التحكم ---
    renderDashboard() {
      const stats = Inventory.getStats();
      const f = UI.els;
      f.statProducts.textContent = Utils.formatQuantity(Inventory.products.length);
      f.statUnits.textContent = Utils.formatQuantity(stats.units);
      f.statLowStock.textContent = Utils.formatQuantity(stats.low);
      f.statCostValue.textContent = Utils.formatMoney(stats.cost);
      f.statSaleValue.textContent = Utils.formatMoney(stats.sale);

      const lowProducts = Inventory.getLowProducts();
      const preview = f.lowStockPreview;
      if (!lowProducts.length) {
        preview.innerHTML = Inventory.products.length
          ? '<div class="stock-ok">المخزون سليم، ما فيه منتجات منخفضة حاليًا.</div>'
          : '<div class="stock-empty">ابدأ بإضافة منتجاتك من زر إدارة المنتجات.</div>';
        return;
      }
      preview.innerHTML = `
        <div class="low-stock-title">تنبيه مخزون منخفض</div>
        <div class="low-stock-chips">
          ${lowProducts.map(p => `<button type="button" data-dashboard-product="${p.id}">${Utils.escapeHtml(p.name)} <b>${Utils.formatQuantity(p.stock)}</b></button>`).join('')}
        </div>`;
      preview.querySelectorAll('[data-dashboard-product]').forEach(btn => {
        btn.addEventListener('click', () => {
          this.openProducts();
          this.editProduct(btn.dataset.dashboardProduct);
        });
      });
    },

    // --- حركات المخزون ---
    openMovements() {
      this.renderMovements();
      UI.openModal(UI.els.movementsModal);
    },

    renderMovements() {
      const list = UI.els.movementsList;
      if (!Inventory.movements.length) {
        list.innerHTML = '<div class="history-empty">ما فيه حركات مخزون حتى الآن.</div>';
        return;
      }
      const fragment = document.createDocumentFragment();
      Inventory.movements.slice(0, 300).forEach(mov => {
        const type = this.movementType(mov.type);
        const qty = Number(mov.quantity) || 0;
        const div = document.createElement('article');
        div.className = 'movement-entry';
        div.innerHTML = `
          <div class="movement-icon ${type.className}">${type.icon}</div>
          <div class="movement-main">
            <div class="movement-top">
              <h3>${Utils.escapeHtml(mov.productName || 'منتج')}</h3>
              <time>${Utils.escapeHtml(Utils.formatDateTime(mov.createdAt))}</time>
            </div>
            <p>${Utils.escapeHtml(type.label)} ${mov.invoiceNumber ? `— فاتورة ${Utils.escapeHtml(mov.invoiceNumber)}` : ''}</p>
            <div class="movement-details">
              <span>التغيير: <b class="${qty >= 0 ? 'positive' : 'negative'}">${qty >= 0 ? '+' : ''}${Utils.formatQuantity(qty)}</b></span>
              <span>قبل: ${Utils.formatQuantity(mov.beforeStock)}</span>
              <span>بعد: ${Utils.formatQuantity(mov.afterStock)}</span>
            </div>
          </div>
        `;
        fragment.appendChild(div);
      });
      list.innerHTML = '';
      list.appendChild(fragment);
    },

    movementType(type) {
      const map = {
        sale: { label: 'بيع وخصم من المخزون', icon: '−', className: 'sale' },
        restock: { label: 'إضافة كمية', icon: '+', className: 'restock' },
        initial: { label: 'رصيد افتتاحي', icon: '+', className: 'initial' },
        adjustment: { label: 'تعديل مخزون', icon: '±', className: 'adjustment' }
      };
      return map[type] || map.adjustment;
    },

    // --- الفواتير المحفوظة ---
    openHistory() {
      this.renderHistory();
      UI.openModal(UI.els.historyModal);
    },

    renderHistory() {
      const history = Storage.readHistory();
      const list = UI.els.historyList;
      if (!history.length) {
        list.innerHTML = '<div class="history-empty">ما فيه فواتير محفوظة على هذا الجهاز حتى الآن.</div>';
        return;
      }
      const fragment = document.createDocumentFragment();
      history.forEach((entry, index) => {
        const div = document.createElement('article');
        div.className = 'history-entry';
        div.innerHTML = `
          <div class="history-entry-top">
            <h3>${Utils.escapeHtml(entry.number || 'فاتورة')}</h3>
            <time>${Utils.escapeHtml(Utils.formatDateTime(entry.savedAt))}</time>
          </div>
          <div class="history-entry-details">
            <span>${Utils.escapeHtml(entry.title || 'فاتورة')}</span>
            <span>${Utils.formatNumber(entry.totals?.total || 0)} ريال</span>
            <span>${Array.isArray(entry.items) ? entry.items.length : 0} بند</span>
            <span class="history-status ${entry.inventoryCommitted ? 'committed' : 'draft'}">${entry.inventoryCommitted ? 'معتمدة ومخصومة' : 'غير معتمدة'}</span>
          </div>
          <div class="history-entry-actions">
            <button class="history-load" type="button" data-load-history="${index}">فتح الفاتورة</button>
            <button class="history-delete" type="button" data-delete-history="${index}">حذف من المحفوظات</button>
          </div>
        `;
        fragment.appendChild(div);
      });
      list.innerHTML = '';
      list.appendChild(fragment);

      list.querySelectorAll('[data-load-history]').forEach(btn => {
        btn.addEventListener('click', () => {
          Invoice.loadHistory(Number(btn.dataset.loadHistory));
        });
      });
      list.querySelectorAll('[data-delete-history]').forEach(btn => {
        btn.addEventListener('click', () => {
          const idx = Number(btn.dataset.deleteHistory);
          if (!window.confirm('متأكد من حذف الفاتورة من المحفوظات؟ حذفها لا يعيد الكمية للمخزون.')) return;
          const history = Storage.readHistory();
          history.splice(idx, 1);
          Storage.write(STORAGE_KEYS.history, history);
          this.renderHistory();
        });
      });
    },

    // --- الإجراءات النهائية (PDF، واتساب، طباعة) ---
    async savePdf() {
      if (!Invoice.validate()) return;
      await QR.refresh();
      const data = Invoice.getInvoiceData();
      const blob = await Print.createPdfBlob(data);
      const result = Invoice.commitInventory(data);
      Invoice.saveHistory(data);
      Utils.downloadBlob(blob, `${Utils.safeFileName(data.number)}.pdf`);
      UI.showStatus(result.changed
        ? 'تم حفظ PDF واعتماد الفاتورة وخصم الكميات من المخزون.'
        : 'تم حفظ PDF. الفاتورة محفوظة بدون خصم إضافي للمخزون.');
      this.renderDashboard();
    },

    async sharePdf() {
      if (!Invoice.validate()) return;
      const likelyDesktop = !window.matchMedia('(pointer: coarse)').matches;
      const whatsappTab = likelyDesktop ? window.open('about:blank', '_blank') : null;

      await QR.refresh();
      const data = Invoice.getInvoiceData();
      const blob = await Print.createPdfBlob(data);
      const file = new File([blob], `${Utils.safeFileName(data.number)}.pdf`, { type: 'application/pdf' });
      const result = Invoice.commitInventory(data);
      Invoice.saveHistory(data);
      const message = WhatsApp.buildMessage(data);
      const canShareFile = Boolean(navigator.share && navigator.canShare && navigator.canShare({ files: [file] }));

      if (canShareFile) {
        if (whatsappTab && !whatsappTab.closed) whatsappTab.close();
        try {
          await navigator.share({
            title: `${data.title} ${data.number}`,
            text: message,
            files: [file]
          });
          UI.showStatus(result.changed
            ? 'تم اعتماد البيع وفتح مشاركة الفاتورة. اختر واتساب ثم جهة الاتصال.'
            : 'تم فتح مشاركة الفاتورة بدون خصم إضافي للمخزون.');
          this.renderDashboard();
          return;
        } catch (error) {
          if (error?.name === 'AbortError') {
            UI.showStatus('تم إلغاء المشاركة. الفاتورة بقيت محفوظة ومعتمدة.');
            return;
          }
          console.warn('تعذرت مشاركة الملف مباشرة، سيتم فتح واتساب ويب.', error);
        }
      }

      Utils.downloadBlob(blob, file.name);
      const whatsappUrl = WhatsApp.buildUrl(data.whatsappNumber, message);
      if (whatsappTab && !whatsappTab.closed) {
        whatsappTab.location.href = whatsappUrl;
      } else {
        window.open(whatsappUrl, '_blank', 'noopener');
      }
      UI.showStatus(result.changed
        ? 'تم اعتماد البيع وتنزيل PDF وفتح واتساب. أرفق ملف الفاتورة الذي تم تنزيله.'
        : 'تم تنزيل PDF وفتح واتساب بدون خصم إضافي للمخزون. أرفق الملف في المحادثة.');
      this.renderDashboard();
    },

    async printInvoice() {
      if (!Invoice.validate()) return;
      await QR.refresh();
      const data = Invoice.getInvoiceData();
      await Print.renderPrint(data);
      const result = Invoice.commitInventory(data);
      Invoice.saveHistory(data);
      UI.showStatus(result.changed ? 'تم اعتماد البيع وخصم المخزون وتجهيز الطباعة.' : 'تم تجهيز الطباعة بدون خصم إضافي للمخزون.');
      this.renderDashboard();
      window.print();
    },

    newInvoice() {
      if (!window.confirm('فتح فاتورة جديدة؟ سيتم مسح البنود الحالية فقط.')) return;
      const f = UI.els;
      f.invoiceNumber.value = Utils.generateInvoiceNumber();
      f.invoiceDate.value = Utils.todayIso();
      f.invoiceTime.value = Utils.currentTimeIso();
      f.whatsappNumber.value = '';
      Invoice.state.items = [];
      Invoice.state.nextItemId = 1;
      Invoice.state.invoiceCommitted = false;
      Invoice.addItem({}, false);
      Invoice.recalculate();
      QR.refresh();
      UI.showStatus('تم فتح فاتورة جديدة مع الاحتفاظ ببيانات المنشأة والمخزون.');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },

    // --- النسخ الاحتياطية ---
    exportBackup() {
      const backup = {
        schema: 'yousef-auto-parts-backup-v1',
        exportedAt: new Date().toISOString(),
        business: BUSINESS,
        settings: Storage.read(STORAGE_KEYS.settings, {}),
        products: Inventory.products,
        movements: Inventory.movements,
        history: Storage.readHistory()
      };
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json;charset=utf-8' });
      Utils.downloadBlob(blob, `نسخة-احتياطية-قطع-الغيار-${Utils.todayIso()}.json`);
      UI.showStatus('تم تنزيل نسخة احتياطية تشمل المنتجات والمخزون والفواتير والإعدادات.');
    },

    async importBackup(e) {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (!file) return;
      try {
        const text = await file.text();
        const backup = JSON.parse(text);
        if (!backup || backup.schema !== 'yousef-auto-parts-backup-v1' || !Array.isArray(backup.products)) {
          throw new Error('ملف غير صالح');
        }
        if (!window.confirm('استرجاع النسخة سيستبدل المنتجات والمخزون والفواتير الحالية. متأكد؟')) return;
        Storage.write(STORAGE_KEYS.settings, backup.settings || {});
        Storage.write(STORAGE_KEYS.products, backup.products || []);
        Storage.write(STORAGE_KEYS.movements, backup.movements || []);
        Storage.write(STORAGE_KEYS.history, backup.history || []);
        window.alert('تم استرجاع النسخة بنجاح. سيتم تحديث الصفحة الآن.');
        window.location.reload();
      } catch (error) {
        console.error(error);
        UI.showStatus('تعذر استرجاع الملف. تأكد أنه نسخة احتياطية صادرة من نفس الموقع.', true);
      }
    },

    // --- تصدير CSV ---
    exportProductsCsv() {
      if (!Inventory.products.length) {
        window.alert('ما فيه منتجات لتصديرها.');
        return;
      }
      const rows = [
        ['اسم المنتج', 'رقم القطعة', 'الباركود', 'الشركة', 'السيارات المتوافقة', 'سعر الشراء', 'سعر البيع', 'الكمية', 'حد التنبيه', 'الرف', 'ملاحظات'],
        ...Inventory.products.map(p => [
          p.name, p.partNumber, p.barcode, p.brand, p.vehicles,
          p.costPrice, p.salePrice, p.stock, p.minStock, p.shelf, p.notes
        ])
      ];
      const csv = '\uFEFF' + rows.map(row => row.map(cell => `"${String(cell ?? '').replaceAll('"', '""')}"`).join(',')).join('\r\n');
      Utils.downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `منتجات-المخزون-${Utils.todayIso()}.csv`);
    },

    // --- تشغيل إجراء مع تعطيل الأزرار مؤقتًا ---
    async runAction(button, action) {
      const btns = [UI.els.savePdfBtn, UI.els.sharePdfBtn, UI.els.printBtn, UI.els.newInvoiceBtn];
      btns.forEach(b => { b.disabled = true; });
      const originalText = button.textContent;
      button.textContent = 'جاري التجهيز...';
      UI.showStatus('');
      try {
        await action();
      } catch (error) {
        if (error?.name !== 'AbortError') {
          console.error(error);
          UI.showStatus('صار خطأ أثناء تجهيز الفاتورة. جرّب مرة ثانية.', true);
        }
      } finally {
        button.textContent = originalText;
        btns.forEach(b => { b.disabled = false; });
      }
    },

    // --- تطبيق تنسيق الأرقام على الحقول ---
    applyLatinInputs() {
      const selector = 'input[type="number"], input[type="date"], input[type="time"], input[inputmode="numeric"], input[inputmode="decimal"], input[inputmode="tel"], .latin-digits';
      document.querySelectorAll(selector).forEach(el => {
        el.lang = el.type === 'date' || el.type === 'time' ? 'en-GB' : 'en-US';
        el.dir = 'ltr';
        el.classList.add('latin-digits');
        el.addEventListener('input', () => {
          const converted = Utils.toLatinDigits(el.value);
          if (converted !== el.value) el.value = converted;
        });
      });
    }
  };

  // ============================================================
  //  بدء التطبيق عند تحميل الصفحة
  // ============================================================
  document.addEventListener('DOMContentLoaded', () => App.init());

})();
