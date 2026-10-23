const Dispatch = window.Dispatch = {
  initDone:false,

  init() {
    if(this.initDone) return;
    this.initDone=true;

    document.querySelectorAll("[data-dispatch-tab]").forEach(b=>b.addEventListener("click",()=>{
      document.querySelectorAll("[data-dispatch-tab]").forEach(x=>x.classList.remove("active"));
      b.classList.add("active");
      App.state.dispatchTab=b.dataset.dispatchTab;
      this.render();
    }));

    const bulkPrintBtn = document.getElementById("bulkPrintBtn");
    if (bulkPrintBtn && !["admin","dispatch"].includes(App.state.role)) bulkPrintBtn.classList.add("hidden");
    bulkPrintBtn?.addEventListener("click",()=>{
      const ids=[...document.querySelectorAll(".dispatch-check:checked")].map(c=>c.value);
      if(!ids.length) return App.toast("Selecciona al menos un pedido.");
      this.printOrders(ids);
    });
  },

  render() {
    if(!this.initDone) this.init();

    const own = App.orders.filter(o=>o.fulfillment==="own" && ["confirmed","preparing","packed"].includes(o.status));
    const supplier = App.orders.filter(o=>o.fulfillment==="supplier" && ["supplier_pending","supplier_loaded"].includes(o.status));

    document.getElementById("ownCount").textContent=own.length;
    document.getElementById("supplierCount").textContent=supplier.length;

    const list=App.state.dispatchTab==="own"?own:supplier;
    const el=document.getElementById("dispatchList");

    if(!list.length) {
      el.innerHTML=`<div class="empty-state"><b>Todo al día</b><span>No hay pedidos pendientes en esta sección.</span></div>`;
      return;
    }

    el.innerHTML=list.map(o=>{
      const p=App.getProduct(o.productId);
      const s=App.getSupplier(o.supplierId);
      let actions="";

      if(o.fulfillment==="own") {
        const label=o.status==="confirmed"?"Preparar":o.status==="preparing"?"Empacado":"Despachar";
        actions=`<button class="btn btn-secondary" onclick="Dispatch.printOrders(['${o.id}'])">Imprimir</button><button class="btn btn-primary" onclick="Dispatch.advanceOwn('${o.id}')">${label}</button>`;
      } else {
        actions=o.status==="supplier_pending"
          ? `<button class="btn btn-secondary" onclick="Dispatch.copySupplierData('${o.id}')">Copiar datos</button><button class="btn btn-primary" onclick="Dispatch.loadSupplier('${o.id}')">Cargar proveedor</button>`
          : `<button class="btn btn-secondary" onclick="Dispatch.copySupplierData('${o.id}')">Copiar datos</button><button class="btn btn-primary" onclick="Dispatch.setSupplierGuide('${o.id}')">Registrar guía</button>`;
      }

      return `<article class="dispatch-card">
        <input class="dispatch-check" type="checkbox" value="${o.id}">
        <div class="dispatch-main">
          <button class="link-btn" onclick="Orders.openOrder('${o.id}')">${o.id}</button>
          <b>${App.escapeHTML(p?.name||"-")} · ${App.escapeHTML(p?.variant||"")} ×${o.quantity}</b>
          <span>${App.escapeHTML(o.customer?.name||"-")} · ${App.escapeHTML(o.customer?.city||"-")}</span>
        </div>
        <div class="dispatch-meta">
          <b>${o.fulfillment==="own"?"🏠 Bodega propia":`🏭 ${App.escapeHTML(s?.name||"Proveedor")}`}</b>
          <span>${o.payment==="cod"?`Cobrar ${App.money(o.total)}`:"PAGADO · No cobrar"}</span>
        </div>
        <div class="dispatch-actions">${actions}</div>
      </article>`;
    }).join("");
  },

  async advanceOwn(id) {
    const o=App.getOrder(id);
    if(!o) return;

    let guide = null;
    if(o.status==="packed") {
      guide=prompt("Número de guía (puedes dejarlo vacío para usar una referencia interna):","") || `GUIA-${Date.now().toString().slice(-7)}`;
    }

    try {
      await FirebaseService.advanceOwnOrder(id, App.actor(), guide);
      document.getElementById("orderModal").classList.add("hidden");
      App.toast(`${id} actualizado.`);
    } catch(error) {
      console.error(error);
      App.toast(App.firebaseMessage(error));
    }
  },

  async loadSupplier(id) {
    const ref=prompt("Número de orden asignado por el proveedor:","");
    if(!ref) return;

    try {
      await FirebaseService.loadSupplierOrder(id, ref.trim(), App.actor());
      document.getElementById("orderModal").classList.add("hidden");
      App.toast("Orden de proveedor registrada.");
    } catch(error) {
      console.error(error);
      App.toast(App.firebaseMessage(error));
    }
  },

  async setSupplierGuide(id) {
    const guide=prompt("Número de guía informado por el proveedor:","");
    if(!guide) return;

    try {
      await FirebaseService.setSupplierGuide(id, guide.trim(), App.actor());
      document.getElementById("orderModal").classList.add("hidden");
      App.toast("Guía registrada.");
    } catch(error) {
      console.error(error);
      App.toast(App.firebaseMessage(error));
    }
  },

  async markDelivered(id) {
    try {
      await FirebaseService.markDelivered(id, App.actor());
      document.getElementById("orderModal").classList.add("hidden");
      App.toast("Pedido marcado como entregado.");
    } catch(error) {
      console.error(error);
      App.toast(App.firebaseMessage(error));
    }
  },

  copySupplierData(id) {
    const o=App.getOrder(id);
    const p=App.getProduct(o.productId);

    const text=`Pedido: ${o.id}
Destinatario: ${o.customer?.name||""}
Cédula / documento: ${o.customer?.documentId||"-"}
Celular: ${o.customer?.phone||""}
Asesor: ${o.seller||"-"}
Departamento: ${o.customer?.department||""}
Ciudad: ${o.customer?.city||""}
Dirección: ${o.customer?.address||""}
Barrio: ${o.customer?.neighborhood||"-"}
Referencia: ${o.customer?.reference||"-"}
Producto: ${p?.name||""} ${p?.variant||""}
Cantidad: ${o.quantity}
Pago: ${o.payment==="cod"?"Contraentrega":"Pagado"}
Valor a recaudar: ${o.payment==="cod"?App.money(o.total):"$0"}
Observaciones: ${o.notes||"-"}`;

    navigator.clipboard?.writeText(text)
      .then(()=>App.toast("Datos copiados."))
      .catch(()=>prompt("Copia los datos:",text));
  },

  printOrders(ids) {
    if (!["admin","dispatch"].includes(App.state.role)) {
      App.toast("Solo Administración y Bodega/Despacho pueden imprimir etiquetas.");
      return;
    }

    const orders=ids.map(id=>App.getOrder(id)).filter(Boolean);
    if (!orders.length) return App.toast("No hay pedidos válidos para imprimir.");

    const area=document.getElementById("printArea");
    area.innerHTML=orders.map(o=>{
      const p=App.getProduct(o.productId);
      const collect = o.payment === "cod" ? Number(o.total || 0) : 0;

      return `<section class="shipping-label">
        <header class="sticker-head">
          <div><span class="sticker-kicker">PEDIDO</span><h1>${App.escapeHTML(o.id)}</h1></div>
          <div class="sticker-advisor"><span>ASESOR</span><b>${App.escapeHTML(o.seller||"-")}</b></div>
        </header>
        <div class="sticker-recipient"><span>DESTINATARIO</span><strong>${App.escapeHTML(o.customer?.name||"-")}</strong></div>
        <div class="ship-two">
          <div class="ship-block"><div class="ship-label">Cédula / documento</div><div class="ship-value">${App.escapeHTML(o.customer?.documentId||"-")}</div></div>
          <div class="ship-block"><div class="ship-label">Celular</div><div class="ship-value">${App.escapeHTML(o.customer?.phone||"-")}</div></div>
        </div>
        <div class="ship-block"><div class="ship-label">Destino</div><div class="ship-value">${App.escapeHTML(o.customer?.city||"-")} · ${App.escapeHTML(o.customer?.department||"-")}</div></div>
        <div class="ship-block ship-address"><div class="ship-label">Dirección</div><div class="ship-value">${App.escapeHTML(o.customer?.address||"-")}</div></div>
        ${o.customer?.neighborhood?`<div class="ship-block"><div class="ship-label">Barrio</div><div class="ship-value">${App.escapeHTML(o.customer.neighborhood)}</div></div>`:""}
        ${o.customer?.reference?`<div class="ship-block"><div class="ship-label">Referencia</div><div class="ship-value">${App.escapeHTML(o.customer.reference)}</div></div>`:""}
        <div class="ship-divider"></div>
        <div class="ship-block"><div class="ship-label">Producto</div><div class="ship-value ship-product">${App.escapeHTML(p?.name||"-")} · ${App.escapeHTML(p?.variant||"")} · x${Number(o.quantity||1)}</div></div>
        <div class="sticker-payment ${o.payment === "cod" ? "sticker-payment--cod" : "sticker-payment--paid"}">
          <span>${o.payment === "cod" ? "CONTRAENTREGA · COBRAR" : "PAGO CONFIRMADO"}</span>
          <strong>${o.payment === "cod" ? App.money(collect) : "NO COBRAR"}</strong>
        </div>
        ${o.guide?`<div class="ship-block"><div class="ship-label">Guía</div><div class="ship-value ship-guide">${App.escapeHTML(o.guide)}</div></div>`:""}
        ${o.notes?`<div class="ship-block sticker-notes"><div class="ship-label">Observaciones</div><div class="ship-value">${App.escapeHTML(o.notes)}</div></div>`:""}
        <footer class="sticker-footer"><span>${App.escapeHTML(o.fulfillment === "own" ? "Bodega propia" : "Etech Store / proveedor")}</span><b>${App.dateTime(o.createdAt||o.createdAtClient)}</b></footer>
      </section>`;
    }).join("");

    window.print();
  }
};

document.addEventListener("DOMContentLoaded",()=>Dispatch.init());
