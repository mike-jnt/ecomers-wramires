const Finance = window.Finance = {
  initDone:false,

  init() {
    if(this.initDone) return;
    this.initDone=true;

    document.getElementById("addExpenseBtn")?.addEventListener("click",()=>document.getElementById("expenseModal")?.classList.remove("hidden"));
    document.querySelectorAll("[data-close-expense]").forEach(b=>b.addEventListener("click",()=>document.getElementById("expenseModal")?.classList.add("hidden")));

    document.getElementById("expenseForm")?.addEventListener("submit",async e=>{
      e.preventDefault();
      const f=new FormData(e.currentTarget);
      try {
        await FirebaseService.addExpense({ category:f.get("category"), concept:f.get("concept"), amount:Number(f.get("amount")) }, App.actor());
        e.currentTarget.reset();
        document.getElementById("expenseModal").classList.add("hidden");
        App.toast("Gasto registrado.");
      } catch(error) {
        console.error(error);
        App.toast(App.firebaseMessage(error));
      }
    });

    document.querySelectorAll("[data-finance-tab]").forEach(btn=>btn.addEventListener("click",()=>{
      document.querySelectorAll("[data-finance-tab]").forEach(x=>x.classList.remove("active"));
      btn.classList.add("active");
      App.state.financeTab=btn.dataset.financeTab;
      this.render();
    }));
  },

  async collectOrder(id) {
    if (!["admin","finance"].includes(App.state.role)) return;
    const order=App.getOrder(id);
    if(!order) return;
    const amountText=prompt("Valor recibido de la transportadora:", String(order.total || 0));
    if(amountText===null) return;
    const amount=Number(String(amountText).replace(/[^0-9.-]/g,""));
    if(!Number.isFinite(amount) || amount<0) return App.toast("Escribe un valor de recaudo válido.");
    const reference=prompt("Referencia, liquidación o comprobante (opcional):","") ?? "";
    try {
      await FirebaseService.markOrderCollected(id, App.actor(), amount, reference);
      document.getElementById("orderModal")?.classList.add("hidden");
      App.toast("Recaudo conciliado correctamente.");
    } catch(error) {
      console.error(error);
      App.toast(App.firebaseMessage(error));
    }
  },

  render() {
    if(!this.initDone) this.init();
    if(!["admin","finance"].includes(App.state.role)) return;
    const accounting=o=>window.Pricing?.orderAccounting ? Pricing.orderAccounting(o) : {customerPays:Number(o.total||0),companyNet:0,productRevenue:Number(o.unitPrice||0)*Number(o.quantity||1),shipping:Number(o.shipping||0),productCost:0,advisorCommission:0,dispatchFee:0,carrierFee:0,advertisingCost:0,margin:0};
    const delivered=App.orders.filter(o=>o.status==="delivered");
    const sales=delivered.reduce((sum,o)=>sum+accounting(o).customerPays,0);
    const collected=delivered.filter(o=>o.collected || o.payment==="transfer").reduce((sum,o)=>sum+Number(o.collectedAmount ?? accounting(o).customerPays),0);
    const expenses=App.expenses.reduce((s,g)=>s+Number(g.amount||0),0);
    const orderNet=delivered.reduce((sum,o)=>sum+accounting(o).companyNet,0);
    const estimatedProfit=orderNet-expenses;

    document.getElementById("financeMetrics").innerHTML=[
      ["Ventas entregadas",sales,`${delivered.length} venta(s) reales`],
      ["Recaudado identificado",collected,"Transferencias y contraentregas conciliadas"],
      ["Por recaudar",Math.max(0,sales-collected),"Contraentregas pendientes"],
      ["Resultado neto",estimatedProfit,"Utilidad de ventas - gastos generales"]
    ].map(m=>`<article class="metric-card"><div class="metric-top"><span>${m[0]}</span><span class="metric-icon">$</span></div><strong class="metric-value">${App.money(m[1])}</strong><span class="metric-foot">${m[2]}</span></article>`).join("");

    const tab=App.state.financeTab||"sales";
    document.querySelectorAll("[data-finance-tab]").forEach(btn=>btn.classList.toggle("active",btn.dataset.financeTab===tab));
    const title=document.getElementById("financeTableTitle"), subtitle=document.getElementById("financeTableSubtitle"), el=document.getElementById("financeTable");
    if(!title||!subtitle||!el) return;

    if(tab==="sales") {
      title.textContent="Historial de ventas entregadas";
      subtitle.textContent="Ventas reales y estado de conciliación del recaudo.";
      const rows=delivered.slice().sort((a,b)=>App.toDate(b.updatedAt||b.createdAt)-App.toDate(a.updatedAt||a.createdAt));
      el.innerHTML=rows.length?`<div class="table-scroll"><table class="data-table"><thead><tr><th>Fecha</th><th>Pedido</th><th>Cliente</th><th>Vendedor</th><th>Producto</th><th>Precio producto</th><th>Envío</th><th>Cliente pagó</th><th>Pago</th><th>Recaudo</th></tr></thead><tbody>${rows.map(o=>{const p=App.getProduct(o.productId),a=accounting(o);const pending=o.payment==="cod"&&!o.collected;return `<tr class="row-clickable" onclick="Orders.openOrder('${o.id}')"><td>${App.dateTime(o.updatedAt||o.createdAt)}</td><td><b>${o.id}</b></td><td>${App.escapeHTML(o.customer?.name||"-")}</td><td>${App.escapeHTML(o.seller||"-")}</td><td>${App.escapeHTML(p?.name||"-")} ×${o.quantity}</td><td>${App.money(a.productRevenue)}</td><td>${App.money(a.shipping)}</td><td><b>${App.money(a.customerPays)}</b></td><td>${o.payment==="cod"?"Contraentrega":"Transferencia"}</td><td>${pending?`<button class="btn btn-secondary btn-sm" onclick="event.stopPropagation();Finance.collectOrder('${o.id}')">Pendiente · Conciliar</button>`:`<span class="status status-delivered">${o.collected?"Recaudado":"Pagado"}</span>`}</td></tr>`;}).join("")}</tbody></table></div>`:`<div class="empty-state"><b>Sin ventas entregadas</b><span>Los pedidos aparecerán aquí cuando sean marcados como entregados.</span></div>`;
    } else if(tab==="expenses") {
      title.textContent="Historial de gastos";
      subtitle.textContent="Egresos generales registrados por administración o contabilidad.";
      const rows=App.expenses.slice().sort((a,b)=>App.toDate(b.date||b.dateClient)-App.toDate(a.date||a.dateClient));
      el.innerHTML=rows.length?`<div class="table-scroll"><table class="data-table"><thead><tr><th>Fecha</th><th>Categoría</th><th>Concepto</th><th>Registrado por</th><th>Valor</th></tr></thead><tbody>${rows.map(g=>`<tr><td>${App.dateTime(g.date||g.dateClient)}</td><td>${App.escapeHTML(g.category||"-")}</td><td>${App.escapeHTML(g.concept||"-")}</td><td>${App.escapeHTML(g.createdByName||"-")}</td><td class="fin-negative">-${App.money(g.amount)}</td></tr>`).join("")}</tbody></table></div>`:`<div class="empty-state"><b>Sin gastos</b><span>No hay egresos generales registrados.</span></div>`;
    } else {
      title.textContent="Rentabilidad por venta";
      subtitle.textContent="Costos privados según la versión de precios asociada a cada pedido.";
      const rows=delivered.slice().sort((a,b)=>App.toDate(b.updatedAt||b.createdAt)-App.toDate(a.updatedAt||a.createdAt));
      el.innerHTML=rows.length?`<div class="table-scroll"><table class="data-table pricing-finance-table"><thead><tr><th>Pedido</th><th>Producto</th><th>Venta prod.</th><th>Envío</th><th>Costo</th><th>Asesor</th><th>Despacho</th><th>Transportadora</th><th>Publicidad</th><th>Neto venta</th><th>Margen</th></tr></thead><tbody>${rows.map(o=>{const p=App.getProduct(o.productId),a=accounting(o);return `<tr class="row-clickable" onclick="Orders.openOrder('${o.id}')"><td><b>${o.id}</b></td><td>${App.escapeHTML(p?.name||"-")}</td><td>${App.money(a.productRevenue)}</td><td>${App.money(a.shipping)}</td><td>${App.money(a.productCost)}</td><td>${App.money(a.advisorCommission)}</td><td>${App.money(a.dispatchFee)}</td><td>${App.money(a.carrierFee)}</td><td>${App.money(a.advertisingCost)}</td><td class="${a.companyNet>=0?"fin-positive":"fin-negative"}"><b>${App.money(a.companyNet)}</b></td><td>${a.margin.toFixed(1)}%</td></tr>`;}).join("")}</tbody><tfoot><tr><td colspan="9"><b>Utilidad de ventas entregadas</b></td><td class="${orderNet>=0?"fin-positive":"fin-negative"}"><b>${App.money(orderNet)}</b></td><td></td></tr><tr><td colspan="9"><b>Menos gastos generales</b></td><td class="fin-negative">-${App.money(expenses)}</td><td></td></tr><tr><td colspan="9"><b>Resultado neto empresa</b></td><td class="${estimatedProfit>=0?"fin-positive":"fin-negative"}"><b>${App.money(estimatedProfit)}</b></td><td></td></tr></tfoot></table></div>`:`<div class="empty-state"><b>Sin rentabilidad registrada</b><span>Se calculará cuando existan pedidos entregados.</span></div>`;
    }
  }
};

document.addEventListener("DOMContentLoaded",()=>Finance.init());
