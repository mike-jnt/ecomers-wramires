const Pricing = window.Pricing = {
  initDone: false,

  init() {
    if (this.initDone) return;
    this.initDone = true;
    document.getElementById("loadEtechCatalogBtn")?.addEventListener("click", () => this.loadEtechCatalog());
  },

  estimate(product) {
    const qty = 1;
    const revenue = Number(product.price || 0);
    const shipping = Number(product.defaultShipping || 0);
    const customerPays = revenue + shipping;
    const cost = Number(product.ownCost || product.supplierCost || 0);
    const dispatch = Number(product.dispatchFeePerUnit || 0);
    const commission = product.advisorCommissionType === "percent"
      ? revenue * (Number(product.advisorCommissionValue || 0) / 100)
      : Number(product.advisorCommissionValue || 0);
    const carrier = customerPays * (Number(product.carrierFeePercent || 0) / 100);
    const ads = Number(product.advertisingCost || 0);
    const gross = customerPays - cost - shipping - dispatch - commission - carrier;
    const net = gross - ads;
    const margin = revenue > 0 ? net / revenue * 100 : 0;
    return { revenue, shipping, customerPays, cost, dispatch, commission, carrier, ads, gross, net, margin };
  },

  async loadEtechCatalog() {
    if (App.state.role !== "admin") return;
    if (!confirm("Se cargarán los 4 audífonos encontrados en PRECIOS STARTECH con stock 0. Los SKU existentes no se duplicarán. ¿Continuar?")) return;
    try {
      const result = await FirebaseService.seedEtechCatalog();
      App.toast(`Etech Store: ${result.created} creado(s), ${result.updated} actualizado(s).`);
    } catch (error) {
      console.error(error);
      App.toast(App.firebaseMessage(error));
    }
  },

  render() {
    if (!this.initDone) this.init();
    const metrics = document.getElementById("pricingMetrics");
    const table = document.getElementById("pricingTable");
    if (!metrics || !table || !["admin","finance"].includes(App.state.role)) return;

    const active = App.products.filter(p => p.activo !== false);
    const estimates = active.map(p => ({ product:p, ...this.estimate(p) }));
    const positive = estimates.filter(x => x.net >= 0);
    const losses = estimates.filter(x => x.net < 0);
    const avgMargin = estimates.length ? estimates.reduce((s,x)=>s+x.margin,0)/estimates.length : 0;
    const projectedNet = estimates.reduce((s,x)=>s+x.net,0);

    metrics.innerHTML = [
      ["Productos activos", active.length, "Configurados para venta"],
      ["Margen neto promedio", `${avgMargin.toFixed(1)}%`, "Proyección de 1 unidad por producto"],
      ["Utilidad proyectada", App.money(projectedNet), "Suma teórica de 1 unidad de cada producto"],
      ["Alertas de pérdida", losses.length, losses.length ? "Revisar publicidad/costos" : "Sin pérdidas proyectadas"]
    ].map(([label,value,foot]) => `<article class="metric-card"><div class="metric-top"><span>${label}</span><span class="metric-icon">%</span></div><strong class="metric-value">${value}</strong><span class="metric-foot">${foot}</span></article>`).join("");

    if (!active.length) {
      table.innerHTML = `<div class="empty-state"><b>No hay productos</b><span>${App.state.role === "admin" ? "Usa Cargar catálogo Etech Store o crea productos desde Inventario." : "El administrador todavía no ha configurado el catálogo."}</span></div>`;
      return;
    }

    table.innerHTML = `<div class="table-scroll pricing-table-scroll"><table class="data-table pricing-table">
      <thead><tr>
        <th>Producto</th><th>Precio venta</th><th>Costo unit.</th><th>Envío</th><th>Asesor</th><th>Despacho</th><th>Transportadora</th><th>Publicidad</th><th>Cliente paga</th><th>Utilidad empresa</th><th>Margen</th>${App.state.role === "admin" ? "<th></th>" : ""}
      </tr></thead>
      <tbody>${estimates.map(x => {
        const p=x.product;
        const warning = x.net < 0 ? `<span class="pricing-warning">PÉRDIDA</span>` : "";
        const commissionLabel = p.advisorCommissionType === "percent" ? `${Number(p.advisorCommissionValue||0)}% · ${App.money(x.commission)}` : App.money(x.commission);
        return `<tr class="${x.net < 0 ? "pricing-loss-row" : ""}">
          <td><b>${p.name}</b><br><span class="muted">${p.sku} · ${p.pricingSource || "Manual"}</span>${warning}</td>
          <td class="pricing-sale"><b>${App.money(x.revenue)}</b></td>
          <td>${App.money(x.cost)}</td>
          <td>${App.money(x.shipping)}</td>
          <td>${commissionLabel}</td>
          <td>${App.money(x.dispatch)}</td>
          <td>${Number(p.carrierFeePercent||0)}% · ${App.money(x.carrier)}</td>
          <td>${App.money(x.ads)}</td>
          <td><b>${App.money(x.customerPays)}</b></td>
          <td class="${x.net >= 0 ? "fin-positive" : "fin-negative"}"><b>${App.money(x.net)}</b></td>
          <td class="${x.margin >= 0 ? "fin-positive" : "fin-negative"}">${x.margin.toFixed(1)}%</td>
          ${App.state.role === "admin" ? `<td><button class="btn btn-secondary btn-sm" onclick="Management.openProductModal('${p.id}')">Editar</button></td>` : ""}
        </tr>`;
      }).join("")}</tbody>
    </table></div>`;
  }
};

// Utilidad contable basada en la foto financiera guardada al momento de crear el pedido.
function orderAccounting(o) {
  const s = o.pricingSnapshot || {};
  const p = App.getProduct(o.productId);
  const fallbackCost = ((o.fulfillment === "supplier" ? p?.supplierCost : p?.ownCost) || 0) * Number(o.quantity || 1);
  const productRevenue = Number(s.productRevenue ?? (Number(o.unitPrice||0) * Number(o.quantity||1)));
  const shipping = Number(s.shippingCharged ?? o.shipping ?? 0);
  const customerPays = Number(s.customerPays ?? o.total ?? (productRevenue + shipping));
  const productCost = Number(s.productCost ?? fallbackCost);
  const dispatchFee = Number(s.dispatchFee ?? 0);
  const advisorCommission = Number(s.advisorCommission ?? 0);
  const carrierFee = Number(s.carrierFee ?? 0);
  const advertisingCost = Number(s.advertisingCost ?? 0);
  const companyNet = Number(s.companyNet ?? (customerPays - productCost - shipping - dispatchFee - advisorCommission - carrierFee - advertisingCost));
  const margin = Number(s.netMarginPercent ?? (productRevenue ? companyNet/productRevenue*100 : 0));
  return { productRevenue, shipping, customerPays, productCost, dispatchFee, advisorCommission, carrierFee, advertisingCost, companyNet, margin, pricingSource:s.pricingSource || p?.pricingSource || "" };
}

// Reemplaza la vista financiera para contar como venta real únicamente los pedidos entregados.
Finance.render = function() {
  if(!this.initDone) this.init();
  const delivered = App.orders.filter(o => o.status === "delivered");
  const sales = delivered.reduce((sum,o)=>sum+orderAccounting(o).customerPays,0);
  const collected = delivered.filter(o=>o.collected || o.payment === "transfer").reduce((sum,o)=>sum+orderAccounting(o).customerPays,0);
  const expenses = App.expenses.reduce((s,g)=>s+Number(g.amount||0),0);
  const orderNet = delivered.reduce((sum,o)=>sum+orderAccounting(o).companyNet,0);
  const estimatedProfit = orderNet - expenses;

  document.getElementById("financeMetrics").innerHTML = [
    ["Ventas entregadas", sales, `${delivered.length} venta(s) reales`],
    ["Recaudado identificado", collected, "Transferencias / recaudos marcados"],
    ["Gastos generales", expenses, "Egresos adicionales registrados"],
    ["Resultado neto", estimatedProfit, "Utilidad por ventas - gastos generales"]
  ].map(m=>`<article class="metric-card"><div class="metric-top"><span>${m[0]}</span><span class="metric-icon">$</span></div><strong class="metric-value">${App.money(m[1])}</strong><span class="metric-foot">${m[2]}</span></article>`).join("");

  const tab = App.state.financeTab || "sales";
  document.querySelectorAll("[data-finance-tab]").forEach(btn => btn.classList.toggle("active", btn.dataset.financeTab === tab));
  const title=document.getElementById("financeTableTitle"), subtitle=document.getElementById("financeTableSubtitle"), el=document.getElementById("financeTable");

  if (tab === "sales") {
    title.textContent = "Historial de ventas entregadas";
    subtitle.textContent = "Solo pedidos entregados cuentan como venta real.";
    const rows=delivered.slice().sort((a,b)=>App.toDate(b.updatedAt||b.createdAt)-App.toDate(a.updatedAt||a.createdAt));
    el.innerHTML = rows.length ? `<div class="table-scroll"><table class="data-table"><thead><tr><th>Fecha</th><th>Pedido</th><th>Cliente</th><th>Vendedor</th><th>Producto</th><th>Precio producto</th><th>Envío</th><th>Cliente pagó</th><th>Pago</th></tr></thead><tbody>${rows.map(o=>{const p=App.getProduct(o.productId),a=orderAccounting(o);return `<tr class="row-clickable" onclick="Orders.openOrder('${o.id}')"><td>${App.dateTime(o.updatedAt||o.createdAt)}</td><td><b>${o.id}</b></td><td>${o.customer?.name||"-"}</td><td>${o.seller||"-"}</td><td>${p?.name||"-"} ×${o.quantity}</td><td>${App.money(a.productRevenue)}</td><td>${App.money(a.shipping)}</td><td><b>${App.money(a.customerPays)}</b></td><td>${o.payment==="cod"?"Contraentrega":"Transferencia"}</td></tr>`;}).join("")}</tbody></table></div>` : `<div class="empty-state"><b>Sin ventas entregadas</b><span>Los pedidos aparecerán aquí cuando sean marcados como entregados.</span></div>`;
  } else if (tab === "expenses") {
    title.textContent="Historial de gastos"; subtitle.textContent="Egresos generales registrados por administración o contabilidad.";
    const rows=App.expenses.slice().sort((a,b)=>App.toDate(b.date||b.dateClient)-App.toDate(a.date||a.dateClient));
    el.innerHTML=rows.length?`<div class="table-scroll"><table class="data-table"><thead><tr><th>Fecha</th><th>Categoría</th><th>Concepto</th><th>Registrado por</th><th>Valor</th></tr></thead><tbody>${rows.map(g=>`<tr><td>${App.dateTime(g.date||g.dateClient)}</td><td>${g.category||"-"}</td><td>${g.concept||"-"}</td><td>${g.createdByName||"-"}</td><td class="fin-negative">-${App.money(g.amount)}</td></tr>`).join("")}</tbody></table></div>`:`<div class="empty-state"><b>Sin gastos</b><span>No hay egresos generales registrados.</span></div>`;
  } else {
    title.textContent="Rentabilidad por venta"; subtitle.textContent="Desglose congelado con los costos y parámetros vigentes cuando se creó cada pedido.";
    const rows=delivered.slice().sort((a,b)=>App.toDate(b.updatedAt||b.createdAt)-App.toDate(a.updatedAt||a.createdAt));
    el.innerHTML=rows.length?`<div class="table-scroll"><table class="data-table pricing-finance-table"><thead><tr><th>Pedido</th><th>Producto</th><th>Venta prod.</th><th>Envío</th><th>Costo</th><th>Asesor</th><th>Despacho</th><th>Transportadora</th><th>Publicidad</th><th>Neto venta</th><th>Margen</th></tr></thead><tbody>${rows.map(o=>{const p=App.getProduct(o.productId),a=orderAccounting(o);return `<tr class="row-clickable" onclick="Orders.openOrder('${o.id}')"><td><b>${o.id}</b></td><td>${p?.name||"-"}</td><td>${App.money(a.productRevenue)}</td><td>${App.money(a.shipping)}</td><td>${App.money(a.productCost)}</td><td>${App.money(a.advisorCommission)}</td><td>${App.money(a.dispatchFee)}</td><td>${App.money(a.carrierFee)}</td><td>${App.money(a.advertisingCost)}</td><td class="${a.companyNet>=0?"fin-positive":"fin-negative"}"><b>${App.money(a.companyNet)}</b></td><td>${a.margin.toFixed(1)}%</td></tr>`;}).join("")}</tbody><tfoot><tr><td colspan="9"><b>Utilidad de ventas entregadas</b></td><td class="${orderNet>=0?"fin-positive":"fin-negative"}"><b>${App.money(orderNet)}</b></td><td></td></tr><tr><td colspan="9"><b>Menos gastos generales</b></td><td class="fin-negative">-${App.money(expenses)}</td><td></td></tr><tr><td colspan="9"><b>Resultado neto empresa</b></td><td class="${estimatedProfit>=0?"fin-positive":"fin-negative"}"><b>${App.money(estimatedProfit)}</b></td><td></td></tr></tfoot></table></div>`:`<div class="empty-state"><b>Sin rentabilidad registrada</b><span>Se calculará cuando existan pedidos entregados.</span></div>`;
  }
};

// Amplía el modal de pedido con el desglose contable únicamente para admin/contabilidad.
const openOrderBase = Orders.openOrder.bind(Orders);
Orders.openOrder = function(id) {
  openOrderBase(id);
  if (!["admin","finance"].includes(App.state.role)) return;
  const o=App.getOrder(id); if(!o) return;
  const a=orderAccounting(o); const body=document.getElementById("orderModalBody"); if(!body) return;
  body.insertAdjacentHTML("beforeend", `<section class="accounting-breakdown"><div class="panel-head panel-head--compact"><div><h3>Desglose contable</h3><p>Información interna. No visible para vendedores.</p></div></div><div class="accounting-grid"><div><span>Venta producto</span><b>${App.money(a.productRevenue)}</b></div><div><span>Envío cobrado</span><b>${App.money(a.shipping)}</b></div><div><span>Cliente paga</span><b>${App.money(a.customerPays)}</b></div><div><span>Costo producto</span><b>-${App.money(a.productCost)}</b></div><div><span>Comisión asesor</span><b>-${App.money(a.advisorCommission)}</b></div><div><span>Persona despacho</span><b>-${App.money(a.dispatchFee)}</b></div><div><span>Fee transportadora</span><b>-${App.money(a.carrierFee)}</b></div><div><span>Publicidad</span><b>-${App.money(a.advertisingCost)}</b></div><div class="accounting-net"><span>Utilidad empresa</span><b class="${a.companyNet>=0?"fin-positive":"fin-negative"}">${App.money(a.companyNet)}</b></div><div><span>Margen</span><b>${a.margin.toFixed(1)}%</b></div></div></section>`);
};

document.addEventListener("DOMContentLoaded", () => Pricing.init());
