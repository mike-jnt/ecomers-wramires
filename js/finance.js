const Finance = window.Finance = {
  initDone:false,

  init() {
    if(this.initDone) return;
    this.initDone=true;

    document.getElementById("addExpenseBtn").addEventListener("click",()=>document.getElementById("expenseModal").classList.remove("hidden"));
    document.querySelectorAll("[data-close-expense]").forEach(b=>b.addEventListener("click",()=>document.getElementById("expenseModal").classList.add("hidden")));

    document.getElementById("expenseForm").addEventListener("submit",async e=>{
      e.preventDefault();
      const f=new FormData(e.currentTarget);

      try {
        await FirebaseService.addExpense({
          category:f.get("category"),
          concept:f.get("concept"),
          amount:Number(f.get("amount"))
        }, App.actor());

        e.currentTarget.reset();
        document.getElementById("expenseModal").classList.add("hidden");
        App.toast("Gasto registrado.");
      } catch(error) {
        console.error(error);
        App.toast(App.firebaseMessage(error));
      }
    });
  },

  render() {
    if(!this.initDone) this.init();

    const sales=App.orders.reduce((s,o)=>s+Number(o.total||0),0);
    const collected=App.orders.filter(o=>o.collected).reduce((s,o)=>s+Number(o.total||0),0);
    const expenses=App.expenses.reduce((s,g)=>s+Number(g.amount||0),0);

    const productCosts=App.orders.filter(o=>o.status==="delivered").reduce((s,o)=>{
      const p=App.getProduct(o.productId);
      return s+((o.fulfillment==="own"?p?.ownCost:p?.supplierCost)||0)*Number(o.quantity||1);
    },0);

    const estimatedProfit=collected-expenses-productCosts;

    const metrics=[
      ["Ventas",sales,"Pedidos registrados"],
      ["Recaudado",collected,"Dinero identificado"],
      ["Gastos",expenses,"Egresos registrados"],
      ["Utilidad estimada",estimatedProfit,"Después de costos conocidos"]
    ];

    document.getElementById("financeMetrics").innerHTML=metrics.map(m=>`
      <article class="metric-card">
        <div class="metric-top"><span>${m[0]}</span><span class="metric-icon">$</span></div>
        <strong class="metric-value">${App.money(m[1])}</strong>
        <span class="metric-foot">${m[2]}</span>
      </article>`).join("");

    const movements=[
      ...App.expenses.map(g=>({
        date:g.date||g.dateClient,
        type:"Egreso",
        concept:`${g.category} · ${g.concept}`,
        amount:-Number(g.amount||0)
      })),
      ...App.orders.filter(o=>o.collected).map(o=>({
        date:o.updatedAt||o.createdAt||o.createdAtClient,
        type:"Ingreso",
        concept:`${o.id} · ${o.customer?.name||""}`,
        amount:Number(o.total||0)
      }))
    ].sort((a,b)=>App.toDate(b.date)-App.toDate(a.date)).slice(0,10);

    document.getElementById("financeMovements").innerHTML=movements.length
      ? movements.map(m=>`
        <div class="list-row" style="grid-template-columns:1fr auto">
          <div><b>${m.concept}</b><span>${App.dateTime(m.date)} · ${m.type}</span></div>
          <div><b style="color:${m.amount<0?'var(--danger)':'var(--success)'}">${m.amount<0?'-':''}${App.money(Math.abs(m.amount))}</b></div>
        </div>`).join("")
      : `<div class="empty-state"><b>Sin movimientos</b><span>Los ingresos y gastos aparecerán aquí.</span></div>`;

    document.getElementById("supplierFinance").innerHTML=App.suppliers.length
      ? App.suppliers.map(s=>{
          const delivered=App.orders.filter(o=>o.supplierId===s.id && o.status==="delivered");
          const cost=delivered.reduce((sum,o)=>sum+(App.getProduct(o.productId)?.supplierCost||0)*Number(o.quantity||1),0);
          return `<div class="list-row" style="grid-template-columns:1fr auto"><div><b>${s.name}</b><span>${delivered.length} pedidos entregados</span></div><div><b>${App.money(cost)}</b><span>Costo mercancía</span></div></div>`;
        }).join("")
      : `<div class="empty-state"><b>Sin proveedores</b><span>No hay información financiera de proveedores.</span></div>`;
  }
};

document.addEventListener("DOMContentLoaded",()=>Finance.init());
