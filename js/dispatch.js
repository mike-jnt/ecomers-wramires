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

    document.getElementById("bulkPrintBtn").addEventListener("click",()=>{
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
          <b>${p?.name||"-"} · ${p?.variant||""} ×${o.quantity}</b>
          <span>${o.customer?.name||"-"} · ${o.customer?.city||"-"}</span>
        </div>
        <div class="dispatch-meta">
          <b>${o.fulfillment==="own"?"🏠 Bodega propia":`🏭 ${s?.name||"Proveedor"}`}</b>
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
Celular: ${o.customer?.phone||""}
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
    const orders=ids.map(id=>App.getOrder(id)).filter(Boolean);
    const area=document.getElementById("printArea");

    area.innerHTML=orders.map(o=>{
      const p=App.getProduct(o.productId);

      return `<section class="shipping-label">
        <h1>${o.id}</h1>
        <div class="ship-block"><div class="ship-label">Destinatario</div><div class="ship-value ship-value--xl">${o.customer?.name||"-"}</div></div>
        <div class="ship-two">
          <div class="ship-block"><div class="ship-label">Celular</div><div class="ship-value">${o.customer?.phone||"-"}</div></div>
          <div class="ship-block"><div class="ship-label">Destino</div><div class="ship-value">${o.customer?.city||"-"} - ${o.customer?.department||"-"}</div></div>
        </div>
        <div class="ship-block"><div class="ship-label">Dirección</div><div class="ship-value">${o.customer?.address||"-"}</div></div>
        ${o.customer?.neighborhood?`<div class="ship-block"><div class="ship-label">Barrio</div><div class="ship-value">${o.customer.neighborhood}</div></div>`:""}
        ${o.customer?.reference?`<div class="ship-block"><div class="ship-label">Referencia</div><div class="ship-value">${o.customer.reference}</div></div>`:""}
        <div class="ship-divider"></div>
        <div class="ship-block"><div class="ship-label">Producto</div><div class="ship-value">${p?.name||"-"} · ${p?.variant||""} · Cantidad ${o.quantity}</div></div>
        <div class="ship-divider"></div>
        <div class="ship-block"><div class="ship-label">${o.payment==="cod"?"Contraentrega · Valor a recaudar":"Pago"}</div><div class="ship-value ship-value--xl">${o.payment==="cod"?`COBRAR ${App.money(o.total)}`:"PAGADO · NO COBRAR"}</div></div>
        ${o.guide?`<div class="ship-block"><div class="ship-label">Guía</div><div class="ship-value">${o.guide}</div></div>`:""}
        ${o.notes?`<div class="ship-block"><div class="ship-label">Observaciones</div><div class="ship-value">${o.notes}</div></div>`:""}
      </section>`;
    }).join("");

    window.print();
  }
};

document.addEventListener("DOMContentLoaded",()=>Dispatch.init());
