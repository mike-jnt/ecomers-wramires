(() => {
  const App = window.App = {
    state: {
      role: null,
      activeView: "dashboard",
      orderFilter: "all",
      dispatchTab: "own"
    },

    currentUser: null,
    profile: null,
    products: [],
    suppliers: [],
    orders: [],
    expenses: [],
    systemUsers: [],
    unsubscribers: [],

    roleConfig: {
      admin: {
        name: "Administrador", label: "Administrador", initial: "A",
        views: ["dashboard","new-order","orders","dispatch","inventory","suppliers","customers","pricing","finance","users"]
      },
      seller: {
        name: "Vendedor", label: "Vendedor", initial: "V",
        views: ["dashboard","new-order","orders","customers"]
      },
      dispatch: {
        name: "Despacho", label: "Despacho", initial: "D",
        views: ["dashboard","orders","dispatch","inventory","suppliers"]
      },
      finance: {
        name: "Contabilidad", label: "Contabilidad", initial: "C",
        views: ["dashboard","orders","suppliers","pricing","finance"]
      }
    },

    navItems: [
      ["dashboard","⌂","Inicio"],
      ["new-order","+","Nuevo pedido"],
      ["orders","▣","Pedidos"],
      ["dispatch","⇢","Despacho"],
      ["inventory","◫","Inventario"],
      ["suppliers","▤","Proveedores"],
      ["users","♙","Usuarios"],
      ["customers","♙","Clientes"],
      ["pricing","%","Precios y rentabilidad"],
      ["finance","$","Finanzas"]
    ],

    statusLabels: {
      confirmed:"Confirmado",
      preparing:"Preparando",
      packed:"Empacado",
      supplier_pending:"Pendiente proveedor",
      supplier_loaded:"Cargado proveedor",
      shipped:"Despachado",
      transit:"En tránsito",
      delivered:"Entregado",
      collected:"Recaudado",
      cancelled:"Cancelado",
      returned:"Devuelto"
    },

    async init() {
      this.bindAuth();
      this.bindNavigation();
      this.bindGlobal();
      this.setDateLabel();
      this.setConnection("Conectando…");

      try {
        await window.FirebaseReady;
        FirebaseService.onAuthStateChanged(user => this.handleAuthState(user));
      } catch (error) {
        console.error(error);
        this.setConnection("Error Firebase", "error");
        this.showAuthError("No fue posible cargar Firebase. Abre el sistema mediante http://localhost o Firebase Hosting y verifica tu conexión a internet.");
      }
    },

    async handleAuthState(user) {
      if (!user) {
        this.stopDataSync();
        this.currentUser = null;
        this.profile = null;
        this.state.role = null;
        document.body.classList.remove("is-admin");
        document.getElementById("appView").classList.add("hidden");
        document.getElementById("loginView").classList.remove("hidden");
        this.setConnection("Sin sesión");
        return;
      }

      try {
        let profile = await FirebaseService.getUserProfile(user.uid);

        if (!profile) {
          try {
            this.setConnection("Configurando admin…");
            const bootstrap = await FirebaseService.bootstrapAdminProfile(user);
            if (bootstrap?.created || bootstrap?.alreadyAdmin) {
              profile = await FirebaseService.getUserProfile(user.uid);
            }
          } catch (bootstrapError) {
            console.error("Bootstrap admin:", bootstrapError);
          }
        }

        if (!profile) {
          await FirebaseService.logout();
          this.showAuthError(
            "La cuenta existe en Authentication, pero no tiene un perfil autorizado en el sistema. Solicita al administrador que cree tu usuario desde el módulo Usuarios."
          );
          return;
        }

        if (profile.activo === false) {
          await FirebaseService.logout();
          this.showAuthError("Este usuario está desactivado.");
          return;
        }

        const role = this.normalizeRole(profile.rol || profile.role);
        if (!role) {
          await FirebaseService.logout();
          this.showAuthError(`El rol "${profile.rol || profile.role || ""}" no es válido.`);
          return;
        }

        this.currentUser = user;
        this.profile = profile;
        this.state.role = role;
        document.body.classList.toggle("is-admin", role === "admin");

        const cfg = this.roleConfig[role];
        const displayName = profile.nombre || profile.name || user.email || cfg.name;
        cfg.name = displayName;
        cfg.initial = displayName.trim().charAt(0).toUpperCase();

        document.getElementById("loginView").classList.add("hidden");
        document.getElementById("appView").classList.remove("hidden");

        ["userName","topUserName"].forEach(id => document.getElementById(id).textContent = displayName);
        document.getElementById("userRoleLabel").textContent = cfg.label;
        ["userAvatar","topAvatar"].forEach(id => document.getElementById(id).textContent = cfg.initial);

        this.renderNav();
        this.renderRoleVisibility();
        this.go("dashboard");
        this.startDataSync();
        this.setConnection("En línea", "online");
        this.hideAuthError();
      } catch (error) {
        console.error(error);
        this.showAuthError(this.firebaseMessage(error));
      }
    },

    normalizeRole(role) {
      const value = String(role || "").toLowerCase().trim();
      const aliases = {
        admin:"admin", administrador:"admin",
        seller:"seller", vendedor:"seller", ventas:"seller",
        dispatch:"dispatch", despacho:"dispatch", bodega:"dispatch",
        finance:"finance", contabilidad:"finance", contador:"finance", contable:"finance"
      };
      return aliases[value] || null;
    },

    bindAuth() {
      const form = document.getElementById("loginForm");
      form.addEventListener("submit", async e => {
        e.preventDefault();
        this.hideAuthError();
        const btn = document.getElementById("loginSubmitBtn");
        const email = document.getElementById("loginEmail").value.trim();
        const password = document.getElementById("loginPassword").value;

        btn.disabled = true;
        btn.innerHTML = '<span class="loading-inline">Ingresando</span>';
        try {
          await window.FirebaseReady;
          await FirebaseService.login(email, password);
        } catch (error) {
          this.showAuthError(this.firebaseMessage(error));
        } finally {
          btn.disabled = false;
          btn.textContent = "Ingresar";
        }
      });

      document.getElementById("resetPasswordBtn").addEventListener("click", async () => {
        const email = document.getElementById("loginEmail").value.trim();
        if (!email) return this.showAuthError("Escribe primero el correo electrónico.");
        try {
          await window.FirebaseReady;
          await FirebaseService.resetPassword(email);
          this.showAuthError("Enviamos el correo para restablecer la contraseña. Revisa también spam.", false);
        } catch (error) {
          this.showAuthError(this.firebaseMessage(error));
        }
      });

      document.getElementById("logoutBtn").addEventListener("click", async () => {
        try { await FirebaseService.logout(); } catch (e) { console.error(e); }
      });
    },

    showAuthError(message, isError = true) {
      const el = document.getElementById("authError");
      el.textContent = message;
      el.classList.remove("hidden");
      el.style.color = isError ? "var(--danger)" : "var(--success)";
      el.style.background = isError ? "var(--danger-soft)" : "var(--success-soft)";
      el.style.borderColor = isError ? "#fecaca" : "#bbf7d0";
    },

    hideAuthError() {
      document.getElementById("authError").classList.add("hidden");
    },

    firebaseMessage(error) {
      const code = error?.code || "";
      const map = {
        "auth/invalid-credential":"Correo o contraseña incorrectos.",
        "auth/user-disabled":"Este usuario está desactivado en Firebase Authentication.",
        "auth/too-many-requests":"Demasiados intentos. Intenta nuevamente más tarde.",
        "auth/network-request-failed":"No se pudo conectar con Firebase. Verifica tu internet.",
        "auth/invalid-email":"El correo electrónico no es válido.",
        "auth/missing-password":"Escribe la contraseña.",
        "permission-denied":"Firestore bloqueó esta acción por permisos.",
        "failed-precondition":"Falta una configuración requerida en Firestore.",
        "auth/email-already-in-use":"Ya existe una cuenta con ese correo.",
        "auth/weak-password":"La contraseña no cumple los requisitos mínimos.",
        "auth/operation-not-allowed":"Debes activar Email/Password en Firebase Authentication.",
        "auth/wrong-password":"La contraseña actual no es correcta.",
        "auth/invalid-credential":"Correo o contraseña incorrectos.",
        "auth/email-already-in-use":"Ese correo ya está usado por otra cuenta.",
        "auth/requires-recent-login":"La cuenta debe autenticarse nuevamente antes de cambiar credenciales."
      };
      return map[code] || error?.message || "Ocurrió un error inesperado.";
    },

    startDataSync() {
      this.stopDataSync();

      const listen = (collection, setter, allowed = true) => {
        if (!allowed) { setter([]); return; }
        const unsub = FirebaseService.subscribeCollection(
          collection,
          data => {
            setter(data);
            this.refreshAll();
          },
          error => {
            console.error(error);
            this.setConnection("Permisos / conexión", "error");
          }
        );
        this.unsubscribers.push(unsub);
      };

      listen("productos", data => {
        this.products = data.map(p => this.normalizeProduct(p));
        this.renderProductOptions();
      });

      listen("proveedores", data => {
        this.suppliers = data.map(s => this.normalizeSupplier(s));
      });

      listen("pedidos", data => {
        this.orders = data;
      });

      listen("gastos", data => {
        this.expenses = data;
      }, ["admin","finance"].includes(this.state.role));

      listen("usuariosSistema", data => {
        this.systemUsers = data;
      }, this.state.role === "admin");
    },

    stopDataSync() {
      this.unsubscribers.forEach(fn => {
        try { fn(); } catch {}
      });
      this.unsubscribers = [];
      this.products = [];
      this.suppliers = [];
      this.orders = [];
      this.expenses = [];
      this.systemUsers = [];
    },

    normalizeProduct(p) {
      return {
        ...p,
        sku: p.sku || "",
        name: p.nombre || p.name || "",
        variant: p.variante || p.variant || "",
        price: Number(p.precio ?? p.price ?? 0),
        ownStock: Number(p.stockPropio ?? p.ownStock ?? 0),
        reserved: Number(p.reservado ?? p.reserved ?? 0),
        ownCost: Number(p.costoPropio ?? p.ownCost ?? 0),
        supplierId: p.proveedorId ?? p.supplierId ?? null,
        supplierStock: Number(p.stockProveedor ?? p.supplierStock ?? 0),
        supplierCost: Number(p.costoProveedor ?? p.supplierCost ?? 0),
        pricingModel: p.modeloPrecio || p.pricingModel || "standard",
        defaultShipping: Number(p.envioPredeterminado ?? p.defaultShipping ?? 0),
        dispatchFeePerUnit: Number(p.despachoPorUnidad ?? p.dispatchFeePerUnit ?? 0),
        advisorCommissionType: p.comisionAsesorTipo || p.advisorCommissionType || "fixed",
        advisorCommissionValue: Number(p.comisionAsesorValor ?? p.advisorCommissionValue ?? 0),
        carrierFeePercent: Number(p.feeTransportadoraPct ?? p.carrierFeePercent ?? 0),
        advertisingCost: Number(p.publicidadPorVenta ?? p.advertisingCost ?? 0),
        pricingSource: p.fuentePrecio || p.pricingSource || "Manual",
        commercialDescription: p.descripcionComercial || p.commercialDescription || "",
        commercialFeatures: Array.isArray(p.funcionesComerciales) ? p.funcionesComerciales : (Array.isArray(p.commercialFeatures) ? p.commercialFeatures : []),
        commercialBenefits: Array.isArray(p.beneficiosComerciales) ? p.beneficiosComerciales : (Array.isArray(p.commercialBenefits) ? p.commercialBenefits : []),
        commercialUses: Array.isArray(p.usosComerciales) ? p.usosComerciales : (Array.isArray(p.commercialUses) ? p.commercialUses : []),
        commercialValidation: p.validacionComercial || p.commercialValidation || "",
        commercialSheetActive: p.fichaComercialActiva !== false
      };
    },

    normalizeSupplier(s) {
      return {
        ...s,
        name: s.nombre || s.name || "",
        phone: s.telefono || s.phone || "",
        model: s.modelo || s.model || "",
        settlement: s.liquidacion || s.settlement || ""
      };
    },

    renderNav() {
      const allowed = this.roleConfig[this.state.role].views;
      const nav = document.getElementById("mainNav");
      nav.innerHTML = this.navItems.filter(i => allowed.includes(i[0])).map(([view,icon,label]) =>
        `<button class="nav-link ${view===this.state.activeView?'active':''}" data-go="${view}">
          <span class="nav-icon">${icon}</span><span>${label}</span>
        </button>`).join("");

      const mobile = document.getElementById("mobileNav");
      let items;
      if (this.state.role === "seller") items = [["dashboard","⌂","Inicio"],["orders","▣","Pedidos"],["new-order","+","Pedido"],["customers","⌕","Clientes"],["dashboard","☰","Más"]];
      else if (this.state.role === "dispatch") items = [["dashboard","⌂","Inicio"],["dispatch","⇢","Despacho"],["orders","▣","Pedidos"],["inventory","◫","Stock"],["suppliers","☰","Más"]];
      else if (this.state.role === "finance") items = [["dashboard","⌂","Inicio"],["finance","$","Finanzas"],["pricing","%","Costos"],["orders","▣","Pedidos"],["suppliers","▤","Proveedores"]];
      else items = [["dashboard","⌂","Inicio"],["orders","▣","Pedidos"],["new-order","+","Pedido"],["pricing","%","Costos"],["finance","$","Finanzas"]];

      mobile.innerHTML = items.filter(i => allowed.includes(i[0])).map(([view,icon,label]) =>
        `<button class="mobile-nav-btn ${view===this.state.activeView?'active':''} ${view==='new-order'?'primary-mobile':''}" data-go="${view}">
          <span class="nav-icon">${icon}</span>${view==='new-order'?'':`<span>${label}</span>`}
        </button>`).join("");
    },

    renderRoleVisibility() {
      const role = this.state.role;
      document.querySelectorAll(".seller-admin-only").forEach(el => el.classList.toggle("hidden", !["seller","admin"].includes(role)));
    },

    bindNavigation() {
      document.addEventListener("click", e => {
        const go = e.target.closest("[data-go]");
        if (go) this.go(go.dataset.go);

        const action = e.target.closest("[data-action]");
        if (action?.dataset.action === "seed-demo") this.seedDemo();
      });

      document.getElementById("menuBtn").addEventListener("click", () => document.getElementById("sidebar").classList.toggle("open"));
    },

    go(view) {
      const allowed = this.roleConfig[this.state.role]?.views || [];
      if (!allowed.includes(view)) return;
      this.state.activeView = view;
      document.querySelectorAll(".view").forEach(v => v.classList.toggle("active", v.dataset.view === view));
      document.querySelectorAll("[data-go]").forEach(b => b.classList.toggle("active", b.dataset.go === view && (b.classList.contains("nav-link") || b.classList.contains("mobile-nav-btn"))));
      document.getElementById("sidebar").classList.remove("open");
      if (view === "new-order" && window.Orders) Orders.updateSummary();
      this.refreshAll();
      window.scrollTo({top:0,behavior:"smooth"});
    },

    bindGlobal() {
      document.getElementById("globalSearch").addEventListener("keydown", e => {
        if (e.key !== "Enter") return;
        const q = e.target.value.trim().toLowerCase();
        const match = this.orders.find(o => o.id.toLowerCase().includes(q) || o.customer?.name?.toLowerCase().includes(q) || String(o.customer?.phone||"").includes(q));
        if (match) Orders.openOrder(match.id); else this.toast("No encontramos coincidencias.");
      });

      document.querySelectorAll("[data-close-modal]").forEach(b => b.addEventListener("click", () => document.getElementById("orderModal").classList.add("hidden")));
      document.getElementById("orderModal").addEventListener("click", e => {
        if (e.target.id === "orderModal") e.currentTarget.classList.add("hidden");
      });

      const createUserForm = document.getElementById("createUserForm");
      if (createUserForm) {
        createUserForm.addEventListener("submit", e => {
          e.preventDefault();
          this.createSystemUser(e.currentTarget);
        });
      }

      window.addEventListener("online", () => this.setConnection("En línea", "online"));
      window.addEventListener("offline", () => this.setConnection("Sin internet", "error"));
    },

    setDateLabel() {
      const date = new Date();
      document.getElementById("todayLabel").textContent = date.toLocaleDateString("es-CO",{weekday:"long",day:"numeric",month:"long",year:"numeric"}).toUpperCase();
    },

    setConnection(text, mode = "") {
      const el = document.getElementById("connectionBadge");
      if (!el) return;
      el.textContent = text;
      el.className = `connection-badge ${mode}`.trim();
    },

    renderProductOptions() {
      const select = document.getElementById("productSelect");
      if (!select) return;

      const currentValue = select.value;

      if (!this.products.length) {
        select.innerHTML = '<option value="">No hay productos disponibles</option>';
      } else {
        select.innerHTML = '<option value="">Selecciona un producto</option>' +
          this.products
            .filter(p => p.activo !== false)
            .map(p => `<option value="${p.id}">${p.name} · ${p.variant} · ${this.money(p.price)}</option>`)
            .join("");
      }

      if (currentValue && this.products.some(p => p.id === currentValue && p.activo !== false)) {
        select.value = currentValue;
      } else {
        select.value = "";
      }

      if (window.Orders) Orders.updateSummary();
    },

    refreshAll() {
      if (!this.state.role) return;
      this.renderDashboard();
      if (window.Orders) Orders.renderOrders();
      if (window.Dispatch) Dispatch.render();
      this.renderInventory();
      this.renderSuppliers();
      this.renderCustomers();
      this.renderSystemUsers();
      if (window.Pricing) Pricing.render();
      if (window.Finance) Finance.render();
    },

    async seedDemo() {
      if (this.state.role !== "admin") return;
      if (!confirm("Esto creará/actualizará Etech Store como proveedor principal y cargará los 4 audífonos con precios, costos y fichas comerciales. El inventario existente no se borrará. ¿Continuar?")) return;
      try {
        const result = await FirebaseService.seedEtechCatalog();
        this.toast(`Etech Store listo: ${result.created} producto(s) creados y ${result.updated} actualizados.`);
      } catch (error) {
        console.error(error);
        this.toast(this.firebaseMessage(error));
      }
    },

    renderDashboard() {
      const cfg = this.roleConfig[this.state.role];
      document.getElementById("dashboardGreeting").textContent = `Buenos días, ${cfg.name}`;

      const todayKey = new Date().toLocaleDateString("en-CA");
      const todayOrders = this.orders.filter(o => this.toDate(o.createdAt || o.createdAtClient).toLocaleDateString("en-CA") === todayKey);
      const pendingDispatch = this.orders.filter(o => ["confirmed","preparing","packed","supplier_pending","supplier_loaded"].includes(o.status)).length;
      const transit = this.orders.filter(o => ["shipped","transit"].includes(o.status)).length;
      const delivered = this.orders.filter(o => o.status === "delivered").length;

      let metrics;
      if (this.state.role === "seller") {
        const ownToday = todayOrders.filter(o => o.sellerUid === this.currentUser?.uid);
        metrics = [
          ["▣","Mis pedidos hoy",ownToday.length,"Creados por ti"],
          ["✓","Confirmados",ownToday.filter(o=>o.status!=="cancelled").length,"Pedidos válidos"],
          ["⇢","En tránsito",this.orders.filter(o=>o.sellerUid===this.currentUser?.uid && o.status==="transit").length,"Seguimiento activo"],
          ["!","Novedades",0,"Sin alertas nuevas"]
        ];
      } else if (this.state.role === "finance") {
        const deliveredSales = this.orders.filter(o=>o.status==="delivered");
        const sales = deliveredSales.reduce((sum,o)=>sum+Number(o.total||0),0);
        const collected = deliveredSales.filter(o=>o.collected || o.payment==="transfer").reduce((sum,o)=>sum+Number(o.total||0),0);
        const expenses = this.expenses.reduce((sum,g)=>sum+Number(g.amount||0),0);
        metrics = [
          ["$","Ventas entregadas",sales,"Solo ventas reales"],
          ["✓","Recaudado",collected,"Dinero identificado"],
          ["…","Por recaudar",Math.max(0,sales-collected),"Entregas pendientes de recaudo"],
          ["−","Gastos",expenses,"Registrados"]
        ];
      } else {
        metrics = [
          ["▣","Pedidos hoy",todayOrders.length,"Operación del día"],
          ["⇢","Por gestionar",pendingDispatch,"Bodega + proveedor"],
          ["⌁","En tránsito",transit,"Con guía"],
          ["✓","Entregados",delivered,"Histórico visible"]
        ];
      }

      document.getElementById("metricGrid").innerHTML = metrics.map(m => `
        <article class="metric-card">
          <div class="metric-top"><span>${m[1]}</span><span class="metric-icon">${m[0]}</span></div>
          <strong class="metric-value">${typeof m[2]==="number" && m[1].match(/Ventas|Recaudado|Por recaudar|Gastos/)?this.money(m[2]):m[2]}</strong>
          <span class="metric-foot">${m[3]}</span>
        </article>`).join("");

      const own = this.orders.filter(o=>o.fulfillment==="own" && ["confirmed","preparing","packed"].includes(o.status)).length;
      const supplier = this.orders.filter(o=>o.fulfillment==="supplier" && ["supplier_pending","confirmed","supplier_loaded"].includes(o.status)).length;
      const lowStock = this.products.filter(p=>(p.ownStock-p.reserved)<=3).length;

      document.getElementById("attentionList").innerHTML = [
        [own,"pedidos para preparar en bodega","dispatch"],
        [supplier,"pedidos gestionados por proveedor","dispatch"],
        [lowStock,"productos con stock propio bajo","inventory"]
      ].filter(item => this.roleConfig[this.state.role].views.includes(item[2])).map(([n,t,v])=>`
        <button class="attention-item" data-go="${v}">
          <span class="attention-dot"></span>
          <span class="attention-copy"><b>${n} ${t}</b><span>Ver detalle</span></span>
          <span>›</span>
        </button>`).join("") || '<div class="empty-state"><b>Operación al día</b><span>No hay alertas para tu rol.</span></div>';

      let actions = [];
      if (["seller","admin"].includes(this.state.role)) actions.push(["+ Nuevo pedido","Registrar una venta","new-order"]);
      if (["dispatch","admin"].includes(this.state.role)) actions.push(["⇢ Despachos","Preparar pedidos","dispatch"]);
      if (["dispatch","admin"].includes(this.state.role)) actions.push(["◫ Inventario","Revisar stock","inventory"]);
      if (["finance","admin"].includes(this.state.role)) actions.push(["% Precios","Revisar rentabilidad","pricing"]);
      if (["finance","admin"].includes(this.state.role)) actions.push(["$ Finanzas","Revisar recaudos","finance"]);
      if (this.state.role==="admin") actions.push(["♙ Usuarios","Crear y administrar accesos","users"]);
      if (this.state.role==="seller") actions.push(["♙ Clientes","Consultar historial","customers"],["▣ Mis pedidos","Ver seguimiento","orders"]);

      let quickHtml = actions.slice(0,4).map(a=>`<button class="quick-action" data-go="${a[2]}"><b>${a[0]}</b><span>${a[1]}</span></button>`).join("");
      if (this.state.role === "admin" && this.products.length === 0) {
        quickHtml = `<button class="quick-action" data-action="seed-demo"><b>⚙ Cargar catálogo Etech Store</b><span>Proveedor + 4 audífonos + fichas comerciales</span></button>` + quickHtml;
      }
      document.getElementById("quickActions").innerHTML = quickHtml;

      const recentBase = this.state.role === "seller"
        ? this.orders.filter(o => !o.sellerUid || o.sellerUid === this.currentUser?.uid)
        : this.orders;
      const recent = recentBase.slice().sort((a,b)=>this.toDate(b.createdAt||b.createdAtClient)-this.toDate(a.createdAt||a.createdAtClient)).slice(0,5);
      Orders.renderOrderContainer("recentOrders", recent);
    },

    renderInventory() {
      const el = document.getElementById("inventoryList");
      if (!el) return;
      if (!this.products.length) {
        el.innerHTML = `<div class="empty-state"><b>No hay productos</b><span>${this.state.role==="admin"?"Inicializa la base desde Inicio o crea productos en Firestore.":"El administrador aún no ha cargado el catálogo."}</span></div>`;
        return;
      }
      el.innerHTML = `
        <div class="desktop-table"><table class="data-table"><thead><tr><th>Producto</th><th>SKU</th><th>Físico</th><th>Reservado</th><th>Disponible</th><th>Proveedor</th></tr></thead><tbody>
        ${this.products.map(p=>`<tr><td><b>${p.name}</b><br><span class="muted">${p.variant}</span></td><td>${p.sku}</td><td>${p.ownStock}</td><td>${p.reserved}</td><td><b>${Math.max(0,p.ownStock-p.reserved)}</b></td><td>${p.supplierStock}</td></tr>`).join("")}
        </tbody></table></div>
        <div class="mobile-order-list">${this.products.map(p=>`<article class="order-card-mobile"><div class="order-card-top"><b>${p.name}</b><span class="${p.ownStock-p.reserved<=3?'stock-warn':'stock-good'}">${p.ownStock-p.reserved} disponibles</span></div><p>${p.variant} · ${p.sku}</p><p>Proveedor: ${p.supplierStock} unidades reportadas</p></article>`).join("")}</div>`;
    },

    renderSuppliers() {
      const el = document.getElementById("supplierList");
      if (!el) return;
      if (!this.suppliers.length) {
        el.innerHTML = '<div class="empty-state"><b>No hay proveedores</b><span>Aún no se han creado proveedores en Firestore.</span></div>';
        return;
      }
      el.innerHTML = this.suppliers.map(s=>{
        const orders = this.orders.filter(o=>o.supplierId===s.id);
        const pending = orders.filter(o=>!["delivered","cancelled"].includes(o.status)).length;
        const pcount = this.products.filter(p=>p.supplierId===s.id).length;
        return `<div class="list-row"><div><b>${s.name}</b><span>${s.model} · ${s.settlement}</span></div><div><b>${pcount}</b><span>Productos</span></div><div><b>${pending}</b><span>Pendientes</span></div><div><b>${s.phone}</b><span>Contacto</span></div></div>`;
      }).join("");
    },

    renderCustomers() {
      const el = document.getElementById("customerList");
      if (!el) return;
      const map = {};
      this.orders.forEach(o=>{
        const phone = o.customer?.phone;
        if (!phone) return;
        if(!map[phone]) map[phone]={...o.customer,orders:0,total:0,delivered:0};
        map[phone].orders++;
        map[phone].total += Number(o.total||0);
        if(o.status==="delivered") map[phone].delivered++;
      });
      const customers = Object.values(map);
      el.innerHTML = customers.length ? customers.map(c=>`
        <div class="list-row">
          <div><b>${c.name}</b><span>${c.phone} · ${c.city}</span></div>
          <div><b>${c.orders}</b><span>Pedidos</span></div>
          <div><b>${c.delivered}</b><span>Entregados</span></div>
          <div><b>${this.money(c.total)}</b><span>Compras</span></div>
        </div>`).join("") : '<div class="empty-state"><b>Sin clientes</b><span>Los clientes aparecerán a medida que se creen pedidos.</span></div>';
    },


    renderSystemUsers() {
      const list = document.getElementById("systemUsersList");
      const summary = document.getElementById("userRoleSummary");
      if (!list || !summary || this.state.role !== "admin") return;

      const users = this.systemUsers.slice().sort((a,b) =>
        String(a.nombre || a.email || "").localeCompare(String(b.nombre || b.email || ""), "es")
      );

      const countRole = role => users.filter(u => u.rol === role && u.activo !== false).length;
      const roleLabels = { admin: "Administrador", vendedor: "Vendedor", despacho: "Despacho", contabilidad: "Contabilidad" };

      summary.innerHTML = [
        ["Administrador", countRole("admin")],
        ["Vendedores", countRole("vendedor")],
        ["Despacho", countRole("despacho")],
        ["Contabilidad", countRole("contabilidad")]
      ].map(([label,count]) => `<div class="user-role-stat"><b>${label}</b><strong>${count}</strong></div>`).join("");

      if (!users.length) {
        list.innerHTML = '<div class="empty-state"><b>Sin usuarios</b><span>No hay perfiles registrados.</span></div>';
        return;
      }

      list.innerHTML = `
        <div class="desktop-table">
          <table class="data-table">
            <thead><tr><th>Usuario</th><th>Rol</th><th>Estado</th><th>UID</th></tr></thead>
            <tbody>${users.map(u => `
              <tr>
                <td><div class="user-row-main"><b>${u.nombre || "Sin nombre"}</b><span>${u.email || "-"}</span></div></td>
                <td><span class="role-badge ${u.rol === "admin" ? "admin" : ""}">${roleLabels[u.rol] || u.rol || "-"}</span></td>
                <td><span class="status ${u.activo === false ? "status-cancelled" : "status-delivered"}">${u.activo === false ? "Inactivo" : "Activo"}</span></td>
                <td><span class="muted">${u.id}</span></td>
              </tr>`).join("")}
            </tbody>
          </table>
        </div>
        <div class="mobile-order-list">
          ${users.map(u => `
            <article class="order-card-mobile">
              <div class="order-card-top"><b>${u.nombre || "Sin nombre"}</b><span class="role-badge ${u.rol === "admin" ? "admin" : ""}">${roleLabels[u.rol] || u.rol || "-"}</span></div>
              <p>${u.email || "-"}</p><p>${u.activo === false ? "Inactivo" : "Activo"}</p>
            </article>`).join("")}
        </div>`;
    },

    async createSystemUser(formElement) {
      if (this.state.role !== "admin") return;
      const data = new FormData(formElement);
      const payload = {
        name: String(data.get("name") || "").trim(),
        email: String(data.get("email") || "").trim().toLowerCase(),
        role: String(data.get("role") || "").trim(),
        password: String(data.get("password") || "")
      };

      if (payload.password.length < 8) { this.toast("La contraseña temporal debe tener mínimo 8 caracteres."); return; }
      const button = document.getElementById("createUserBtn");
      button.disabled = true;
      button.innerHTML = '<span class="loading-inline">Creando usuario</span>';
      try {
        const result = await FirebaseService.createSystemUser(payload, this.actor());
        formElement.reset();
        this.toast(`${result.name} fue creado como ${result.role}.`);
      } catch (error) {
        console.error(error);
        this.toast(this.firebaseMessage(error));
      } finally {
        button.disabled = false;
        button.textContent = "Crear usuario";
      }
    },

    actor() {
      return {
        uid: this.currentUser?.uid,
        name: this.profile?.nombre || this.currentUser?.email || "Usuario"
      };
    },

    getProduct(id) { return this.products.find(p=>p.id===id); },
    getSupplier(id) { return this.suppliers.find(s=>s.id===id); },
    getOrder(id) { return this.orders.find(o=>o.id===id); },

    toDate(value) {
      if (!value) return new Date(0);
      if (typeof value.toDate === "function") return value.toDate();
      return new Date(value);
    },

    money(v) {
      return new Intl.NumberFormat("es-CO",{style:"currency",currency:"COP",maximumFractionDigits:0}).format(Number(v||0));
    },

    dateTime(v) {
      return this.toDate(v).toLocaleString("es-CO",{dateStyle:"short",timeStyle:"short"});
    },

    toast(msg) {
      const el = document.getElementById("toast");
      el.textContent = msg;
      el.classList.remove("hidden");
      clearTimeout(this.toastTimer);
      this.toastTimer=setTimeout(()=>el.classList.add("hidden"),3000);
    }
  };

  document.addEventListener("DOMContentLoaded", () => App.init());
})();
