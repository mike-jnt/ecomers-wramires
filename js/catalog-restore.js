/* NEXO V15.10: restauración selectiva del catálogo. No importa historial ni usuarios. */
const CatalogRestore = window.CatalogRestore = {
  plan: null,
  running: false,
  MAX_FILE_BYTES: 20 * 1024 * 1024,
  MAX_ITEMS: 8000,

  isAdmin() {
    return App.state.role === "admin" && !!App.currentUser?.uid && App.profile?.activo === true;
  },
  init() {
    const input = document.getElementById("catalogRestoreFile");
    const button = document.getElementById("applyCatalogRestoreBtn");
    input?.addEventListener("change", () => this.loadFile(input.files?.[0]));
    button?.addEventListener("click", () => this.apply());
    document.getElementById("catalogRestoreConfirm")?.addEventListener("change", () => this.refreshButton());
    this.clear();
  },
  clear() {
    if (this.running) return;
    this.plan = null;
    const input = document.getElementById("catalogRestoreFile");
    if (input) input.value = "";
    const checkbox = document.getElementById("catalogRestoreConfirm");
    if (checkbox) checkbox.checked = false;
    this.message("Selecciona un respaldo JSON generado por NEXO para revisar qué se recuperará.", false);
    document.getElementById("catalogRestoreProgress")?.classList.add("hidden");
    this.refreshButton();
  },
  message(value, isError = false) {
    const node = document.getElementById("catalogRestorePreview");
    if (!node) return;
    node.textContent = value;
    node.classList.toggle("catalog-restore-preview--error", isError);
  },
  refreshButton() {
    const button = document.getElementById("applyCatalogRestoreBtn");
    if (button) button.disabled = !this.isAdmin() || !this.plan || this.running || SystemReset.running || !document.getElementById("catalogRestoreConfirm")?.checked;
  },
  safeText(value, max = 200) {
    return String(value ?? "").replace(/[<>]/g, "").replace(/[\u0000-\u001F\u007F]/g, " ").trim().slice(0, max);
  },
  id(value, label) {
    const id = String(value ?? "").trim();
    if (!id || id.length > 220 || id === "." || id === ".." || id.includes("/") || /[\u0000-\u001F\u007F]/.test(id) || /^__.*__$/.test(id)) {
      throw new Error(`Identificador no válido en ${label}.`);
    }
    return id;
  },
  money(value, label, maximum = 100000000000) {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > maximum) {
      throw new Error(`Valor numérico inválido: ${label}.`);
    }
    return value;
  },
  numberOrZero(value, label, maximum = 100000000000) {
    return this.money(value ?? 0, label, maximum);
  },
  stock(value, label) {
    const n = this.numberOrZero(value, label, 10000000);
    if (!Number.isInteger(n)) throw new Error(`El inventario de ${label} debe ser un entero.`);
    return n;
  },
  list(value) {
    return (Array.isArray(value) ? value : []).slice(0, 60)
      .map(v => this.safeText(v, 300)).filter(Boolean);
  },
  records(source, name, required = false) {
    const records = source[name];
    if (records === undefined && !required) return [];
    if (!Array.isArray(records)) throw new Error(`La colección ${name} no existe o no es una lista en el respaldo.`);
    if (records.length > this.MAX_ITEMS) throw new Error(`La colección ${name} supera el límite de seguridad (${this.MAX_ITEMS}).`);
    const seen = new Set();
    return records.map(raw => {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`Documento inválido en ${name}.`);
      const id = this.id(raw.id, name);
      if (seen.has(id)) throw new Error(`ID repetido en ${name}: ${id}.`);
      seen.add(id);
      return { ...raw, id };
    });
  },
  prepare(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw) || !raw.collections || typeof raw.collections !== "object" || Array.isArray(raw.collections)) {
      throw new Error("El JSON no corresponde al formato de respaldo de NEXO (collections).");
    }
    if (raw.projectId !== "ecomers-etech") {
      throw new Error("El respaldo no corresponde al proyecto Firebase ecomers-etech.");
    }
    const col = raw.collections;
    const suppliers = this.records(col, "proveedores", true).map(s => ({
      id: s.id,
      data: {
        nombre: this.safeText(s.nombre, 180),
        telefono: this.safeText(s.telefono, 80),
        modelo: this.safeText(s.modelo, 220),
        liquidacion: this.safeText(s.liquidacion, 180),
        activo: s.activo !== false,
        catalogoBase: s.catalogoBase === true
      }
    }));
    for (const s of suppliers) if (!s.data.nombre) throw new Error(`Proveedor sin nombre: ${s.id}.`);
    const versions = this.records(col, "preciosVersiones", true);
    const versionsById = new Map(versions.map(v => [v.id, v]));
    const sourceProducts = this.records(col, "productos", true);
    const products = [];
    const prices = [];
    const seenSku = new Set();
    const seenVersion = new Set();
    for (const p of sourceProducts) {
      const sku = this.safeText(p.sku, 60).toUpperCase();
      const nombre = this.safeText(p.nombre ?? p.name, 140);
      if (!nombre || !sku) throw new Error(`Producto ${p.id}: faltan nombre o SKU.`);
      if (seenSku.has(sku)) throw new Error(`SKU duplicado en el respaldo: ${sku}.`);
      seenSku.add(sku);
      const proveedorId = p.proveedorId ? this.id(p.proveedorId, `proveedor del producto ${sku}`) : null;
      const versionId = p.pricingVersionId ? this.id(p.pricingVersionId, `precio del producto ${sku}`) : null;
      if (!versionId) throw new Error(`El producto ${sku} no tiene versión de precio vinculada. Usa un respaldo completo V15.8/V15.9.`);
      const version = versionsById.get(versionId);
      if (!version) throw new Error(`Falta preciosVersiones/${versionId} del producto ${sku}.`);
      if (String(version.productId || "") !== p.id) throw new Error(`La versión ${versionId} apunta a otro producto.`);
      if (seenVersion.has(versionId)) throw new Error(`Dos productos comparten la misma versión activa ${versionId}.`);
      seenVersion.add(versionId);
      const precio = this.money(p.precio, `precio de venta ${sku}`);
      const stockPropio = this.stock(p.stockPropio, `stock propio ${sku}`);
      const stockProveedor = this.stock(p.stockProveedor, `stock proveedor ${sku}`);
      products.push({
        id: p.id,
        data: {
          sku, nombre, variante: this.safeText(p.variante, 180), precio,
          stockPropio, stockProveedor,
          // Nunca reconstruir reservas de pedidos que NO serán importados.
          reservado: 0, reservadoProveedor: 0,
          proveedorId, pricingVersionId: versionId,
          modeloPrecio: this.safeText(p.modeloPrecio || "standard", 80),
          envioPredeterminado: this.numberOrZero(p.envioPredeterminado, `envío ${sku}`),
          fuentePrecio: this.safeText(p.fuentePrecio || "Manual", 180),
          proveedorCatalogo: this.safeText(p.proveedorCatalogo || "", 180),
          descripcionComercial: this.safeText(p.descripcionComercial || "", 1200),
          funcionesComerciales: this.list(p.funcionesComerciales),
          beneficiosComerciales: this.list(p.beneficiosComerciales),
          usosComerciales: this.list(p.usosComerciales),
          validacionComercial: this.safeText(p.validacionComercial || "", 800),
          fichaComercialActiva: p.fichaComercialActiva !== false,
          sellerVisible: p.sellerVisible !== false,
          activo: p.activo !== false,
          ...(p.legacyId ? { legacyId: this.safeText(p.legacyId, 200) } : {})
        }
      });
      prices.push({
        id: versionId,
        data: {
          productId: p.id, versionId,
          costoPropio: this.numberOrZero(version.costoPropio, `costo propio ${sku}`),
          costoProveedor: this.numberOrZero(version.costoProveedor, `costo proveedor ${sku}`),
          despachoPorUnidad: this.numberOrZero(version.despachoPorUnidad, `despacho ${sku}`),
          comisionAsesorTipo: version.comisionAsesorTipo === "percent" ? "percent" : "fixed",
          comisionAsesorValor: this.numberOrZero(version.comisionAsesorValor, `comisión ${sku}`),
          feeTransportadoraPct: this.numberOrZero(version.feeTransportadoraPct, `transportadora ${sku}`, 100),
          publicidadPorVenta: this.numberOrZero(version.publicidadPorVenta, `publicidad ${sku}`),
          modeloPrecio: this.safeText(version.modeloPrecio || p.modeloPrecio || "standard", 80),
          fuentePrecio: this.safeText(version.fuentePrecio || p.fuentePrecio || "Manual", 180)
        }
      });
    }
    if (!suppliers.length && !products.length) throw new Error("No hay proveedores ni productos que recuperar en este JSON.");
    // El único descuento comercial admitido por esta versión es 8 %.
    // La regla y la interfaz lo conservan sin importar ventas ni configuraciones.
    return { projectId: raw.projectId, exportedAt: this.safeText(raw.exportedAt, 80), suppliers, products, prices, discountPercent: 8 };
  },
  async loadFile(file) {
    this.plan = null;
    this.refreshButton();
    if (!file) return this.message("Selecciona un respaldo JSON para continuar.");
    if (!this.isAdmin() || this.running || SystemReset.running) return this.message("Acceso exclusivo para administradores activos.", true);
    if (file.size > this.MAX_FILE_BYTES) return this.message("El archivo supera los 20 MB permitidos.", true);
    if (!file.name.toLowerCase().endsWith(".json")) return this.message("Selecciona un archivo con extensión .json.", true);
    try {
      const raw = JSON.parse(await file.text());
      this.plan = this.prepare(raw);
      const x = this.plan;
      this.message(`Archivo: ${file.name}\nProyecto: ${x.projectId}\n${x.suppliers.length} proveedores · ${x.products.length} productos con precio de venta e inventario · ${x.prices.length} versiones de precios/costos.\nDescuento permitido: 8 % (ya incluido en la aplicación).\nNO se importarán pedidos, ventas, gastos, usuarios, contadores ni auditorías.\nLas reservas antiguas quedarán en 0 y no se sobrescribirán documentos existentes.`);
    } catch (e) {
      this.plan = null;
      this.message(`No se puede usar este respaldo: ${e.message}`, true);
    }
    this.refreshButton();
  },
  async apply() {
    if (!this.isAdmin() || this.running || SystemReset.running || !this.plan || !document.getElementById("catalogRestoreConfirm")?.checked) return;
    const approved = confirm("RECUPERACIÓN SELECTIVA\n\nSolo se crearán proveedores, productos y sus versiones activas de precios que aún no existan. No se recuperará ningún pedido, gasto, usuario o movimiento histórico. Las reservas quedarán en cero.\n\n¿Confirmas la restauración?");
    if (!approved) return;
    this.running = true;
    this.refreshButton();
    const resetBtn = document.getElementById("confirmSystemResetBtn");
    if (resetBtn) resetBtn.disabled = true;
    document.querySelectorAll("[data-close-system-reset]").forEach(b => b.disabled = true);
    const progress = document.getElementById("catalogRestoreProgress");
    const progressText = document.getElementById("catalogRestoreProgressText");
    progress?.classList.remove("hidden");
    const update = message => { if (progressText) progressText.textContent = message; };
    try {
      update("Comprobando permisos y existencia de pedidos…");
      const result = await FirebaseService.restoreCatalogData(this.plan, App.actor(), update);
      this.message(`Restauración completada.\nProveedores creados: ${result.suppliersCreated}; productos creados: ${result.productsCreated}; versiones de precios creadas: ${result.pricesCreated}.\nDocumentos existentes conservados: ${result.existingSkipped}.\nNo se recuperó historial de ventas ni cuentas de usuario. El 8 % continúa disponible.`);
      this.plan = null;
      document.getElementById("catalogRestoreFile").value = "";
      document.getElementById("catalogRestoreConfirm").checked = false;
      App.toast("Catálogo recuperado correctamente, sin restaurar el historial de ventas.");
      App.refreshAll?.();
    } catch (error) {
      console.error("Restaurar catálogo:", error);
      this.message(`No se completó la restauración: ${error.message || App.firebaseMessage(error)}\nAlgunos documentos podrían haberse creado. Puedes revisar Firestore y repetir el mismo JSON: los documentos existentes se conservan.`, true);
      App.toast("Restauración incompleta: revisa los detalles y Firestore.");
    } finally {
      this.running = false;
      progress?.classList.add("hidden");
      document.querySelectorAll("[data-close-system-reset]").forEach(b => b.disabled = false);
      if (resetBtn) resetBtn.disabled = false;
      this.refreshButton();
    }
  }
};

document.addEventListener("DOMContentLoaded", () => CatalogRestore.init());
