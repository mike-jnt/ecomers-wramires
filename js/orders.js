const Orders = window.Orders = {
  initDone: false,

  init() {
    if (this.initDone) return;
    this.initDone = true;

    document.getElementById("productSelect").addEventListener("change", () => {
      this.applyDefaultShipping();
      this.updateSummary();
    });
    document.getElementById("quantityInput").addEventListener("input", () => {
      this.applyDefaultShipping();
      this.updateSummary();
    });
    document.getElementById("shippingInput").addEventListener("input", () => this.updateSummary());
    document.getElementById("discount8Toggle")?.addEventListener("change", () => this.updateSummary());

    document.getElementById("orderForm").addEventListener("submit", e => this.create(e));
    document.getElementById("clearOrderFormBtn")?.addEventListener("click", () => this.clearNewOrderForm());
    document.getElementById("customerPhone").addEventListener("blur", () => this.checkCustomer());
    document.getElementById("ordersSearch").addEventListener("input", () => this.renderOrders());

    document.querySelectorAll("[data-order-filter]").forEach(b=>b.addEventListener("click",()=>{
      document.querySelectorAll("[data-order-filter]").forEach(x=>x.classList.remove("active"));
      b.classList.add("active");
      App.state.orderFilter=b.dataset.orderFilter;
      this.renderOrders();
    }));
  },

  applyDefaultShipping() {
    const product = App.getProduct(document.getElementById("productSelect")?.value);
    const shippingInput = document.getElementById("shippingInput");
    if (!shippingInput) return;

    if (!product) {
      shippingInput.value = "";
      return;
    }

    // El valor viene de envioPredeterminado cargado desde el Excel de precios.
    // Para los audífonos Etech Store actualmente corresponde a $20.000 por pedido.
    shippingInput.value = Math.max(0, Number(product.defaultShipping || 0));
  },

  updateSummary() {
    if (!this.initDone) this.init();
    const p = App.getProduct(document.getElementById("productSelect").value);
    if (!p) {
      const shippingInput = document.getElementById("shippingInput");
      if (shippingInput) shippingInput.value = "";
      document.getElementById("productPreview").innerHTML = '<div class="empty-state"><b>Sin productos</b><span>Carga el catálogo antes de crear pedidos.</span></div>';
      document.getElementById("summaryProduct").innerHTML = '<span>Selecciona un producto</span>';
      document.getElementById("subtotalValue").textContent = App.money(0);
      document.getElementById("shippingValue").textContent = App.money(0);
      const discountValue = document.getElementById("discountValue");
      if (discountValue) discountValue.textContent = `-${App.money(0)}`;
      document.getElementById("discountSummaryRow")?.classList.remove("discount-summary-row--active");
      document.getElementById("totalValue").textContent = App.money(0);
      document.getElementById("fulfillmentCallout").innerHTML = '<b>Sin disponibilidad</b><span>No hay catálogo cargado.</span>';
      return;
    }

    const qty = Math.max(1, Number(document.getElementById("quantityInput").value)||1);
    const shipping = Math.max(0, Number(document.getElementById("shippingInput").value)||0);
    const discountApplied = Boolean(document.getElementById("discount8Toggle")?.checked);
    const grossTotal = p.price * qty + shipping;
    const discountAmount = discountApplied ? Math.round(grossTotal * 0.08) : 0;
    const finalTotal = Math.max(0, grossTotal - discountAmount);
    const available = Math.max(0, p.ownStock-p.reserved);
    const ownPossible = available >= qty;

    document.getElementById("productPreview").innerHTML = App.state.role === "seller"
      ? `<div class="product-preview-grid seller-price-preview">
          <div>
            <b>${App.escapeHTML(p.name)}</b>
            <span class="product-meta">${App.escapeHTML(p.variant)} · Etech Store</span>
            <button type="button" class="link-btn product-info-link" onclick="Management.openProductInfo('${p.id}')">Ver funciones y beneficios</button>
          </div>
          <div class="seller-visible-price">${App.money(p.price)}</div>
        </div>`
      : `<div class="product-preview-grid">
          <div>
            <b>${App.escapeHTML(p.name)}</b>
            <span class="product-meta">${App.escapeHTML(p.variant)} · ${App.escapeHTML(p.sku)}</span>
            <button type="button" class="link-btn product-info-link" onclick="Management.openProductInfo('${p.id}')">Ver ficha comercial</button>
          </div>
          <div class="${ownPossible?'stock-good':'stock-warn'}">${ownPossible?`${available} disponibles en bodega`:`Etech Store: ${p.supplierStock} reportados`}</div>
        </div>`;

    document.getElementById("summaryProduct").innerHTML = `<b>${App.escapeHTML(p.name)}</b><span>${p.variant} · ${qty} unidad${qty>1?'es':''}</span>`;
    document.getElementById("subtotalValue").textContent = App.money(p.price*qty);
    document.getElementById("shippingValue").textContent = App.money(shipping);
    document.getElementById("discountValue").textContent = `-${App.money(discountAmount)}`;
    document.getElementById("discountSummaryRow")?.classList.toggle("discount-summary-row--active", discountApplied);
    document.getElementById("totalValue").textContent = App.money(finalTotal);

    const supplier = App.getSupplier(p.supplierId);
    document.getElementById("fulfillmentCallout").innerHTML = App.state.role === "seller"
      ? `<b>Total del cliente${discountApplied ? " · descuento 8% aplicado" : ""}</b><span>${App.money(p.price * qty)} en producto + ${App.money(shipping)} de envío${discountApplied ? ` - ${App.money(discountAmount)} de descuento` : ""} = <strong>${App.money(finalTotal)}</strong>.</span>`
      : (ownPossible
        ? `<b>🏠 Inventario propio</b><span>Al confirmar se reservarán ${qty} unidad${qty>1?'es':''}.</span>`
        : `<b>🏭 ${supplier?.name || "Proveedor"}</b><span>Sin stock propio suficiente. El pedido quedará pendiente para cargar al proveedor.</span>`);
  },

  checkCustomer() {
    const phone = document.getElementById("customerPhone").value.replace(/\D/g,"");
    const orders = App.orders.filter(o=>String(o.customer?.phone||"").replace(/\D/g,"")===phone);
    const hint = document.getElementById("customerHistoryHint");

    if (!phone) {
      hint.textContent="";
      return;
    }

    if (orders.length) {
      const delivered = orders.filter(o=>o.status==="delivered").length;
      hint.textContent = `Cliente existente: ${orders.length} pedido(s), ${delivered} entregado(s).`;
    } else {
      hint.textContent = "Cliente nuevo.";
    }
  },

  async create(e) {
    e.preventDefault();

    const p = App.getProduct(document.getElementById("productSelect").value);
    if (!p) return App.toast("No hay producto seleccionado.");

    const form = new FormData(e.currentTarget);
    const qty = Math.max(1,Number(document.getElementById("quantityInput").value)||1);
    const phone = String(form.get("phone")||"").replace(/\D/g,"");

    const duplicate = App.orders.find(o =>
      String(o.customer?.phone||"").replace(/\D/g,"")===phone &&
      o.productId===p.id &&
      !["delivered","cancelled","returned"].includes(o.status)
    );

    if (duplicate && !confirm(`Este cliente ya tiene un pedido activo (${duplicate.id}) para este producto. ¿Deseas continuar?`)) return;

    const shipping = Math.max(0,Number(document.getElementById("shippingInput").value)||0);
    const payment = form.get("payment");
    const source = document.getElementById("sourceSelect").value;

    if (!payment) {
      App.toast("Selecciona el método de pago.");
      return;
    }

    if (!source) {
      App.toast("Selecciona la fuente del pedido.");
      return;
    }

    const discountApplied = Boolean(document.getElementById("discount8Toggle")?.checked);

    const baseOrder = {
      customer: {
        name: form.get("name"),
        documentId: String(form.get("documentId") || "").replace(/[^0-9A-Za-z.-]/g, "").slice(0, 20),
        phone,
        department: form.get("department"),
        city: form.get("city"),
        address: form.get("address"),
        neighborhood: form.get("neighborhood") || "",
        reference: form.get("reference") || ""
      },
      productId: p.id,
      productSku: p.sku || "",
      quantity: qty,
      unitPrice: p.price,
      shipping,
      discountApplied,
      discountPercent: discountApplied ? 8 : 0,
      payment,
      source,
      notes: document.getElementById("orderNotes").value.trim()
    };

    const submit = e.currentTarget.querySelector('button[type="submit"]');
    submit.disabled = true;
    submit.innerHTML = '<span class="loading-inline">Confirmando</span>';

    try {
      const result = await FirebaseService.createOrder(baseOrder, App.actor());

      this.resetNewOrderForm(e.currentTarget);

      // Después de guardar permanecemos en "Nuevo pedido".
      // No abrimos el detalle ni cambiamos de pantalla: el vendedor puede
      // comenzar inmediatamente a registrar el siguiente cliente.
      App.toast(`${result.id} creado correctamente. Puedes registrar el siguiente pedido.`);
    } catch (error) {
      console.error(error);
      App.toast(App.firebaseMessage(error));
    } finally {
      submit.disabled = false;
      submit.textContent = "Confirmar pedido";
    }
  },



  clearNewOrderForm() {
    const form = document.getElementById("orderForm");
    if (!form) return;

    // Usa la misma limpieza dura del guardado automático para que ambos
    // comportamientos sean idénticos.
    this.resetNewOrderForm(form);

    // Reafirmar las selecciones solicitadas por el usuario.
    const productSelect = document.getElementById("productSelect");
    const sourceSelect = document.getElementById("sourceSelect");

    if (productSelect) {
      productSelect.value = "";
      const placeholder = Array.from(productSelect.options).find(o => o.value === "");
      if (placeholder) placeholder.selected = true;
    }

    if (sourceSelect) {
      sourceSelect.value = "";
      const placeholder = Array.from(sourceSelect.options).find(o => o.value === "");
      if (placeholder) placeholder.selected = true;
    }

    form.querySelectorAll('input[name="payment"]').forEach(input => {
      input.checked = false;
      input.defaultChecked = false;
      input.removeAttribute("checked");
    });

    this.updateSummary();
    App.toast("Formulario limpio. Puedes registrar el siguiente pedido.");
  },


  resetNewOrderForm(formElement = document.getElementById("orderForm")) {
    if (!formElement) return;

    // V16.5: limpieza dura. Además de value, borramos defaultValue/defaultChecked
    // para impedir que form.reset(), autocomplete o el navegador restauren
    // información del pedido anterior.
    const clearOnce = ({ refreshSummary = true } = {}) => {
      try { formElement.reset(); } catch {}

      formElement.querySelectorAll("input").forEach(field => {
        const type = String(field.type || "text").toLowerCase();
        if (["submit", "button", "reset", "hidden"].includes(type)) return;

        if (["radio", "checkbox"].includes(type)) {
          field.checked = false;
          field.defaultChecked = false;
          field.removeAttribute("checked");
        } else {
          field.value = "";
          field.defaultValue = "";
          field.setAttribute("value", "");
        }
      });

      formElement.querySelectorAll("textarea").forEach(field => {
        field.value = "";
        field.defaultValue = "";
        field.textContent = "";
      });

      formElement.querySelectorAll("select").forEach(select => {
        Array.from(select.options).forEach(option => {
          option.defaultSelected = false;
          option.removeAttribute("selected");
        });

        const emptyOption = Array.from(select.options).find(option => option.value === "");
        if (emptyOption) {
          emptyOption.selected = true;
          emptyOption.defaultSelected = true;
          select.value = "";
        } else {
          select.selectedIndex = -1;
        }
      });

      // Referencias explícitas de campos dinámicos del pedido.
      const productSelect = document.getElementById("productSelect");
      const quantityInput = document.getElementById("quantityInput");
      const shippingInput = document.getElementById("shippingInput");
      const sourceSelect = document.getElementById("sourceSelect");
      const notes = document.getElementById("orderNotes");
      const hint = document.getElementById("customerHistoryHint");

      if (productSelect) productSelect.value = "";
      if (quantityInput) { quantityInput.value = ""; quantityInput.defaultValue = ""; }
      if (shippingInput) { shippingInput.value = ""; shippingInput.defaultValue = ""; }
      if (sourceSelect) sourceSelect.value = "";
      if (notes) { notes.value = ""; notes.defaultValue = ""; }
      if (hint) hint.textContent = "";

      if (refreshSummary) this.updateSummary();
    };

    // Primera limpieza inmediatamente después de la confirmación de Firebase.
    clearOnce();

    // Mantener la vista de captura abierta.
    if (App.state.activeView !== "new-order") App.go("new-order");
    formElement.scrollIntoView({ behavior:"smooth", block:"start" });

    // Firestore y el navegador pueden producir una actualización justo después
    // del submit. Repetimos la limpieza al terminar esos ciclos para asegurar
    // que ningún dato reaparezca en pantalla.
    requestAnimationFrame(() => clearOnce());
    [120, 350, 800].forEach(delay => {
      setTimeout(() => clearOnce(), delay);
    });

    setTimeout(() => {
      const phone = document.getElementById("customerPhone");
      if (phone) {
        phone.value = "";
        phone.defaultValue = "";
        phone.focus({ preventScroll:true });
      }
    }, 850);
  },

  async waitForOrder(id, timeout = 3000) {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      const order = App.getOrder(id);
      if (order) return order;
      await new Promise(resolve => setTimeout(resolve, 120));
    }
    return null;
  },

  filteredOrders() {
    const q = (document.getElementById("ordersSearch")?.value||"").trim().toLowerCase();

    return App.orders.filter(o=>{
      const f = App.state.orderFilter;
      let ok = f==="all" ||
        (f==="confirmed" && ["confirmed","supplier_pending"].includes(o.status)) ||
        (f==="dispatch" && ["preparing","packed","supplier_loaded"].includes(o.status)) ||
        (f==="transit" && ["shipped","transit"].includes(o.status)) ||
        (f==="delivered" && o.status==="delivered") ||
        (f==="cancelled" && o.status==="cancelled");

      if(!ok) return false;

      if (App.state.role === "seller" && o.sellerUid && o.sellerUid !== App.currentUser?.uid) return false;

      if(!q) return true;
      const p=App.getProduct(o.productId);

      return [
        o.id,
        o.customer?.name,
        o.customer?.phone,
        o.customer?.city,
        p?.name
      ].join(" ").toLowerCase().includes(q);
    }).sort((a,b)=>App.toDate(b.createdAt||b.createdAtClient)-App.toDate(a.createdAt||a.createdAtClient));
  },

  renderOrders() {
    if (!this.initDone) this.init();
    this.renderOrderContainer("ordersList", this.filteredOrders());
  },

  renderOrderContainer(id, orders) {
    const el = document.getElementById(id);
    if (!el) return;

    if (!orders.length) {
      el.innerHTML = `<div class="empty-state"><b>No hay pedidos</b><span>No encontramos registros con este filtro.</span></div>`;
      return;
    }

    el.innerHTML = `
      <div class="desktop-table">
        <table class="data-table">
          <thead><tr><th>Pedido</th><th>Cliente</th><th>Producto</th><th>Total</th><th>Origen</th><th>Estado</th></tr></thead>
          <tbody>${orders.map(o=>{
            const p=App.getProduct(o.productId);
            return `<tr>
              <td><button class="link-btn" onclick="Orders.openOrder('${o.id}')">${o.id}</button><br><span class="muted">${App.dateTime(o.createdAt||o.createdAtClient)}</span></td>
              <td><b>${App.escapeHTML(o.customer?.name||"-")}</b><br><span class="muted">${App.escapeHTML(o.customer?.city||"-")} · ${App.escapeHTML(o.customer?.phone||"-")}</span></td>
              <td>${App.escapeHTML(p?.name||"-")}<br><span class="muted">${App.escapeHTML(p?.variant||"")} · x${o.quantity}</span></td>
              <td><b>${App.money(o.total)}</b><br><span class="muted">${o.payment==="cod"?"Contraentrega":"Pagado"}</span></td>
              <td>${o.fulfillment==="own"?"🏠 Bodega":"🏭 Proveedor"}</td>
              <td><span class="status status-${o.status}">${App.statusLabels[o.status]||o.status}</span></td>
            </tr>`;
          }).join("")}</tbody>
        </table>
      </div>

      <div class="mobile-order-list">
        ${orders.map(o=>{
          const p=App.getProduct(o.productId);
          return `<article class="order-card-mobile" onclick="Orders.openOrder('${o.id}')">
            <div class="order-card-top"><button class="link-btn">${o.id}</button><span class="status status-${o.status}">${App.statusLabels[o.status]||o.status}</span></div>
            <h3>${App.escapeHTML(o.customer?.name||"-")}</h3>
            <p>${App.escapeHTML(p?.name||"-")} · x${o.quantity}</p>
            <div class="order-card-bottom"><p>${App.escapeHTML(o.customer?.city||"-")}</p><b>${App.money(o.total)}</b></div>
          </article>`;
        }).join("")}
      </div>`;
  },

  openOrder(id) {
    if (window.Management?.openOrderDetails) return Management.openOrderDetails(id);
    App.toast("El módulo de detalle del pedido aún no está listo.");
  }};

document.addEventListener("DOMContentLoaded",()=>Orders.init());
