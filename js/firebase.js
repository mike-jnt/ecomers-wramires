window.FirebaseReady = (async () => {
  const VERSION = "12.18.0";
  const BASE = `https://www.gstatic.com/firebasejs/${VERSION}`;

  const [
    appSdk,
    authSdk,
    firestoreSdk
  ] = await Promise.all([
    import(`${BASE}/firebase-app.js`),
    import(`${BASE}/firebase-auth.js`),
    import(`${BASE}/firebase-firestore.js`)
  ]);

  const firebaseConfig = {
    apiKey: "AIzaSyCdS8p7JFTIplC_8AXj9jAr5D5i_82aayE",
    authDomain: "ecomers-etech.firebaseapp.com",
    projectId: "ecomers-etech",
    storageBucket: "ecomers-etech.firebasestorage.app",
    messagingSenderId: "90466746826",
    appId: "1:90466746826:web:4da00f27ec9b8e0fd54f33",
    measurementId: "G-3PF78WFMBX"
  };

  const app = appSdk.initializeApp(firebaseConfig);
  const auth = authSdk.getAuth(app);
  const db = firestoreSdk.getFirestore(app);

  const {
    collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, onSnapshot,
    runTransaction, writeBatch, serverTimestamp, query, where
  } = firestoreSdk;

  function mapSnapshot(snapshot) {
    return snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
  }

  async function getUserProfile(uid) {
    const snap = await getDoc(doc(db, "usuariosSistema", uid));
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
  }

  function subscribeCollection(name, callback, onError) {
    return onSnapshot(
      collection(db, name),
      snap => callback(mapSnapshot(snap)),
      err => {
        console.error(`Firestore ${name}:`, err);
        if (onError) onError(err);
      }
    );
  }

  async function createOrder(baseOrder, actor) {
    const productRef = doc(db, "productos", baseOrder.productId);
    const counterRef = doc(db, "configuracion", "contadores");

    return runTransaction(db, async transaction => {
      const productSnap = await transaction.get(productRef);
      if (!productSnap.exists()) throw new Error("El producto ya no existe.");

      const counterSnap = await transaction.get(counterRef);
      if (!counterSnap.exists()) {
        throw new Error("Falta inicializar configuracion/contadores. Ingresa como administrador e inicializa la base.");
      }

      const product = productSnap.data();
      const quantity = Number(baseOrder.quantity || 1);
      const stockOwn = Number(product.stockPropio || 0);
      const reserved = Number(product.reservado || 0);
      const supplierStock = Number(product.stockProveedor || 0);
      const availableOwn = Math.max(0, stockOwn - reserved);
      const fulfillment = availableOwn >= quantity ? "own" : "supplier";

      if (fulfillment === "supplier" && supplierStock < quantity) {
        throw new Error("No existe disponibilidad suficiente en inventario propio ni proveedor.");
      }

      const next = Number(counterSnap.data().pedidoConsecutivo || 0) + 1;
      const orderId = `PED-${String(next).padStart(6, "0")}`;
      const orderRef = doc(db, "pedidos", orderId);
      const nowIso = new Date().toISOString();

      const order = {
        ...baseOrder,
        id: orderId,
        consecutivo: next,
        sellerUid: actor.uid,
        seller: actor.name,
        fulfillment,
        supplierId: fulfillment === "supplier" ? (product.proveedorId || null) : null,
        supplierOrderId: null,
        guide: null,
        status: fulfillment === "own" ? "confirmed" : "supplier_pending",
        collected: baseOrder.payment === "transfer",
        createdAt: serverTimestamp(),
        createdAtClient: nowIso,
        updatedAt: serverTimestamp(),
        timeline: [{
          at: nowIso,
          label: "Pedido confirmado",
          user: actor.name,
          uid: actor.uid
        }]
      };

      transaction.set(orderRef, order);
      transaction.update(counterRef, {
        pedidoConsecutivo: next,
        updatedAt: serverTimestamp()
      });

      if (fulfillment === "own") {
        transaction.update(productRef, {
          reservado: reserved + quantity,
          updatedAt: serverTimestamp()
        });
      }

      return { id: orderId, fulfillment };
    });
  }

  async function appendTimelineUpdate(orderId, patch, timelineItem) {
    const orderRef = doc(db, "pedidos", orderId);
    return runTransaction(db, async transaction => {
      const snap = await transaction.get(orderRef);
      if (!snap.exists()) throw new Error("Pedido no encontrado.");
      const data = snap.data();
      transaction.update(orderRef, {
        ...patch,
        timeline: [...(data.timeline || []), timelineItem],
        updatedAt: serverTimestamp()
      });
    });
  }

  async function advanceOwnOrder(orderId, actor, guide = null) {
    const orderRef = doc(db, "pedidos", orderId);

    return runTransaction(db, async transaction => {
      const orderSnap = await transaction.get(orderRef);
      if (!orderSnap.exists()) throw new Error("Pedido no encontrado.");
      const order = orderSnap.data();

      if (order.fulfillment !== "own") throw new Error("Este pedido no corresponde a inventario propio.");

      const nowIso = new Date().toISOString();
      let nextStatus = order.status;
      let label = "";

      if (order.status === "confirmed") {
        nextStatus = "preparing";
        label = "Preparación iniciada";
      } else if (order.status === "preparing") {
        nextStatus = "packed";
        label = "Pedido empacado";
      } else if (order.status === "packed") {
        nextStatus = "transit";
        label = `Despachado · ${guide || "sin guía"}`;

        const productRef = doc(db, "productos", order.productId);
        const productSnap = await transaction.get(productRef);
        if (!productSnap.exists()) throw new Error("Producto no encontrado.");

        const product = productSnap.data();
        const quantity = Number(order.quantity || 1);
        transaction.update(productRef, {
          stockPropio: Math.max(0, Number(product.stockPropio || 0) - quantity),
          reservado: Math.max(0, Number(product.reservado || 0) - quantity),
          updatedAt: serverTimestamp()
        });
      } else {
        throw new Error("El pedido no puede avanzar desde su estado actual.");
      }

      transaction.update(orderRef, {
        status: nextStatus,
        ...(guide ? { guide } : {}),
        timeline: [...(order.timeline || []), {
          at: nowIso, label, user: actor.name, uid: actor.uid
        }],
        updatedAt: serverTimestamp()
      });

      return nextStatus;
    });
  }

  async function loadSupplierOrder(orderId, supplierOrderId, actor) {
    return appendTimelineUpdate(orderId, {
      supplierOrderId,
      status: "supplier_loaded"
    }, {
      at: new Date().toISOString(),
      label: `Cargado al proveedor · ${supplierOrderId}`,
      user: actor.name,
      uid: actor.uid
    });
  }

  async function setSupplierGuide(orderId, guide, actor) {
    return appendTimelineUpdate(orderId, {
      guide,
      status: "transit"
    }, {
      at: new Date().toISOString(),
      label: `Proveedor despachó · ${guide}`,
      user: actor.name,
      uid: actor.uid
    });
  }

  async function markDelivered(orderId, actor) {
    const orderRef = doc(db, "pedidos", orderId);
    return runTransaction(db, async transaction => {
      const snap = await transaction.get(orderRef);
      if (!snap.exists()) throw new Error("Pedido no encontrado.");
      const order = snap.data();
      transaction.update(orderRef, {
        status: "delivered",
        collected: order.payment === "transfer" ? true : Boolean(order.collected),
        timeline: [...(order.timeline || []), {
          at: new Date().toISOString(),
          label: "Pedido entregado",
          user: actor.name,
          uid: actor.uid
        }],
        updatedAt: serverTimestamp()
      });
    });
  }

  async function addExpense(expense, actor) {
    return addDoc(collection(db, "gastos"), {
      ...expense,
      createdBy: actor.uid,
      createdByName: actor.name,
      date: serverTimestamp(),
      dateClient: new Date().toISOString()
    });
  }

  async function seedDemoData() {
    const productSnap = await getDocs(collection(db, "productos"));
    if (!productSnap.empty) return { skipped: true };

    const batch = writeBatch(db);

    (window.NEXO_DATA?.products || []).forEach(p => {
      batch.set(doc(db, "productos", p.id), {
        sku: p.sku,
        nombre: p.name,
        variante: p.variant,
        precio: p.price,
        stockPropio: p.ownStock,
        reservado: p.reserved,
        costoPropio: p.ownCost,
        proveedorId: p.supplierId,
        stockProveedor: p.supplierStock,
        costoProveedor: p.supplierCost,
        activo: true,
        createdAt: serverTimestamp()
      });
    });

    (window.NEXO_DATA?.suppliers || []).forEach(s => {
      batch.set(doc(db, "proveedores", s.id), {
        nombre: s.name,
        telefono: s.phone,
        modelo: s.model,
        liquidacion: s.settlement,
        activo: true,
        createdAt: serverTimestamp()
      });
    });

    batch.set(doc(db, "configuracion", "contadores"), {
      pedidoConsecutivo: 0,
      updatedAt: serverTimestamp()
    }, { merge: true });

    await batch.commit();
    return { skipped: false };
  }

  window.FirebaseService = {
    app,
    auth,
    db,

    onAuthStateChanged: callback => authSdk.onAuthStateChanged(auth, callback),
    login: (email, password) => authSdk.signInWithEmailAndPassword(auth, email, password),
    logout: () => authSdk.signOut(auth),
    resetPassword: email => authSdk.sendPasswordResetEmail(auth, email),

    getUserProfile,
    subscribeCollection,
    createOrder,
    advanceOwnOrder,
    loadSupplierOrder,
    setSupplierGuide,
    markDelivered,
    addExpense,
    seedDemoData
  };

  return window.FirebaseService;
})();
