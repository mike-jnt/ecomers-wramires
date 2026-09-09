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
    collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc, onSnapshot,
    runTransaction, writeBatch, serverTimestamp
  } = firestoreSdk;

  function mapSnapshot(snapshot) {
    return snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
  }

  async function getUserProfile(uid) {
    const snap = await getDoc(doc(db, "usuariosSistema", uid));
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
  }

  /**
   * Bootstrap del primer administrador SIN Cloud Functions.
   *
   * Importante:
   * - Solo debe existir inicialmente la cuenta de Authentication que será admin.
   * - Firestore Rules exigen que usuariosSistema/{uid} y configuracion/seguridad
   *   se creen juntos en el mismo batch.
   * - Después de configuracion/seguridad, nadie más puede autoasignarse admin.
   */
  async function bootstrapAdminProfile(user) {
    if (!user?.uid) throw new Error("No existe una sesión autenticada.");

    const profileRef = doc(db, "usuariosSistema", user.uid);
    const securityRef = doc(db, "configuracion", "seguridad");

    const batch = writeBatch(db);

    batch.set(profileRef, {
      nombre: user.displayName || user.email?.split("@")[0] || "Administrador",
      email: user.email || "",
      rol: "admin",
      activo: true,
      esAdministradorInicial: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    batch.set(securityRef, {
      adminUid: user.uid,
      adminEmail: user.email || "",
      bootstrapCompletado: true,
      bootstrapAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    await batch.commit();

    return {
      created: true,
      alreadyAdmin: true,
      role: "admin"
    };
  }

  /**
   * Crear usuario sin cerrar la sesión del administrador.
   *
   * Se usa una segunda Firebase App/Auth independiente.
   * El usuario nuevo se crea en Authentication sobre esa instancia secundaria.
   * El perfil de Firestore se crea usando la instancia principal, donde sigue
   * autenticado el administrador.
   */
  async function createSystemUser(payload, actor) {
    const name = String(payload?.name || "").trim();
    const email = String(payload?.email || "").trim().toLowerCase();
    const password = String(payload?.password || "");
    const role = String(payload?.role || "").trim();

    const allowedRoles = new Set(["vendedor", "despacho", "contabilidad"]);

    if (!actor?.uid) throw new Error("No existe una sesión administrativa.");
    if (!name) throw new Error("Escribe el nombre del usuario.");
    if (!email || !email.includes("@")) throw new Error("El correo no es válido.");
    if (password.length < 8) throw new Error("La contraseña debe tener mínimo 8 caracteres.");
    if (!allowedRoles.has(role)) throw new Error("El rol seleccionado no es válido.");

    const secondaryName = `userCreator-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const secondaryApp = appSdk.initializeApp(firebaseConfig, secondaryName);
    const secondaryAuth = authSdk.getAuth(secondaryApp);

    let targetUser = null;
    let createdFresh = false;

    try {
      try {
        const credential = await authSdk.createUserWithEmailAndPassword(
          secondaryAuth,
          email,
          password
        );
        targetUser = credential.user;
        createdFresh = true;
      } catch (createError) {
        // Después de un reinicio total la cuenta puede seguir existiendo
        // en Firebase Authentication aunque su perfil Firestore se haya borrado.
        // Si el admin usa la contraseña correcta, reutilizamos esa cuenta.
        if (createError?.code !== "auth/email-already-in-use") throw createError;

        const credential = await authSdk.signInWithEmailAndPassword(
          secondaryAuth,
          email,
          password
        );
        targetUser = credential.user;
        createdFresh = false;
      }

      await setDoc(doc(db, "usuariosSistema", targetUser.uid), {
        nombre: name,
        email,
        rol: role,
        activo: true,
        eliminado: false,
        createdBy: actor.uid,
        createdByName: actor.name || "",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      try {
        await authSdk.updateProfile(targetUser, { displayName: name });
      } catch (profileError) {
        console.warn("No se pudo actualizar displayName:", profileError);
      }

      await authSdk.signOut(secondaryAuth);

      return {
        uid: targetUser.uid,
        name,
        email,
        role,
        reusedAuthentication: !createdFresh
      };
    } catch (error) {
      // Solo eliminamos la cuenta si fue creada en esta misma operación.
      // Nunca borramos una cuenta preexistente durante un rollback.
      if (targetUser && createdFresh) {
        try {
          await authSdk.deleteUser(targetUser);
        } catch (rollbackError) {
          console.error("No se pudo eliminar la cuenta creada durante rollback:", rollbackError);
        }
      }

      try { await authSdk.signOut(secondaryAuth); } catch {}
      throw error;
    } finally {
      try { await appSdk.deleteApp(secondaryApp); } catch {}
    }
  }


  function calculateOrderFinancials(product, fulfillment, quantity, shipping, payment) {
    const qty = Math.max(1, Number(quantity || 1));
    const unitPrice = Math.max(0, Number(product.precio || 0));
    const ownCost = Math.max(0, Number(product.costoPropio || 0));
    const supplierCost = Math.max(0, Number(product.costoProveedor || 0));
    const unitCost = fulfillment === "supplier" ? (supplierCost || ownCost) : ownCost;
    const productRevenue = unitPrice * qty;
    const shippingCharged = Math.max(0, Number(shipping || 0));
    const customerPays = productRevenue + shippingCharged;
    const productCost = unitCost * qty;
    const dispatchFee = Math.max(0, Number(product.despachoPorUnidad || 0)) * qty;
    const commissionType = product.comisionAsesorTipo === "percent" ? "percent" : "fixed";
    const commissionValue = Math.max(0, Number(product.comisionAsesorValor || 0));
    const advisorCommission = commissionType === "percent"
      ? productRevenue * (commissionValue / 100)
      : commissionValue * qty;
    const carrierFeePercent = Math.max(0, Number(product.feeTransportadoraPct || 0));
    const carrierFee = payment === "cod" ? customerPays * (carrierFeePercent / 100) : 0;
    const advertisingCost = Math.max(0, Number(product.publicidadPorVenta || 0));
    // En la plantilla Startech el envío cobrado al cliente se maneja como valor de paso:
    // se suma a lo que paga el cliente y se descuenta como costo logístico.
    const shippingCost = shippingCharged;
    const profitBeforeAdvertising = customerPays - productCost - shippingCost - dispatchFee - advisorCommission - carrierFee;
    const companyNet = profitBeforeAdvertising - advertisingCost;
    const netMarginPercent = productRevenue > 0 ? (companyNet / productRevenue) * 100 : 0;

    return {
      pricingModel: product.modeloPrecio || "standard",
      pricingSource: product.fuentePrecio || "Manual",
      unitPrice,
      unitCost,
      productRevenue,
      productCost,
      shippingCharged,
      shippingCost,
      customerPays,
      dispatchFeePerUnit: Math.max(0, Number(product.despachoPorUnidad || 0)),
      dispatchFee,
      advisorCommissionType: commissionType,
      advisorCommissionValue: commissionValue,
      advisorCommission,
      carrierFeePercent,
      carrierFee,
      advertisingCost,
      profitBeforeAdvertising,
      companyNet,
      netMarginPercent
    };
  }

  async function seedStartechCatalog() {
    const catalog = [
      { id:"star-air-pro-2", sku:"AIR-PRO-2", nombre:"AIR PRO 2", variante:"Startech", costo:43000, precio:113500, envio:20000, despacho:3000, comisionTipo:"fixed", comision:30000, fee:3, publicidad:20000, modelo:"airpods" },
      { id:"star-air-pro-3", sku:"AIR-PRO-3", nombre:"AIR PRO 3", variante:"Startech", costo:57000, precio:127950, envio:20000, despacho:3000, comisionTipo:"fixed", comision:30000, fee:3, publicidad:20000, modelo:"airpods" },
      { id:"star-airpods-3-serie-3", sku:"AIRPODS-3-S3", nombre:"AirPods 3.ª generación serie 3", variante:"Startech", costo:40000, precio:110800, envio:20000, despacho:3000, comisionTipo:"fixed", comision:30000, fee:3, publicidad:200000, modelo:"airpods" },
      { id:"star-airpods-4-serie-4", sku:"AIRPODS-4-S4", nombre:"AirPods 4 serie 4", variante:"Startech", costo:43000, precio:113900, envio:20000, despacho:3000, comisionTipo:"fixed", comision:30000, fee:3, publicidad:10000, modelo:"airpods" },
      { id:"star-reflector-200w", sku:"REF-SOLAR-200W", nombre:"REFLECTOR SOLAR 200 W", variante:"Solar", costo:96333, precio:196597.95918367346, envio:0, despacho:0, comisionTipo:"percent", comision:17, fee:0, publicidad:0, modelo:"reflector" },
      { id:"star-reflector-300w", sku:"REF-SOLAR-300W", nombre:"REFLECTOR SOLAR 300 W", variante:"Solar", costo:131164, precio:262328, envio:0, despacho:0, comisionTipo:"percent", comision:17, fee:0, publicidad:0, modelo:"reflector" },
      { id:"star-reflector-400w", sku:"REF-SOLAR-400W", nombre:"REFLECTOR SOLAR 400 W", variante:"Solar", costo:160808, precio:292378.1818181818, envio:0, despacho:0, comisionTipo:"percent", comision:17, fee:0, publicidad:0, modelo:"reflector" },
      { id:"star-reflector-poste-300w", sku:"REF-POSTE-300W", nombre:"REFLECTOR SOLAR POSTE 300 W", variante:"Solar poste", costo:238211, precio:433110.90909090906, envio:0, despacho:0, comisionTipo:"percent", comision:17, fee:0, publicidad:0, modelo:"reflector" }
    ];

    const existingSnap = await getDocs(collection(db, "productos"));
    const existingSkus = new Set(existingSnap.docs.map(d => String(d.data().sku || "").toUpperCase()));
    const batch = writeBatch(db);
    let created = 0;

    catalog.forEach(item => {
      if (existingSkus.has(item.sku.toUpperCase())) return;
      batch.set(doc(db, "productos", item.id), {
        sku: item.sku,
        nombre: item.nombre,
        variante: item.variante,
        precio: item.precio,
        stockPropio: 0,
        reservado: 0,
        costoPropio: item.costo,
        proveedorId: null,
        stockProveedor: 0,
        costoProveedor: item.costo,
        modeloPrecio: item.modelo,
        envioPredeterminado: item.envio,
        despachoPorUnidad: item.despacho,
        comisionAsesorTipo: item.comisionTipo,
        comisionAsesorValor: item.comision,
        feeTransportadoraPct: item.fee,
        publicidadPorVenta: item.publicidad,
        fuentePrecio: "PRECIOS STARTECH (1)(1).xlsx",
        activo: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      created++;
    });

    if (created) await batch.commit();
    await setDoc(doc(db, "configuracion", "contadores"), {
      pedidoConsecutivo: 0,
      updatedAt: serverTimestamp()
    }, { merge: true });
    return { created, total: catalog.length, skipped: catalog.length - created };
  }

  async function saveProduct(payload) {
    const productId = String(payload.id || "").trim();

    const data = {
      sku: String(payload.sku || "").trim().toUpperCase(),
      nombre: String(payload.name || "").trim(),
      variante: String(payload.variant || "").trim(),
      precio: Math.max(0, Number(payload.price || 0)),
      stockPropio: Math.max(0, Number(payload.ownStock || 0)),
      reservado: Math.max(0, Number(payload.reserved || 0)),
      costoPropio: Math.max(0, Number(payload.ownCost || 0)),
      proveedorId: payload.supplierId || null,
      stockProveedor: Math.max(0, Number(payload.supplierStock || 0)),
      costoProveedor: Math.max(0, Number(payload.supplierCost || 0)),
      modeloPrecio: String(payload.pricingModel || "standard"),
      envioPredeterminado: Math.max(0, Number(payload.defaultShipping || 0)),
      despachoPorUnidad: Math.max(0, Number(payload.dispatchFeePerUnit || 0)),
      comisionAsesorTipo: payload.advisorCommissionType === "percent" ? "percent" : "fixed",
      comisionAsesorValor: Math.max(0, Number(payload.advisorCommissionValue || 0)),
      feeTransportadoraPct: Math.max(0, Number(payload.carrierFeePercent || 0)),
      publicidadPorVenta: Math.max(0, Number(payload.advertisingCost || 0)),
      fuentePrecio: String(payload.pricingSource || "Manual"),
      activo: payload.active !== false,
      updatedAt: serverTimestamp()
    };

    if (!data.sku) throw new Error("El SKU es obligatorio.");
    if (!data.nombre) throw new Error("El nombre del producto es obligatorio.");
    if (data.reservado > data.stockPropio) {
      throw new Error("El reservado no puede ser mayor que el stock propio.");
    }

    if (!data.proveedorId) {
      data.stockProveedor = 0;
      data.costoProveedor = 0;
    }

    if (productId) {
      await updateDoc(doc(db, "productos", productId), data);
      return { id: productId, created: false };
    }

    const ref = await addDoc(collection(db, "productos"), {
      ...data,
      createdAt: serverTimestamp()
    });

    return { id: ref.id, created: true };
  }

  async function adjustSupplierStock(productId, operation, amount, supplierId = null) {
    const ref = doc(db, "productos", productId);
    const qty = Math.max(0, Number(amount || 0));

    return runTransaction(db, async transaction => {
      const snap = await transaction.get(ref);
      if (!snap.exists()) throw new Error("Producto no encontrado.");

      const current = Number(snap.data().stockProveedor || 0);
      let next = current;

      if (operation === "add") next = current + qty;
      else if (operation === "remove") next = current - qty;
      else if (operation === "set") next = qty;
      else throw new Error("Operación de inventario no válida.");

      if (next < 0) throw new Error("No puedes dejar el inventario del proveedor en negativo.");

      transaction.update(ref, {
        stockProveedor: next,
        proveedorId: supplierId || null,
        updatedAt: serverTimestamp()
      });

      return { previous: current, current: next };
    });
  }

  async function saveSupplier(payload) {
    const supplierId = String(payload.id || "").trim();
    const data = {
      nombre: String(payload.name || "").trim(),
      telefono: String(payload.phone || "").trim(),
      modelo: String(payload.model || "").trim(),
      liquidacion: String(payload.settlement || "").trim(),
      activo: payload.active !== false,
      updatedAt: serverTimestamp()
    };

    if (!data.nombre) throw new Error("El proveedor necesita un nombre.");

    if (supplierId) {
      await updateDoc(doc(db, "proveedores", supplierId), data);
      return { id: supplierId, created: false };
    }

    const ref = await addDoc(collection(db, "proveedores"), {
      ...data,
      createdAt: serverTimestamp()
    });

    return { id: ref.id, created: true };
  }

  async function removeSupplier(supplierId) {
    const productsSnap = await getDocs(collection(db, "productos"));
    const linkedProducts = productsSnap.docs.filter(d => d.data().proveedorId === supplierId);

    const batch = writeBatch(db);

    linkedProducts.forEach(productDoc => {
      batch.update(productDoc.ref, {
        proveedorId: null,
        stockProveedor: 0,
        updatedAt: serverTimestamp()
      });
    });

    batch.delete(doc(db, "proveedores", supplierId));
    await batch.commit();

    return { unassignedProducts: linkedProducts.length };
  }

  async function updateSystemUser(uid, patch) {
    await updateDoc(doc(db, "usuariosSistema", uid), {
      ...patch,
      updatedAt: serverTimestamp()
    });
  }

  async function disableSystemUser(uid, actor) {
    if (uid === actor.uid) throw new Error("No puedes eliminar tu propio acceso administrativo.");

    await updateDoc(doc(db, "usuariosSistema", uid), {
      activo: false,
      eliminado: true,
      eliminadoPor: actor.uid,
      eliminadoPorNombre: actor.name || "",
      eliminadoAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
  }

  async function sendUserPasswordReset(email) {
    if (!email) throw new Error("El usuario no tiene correo registrado.");
    await authSdk.sendPasswordResetEmail(auth, email);
  }

  async function changeUserCredentials(payload) {
    const targetUid = String(payload.uid || "");
    const currentEmail = String(payload.currentEmail || "").trim().toLowerCase();
    const currentPassword = String(payload.currentPassword || "");
    const newEmail = String(payload.newEmail || "").trim().toLowerCase();
    const newPassword = String(payload.newPassword || "");

    if (!targetUid || !currentEmail || !currentPassword) {
      throw new Error("Faltan las credenciales actuales del usuario.");
    }
    if (!newEmail && !newPassword) {
      throw new Error("Escribe un nuevo correo o una nueva contraseña.");
    }
    if (newPassword && newPassword.length < 8) {
      throw new Error("La nueva contraseña debe tener mínimo 8 caracteres.");
    }

    const secondaryName = `credentialEditor-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const secondaryApp = appSdk.initializeApp(firebaseConfig, secondaryName);
    const secondaryAuth = authSdk.getAuth(secondaryApp);

    try {
      const credential = await authSdk.signInWithEmailAndPassword(
        secondaryAuth,
        currentEmail,
        currentPassword
      );

      if (credential.user.uid !== targetUid) {
        throw new Error("Las credenciales ingresadas no corresponden al usuario seleccionado.");
      }

      if (newEmail && newEmail !== currentEmail) {
        await authSdk.updateEmail(credential.user, newEmail);
      }

      if (newPassword) {
        await authSdk.updatePassword(credential.user, newPassword);
      }

      if (newEmail && newEmail !== currentEmail) {
        await updateDoc(doc(db, "usuariosSistema", targetUid), {
          email: newEmail,
          updatedAt: serverTimestamp()
        });
      }

      await authSdk.signOut(secondaryAuth);

      return { email: newEmail || currentEmail };
    } finally {
      try { await authSdk.signOut(secondaryAuth); } catch {}
      try { await appSdk.deleteApp(secondaryApp); } catch {}
    }
  }

  async function editOrder(orderId, changes, actor, allowProductChange = false) {
    const orderRef = doc(db, "pedidos", orderId);

    return runTransaction(db, async transaction => {
      const orderSnap = await transaction.get(orderRef);
      if (!orderSnap.exists()) throw new Error("Pedido no encontrado.");

      const order = orderSnap.data();

      if (["cancelled", "delivered", "returned"].includes(order.status)) {
        throw new Error("Este pedido ya no puede editarse.");
      }

      const nowIso = new Date().toISOString();
      const customer = {
        name: String(changes.customer?.name || "").trim(),
        phone: String(changes.customer?.phone || "").replace(/\D/g, ""),
        department: String(changes.customer?.department || "").trim(),
        city: String(changes.customer?.city || "").trim(),
        address: String(changes.customer?.address || "").trim(),
        neighborhood: String(changes.customer?.neighborhood || "").trim(),
        reference: String(changes.customer?.reference || "").trim()
      };

      const shipping = Math.max(0, Number(changes.shipping || 0));
      const basePatch = {
        customer,
        shipping,
        payment: changes.payment,
        source: String(changes.source || "").trim(),
        notes: String(changes.notes || "").trim(),
        timeline: [...(order.timeline || []), {
          at: nowIso,
          label: "Información del pedido editada",
          user: actor.name,
          uid: actor.uid
        }],
        updatedAt: serverTimestamp()
      };

      if (!allowProductChange) {
        const currentProductRef = doc(db, "productos", order.productId);
        const currentProductSnap = await transaction.get(currentProductRef);
        if (!currentProductSnap.exists()) throw new Error("Producto no encontrado.");
        const currentProduct = currentProductSnap.data();
        const financials = calculateOrderFinancials(
          currentProduct,
          order.fulfillment,
          Number(order.quantity || 1),
          shipping,
          changes.payment
        );
        transaction.update(orderRef, {
          ...basePatch,
          unitPrice: financials.unitPrice,
          total: financials.customerPays,
          pricingSnapshot: financials
        });
        return { fulfillment: order.fulfillment, status: order.status };
      }

      if (!["confirmed", "supplier_pending"].includes(order.status)) {
        throw new Error("Producto y cantidad solo pueden cambiar antes de iniciar despacho.");
      }

      const newProductId = String(changes.productId || order.productId);
      const newQuantity = Math.max(1, Number(changes.quantity || 1));

      const oldProductRef = doc(db, "productos", order.productId);
      const newProductRef = doc(db, "productos", newProductId);

      const oldProductSnap = await transaction.get(oldProductRef);
      if (!oldProductSnap.exists()) throw new Error("El producto anterior no existe.");

      const newProductSnap = newProductId === order.productId
        ? oldProductSnap
        : await transaction.get(newProductRef);

      if (!newProductSnap.exists()) throw new Error("El nuevo producto no existe.");

      const oldProduct = oldProductSnap.data();
      const newProduct = newProductSnap.data();
      const oldQty = Number(order.quantity || 1);

      // Liberar reserva anterior si salía de bodega propia.
      if (order.fulfillment === "own") {
        transaction.update(oldProductRef, {
          reservado: Math.max(0, Number(oldProduct.reservado || 0) - oldQty),
          updatedAt: serverTimestamp()
        });
      }

      let adjustedReserved = Number(newProduct.reservado || 0);
      if (newProductId === order.productId && order.fulfillment === "own") {
        adjustedReserved = Math.max(0, adjustedReserved - oldQty);
      }

      const ownAvailable = Math.max(
        0,
        Number(newProduct.stockPropio || 0) - adjustedReserved
      );

      const fulfillment = ownAvailable >= newQuantity ? "own" : "supplier";

      if (fulfillment === "supplier" && Number(newProduct.stockProveedor || 0) < newQuantity) {
        throw new Error("El nuevo producto no tiene disponibilidad suficiente.");
      }

      if (fulfillment === "own") {
        transaction.update(newProductRef, {
          reservado: adjustedReserved + newQuantity,
          updatedAt: serverTimestamp()
        });
      }

      const financials = calculateOrderFinancials(newProduct, fulfillment, newQuantity, shipping, changes.payment);
      const status = fulfillment === "own" ? "confirmed" : "supplier_pending";

      transaction.update(orderRef, {
        ...basePatch,
        productId: newProductId,
        quantity: newQuantity,
        unitPrice: financials.unitPrice,
        total: financials.customerPays,
        pricingSnapshot: financials,
        fulfillment,
        supplierId: fulfillment === "supplier" ? (newProduct.proveedorId || null) : null,
        supplierOrderId: null,
        guide: null,
        status
      });

      return { fulfillment, status };
    });
  }

  async function cancelOrder(orderId, actor, reason = "") {
    const orderRef = doc(db, "pedidos", orderId);

    return runTransaction(db, async transaction => {
      const orderSnap = await transaction.get(orderRef);
      if (!orderSnap.exists()) throw new Error("Pedido no encontrado.");

      const order = orderSnap.data();

      if (["cancelled", "delivered", "returned", "transit", "shipped"].includes(order.status)) {
        throw new Error("Este pedido ya no puede cancelarse desde el sistema.");
      }

      if (order.fulfillment === "own" && ["confirmed", "preparing", "packed"].includes(order.status)) {
        const productRef = doc(db, "productos", order.productId);
        const productSnap = await transaction.get(productRef);

        if (productSnap.exists()) {
          transaction.update(productRef, {
            reservado: Math.max(
              0,
              Number(productSnap.data().reservado || 0) - Number(order.quantity || 1)
            ),
            updatedAt: serverTimestamp()
          });
        }
      }

      transaction.update(orderRef, {
        status: "cancelled",
        cancellationReason: String(reason || "").trim(),
        cancelledAt: serverTimestamp(),
        timeline: [...(order.timeline || []), {
          at: new Date().toISOString(),
          label: `Pedido cancelado${reason ? ` · ${reason}` : ""}`,
          user: actor.name,
          uid: actor.uid
        }],
        updatedAt: serverTimestamp()
      });
    });
  }



  async function deleteCollectionInChunks(collectionName, keepIds = new Set()) {
    const snapshot = await getDocs(collection(db, collectionName));
    const docsToDelete = snapshot.docs.filter(d => !keepIds.has(d.id));
    const chunkSize = 400;
    let deleted = 0;

    for (let i = 0; i < docsToDelete.length; i += chunkSize) {
      const batch = writeBatch(db);
      const chunk = docsToDelete.slice(i, i + chunkSize);
      chunk.forEach(d => batch.delete(d.ref));
      await batch.commit();
      deleted += chunk.length;
    }

    return deleted;
  }

  async function resetSystemData(actor) {
    if (!actor?.uid) throw new Error("No existe una sesión administrativa.");

    const adminRef = doc(db, "usuariosSistema", actor.uid);
    const adminSnap = await getDoc(adminRef);

    if (!adminSnap.exists() || adminSnap.data().rol !== "admin" || adminSnap.data().activo !== true) {
      throw new Error("Solo un administrador activo puede reiniciar el sistema.");
    }

    const result = {
      pedidos: 0,
      productos: 0,
      proveedores: 0,
      gastos: 0,
      auditoria: 0,
      usuarios: 0,
      configuracion: 0
    };

    // El admin actual y configuracion/seguridad se conservan para no perder acceso.
    result.pedidos = await deleteCollectionInChunks("pedidos");
    result.gastos = await deleteCollectionInChunks("gastos");
    result.auditoria = await deleteCollectionInChunks("auditoria");
    result.productos = await deleteCollectionInChunks("productos");
    result.proveedores = await deleteCollectionInChunks("proveedores");
    result.usuarios = await deleteCollectionInChunks("usuariosSistema", new Set([actor.uid]));
    result.configuracion = await deleteCollectionInChunks("configuracion", new Set(["seguridad"]));

    // Reiniciar contador para que el siguiente pedido vuelva a PED-000001.
    await setDoc(doc(db, "configuracion", "contadores"), {
      pedidoConsecutivo: 0,
      updatedAt: serverTimestamp(),
      reiniciadoPor: actor.uid,
      reiniciadoPorNombre: actor.name || ""
    });

    // Asegurar que el administrador actual quede operativo.
    await updateDoc(adminRef, {
      activo: true,
      eliminado: false,
      updatedAt: serverTimestamp()
    });

    return result;
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
      const quantity = Math.max(1, Number(baseOrder.quantity || 1));
      const stockOwn = Number(product.stockPropio || 0);
      const reserved = Number(product.reservado || 0);
      const supplierStock = Number(product.stockProveedor || 0);
      const availableOwn = Math.max(0, stockOwn - reserved);
      const fulfillment = availableOwn >= quantity ? "own" : "supplier";

      if (fulfillment === "supplier" && supplierStock < quantity) {
        throw new Error("No existe disponibilidad suficiente en inventario propio ni proveedor.");
      }

      const shipping = Math.max(0, Number(baseOrder.shipping || 0));
      const financials = calculateOrderFinancials(product, fulfillment, quantity, shipping, baseOrder.payment);

      const next = Number(counterSnap.data().pedidoConsecutivo || 0) + 1;
      const orderId = `PED-${String(next).padStart(6, "0")}`;
      const orderRef = doc(db, "pedidos", orderId);
      const nowIso = new Date().toISOString();

      const order = {
        ...baseOrder,
        id: orderId,
        consecutivo: next,
        quantity,
        unitPrice: financials.unitPrice,
        shipping,
        total: financials.customerPays,
        pricingSnapshot: financials,
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
        timeline: [{ at: nowIso, label: "Pedido confirmado", user: actor.name, uid: actor.uid }]
      };

      transaction.set(orderRef, order);
      transaction.update(counterRef, { pedidoConsecutivo: next, updatedAt: serverTimestamp() });

      if (fulfillment === "own") {
        transaction.update(productRef, { reservado: reserved + quantity, updatedAt: serverTimestamp() });
      }

      return { id: orderId, fulfillment, total: financials.customerPays };
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

      if (order.fulfillment !== "own") {
        throw new Error("Este pedido no corresponde a inventario propio.");
      }

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
          at: nowIso,
          label,
          user: actor.name,
          uid: actor.uid
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
    bootstrapAdminProfile,
    createSystemUser,
    seedStartechCatalog,
    saveProduct,
    adjustSupplierStock,
    saveSupplier,
    removeSupplier,
    updateSystemUser,
    disableSystemUser,
    sendUserPasswordReset,
    changeUserCredentials,
    resetSystemData,
    editOrder,
    cancelOrder,
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
