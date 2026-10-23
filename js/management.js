const Management = window.Management = {
  initDone: false,

  init() {
    if (this.initDone) return;
    this.initDone = true;

    App.state.financeTab = App.state.financeTab || "sales";

    // Modales genéricos
    const closeMap = [
      ["[data-close-product-info]", "productInfoModal"],
      ["[data-close-product]", "productModal"],
      ["[data-close-stock]", "stockSupplierModal"],
      ["[data-close-supplier]", "supplierModal"],
      ["[data-close-user-edit]", "userEditModal"],
      ["[data-close-credentials]", "credentialsModal"],
      ["[data-close-order-edit]", "orderEditModal"]
    ];

    closeMap.forEach(([selector, id]) => {
      document.querySelectorAll(selector).forEach(btn => {
        btn.addEventListener("click", () => document.getElementById(id).classList.add("hidden"));
      });
    });

    document.getElementById("newProductBtn")?.addEventListener("click", () => this.openProductModal());
    document.getElementById("newSupplierBtn")?.addEventListener("click", () => this.openSupplierModal());

    document.getElementById("productForm")?.addEventListener("submit", e => this.saveProduct(e));
    document.getElementById("stockSupplierForm")?.addEventListener("submit", e => this.saveStock(e));
    document.getElementById("supplierForm")?.addEventListener("submit", e => this.saveSupplier(e));
    document.getElementById("userEditForm")?.addEventListener("submit", e => this.saveUser(e));
    document.getElementById("credentialsForm")?.addEventListener("submit", e => this.saveCredentials(e));
    document.getElementById("orderEditForm")?.addEventListener("submit", e => this.saveOrderEdit(e));

    document.getElementById("sendResetFromCredentialsBtn")?.addEventListener("click", () => {
      const form = document.getElementById("credentialsForm");
      this.sendReset(form.elements.currentEmail.value);
    });

  },



  openProductInfo(id) {
    const p = App.getProduct(id);
    if (!p) return;

    const features = p.commercialFeatures || [];
    const benefits = p.commercialBenefits || [];
    const uses = p.commercialUses || [];

    document.getElementById("productInfoTitle").textContent = p.name;

    document.getElementById("productInfoBody").innerHTML = `
      <div class="commercial-hero">
        <div>
          <span class="commercial-supplier">Etech Store</span>
          <h3>${App.escapeHTML(p.name)}</h3>
          <p>${App.escapeHTML(p.commercialDescription || "Ficha comercial en construcción.")}</p>
        </div>
        <div class="commercial-price">${App.money(p.price)}</div>
      </div>

      <div class="commercial-info-grid">
        <section class="commercial-block">
          <h4>Funciones principales</h4>
          ${features.length ? `<ul>${features.map(x => `<li>${App.escapeHTML(x)}</li>`).join("")}</ul>` : `<p class="muted">Sin funciones registradas.</p>`}
        </section>

        <section class="commercial-block">
          <h4>Beneficios para el cliente</h4>
          ${benefits.length ? `<ul>${benefits.map(x => `<li>${App.escapeHTML(x)}</li>`).join("")}</ul>` : `<p class="muted">Sin beneficios registrados.</p>`}
        </section>

        <section class="commercial-block">
          <h4>Usos recomendados</h4>
          ${uses.length ? `<ul>${uses.map(x => `<li>${App.escapeHTML(x)}</li>`).join("")}</ul>` : `<p class="muted">Sin usos registrados.</p>`}
        </section>
      </div>

      ${App.state.role === "admin" && p.commercialValidation
        ? `<div class="info-callout" style="margin-top:14px"><b>Validación pendiente con proveedor</b><span>${App.escapeHTML(p.commercialValidation)}</span></div>`
        : ""}
    `;

    document.getElementById("productInfoModal").classList.remove("hidden");
  },


  // ----------------------------------------------------------
  // PRODUCTOS
  // ----------------------------------------------------------
  openProductModal(id = null) {
    if (App.state.role !== "admin") return;

    const form = document.getElementById("productForm");
    form.reset();

    const supplierSelect = document.getElementById("productSupplierSelect");
    supplierSelect.innerHTML = `<option value="">Sin proveedor</option>` + App.suppliers
      .filter(s => s.activo !== false)
      .map(s => `<option value="${s.id}">${App.escapeHTML(s.name)}</option>`)
      .join("");

    form.elements.productId.value = "";
    form.elements.ownStock.value = 0;
    form.elements.reserved.value = 0;
    form.elements.supplierStock.value = 0;
    form.elements.supplierCost.value = 0;
    form.elements.pricingModel.value = "standard";
    form.elements.defaultShipping.value = 0;
    form.elements.dispatchFeePerUnit.value = 0;
    form.elements.advisorCommissionType.value = "fixed";
    form.elements.advisorCommissionValue.value = 0;
    form.elements.carrierFeePercent.value = 0;
    form.elements.advertisingCost.value = 0;
    form.elements.pricingSource.value = "Manual";
    form.elements.commercialDescription.value = "";
    form.elements.commercialFeatures.value = "";
    form.elements.commercialBenefits.value = "";
    form.elements.commercialUses.value = "";
    form.elements.commercialValidation.value = "";
    form.elements.active.value = "true";

    if (id) {
      const p = App.getProduct(id);
      if (!p) return;

      document.getElementById("productModalTitle").textContent = "Editar producto";
      form.elements.productId.value = p.id;
      form.elements.sku.value = p.sku || "";
      form.elements.name.value = p.name || "";
      form.elements.variant.value = p.variant || "";
      form.elements.price.value = p.price || 0;
      form.elements.ownStock.value = p.ownStock || 0;
      form.elements.reserved.value = p.reserved || 0;
      form.elements.ownCost.value = p.ownCost || 0;
      form.elements.supplierId.value = p.supplierId || "";
      form.elements.supplierStock.value = p.supplierStock || 0;
      form.elements.supplierCost.value = p.supplierCost || 0;
      form.elements.pricingModel.value = p.pricingModel || "standard";
      form.elements.defaultShipping.value = p.defaultShipping || 0;
      form.elements.dispatchFeePerUnit.value = p.dispatchFeePerUnit || 0;
      form.elements.advisorCommissionType.value = p.advisorCommissionType || "fixed";
      form.elements.advisorCommissionValue.value = p.advisorCommissionValue || 0;
      form.elements.carrierFeePercent.value = p.carrierFeePercent || 0;
      form.elements.advertisingCost.value = p.advertisingCost || 0;
      form.elements.pricingSource.value = p.pricingSource || "Manual";
      form.elements.commercialDescription.value = p.commercialDescription || "";
      form.elements.commercialFeatures.value = (p.commercialFeatures || []).join("\n");
      form.elements.commercialBenefits.value = (p.commercialBenefits || []).join("\n");
      form.elements.commercialUses.value = (p.commercialUses || []).join("\n");
      form.elements.commercialValidation.value = p.commercialValidation || "";
      form.elements.active.value = p.activo === false ? "false" : "true";
    } else {
      document.getElementById("productModalTitle").textContent = "Crear producto";
    }

    document.getElementById("productModal").classList.remove("hidden");
  },

  async saveProduct(e) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);

    const id = String(f.get("productId") || "");
    const sku = String(f.get("sku") || "").trim().toUpperCase();

    const duplicate = App.products.find(p =>
      p.id !== id && String(p.sku || "").trim().toUpperCase() === sku
    );

    if (duplicate) {
      App.toast(`Ya existe un producto con el SKU ${sku}.`);
      return;
    }

    try {
      const result = await FirebaseService.saveProduct({
        id,
        sku,
        name: f.get("name"),
        variant: f.get("variant"),
        price: Number(f.get("price") || 0),
        ownStock: Number(f.get("ownStock") || 0),
        reserved: Number(f.get("reserved") || 0),
        ownCost: Number(f.get("ownCost") || 0),
        supplierId: f.get("supplierId") || null,
        supplierStock: Number(f.get("supplierStock") || 0),
        supplierCost: Number(f.get("supplierCost") || 0),
        pricingModel: f.get("pricingModel") || "standard",
        defaultShipping: Number(f.get("defaultShipping") || 0),
        dispatchFeePerUnit: Number(f.get("dispatchFeePerUnit") || 0),
        advisorCommissionType: f.get("advisorCommissionType") || "fixed",
        advisorCommissionValue: Number(f.get("advisorCommissionValue") || 0),
        carrierFeePercent: Number(f.get("carrierFeePercent") || 0),
        advertisingCost: Number(f.get("advertisingCost") || 0),
        pricingSource: f.get("pricingSource") || "Manual",
        commercialDescription: f.get("commercialDescription") || "",
        commercialFeatures: String(f.get("commercialFeatures") || "").split(/\r?\n/).map(x => x.trim()).filter(Boolean),
        commercialBenefits: String(f.get("commercialBenefits") || "").split(/\r?\n/).map(x => x.trim()).filter(Boolean),
        commercialUses: String(f.get("commercialUses") || "").split(/\r?\n/).map(x => x.trim()).filter(Boolean),
        commercialValidation: f.get("commercialValidation") || "",
        active: f.get("active") === "true"
      }, App.actor());

      document.getElementById("productModal").classList.add("hidden");
      App.toast(result.created ? "Producto creado correctamente." : "Producto actualizado.");
    } catch (error) {
      console.error(error);
      App.toast(App.firebaseMessage(error));
    }
  },


  // ----------------------------------------------------------
  // INVENTARIO PROVEEDOR
  // ----------------------------------------------------------
  openStockModal(productId) {
    if (App.state.role !== "admin") return;
    const p = App.getProduct(productId);
    if (!p) return;

    const form = document.getElementById("stockSupplierForm");
    form.reset();
    form.elements.productId.value = p.id;
    form.elements.amount.value = 1;

    const providerSelect = document.getElementById("stockSupplierProvider");
    providerSelect.innerHTML = `<option value="">Sin proveedor</option>` + App.suppliers
      .filter(s => s.activo !== false)
      .map(s => `<option value="${s.id}">${App.escapeHTML(s.name)}</option>`)
      .join("");
    providerSelect.value = p.supplierId || "";

    document.getElementById("stockSupplierTitle").textContent = `${p.name} · ${p.variant}`;
    document.getElementById("stockSupplierCurrent").textContent = `${p.supplierStock} unidades`;

    document.getElementById("stockSupplierModal").classList.remove("hidden");
  },

  async saveStock(e) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);

    try {
      const result = await FirebaseService.adjustSupplierStock(
        f.get("productId"),
        f.get("operation"),
        Number(f.get("amount")),
        f.get("supplierId"),
        App.actor()
      );
      document.getElementById("stockSupplierModal").classList.add("hidden");
      App.toast(`Inventario proveedor actualizado: ${result.current} unidades.`);
    } catch (error) {
      console.error(error);
      App.toast(App.firebaseMessage(error));
    }
  },

  // ----------------------------------------------------------
  // PROVEEDORES
  // ----------------------------------------------------------
  openSupplierModal(id = null) {
    if (App.state.role !== "admin") return;

    const form = document.getElementById("supplierForm");
    form.reset();

    if (id) {
      const s = App.getSupplier(id);
      if (!s) return;

      document.getElementById("supplierModalTitle").textContent = "Editar proveedor";
      form.elements.supplierId.value = s.id;
      form.elements.name.value = s.name || "";
      form.elements.phone.value = s.phone || "";
      form.elements.model.value = s.model || "";
      form.elements.settlement.value = s.settlement || "";
      form.elements.active.value = s.activo === false ? "false" : "true";
    } else {
      document.getElementById("supplierModalTitle").textContent = "Crear proveedor";
      form.elements.supplierId.value = "";
      form.elements.active.value = "true";
    }

    document.getElementById("supplierModal").classList.remove("hidden");
  },

  async saveSupplier(e) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);

    try {
      const result = await FirebaseService.saveSupplier({
        id: f.get("supplierId"),
        name: f.get("name"),
        phone: f.get("phone"),
        model: f.get("model"),
        settlement: f.get("settlement"),
        active: f.get("active") === "true"
      }, App.actor());

      document.getElementById("supplierModal").classList.add("hidden");
      App.toast(result.created ? "Proveedor creado." : "Proveedor actualizado.");
    } catch (error) {
      console.error(error);
      App.toast(App.firebaseMessage(error));
    }
  },

  async deleteSupplier(id) {
    if (App.state.role !== "admin") return;
    const s = App.getSupplier(id);
    if (!s) return;

    const linkedProducts = App.products.filter(p => p.supplierId === id);
    const activeOrders = App.orders.filter(o =>
      o.supplierId === id && !["delivered", "cancelled", "returned"].includes(o.status)
    );

    if (activeOrders.length) {
      App.toast(`No se puede eliminar: ${activeOrders.length} pedido(s) activo(s) aún dependen de este proveedor.`);
      return;
    }

    const productNote = linkedProducts.length
      ? `\n\n${linkedProducts.length} producto(s) quedarán sin proveedor y su stock de proveedor pasará a 0.`
      : "";

    if (!confirm(`¿Eliminar definitivamente el proveedor "${s.name}"?${productNote}`)) return;

    try {
      const result = await FirebaseService.removeSupplier(id, App.actor());
      App.toast(`Proveedor eliminado. ${result.unassignedProducts} producto(s) quedaron sin proveedor.`);
    } catch (error) {
      console.error(error);
      App.toast(App.firebaseMessage(error));
    }
  },

  // ----------------------------------------------------------
  // USUARIOS
  // ----------------------------------------------------------
  openUserEdit(uid) {
    if (App.state.role !== "admin") return;
    const user = App.systemUsers.find(u => u.id === uid);
    if (!user) return;

    const form = document.getElementById("userEditForm");
    form.elements.uid.value = user.id;
    form.elements.name.value = user.nombre || "";
    form.elements.email.value = user.email || "";
    form.elements.role.value = user.rol || "vendedor";
    form.elements.active.value = user.activo === false ? "false" : "true";

    const isInitialAdmin = user.id === App.currentUser?.uid || user.esAdministradorInicial === true;
    form.elements.role.disabled = isInitialAdmin;
    form.elements.active.disabled = user.id === App.currentUser?.uid;

    document.getElementById("userEditModal").classList.remove("hidden");
  },

  async saveUser(e) {
    e.preventDefault();
    const form = e.currentTarget;
    const uid = form.elements.uid.value;
    const current = App.systemUsers.find(u => u.id === uid);
    if (!current) return;

    const patch = {
      nombre: form.elements.name.value.trim()
    };

    if (!form.elements.role.disabled) patch.rol = form.elements.role.value;
    if (!form.elements.active.disabled) {
      patch.activo = form.elements.active.value === "true";
      if (patch.activo) patch.eliminado = false;
    }

    try {
      await FirebaseService.updateSystemUser(uid, patch, App.actor());
      document.getElementById("userEditModal").classList.add("hidden");
      App.toast("Usuario actualizado.");
    } catch (error) {
      console.error(error);
      App.toast(App.firebaseMessage(error));
    }
  },

  openCredentials(uid) {
    if (App.state.role !== "admin") return;
    const user = App.systemUsers.find(u => u.id === uid);
    if (!user) return;

    const form = document.getElementById("credentialsForm");
    form.reset();
    form.elements.uid.value = user.id;
    form.elements.currentEmail.value = user.email || "";
    document.getElementById("credentialsModal").classList.remove("hidden");
  },

  async saveCredentials(e) {
    e.preventDefault();
    const form = e.currentTarget;

    try {
      const result = await FirebaseService.changeUserCredentials({
        uid: form.elements.uid.value,
        currentEmail: form.elements.currentEmail.value,
        currentPassword: form.elements.currentPassword.value,
        newEmail: form.elements.newEmail.value,
        newPassword: form.elements.newPassword.value
      });

      document.getElementById("credentialsModal").classList.add("hidden");
      App.toast(`Credenciales actualizadas. Correo: ${result.email}`);
    } catch (error) {
      console.error(error);
      App.toast(App.firebaseMessage(error));
    }
  },

  async sendReset(email) {
    try {
      await FirebaseService.sendUserPasswordReset(email);
      App.toast(`Correo de recuperación enviado a ${email}.`);
    } catch (error) {
      console.error(error);
      App.toast(App.firebaseMessage(error));
    }
  },

  async disableUser(uid) {
    if (App.state.role !== "admin") return;
    const user = App.systemUsers.find(u => u.id === uid);
    if (!user) return;

    if (user.id === App.currentUser?.uid || user.esAdministradorInicial) {
      App.toast("El administrador principal no puede eliminarse desde el sistema.");
      return;
    }

    if (!confirm(`¿Eliminar el acceso de ${user.nombre || user.email}? La cuenta de Authentication permanecerá registrada, pero no podrá entrar al sistema.`)) return;

    try {
      await FirebaseService.disableSystemUser(uid, App.actor());
      App.toast("Acceso eliminado del sistema.");
    } catch (error) {
      console.error(error);
      App.toast(App.firebaseMessage(error));
    }
  },

  // ----------------------------------------------------------
  // PEDIDOS
  // ----------------------------------------------------------
  canEditOrder(order) {
    if (!order) return false;
    if (["cancelled", "delivered", "returned"].includes(order.status)) return false;
    if (App.state.role === "admin") return true;
    return App.state.role === "seller"
      && order.sellerUid === App.currentUser?.uid
      && ["confirmed", "supplier_pending"].includes(order.status);
  },

  canCancelOrder(order) {
    if (!order) return false;
    if (["cancelled", "delivered", "returned", "transit", "shipped"].includes(order.status)) return false;
    if (App.state.role === "admin") return true;
    return App.state.role === "seller"
      && order.sellerUid === App.currentUser?.uid
      && ["confirmed", "supplier_pending"].includes(order.status);
  },

  openOrderEdit(id) {
    const o = App.getOrder(id);
    if (!this.canEditOrder(o)) return;

    const form = document.getElementById("orderEditForm");
    const canProduct = App.state.role === "admin" && ["confirmed", "supplier_pending"].includes(o.status);

    form.elements.orderId.value = o.id;
    form.elements.phone.value = o.customer?.phone || "";
    form.elements.documentId.value = o.customer?.documentId || "";
    form.elements.name.value = o.customer?.name || "";
    form.elements.department.value = o.customer?.department || "";
    form.elements.city.value = o.customer?.city || "";
    form.elements.address.value = o.customer?.address || "";
    form.elements.neighborhood.value = o.customer?.neighborhood || "";
    form.elements.reference.value = o.customer?.reference || "";
    form.elements.quantity.value = o.quantity || 1;
    form.elements.shipping.value = o.shipping || 0;
    form.elements.payment.value = o.payment || "cod";
    form.elements.source.value = o.source || "";
    form.elements.notes.value = o.notes || "";

    const productSelect = document.getElementById("orderEditProduct");
    productSelect.innerHTML = App.products.map(p =>
      `<option value="${p.id}">${App.escapeHTML(p.name)} · ${App.escapeHTML(p.variant)}</option>`
    ).join("");
    productSelect.value = o.productId;

    productSelect.disabled = !canProduct;
    form.elements.quantity.disabled = !canProduct;

    document.getElementById("orderEditRestriction").innerHTML = canProduct
      ? `<b>Edición completa habilitada</b><span>Como administrador puedes cambiar producto y cantidad porque el pedido todavía no inició despacho. El sistema recalculará la reserva.</span>`
      : `<b>Edición limitada</b><span>Producto y cantidad están bloqueados en este estado. Puedes actualizar datos de entrega, pago, envío y observaciones.</span>`;

    document.getElementById("orderEditTitle").textContent = `Editar ${o.id}`;
    document.getElementById("orderEditModal").classList.remove("hidden");
  },

  async saveOrderEdit(e) {
    e.preventDefault();
    const form = e.currentTarget;
    const id = form.elements.orderId.value;
    const o = App.getOrder(id);
    if (!o) return;

    const allowProductChange = App.state.role === "admin"
      && ["confirmed", "supplier_pending"].includes(o.status);

    const changes = {
      customer: {
        phone: form.elements.phone.value,
        documentId: form.elements.documentId.value,
        name: form.elements.name.value,
        department: form.elements.department.value,
        city: form.elements.city.value,
        address: form.elements.address.value,
        neighborhood: form.elements.neighborhood.value,
        reference: form.elements.reference.value
      },
      productId: allowProductChange ? form.elements.productId.value : o.productId,
      quantity: allowProductChange ? Number(form.elements.quantity.value) : o.quantity,
      shipping: Number(form.elements.shipping.value),
      payment: form.elements.payment.value,
      source: form.elements.source.value,
      notes: form.elements.notes.value
    };

    try {
      await FirebaseService.editOrder(id, changes, App.actor(), allowProductChange);
      document.getElementById("orderEditModal").classList.add("hidden");
      document.getElementById("orderModal").classList.add("hidden");
      App.toast("Pedido actualizado.");
    } catch (error) {
      console.error(error);
      App.toast(App.firebaseMessage(error));
    }
  },

  async cancelOrder(id) {
    const o = App.getOrder(id);
    if (!this.canCancelOrder(o)) return;

    const reason = prompt("Motivo de cancelación (opcional):", "") ?? null;
    if (reason === null) return;
    if (!confirm(`¿Confirmas cancelar ${id}?`)) return;

    try {
      await FirebaseService.cancelOrder(id, App.actor(), reason);
      document.getElementById("orderModal").classList.add("hidden");
      App.toast("Pedido cancelado y reserva liberada cuando correspondía.");
    } catch (error) {
      console.error(error);
      App.toast(App.firebaseMessage(error));
    }
  }
};

// ============================================================
// OVERRIDES DE RENDER
// ============================================================

App.renderInventory = function() {
  const el = document.getElementById("inventoryList");
  if (!el) return;

  if (!this.products.length) {
    el.innerHTML = `<div class="empty-state"><b>No hay productos</b><span>${this.state.role==="admin"?"Inicializa la base desde Inicio.":"No hay catálogo disponible."}</span></div>`;
    return;
  }

  el.innerHTML = `
    <div class="table-scroll">
      <table class="data-table">
        <thead>
          <tr>
            <th>Producto</th><th>SKU</th><th>Stock propio</th><th>Reservado</th>
            <th>Disponible</th><th>Proveedor</th><th>Stock proveedor</th><th>Reservado proveedor</th><th>Disponible proveedor</th>
            ${this.state.role==="admin" ? "<th>Acciones</th>" : ""}
          </tr>
        </thead>
        <tbody>
          ${this.products.map(p => {
            const supplier = this.getSupplier(p.supplierId);
            return `<tr>
              <td><b>${App.escapeHTML(p.name)}</b><br><span class="muted">${App.escapeHTML(p.variant)}</span></td>
              <td>${App.escapeHTML(p.sku)}</td>
              <td>${p.ownStock}</td>
              <td>${p.reserved}</td>
              <td><b>${Math.max(0,p.ownStock-p.reserved)}</b></td>
              <td>${App.escapeHTML(supplier?.name || "Sin proveedor")}</td>
              <td><b>${p.supplierStock}</b></td>
              <td>${p.supplierReserved || 0}</td>
              <td><b>${Math.max(0, p.supplierStock - (p.supplierReserved || 0))}</b></td>
              ${this.state.role==="admin" ? `<td><div class="inventory-actions">
                <button class="btn btn-secondary btn-sm" onclick="Management.openProductModal('${p.id}')">Editar</button>
                <button class="btn btn-secondary btn-sm" onclick="Management.openStockModal('${p.id}')">+ / − Proveedor</button>
              </div></td>` : ""}
            </tr>`;
          }).join("")}
        </tbody>
      </table>
    </div>`;
};

App.renderSuppliers = function() {
  const el = document.getElementById("supplierList");
  if (!el) return;

  if (!this.suppliers.length) {
    el.innerHTML = `<div class="empty-state"><b>No hay proveedores</b><span>${this.state.role==="admin"?"Crea el primer proveedor con el botón superior.":"Aún no hay proveedores registrados."}</span></div>`;
    return;
  }

  el.innerHTML = this.suppliers.map(s => {
    const orders = this.orders.filter(o=>o.supplierId===s.id);
    const pending = orders.filter(o=>!["delivered","cancelled","returned"].includes(o.status)).length;
    const pcount = this.products.filter(p=>p.supplierId===s.id).length;

    return `<article class="supplier-card">
      <div>
        <b>${App.escapeHTML(s.name)}</b>
        <span>${App.escapeHTML(s.phone || "Sin contacto")} · ${App.escapeHTML(s.model || "Sin modelo")} · ${App.escapeHTML(s.settlement || "Sin liquidación")}</span>
      </div>
      <div><b>${pcount}</b><span>Productos</span></div>
      <div><b>${pending}</b><span>Pedidos pendientes</span></div>
      ${this.state.role==="admin" ? `<div class="action-group">
        <button class="btn btn-secondary btn-sm" onclick="Management.openSupplierModal('${s.id}')">Editar</button>
        <button class="btn btn-danger btn-sm" onclick="Management.deleteSupplier('${s.id}')">Eliminar</button>
      </div>` : ""}
    </article>`;
  }).join("");
};

App.renderSystemUsers = function() {
  const list = document.getElementById("systemUsersList");
  const summary = document.getElementById("userRoleSummary");
  if (!list || !summary || this.state.role !== "admin") return;

  const users = this.systemUsers.slice().sort((a,b) =>
    String(a.nombre || a.email || "").localeCompare(String(b.nombre || b.email || ""), "es")
  );

  const countRole = role => users.filter(u => u.rol === role && u.activo !== false).length;
  const roleLabels = {
    admin: "Administrador",
    vendedor: "Vendedor",
    despacho: "Despacho",
    contabilidad: "Contabilidad"
  };

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
    <div class="table-scroll">
      <table class="data-table">
        <thead><tr><th>Usuario</th><th>Rol</th><th>Estado</th><th>Acciones</th></tr></thead>
        <tbody>
          ${users.map(u => {
            const protectedAdmin = u.id === this.currentUser?.uid || u.esAdministradorInicial;
            return `<tr>
              <td><div class="user-row-main"><b>${App.escapeHTML(u.nombre || "Sin nombre")}</b><span>${App.escapeHTML(u.email || "-")}</span></div></td>
              <td><span class="role-badge ${u.rol==="admin"?"admin":""}">${roleLabels[u.rol] || u.rol || "-"}</span></td>
              <td><span class="status ${u.activo===false?"status-cancelled":"status-delivered"}">${u.activo===false?"Inactivo":"Activo"}</span></td>
              <td><div class="action-group">
                <button class="btn btn-secondary btn-sm" onclick="Management.openUserEdit('${u.id}')">Editar</button>
                <button class="btn btn-secondary btn-sm" onclick="Management.openCredentials('${u.id}')">Credenciales</button>
                <button class="btn btn-secondary btn-sm" onclick="Management.sendReset('${u.email || ""}')">Recuperar contraseña</button>
                ${protectedAdmin ? "" : `<button class="btn btn-danger btn-sm" onclick="Management.disableUser('${u.id}')">Eliminar acceso</button>`}
              </div></td>
            </tr>`;
          }).join("")}
        </tbody>
      </table>
    </div>`;
};

// Pedidos: filtro cancelado
const originalFilteredOrders = Orders.filteredOrders.bind(Orders);
Orders.filteredOrders = function() {
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
    return [o.id,o.customer?.name,o.customer?.phone,o.customer?.city,p?.name,o.status]
      .join(" ").toLowerCase().includes(q);
  }).sort((a,b)=>App.toDate(b.createdAt||b.createdAtClient)-App.toDate(a.createdAt||a.createdAtClient));
};

// Tabla de pedidos: cualquier fila se puede seleccionar/abrir
Orders.renderOrderContainer = function(id, orders) {
  const el = document.getElementById(id);
  if (!el) return;

  if (!orders.length) {
    el.innerHTML = `<div class="empty-state"><b>No hay pedidos</b><span>No encontramos registros con este filtro.</span></div>`;
    return;
  }

  el.innerHTML = `
    <div class="table-scroll">
      <table class="data-table">
        <thead><tr><th>Pedido</th><th>Cliente</th><th>Producto</th><th>Total</th><th>Origen</th><th>Estado</th><th></th></tr></thead>
        <tbody>${orders.map(o=>{
          const p=App.getProduct(o.productId);
          return `<tr class="row-clickable" onclick="Orders.openOrder('${o.id}')">
            <td><b>${o.id}</b><br><span class="muted">${App.dateTime(o.createdAt||o.createdAtClient)}</span></td>
            <td><b>${App.escapeHTML(o.customer?.name||"-")}</b><br><span class="muted">${App.escapeHTML(o.customer?.city||"-")} · ${App.escapeHTML(o.customer?.phone||"-")}</span></td>
            <td>${App.escapeHTML(p?.name||"-")}<br><span class="muted">${App.escapeHTML(p?.variant||"")} · x${o.quantity}</span></td>
            <td><b>${App.money(o.total)}</b><br><span class="muted">${o.payment==="cod"?"Contraentrega":"Pagado"}</span></td>
            <td>${o.fulfillment==="own"?"🏠 Bodega":"🏭 Proveedor"}</td>
            <td><span class="status status-${o.status}">${App.statusLabels[o.status]||o.status}</span></td>
            <td><button class="btn btn-secondary btn-sm" onclick="event.stopPropagation();Orders.openOrder('${o.id}')">Ver</button></td>
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
};

// Modal completo de pedido
Management.openOrderDetails = function(id) {
  const o = App.getOrder(id);
  if (!o) { App.toast("El pedido todavía se está sincronizando."); return; }

  const p = App.getProduct(o.productId);
  const supplier = App.getSupplier(o.supplierId);
  const esc = value => App.escapeHTML(value ?? "");
  const collect = o.payment === "cod" ? Number(o.total || 0) : 0;
  const collectionText = o.payment === "transfer"
    ? "Pago previo confirmado"
    : (o.collected ? `Recaudado${o.collectedAmount ? ` · ${App.money(o.collectedAmount)}` : ""}` : "Pendiente de recaudo");

  document.getElementById("modalOrderTitle").textContent = o.id;
  let bodyHTML = `
    <div class="order-status-banner">
      <div><b>${esc(App.statusLabels[o.status] || o.status)}</b><span>${App.dateTime(o.createdAt||o.createdAtClient)} · Vendedor: ${esc(o.seller || "-")}</span></div>
      <span class="status status-${esc(o.status)}">${o.fulfillment === "own" ? "Bodega propia" : "Proveedor"}</span>
    </div>
    <div class="detail-grid">
      <div class="detail-box"><small>Destinatario</small><b>${esc(o.customer?.name||"-")}</b><span>${esc(o.customer?.phone||"-")}${o.customer?.documentId ? ` · C.C. ${esc(o.customer.documentId)}` : ""}</span></div>
      <div class="detail-box"><small>Destino</small><b>${esc(o.customer?.city||"-")} - ${esc(o.customer?.department||"-")}</b><span>${esc(o.customer?.address||"-")}</span></div>
      <div class="detail-box"><small>Barrio / referencia</small><b>${esc(o.customer?.neighborhood||"-")}</b><span>${esc(o.customer?.reference||"-")}</span></div>
      <div class="detail-box"><small>Producto</small><b>${esc(p?.name||"-")}</b><span>${esc(p?.variant||"")} · x${Number(o.quantity||1)}</span></div>
      <div class="detail-box"><small>Subtotal producto</small><b>${App.money(Number(o.unitPrice||0)*Number(o.quantity||1))}</b><span>Envío: ${App.money(o.shipping||0)}</span></div>
      <div class="detail-box"><small>Total</small><b>${App.money(o.total)}</b><span>${o.payment === "cod" ? `Cobrar ${App.money(collect)}` : "PAGADO · No cobrar"}</span></div>
      <div class="detail-box"><small>Recaudo</small><b>${esc(collectionText)}</b><span>${o.collectionReference ? `Referencia: ${esc(o.collectionReference)}` : ""}</span></div>
      <div class="detail-box"><small>Fuente / vendedor</small><b>${esc(o.source||"-")}</b><span>${esc(o.seller||"-")}</span></div>
      <div class="detail-box"><small>Origen de despacho</small><b>${o.fulfillment === "own" ? "Bodega propia" : esc(supplier?.name||"Proveedor")}</b><span>${o.supplierOrderId ? `Orden proveedor: ${esc(o.supplierOrderId)}` : "Sin orden proveedor"}</span></div>
      <div class="detail-box"><small>Transportadora / guía</small><b>${esc(o.guide||"Sin guía")}</b><span>${o.status === "transit" ? "En tránsito" : ""}</span></div>
      <div class="detail-box"><small>Observaciones</small><b>${esc(o.notes||"Sin observaciones")}</b><span>${o.cancellationReason ? `Cancelación: ${esc(o.cancellationReason)}` : ""}</span></div>
    </div>
    <div class="timeline">
      <b>Historial del pedido</b>
      ${(o.timeline||[]).slice().reverse().map(t=>`<div class="timeline-item"><span class="timeline-dot"></span><span class="timeline-copy"><b>${esc(t.label)}</b><span>${App.dateTime(t.at)} · ${esc(t.user)}</span></span></div>`).join("")}
    </div>`;

  if (["admin","finance"].includes(App.state.role) && window.Pricing?.orderAccounting) {
    const a = Pricing.orderAccounting(o);
    bodyHTML += `<section class="accounting-breakdown"><div class="panel-head panel-head--compact"><div><h3>Desglose contable</h3><p>Información interna. No visible para vendedores.</p></div></div><div class="accounting-grid">
      <div><span>Venta producto</span><b>${App.money(a.productRevenue)}</b></div><div><span>Envío cobrado</span><b>${App.money(a.shipping)}</b></div>
      <div><span>Descuento</span><b>${a.discountAmount ? `-${App.money(a.discountAmount)}` : App.money(0)}</b></div><div><span>Cliente paga</span><b>${App.money(a.customerPays)}</b></div>
      <div><span>Costo producto</span><b>-${App.money(a.productCost)}</b></div>
      <div><span>Comisión asesor</span><b>-${App.money(a.advisorCommission)}</b></div><div><span>Persona despacho</span><b>-${App.money(a.dispatchFee)}</b></div>
      <div><span>Fee transportadora</span><b>-${App.money(a.carrierFee)}</b></div><div><span>Publicidad</span><b>-${App.money(a.advertisingCost)}</b></div>
      <div class="accounting-net"><span>Utilidad empresa</span><b class="${a.companyNet>=0?"fin-positive":"fin-negative"}">${App.money(a.companyNet)}</b></div><div><span>Margen</span><b>${a.margin.toFixed(1)}%</b></div>
    </div></section>`;
  }

  document.getElementById("orderModalBody").innerHTML = bodyHTML;
  const actions = [];
  if (["admin","dispatch"].includes(App.state.role)) {
    actions.push(`<button class="btn btn-secondary" onclick="Dispatch.printOrders(['${o.id}'])">Imprimir etiqueta</button>`);
  }
  if (Management.canEditOrder(o)) actions.push(`<button class="btn btn-secondary" onclick="Management.openOrderEdit('${o.id}')">Editar</button>`);
  if (Management.canCancelOrder(o)) actions.push(`<button class="btn btn-danger" onclick="Management.cancelOrder('${o.id}')">Cancelar pedido</button>`);
  if (["admin","dispatch"].includes(App.state.role)) {
    if(o.fulfillment === "own" && o.status === "confirmed") actions.push(`<button class="btn btn-primary" onclick="Dispatch.advanceOwn('${o.id}')">Preparar</button>`);
    if(o.fulfillment === "own" && o.status === "preparing") actions.push(`<button class="btn btn-primary" onclick="Dispatch.advanceOwn('${o.id}')">Marcar empacado</button>`);
    if(o.fulfillment === "own" && o.status === "packed") actions.push(`<button class="btn btn-primary" onclick="Dispatch.advanceOwn('${o.id}')">Despachar</button>`);
    if(o.fulfillment === "supplier" && o.status === "supplier_pending") actions.push(`<button class="btn btn-primary" onclick="Dispatch.loadSupplier('${o.id}')">Cargar proveedor</button>`);
    if(o.fulfillment === "supplier" && o.status === "supplier_loaded") actions.push(`<button class="btn btn-primary" onclick="Dispatch.setSupplierGuide('${o.id}')">Registrar guía</button>`);
    if(["shipped","transit"].includes(o.status)) actions.push(`<button class="btn btn-success" onclick="Dispatch.markDelivered('${o.id}')">Marcar entregado</button>`);
  }
  if (["admin","finance"].includes(App.state.role) && o.status === "delivered" && o.payment === "cod" && !o.collected) {
    actions.push(`<button class="btn btn-success" onclick="Finance.collectOrder('${o.id}')">Marcar recaudado</button>`);
  }
  document.getElementById("orderModalActions").innerHTML = actions.join("");
  document.getElementById("orderModal").classList.remove("hidden");
};

// Finanzas: pestañas Ventas / Gastos / Ganancia


document.addEventListener("DOMContentLoaded", () => Management.init());
