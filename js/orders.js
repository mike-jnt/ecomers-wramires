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

    document.getElementById("orderForm").addEventListener("submit", e => this.create(e));
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
      document.getElementById("totalValue").textContent = App.money(0);
      document.getElementById("fulfillmentCallout").innerHTML = '<b>Sin disponibilidad</b><span>No hay catálogo cargado.</span>';
      return;
    }

    const qty = Math.max(1, Number(document.getElementById("quantityInput").value)||1);
    const shipping = Math.max(0, Number(document.getElementById("shippingInput").value)||0);
    const available = Math.max(0, p.ownStock-p.reserved);
    const ownPossible = available >= qty;

    document.getElementById("productPreview").innerHTML = App.state.role === "seller"
      ? `<div class="product-preview-grid seller-price-preview">
          <div>
            <b>${p.name}</b>
            <span class="product-meta">${p.variant} · Etech Store</span>
            <button type="button" class="link-btn product-info-link" onclick="Management.openProductInfo('${p.id}')">Ver funciones y beneficios</button>
          </div>
          <div class="seller-visible-price">${App.money(p.price)}</div>
        </div>`
      : `<div class="product-preview-grid">
          <div>
            <b>${p.name}</b>
            <span class="product-meta">${p.variant} · ${p.sku}</span>
            <button type="button" class="link-btn product-info-link" onclick="Management.openProductInfo('${p.id}')">Ver ficha comercial</button>
          </div>
          <div class="${ownPossible?'stock-good':'stock-warn'}">${ownPossible?`${available} disponibles en bodega`:`Etech Store: ${p.supplierStock} reportados`}</div>
        </div>`;

    document.getElementById("summaryProduct").innerHTML = `<b>${p.name}</b><span>${p.variant} · ${qty} unidad${qty>1?'es':''}</span>`;
    document.getElementById("subtotalValue").textContent = App.money(p.price*qty);
    document.getElementById("shippingValue").textContent = App.money(shipping);
    document.getElementById("totalValue").textContent = App.money(p.price*qty+shipping);

    const supplier = App.getSupplier(p.supplierId);
    document.getElementById("fulfillmentCallout").innerHTML = App.state.role === "seller"
      ? `<b>Total del cliente</b><span>${App.money(p.price * qty)} en producto + ${App.money(shipping)} de envío = <strong>${App.money(p.price * qty + shipping)}</strong>.</span>`
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

    const baseOrder = {
      customer: {
        name: form.get("name"),
        phone,
        department: form.get("department"),
        city: form.get("city"),
        address: form.get("address"),
        neighborhood: form.get("neighborhood") || "",
        reference: form.get("reference") || ""
      },
      productId: p.id,
      quantity: qty,
      unitPrice: p.price,
      shipping,
      total: p.price*qty+shipping,
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

      App.toast(`${result.id} creado correctamente. Formulario listo para un nuevo pedido.`);
      const synced = await this.waitForOrder(result.id, 3500);
      if (synced) this.openOrder(result.id);
      else App.go("orders");
    } catch (error) {
      console.error(error);
      App.toast(App.firebaseMessage(error));
    } finally {
      submit.disabled = false;
      submit.textContent = "Confirmar pedido";
    }
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
        (f==="delivered" && o.status==="delivered");

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
              <td><b>${o.customer?.name||"-"}</b><br><span class="muted">${o.customer?.city||"-"} · ${o.customer?.phone||"-"}</span></td>
              <td>${p?.name||"-"}<br><span class="muted">${p?.variant||""} · x${o.quantity}</span></td>
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
            <h3>${o.customer?.name||"-"}</h3>
            <p>${p?.name||"-"} · x${o.quantity}</p>
            <div class="order-card-bottom"><p>${o.customer?.city||"-"}</p><b>${App.money(o.total)}</b></div>
          </article>`;
        }).join("")}
      </div>`;
  },

  openOrder(id) {
    const o=App.getOrder(id);
    if(!o) {
      App.toast("El pedido todavía se está sincronizando.");
      return;
    }

    const p=App.getProduct(o.productId);
    const s=App.getSupplier(o.supplierId);

    document.getElementById("modalOrderTitle").textContent=o.id;
    document.getElementById("orderModalBody").innerHTML = `
      <div class="detail-grid">
        <div class="detail-box"><small>Cliente</small><b>${o.customer?.name||"-"}</b><span>${o.customer?.phone||"-"}</span></div>
        <div class="detail-box"><small>Destino</small><b>${o.customer?.city||"-"} - ${o.customer?.department||"-"}</b><span>${o.customer?.address||"-"}</span></div>
        <div class="detail-box"><small>Producto</small><b>${p?.name||"-"}</b><span>${p?.variant||""} · x${o.quantity}</span></div>
        <div class="detail-box"><small>Total</small><b>${App.money(o.total)}</b><span>${o.payment==="cod"?"Contraentrega":"Pagado"}</span></div>
        <div class="detail-box"><small>Origen</small><b>${o.fulfillment==="own"?"Bodega propia":s?.name||"Proveedor"}</b><span>${o.supplierOrderId?`Orden: ${o.supplierOrderId}`:""}</span></div>
        <div class="detail-box"><small>Estado</small><b>${App.statusLabels[o.status]||o.status}</b><span>${o.guide?`Guía: ${o.guide}`:"Sin guía"}</span></div>
      </div>

      ${o.customer?.neighborhood||o.customer?.reference||o.notes?`
        <div class="detail-box" style="margin-top:12px">
          <small>Información de entrega</small>
          <b>${o.customer?.neighborhood||""}</b>
          <span>${o.customer?.reference||""}${o.notes?` · ${o.notes}`:""}</span>
        </div>`:""}

      <div class="timeline">
        <b>Historial</b>
        ${(o.timeline||[]).slice().reverse().map(t=>`
          <div class="timeline-item">
            <span class="timeline-dot"></span>
            <span class="timeline-copy"><b>${t.label}</b><span>${App.dateTime(t.at)} · ${t.user}</span></span>
          </div>`).join("")}
      </div>`;

    const actions = [];
    actions.push(`<button class="btn btn-secondary" onclick="Dispatch.printOrders(['${o.id}'])">Imprimir envío</button>`);

    if (["admin","dispatch"].includes(App.state.role)) {
      if(o.fulfillment==="own" && o.status==="confirmed") actions.push(`<button class="btn btn-primary" onclick="Dispatch.advanceOwn('${o.id}')">Preparar</button>`);
      if(o.fulfillment==="own" && o.status==="preparing") actions.push(`<button class="btn btn-primary" onclick="Dispatch.advanceOwn('${o.id}')">Marcar empacado</button>`);
      if(o.fulfillment==="own" && o.status==="packed") actions.push(`<button class="btn btn-primary" onclick="Dispatch.advanceOwn('${o.id}')">Despachar</button>`);
      if(o.fulfillment==="supplier" && o.status==="supplier_pending") actions.push(`<button class="btn btn-primary" onclick="Dispatch.loadSupplier('${o.id}')">Cargar proveedor</button>`);
      if(o.fulfillment==="supplier" && o.status==="supplier_loaded") actions.push(`<button class="btn btn-primary" onclick="Dispatch.setSupplierGuide('${o.id}')">Registrar guía</button>`);
    }

    if (["shipped","transit"].includes(o.status) && ["admin","dispatch"].includes(App.state.role)) {
      actions.push(`<button class="btn btn-success" onclick="Dispatch.markDelivered('${o.id}')">Marcar entregado</button>`);
    }

    document.getElementById("orderModalActions").innerHTML=actions.join("");
    document.getElementById("orderModal").classList.remove("hidden");
  }
};

document.addEventListener("DOMContentLoaded",()=>Orders.init());
