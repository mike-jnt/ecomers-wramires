const MigrationCenter = window.MigrationCenter = {
  running: false,
  lastStatus: null,

  init() {
    const modal = document.getElementById("migrationModal");
    if (!modal) return;

    document.addEventListener("keydown", e => {
      if (
        App.state.role === "admin" &&
        e.ctrlKey &&
        !e.altKey &&
        !e.shiftKey &&
        String(e.key || "").toLowerCase() === "k"
      ) {
        e.preventDefault();
        e.stopPropagation();
        this.open();
      }
    }, true);

    document.querySelectorAll("[data-close-migration]").forEach(btn => {
      btn.addEventListener("click", () => this.close());
    });

    modal.addEventListener("click", e => {
      if (e.target === modal && !this.running) this.close();
    });

    document.getElementById("reanalyzeMigrationBtn")?.addEventListener("click", () => this.analyze());
    document.getElementById("runMigrationBtn")?.addEventListener("click", () => this.run());
  },

  async open() {
    if (App.state.role !== "admin") return;

    document.getElementById("migrationModal").classList.remove("hidden");
    await this.analyze();
  },

  close() {
    if (this.running) return;
    document.getElementById("migrationModal")?.classList.add("hidden");
  },

  countRow(label, value, important = false) {
    const count = Number(value || 0);
    return `
      <div class="migration-check-row ${important && count ? "migration-check-row--attention" : ""}">
        <span>${App.escapeHtml ? App.escapeHtml(label) : label}</span>
        <b>${count}</b>
      </div>`;
  },

  async analyze() {
    if (this.running || App.state.role !== "admin") return;

    const card = document.getElementById("migrationStatusCard");
    const checks = document.getElementById("migrationChecks");
    const runBtn = document.getElementById("runMigrationBtn");

    card.className = "migration-status-card";
    card.innerHTML = '<span class="loading-inline">Analizando estructura del sistema</span>';
    checks.innerHTML = "";
    runBtn.disabled = true;

    try {
      const status = await FirebaseService.detectSystemMigration();
      this.lastStatus = status;

      document.getElementById("migrationCurrentVersion").textContent = status.currentSchemaVersion;
      document.getElementById("migrationTargetVersion").textContent = status.targetSchemaVersion;

      if (status.pending) {
        card.classList.add("migration-status-card--attention");
        card.innerHTML = `
          <b>Migración disponible</b>
          <span>Se detectaron ${status.dataPending} cambio(s) de datos${status.versionPending ? " y una versión de esquema pendiente" : ""}.</span>
        `;
        runBtn.disabled = false;
      } else {
        card.classList.add("migration-status-card--ok");
        card.innerHTML = `
          <b>Sistema actualizado</b>
          <span>No se detectaron IDs antiguos ni cambios estructurales pendientes.</span>
        `;
      }

      const c = status.counts || {};
      checks.innerHTML = [
        this.countRow("Productos con ID heredado", c.legacyProductIds, true),
        this.countRow("Productos con costos aún públicos", c.privateProducts, true),
        this.countRow("Productos pendientes de marca segura", c.unsafeProducts, true),
        this.countRow("Pedidos con estructura financiera antigua", c.legacyOrderPricing, true),
        this.countRow("Pedidos sin clave privada de vendedor", c.missingSellerAccess, true),
        this.countRow("Pedidos con referencia antigua de producto", c.staleOrderProductIds, true),
        this.countRow("Pedidos cuyo productId es un ID contable", c.pricingIdAsProductId, true)
      ].join("");
    } catch (error) {
      console.error("Análisis de migración:", error);
      card.classList.add("migration-status-card--error");
      card.innerHTML = `<b>No se pudo analizar</b><span>${App.escapeHtml ? App.escapeHtml(App.firebaseMessage(error)) : App.firebaseMessage(error)}</span>`;
    }
  },

  async run() {
    if (this.running || App.state.role !== "admin") return;

    const status = this.lastStatus || await FirebaseService.detectSystemMigration();
    if (!status.pending) {
      App.toast("El sistema ya está actualizado.");
      return this.analyze();
    }

    const ok = confirm(
      `Se migrará la estructura desde ${status.currentSchemaVersion} a ${status.targetSchemaVersion}.\n\n` +
      `Cambios detectados: ${status.dataPending}.\n\n` +
      "La operación no elimina pedidos, ventas ni inventario. ¿Continuar?"
    );
    if (!ok) return;

    this.running = true;
    const progress = document.getElementById("migrationProgress");
    const runBtn = document.getElementById("runMigrationBtn");
    const analyzeBtn = document.getElementById("reanalyzeMigrationBtn");

    progress.classList.remove("hidden");
    runBtn.disabled = true;
    analyzeBtn.disabled = true;
    runBtn.textContent = "Migrando…";

    try {
      const result = await FirebaseService.runSystemMigration(App.actor());
      const m = result.migration || {};

      App.toast(
        `Migración completada: ${Number(m.migratedProducts || 0)} producto(s), ` +
        `${Number(m.migratedOrders || 0)} pedido(s) y ` +
        `${Number(m.canonicalizedProducts || 0)} ID(s) normalizado(s).`
      );

      // El análisis se ejecuta después de liberar this.running.

      // Refrescar listeners para que la UI reciba los IDs/estructura ya migrados.
      App.startDataSync();
    } catch (error) {
      console.error("Migración del sistema:", error);
      App.toast(App.firebaseMessage(error));
    } finally {
      this.running = false;
      await this.analyze();
      progress.classList.add("hidden");
      runBtn.textContent = "Migrar ahora";
      analyzeBtn.disabled = false;
    }
  }
};

document.addEventListener("DOMContentLoaded", () => MigrationCenter.init());
