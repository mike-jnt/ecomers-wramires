const SystemReset = window.SystemReset = {
  phrase: "REINICIAR SISTEMA",
  running: false,
  backupDownloaded: false,

  init() {
    const modal = document.getElementById("systemResetModal");
    const form = document.getElementById("systemResetForm");
    if (!modal || !form) return;

    document.getElementById("openSystemResetBtn")?.addEventListener("click", () => this.open());
    document.getElementById("downloadBackupBtn")?.addEventListener("click", () => this.downloadBackup());

    document.addEventListener("keydown", e => {
      if (
        App.state.role === "admin" &&
        e.ctrlKey &&
        !e.altKey &&
        !e.shiftKey &&
        !e.metaKey &&
        !e.repeat &&
        // Ctrl + M: nuevo atajo. Ctrl + L: compatibilidad con versiones anteriores.
        ["m", "l"].includes(String(e.key || "").toLowerCase())
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
    if (this.running || App.state.role !== "admin" || !App.currentUser?.uid || App.profile?.activo !== true) return;

    const modal = document.getElementById("systemResetModal");
    const form = document.getElementById("systemResetForm");
    const progress = document.getElementById("systemResetProgress");
    const submit = document.getElementById("confirmSystemResetBtn");

    form.reset();
    // El respaldo debe ser reciente y obtenido desde esta apertura del modal.
    this.backupDownloaded = false;
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

  async downloadBackup() {
    if (App.state.role !== "admin" || this.running || !App.currentUser?.uid) return;
    this.backupDownloaded = false;
    const button = document.getElementById("downloadBackupBtn");
    if (button) { button.disabled = true; button.textContent = "Preparando respaldo…"; }
    try {
      const backup = await FirebaseService.exportBackupData();
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type:"application/json;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const stamp = new Date().toISOString().replace(/[:.]/g,"-");
      link.href = url;
      link.download = `respaldo-etech-${stamp}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      this.backupDownloaded = true;
      App.toast("Respaldo JSON generado. Comprueba que el archivo esté guardado antes de reiniciar.");
    } catch (error) {
      console.error("Respaldo:", error);
      App.toast(App.firebaseMessage(error));
    } finally {
      if (button) { button.disabled = false; button.textContent = "Descargar respaldo JSON"; }
    }
  },

  async submit(e) {
    e.preventDefault();
    if (this.running || App.state.role !== "admin" || !App.currentUser?.uid || App.profile?.activo !== true) return;

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

    if (!this.backupDownloaded) {
      App.toast("Antes de reiniciar debes descargar el respaldo JSON desde esta misma sesión.");
      return;
    }

    const finalConfirm = confirm(
      "ÚLTIMA CONFIRMACIÓN\n\n" +
      "Se eliminarán todos los pedidos, productos, inventario, proveedores, gastos y perfiles de usuarios, excepto tu perfil de administrador actual.\n\n" +
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
      this.backupDownloaded = false;
      App.state.orderFilter = "all";
      App.state.financeTab = "sales";
      App.go("dashboard");
      App.toast(`Sistema reiniciado. ${total} documento(s) eliminados. Puedes comenzar desde cero.`);
    } catch (error) {
      console.error("Reinicio total:", error);
      App.toast("Reinicio no confirmado o incompleto. Revisa Firestore y tu respaldo antes de repetir. " + App.firebaseMessage(error));
    } finally {
      this.running = false;
      progress.classList.add("hidden");
      submit.disabled = false;
      submit.textContent = "Eliminar todo y reiniciar";
    }
  }
};

document.addEventListener("DOMContentLoaded", () => SystemReset.init());
