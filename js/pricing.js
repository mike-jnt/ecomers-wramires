const Pricing = window.Pricing = {
  initDone: false,

  init() {
    if (this.initDone) return;
    this.initDone = true;
    document.getElementById("loadEtechCatalogBtn")?.addEventListener("click", () => this.loadEtechCatalog());
  },

  estimate(product) {
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

  orderAccounting(order) {
    const legacy = order.pricingSnapshot || {};
    const version = App.getPricingVersion(order.pricingVersionId);
    const product = App.getProduct(order.productId);
    const qty = Math.max(1, Number(order.quantity || 1));
    const productRevenue = Number(order.unitPrice || 0) * qty;
    const shipping = Number(order.shipping || 0);
    const grossTotal = Number(order.grossTotal || (productRevenue + shipping));
    const discountAmount = Number(order.discountAmount || 0);
    const customerPays = Number(order.total ?? (grossTotal - discountAmount));

    if (version) {
      const unitCost = order.fulfillment === "supplier"
        ? Number(version.supplierCost || version.ownCost || 0)
        : Number(version.ownCost || 0);
      const productCost = unitCost * qty;
      const dispatchFee = Number(version.dispatchFeePerUnit || 0) * qty;
      const advisorCommission = version.advisorCommissionType === "percent"
        ? productRevenue * (Number(version.advisorCommissionValue || 0) / 100)
        : Number(version.advisorCommissionValue || 0) * qty;
      const carrierFee = order.payment === "cod"
        ? customerPays * (Number(version.carrierFeePercent || 0) / 100)
        : 0;
      const advertisingCost = Number(version.advertisingCost || 0);
      const companyNet = customerPays - productCost - shipping - dispatchFee - advisorCommission - carrierFee - advertisingCost;
      const margin = productRevenue ? companyNet / productRevenue * 100 : 0;
      return {
        productRevenue, shipping, grossTotal, discountAmount, customerPays, productCost, dispatchFee, advisorCommission,
        carrierFee, advertisingCost, companyNet, margin, pricingSource: version.pricingSource || product?.pricingSource || ""
      };
    }

    // Compatibilidad con pedidos históricos creados antes de separar los costos privados.
    const fallbackCost = ((order.fulfillment === "supplier" ? product?.supplierCost : product?.ownCost) || 0) * qty;
    const productCost = Number(legacy.productCost ?? fallbackCost);
    const dispatchFee = Number(legacy.dispatchFee ?? 0);
    const advisorCommission = Number(legacy.advisorCommission ?? 0);
    const carrierFee = Number(legacy.carrierFee ?? 0);
    const advertisingCost = Number(legacy.advertisingCost ?? 0);
    const companyNet = Number(legacy.companyNet ?? (customerPays - productCost - shipping - dispatchFee - advisorCommission - carrierFee - advertisingCost));
    const margin = Number(legacy.netMarginPercent ?? (productRevenue ? companyNet / productRevenue * 100 : 0));
    return { productRevenue, shipping, grossTotal, discountAmount, customerPays, productCost, dispatchFee, advisorCommission, carrierFee, advertisingCost, companyNet, margin, pricingSource:legacy.pricingSource || product?.pricingSource || "" };
  },

  async loadEtechCatalog() {
    if (App.state.role !== "admin") return;
    if (!confirm("Se cargarán/actualizarán los 4 audífonos Etech Store. El inventario existente y el consecutivo de pedidos se conservarán. ¿Continuar?")) return;
    try {
      const result = await FirebaseService.seedEtechCatalog(App.actor());
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

    const active = App.products.filter(p => p.activo !== false).map(p => App.getProduct(p.id));
    const estimates = active.map(p => ({ product:p, ...this.estimate(p) }));
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
      <thead><tr><th>Producto</th><th>Precio venta</th><th>Costo unit.</th><th>Envío</th><th>Asesor</th><th>Despacho</th><th>Transportadora</th><th>Publicidad</th><th>Cliente paga</th><th>Utilidad empresa</th><th>Margen</th>${App.state.role === "admin" ? "<th></th>" : ""}</tr></thead>
      <tbody>${estimates.map(x => {
        const p=x.product;
        const warning=x.net<0?`<span class="pricing-warning">PÉRDIDA</span>`:"";
        const commissionLabel=p.advisorCommissionType === "percent" ? `${Number(p.advisorCommissionValue||0)}% · ${App.money(x.commission)}` : App.money(x.commission);
        return `<tr class="${x.net<0?"pricing-loss-row":""}">
          <td><b>${App.escapeHTML(p.name)}</b><br><span class="muted">${App.escapeHTML(p.sku)} · ${App.escapeHTML(p.pricingSource || "Manual")}</span>${warning}</td>
          <td class="pricing-sale"><b>${App.money(x.revenue)}</b></td><td>${App.money(x.cost)}</td><td>${App.money(x.shipping)}</td>
          <td>${commissionLabel}</td><td>${App.money(x.dispatch)}</td><td>${Number(p.carrierFeePercent||0)}% · ${App.money(x.carrier)}</td>
          <td>${App.money(x.ads)}</td><td><b>${App.money(x.customerPays)}</b></td>
          <td class="${x.net>=0?"fin-positive":"fin-negative"}"><b>${App.money(x.net)}</b></td><td class="${x.margin>=0?"fin-positive":"fin-negative"}">${x.margin.toFixed(1)}%</td>
          ${App.state.role === "admin" ? `<td><button class="btn btn-secondary btn-sm" onclick="Management.openProductModal('${p.id}')">Editar</button></td>` : ""}
        </tr>`;
      }).join("")}</tbody></table></div>`;
  }
};

document.addEventListener("DOMContentLoaded", () => Pricing.init());
