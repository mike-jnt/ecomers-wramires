const SystemReset = window.SystemReset = {
  phrase: "REINICIAR SISTEMA",
  running: false,

  init() {
    const modal = document.getElementById("systemResetModal");
    const form = document.getElementById("systemResetForm");
    if (!modal || !form) return;

    document.addEventListener("keydown", e => {
      if (
        App.state.role === "admin" &&
        e.ctrlKey &&
        !e.altKey &&
        !e.shiftKey &&
        String(e.key || "").toLowerCase() === "l"
      ) {
        e.preventDefault();
        e.stopPropagation();
        this.open();
      }
    }, true);

    document.querySelectorAll("[data-close-system-reset]").forEach(btn => {
      btn.addEventListener("click", () => this.close());
    });

    modal.addEventListener("click", e => {
      if (e.target === modal && !this.running) this.close();
    });

    form.addEventListener("submit", e => this.submit(e));
  },

  open() {
    if (App.state.role !== "admin") return;

    const modal = document.getElementById("systemResetModal");
    const form = document.getElementById("systemResetForm");
    const progress = document.getElementById("systemResetProgress");
    const submit = document.getElementById("confirmSystemResetBtn");

    form.reset();
    progress.classList.add("hidden");
    submit.disabled = false;
    submit.textContent = "Eliminar todo y reiniciar";

    modal.classList.remove("hidden");
    setTimeout(() => document.getElementById("systemResetPhrase")?.focus(), 50);
  },

  close() {
    if (this.running) return;
    document.getElementById("systemResetModal")?.classList.add("hidden");
  },

  async submit(e) {
    e.preventDefault();
    if (this.running || App.state.role !== "admin") return;

    const phrase = String(document.getElementById("systemResetPhrase")?.value || "").trim();
    const acknowledged = Boolean(document.getElementById("systemResetAcknowledge")?.checked);

    if (phrase !== this.phrase) {
      App.toast(`Escribe exactamente: ${this.phrase}`);
      return;
    }

    if (!acknowledged) {
      App.toast("Debes confirmar que entiendes que el reinicio es irreversible.");
      return;
    }

    const finalConfirm = confirm(
      "ÚLTIMA CONFIRMACIÓN\n\n" +
      "Se eliminarán todos los pedidos, productos, inventario, proveedores, gastos y perfiles de usuarios no administradores.\n\n" +
      "El administrador actual se conservará.\n\n" +
      "¿Deseas continuar?"
    );

    if (!finalConfirm) return;

    this.running = true;

    const progress = document.getElementById("systemResetProgress");
    const submit = document.getElementById("confirmSystemResetBtn");
    progress.classList.remove("hidden");
    submit.disabled = true;
    submit.textContent = "Reiniciando…";

    try {
      const result = await FirebaseService.resetSystemData(App.actor());

      const total = Object.values(result).reduce((sum, value) => sum + Number(value || 0), 0);

      document.getElementById("systemResetModal").classList.add("hidden");
      App.state.orderFilter = "all";
      App.state.financeTab = "sales";
      App.go("dashboard");
      App.toast(`Sistema reiniciado. ${total} documento(s) eliminados. Puedes comenzar desde cero.`);
    } catch (error) {
      console.error("Reinicio total:", error);
      App.toast(App.firebaseMessage(error));
    } finally {
      this.running = false;
      progress.classList.add("hidden");
      submit.disabled = false;
      submit.textContent = "Eliminar todo y reiniciar";
    }
  }
};

document.addEventListener("DOMContentLoaded", () => SystemReset.init());
