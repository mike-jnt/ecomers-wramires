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
    runTransaction, writeBatch, serverTimestamp, query, where, deleteField
  } = firestoreSdk;

  function mapSnapshot(snapshot) {
    return snapshot.docs.map(d => {
      const data = d.data();
      const embeddedId = data?.id && data.id !== d.id ? String(data.id) : null;
      return {
        ...data,
        legacyId: data?.legacyId || embeddedId || null,
        id: d.id
      };
    });
  }

  const PRIVATE_PRODUCT_FIELDS = [
    "costoPropio", "costoProveedor", "despachoPorUnidad", "comisionAsesorTipo",
    "comisionAsesorValor", "feeTransportadoraPct", "publicidadPorVenta"
  ];

  function cleanText(value, maxLength = 1000) {
    return String(value ?? "")
      .replace(/[<>]/g, "")
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
      .trim()
      .slice(0, maxLength);
  }

  function privatePricingFromProduct(product = {}) {
    return {
      costoPropio: Math.max(0, Number(product.costoPropio || 0)),
      costoProveedor: Math.max(0, Number(product.costoProveedor || 0)),
      despachoPorUnidad: Math.max(0, Number(product.despachoPorUnidad || 0)),
      comisionAsesorTipo: product.comisionAsesorTipo === "percent" ? "percent" : "fixed",
      comisionAsesorValor: Math.max(0, Number(product.comisionAsesorValor || 0)),
      feeTransportadoraPct: Math.max(0, Number(product.feeTransportadoraPct || 0)),
      publicidadPorVenta: Math.max(0, Number(product.publicidadPorVenta || 0)),
      modeloPrecio: cleanText(product.modeloPrecio || "standard", 80),
      fuentePrecio: cleanText(product.fuentePrecio || "Manual", 180)
    };
  }

  function privatePricingFromPayload(payload = {}) {
    return {
      costoPropio: Math.max(0, Number(payload.ownCost || 0)),
      costoProveedor: Math.max(0, Number(payload.supplierCost || 0)),
      despachoPorUnidad: Math.max(0, Number(payload.dispatchFeePerUnit || 0)),
      comisionAsesorTipo: payload.advisorCommissionType === "percent" ? "percent" : "fixed",
      comisionAsesorValor: Math.max(0, Number(payload.advisorCommissionValue || 0)),
      feeTransportadoraPct: Math.max(0, Number(payload.carrierFeePercent || 0)),
      publicidadPorVenta: Math.max(0, Number(payload.advertisingCost || 0)),
      modeloPrecio: cleanText(payload.pricingModel || "standard", 80),
      fuentePrecio: cleanText(payload.pricingSource || "Manual", 180)
    };
  }

  async function writeAudit(action, entityType, entityId, actor, details = {}) {
    if (!actor?.uid) return;
    try {
      await addDoc(collection(db, "auditoria"), {
        action: cleanText(action, 120),
        entityType: cleanText(entityType, 80),
        entityId: cleanText(entityId, 180),
        actorUid: actor.uid,
        actorName: cleanText(actor.name || "Usuario", 160),
        actorRole: cleanText(actor.role || "", 60),
        details,
        createdAt: serverTimestamp(),
        createdAtClient: new Date().toISOString()
      });
    } catch (error) {
      console.warn("No se pudo registrar auditoría:", error);
    }
  }

  async function migratePrivatePricingData() {
    const productSnapshot = await getDocs(collection(db, "productos"));

    // Compatibilidad con versiones antiguas: algunos documentos guardaban un campo
    // interno `id` distinto al ID real de Firestore. Ese valor podía pisar d.id
    // en el cliente y provocar "El producto ya no existe" al crear pedidos.
    const legacyProductMap = new Map();
    const legacyProductDocs = productSnapshot.docs.filter(d => {
      const embeddedId = d.data()?.id;
      if (embeddedId && String(embeddedId) !== d.id) {
        legacyProductMap.set(String(embeddedId), d.id);
        return true;
      }
      if (d.data()?.legacyId && String(d.data().legacyId) !== d.id) {
        legacyProductMap.set(String(d.data().legacyId), d.id);
      }
      return false;
    });

    for (let i = 0; i < legacyProductDocs.length; i += 400) {
      const batch = writeBatch(db);
      legacyProductDocs.slice(i, i + 400).forEach(productDoc => {
        const embeddedId = String(productDoc.data().id || "");
        batch.update(productDoc.ref, {
          legacyId: embeddedId || productDoc.data().legacyId || null,
          id: deleteField(),
          updatedAt: serverTimestamp()
        });
      });
      await batch.commit();
    }

    const productCandidates = productSnapshot.docs.filter(d =>
      PRIVATE_PRODUCT_FIELDS.some(k => Object.prototype.hasOwnProperty.call(d.data(), k))
    );

    let migratedProducts = 0;
    let migratedOrders = 0;
    const chunkSize = 150;

    for (let i = 0; i < productCandidates.length; i += chunkSize) {
      const batch = writeBatch(db);
      const chunk = productCandidates.slice(i, i + chunkSize);
      chunk.forEach(productDoc => {
        const product = productDoc.data();
        const versionRef = product.pricingVersionId
          ? doc(db, "preciosVersiones", product.pricingVersionId)
          : doc(collection(db, "preciosVersiones"));

        batch.set(versionRef, {
          productId:productDoc.id,
          versionId:versionRef.id,
          ...privatePricingFromProduct(product),
          migratedFromProduct:true,
          updatedAt:serverTimestamp(),
          createdAt:serverTimestamp()
        }, { merge:true });

        batch.update(productDoc.ref, {
          pricingVersionId:versionRef.id,
          costoPropio:deleteField(),
          costoProveedor:deleteField(),
          despachoPorUnidad:deleteField(),
          comisionAsesorTipo:deleteField(),
          comisionAsesorValor:deleteField(),
          feeTransportadoraPct:deleteField(),
          publicidadPorVenta:deleteField(),
          reservadoProveedor:Number(product.reservadoProveedor || 0),
          sellerVisible:true,
          updatedAt:serverTimestamp()
        });
        migratedProducts += 1;
      });
      await batch.commit();
    }

    const publicSafetyProducts = productSnapshot.docs.filter(d =>
      !productCandidates.some(c => c.id === d.id)
      && (
        !Object.prototype.hasOwnProperty.call(d.data(), "reservadoProveedor")
        || d.data().sellerVisible !== true
      )
    );
    for (let i = 0; i < publicSafetyProducts.length; i += 400) {
      const batch = writeBatch(db);
      publicSafetyProducts.slice(i, i + 400).forEach(productDoc => {
        const patch = { sellerVisible:true, updatedAt:serverTimestamp() };
        if (!Object.prototype.hasOwnProperty.call(productDoc.data(), "reservadoProveedor")) patch.reservadoProveedor = 0;
        batch.update(productDoc.ref, patch);
      });
      await batch.commit();
    }

    // Los pedidos antiguos podían contener costos privados dentro de pricingSnapshot.
    // Se mueve esa fotografía a preciosVersiones para que un vendedor no pueda verla.
    const orderSnapshot = await getDocs(collection(db, "pedidos"));
    const orderCandidates = orderSnapshot.docs.filter(d => Object.prototype.hasOwnProperty.call(d.data(), "pricingSnapshot"));
    for (let i = 0; i < orderCandidates.length; i += chunkSize) {
      const batch = writeBatch(db);
      const chunk = orderCandidates.slice(i, i + chunkSize);
      chunk.forEach(orderDoc => {
        const order = orderDoc.data();
        const snap = order.pricingSnapshot || {};
        let versionId = order.pricingVersionId || null;
        let versionRef = versionId ? doc(db, "preciosVersiones", versionId) : null;

        if (!versionRef) {
          versionRef = doc(collection(db, "preciosVersiones"));
          versionId = versionRef.id;
        }

        batch.set(versionRef, {
          productId:order.productId || null,
          versionId,
          costoPropio:Number(snap.unitCost || 0),
          costoProveedor:Number(snap.unitCost || 0),
          despachoPorUnidad:Number(snap.dispatchFeePerUnit || 0),
          comisionAsesorTipo:snap.advisorCommissionType === "percent" ? "percent" : "fixed",
          comisionAsesorValor:Number(snap.advisorCommissionValue || 0),
          feeTransportadoraPct:Number(snap.carrierFeePercent || 0),
          publicidadPorVenta:Number(snap.advertisingCost || 0),
          modeloPrecio:cleanText(snap.pricingModel || "legacy", 80),
          fuentePrecio:cleanText(snap.pricingSource || "Pedido histórico", 180),
          migratedFromOrder:orderDoc.id,
          createdAt:serverTimestamp(),
          updatedAt:serverTimestamp()
        }, { merge:true });

        batch.update(orderDoc.ref, {
          pricingVersionId:versionId,
          pricingSnapshot:deleteField(),
          productId:legacyProductMap.get(String(order.productId || "")) || order.productId || null,
          sellerAccessKey:order.sellerUid || null,
          updatedAt:serverTimestamp()
        });
        migratedOrders += 1;
      });
      await batch.commit();
    }

    const safeOrderAccess = orderSnapshot.docs.filter(d =>
      !Object.prototype.hasOwnProperty.call(d.data(), "pricingSnapshot")
      && !Object.prototype.hasOwnProperty.call(d.data(), "sellerAccessKey")
    );
    for (let i = 0; i < safeOrderAccess.length; i += 400) {
      const batch = writeBatch(db);
      safeOrderAccess.slice(i, i + 400).forEach(orderDoc => {
        const order = orderDoc.data();
        batch.update(orderDoc.ref, {
          productId:legacyProductMap.get(String(order.productId || "")) || order.productId || null,
          sellerAccessKey:order.sellerUid || null,
          updatedAt:serverTimestamp()
        });
      });
      await batch.commit();
    }

    if (legacyProductMap.size) {
      const staleProductOrders = orderSnapshot.docs.filter(d =>
        legacyProductMap.has(String(d.data().productId || ""))
      );
      for (let i = 0; i < staleProductOrders.length; i += 400) {
        const batch = writeBatch(db);
        staleProductOrders.slice(i, i + 400).forEach(orderDoc => {
          const oldProductId = String(orderDoc.data().productId || "");
          batch.update(orderDoc.ref, {
            productId: legacyProductMap.get(oldProductId),
            updatedAt: serverTimestamp()
          });
        });
        await batch.commit();
      }
    }

    // Corrección V16.3: algunos pedidos creados/intentados desde la vista admin
    // podían conservar como productId el ID de preciosVersiones. Normalizamos
    // cualquier registro histórico que todavía tenga esa referencia.
    const pricingSnapshot = await getDocs(collection(db, "preciosVersiones"));
    const pricingToProduct = new Map(
      pricingSnapshot.docs
        .map(d => [d.id, String(d.data()?.productId || "").trim()])
        .filter(([, productId]) => productId)
    );
    const pricingIdOrders = orderSnapshot.docs.filter(d => {
      const current = String(d.data()?.productId || "").trim();
      return current && pricingToProduct.has(current);
    });
    for (let i = 0; i < pricingIdOrders.length; i += 400) {
      const batch = writeBatch(db);
      pricingIdOrders.slice(i, i + 400).forEach(orderDoc => {
        const current = String(orderDoc.data()?.productId || "").trim();
        batch.update(orderDoc.ref, {
          productId: pricingToProduct.get(current),
          updatedAt: serverTimestamp()
        });
      });
      await batch.commit();
    }

    return {
      migrated:migratedProducts + migratedOrders + pricingIdOrders.length,
      migratedProducts,
      migratedOrders,
      canonicalizedProducts:legacyProductMap.size,
      correctedPricingProductIds:pricingIdOrders.length
    };
  }


  const SYSTEM_SCHEMA_VERSION = "16.3";
  const SYSTEM_APP_VERSION = "V16.3";

  async function detectSystemMigration() {
    const [systemSnap, productSnapshot, orderSnapshot, pricingSnapshot] = await Promise.all([
      getDoc(doc(db, "configuracion", "sistema")),
      getDocs(collection(db, "productos")),
      getDocs(collection(db, "pedidos")),
      getDocs(collection(db, "preciosVersiones"))
    ]);

    const currentSchemaVersion = systemSnap.exists()
      ? String(systemSnap.data()?.schemaVersion || "")
      : "";

    const currentProductIds = new Set(productSnapshot.docs.map(d => d.id));
    const legacyProductMap = new Map();

    let legacyProductIds = 0;
    let privateProducts = 0;
    let unsafeProducts = 0;

    productSnapshot.docs.forEach(d => {
      const data = d.data() || {};
      const embeddedId = data.id ? String(data.id) : "";
      const legacyId = data.legacyId ? String(data.legacyId) : "";

      if (embeddedId && embeddedId !== d.id) {
        legacyProductMap.set(embeddedId, d.id);
        legacyProductIds += 1;
      }
      if (legacyId && legacyId !== d.id) {
        legacyProductMap.set(legacyId, d.id);
      }

      if (PRIVATE_PRODUCT_FIELDS.some(k => Object.prototype.hasOwnProperty.call(data, k))) {
        privateProducts += 1;
      }

      if (
        data.sellerVisible !== true ||
        !Object.prototype.hasOwnProperty.call(data, "reservadoProveedor")
      ) {
        unsafeProducts += 1;
      }
    });

    const pricingToProduct = new Map(
      pricingSnapshot.docs
        .map(d => [d.id, String(d.data()?.productId || "").trim()])
        .filter(([, productId]) => productId)
    );

    let legacyOrderPricing = 0;
    let missingSellerAccess = 0;
    let staleOrderProductIds = 0;
    let pricingIdAsProductId = 0;

    orderSnapshot.docs.forEach(d => {
      const order = d.data() || {};

      if (Object.prototype.hasOwnProperty.call(order, "pricingSnapshot")) {
        legacyOrderPricing += 1;
      }

      if (
        order.sellerUid &&
        !Object.prototype.hasOwnProperty.call(order, "sellerAccessKey")
      ) {
        missingSellerAccess += 1;
      }

      const productId = String(order.productId || "");
      if (
        productId &&
        !currentProductIds.has(productId) &&
        legacyProductMap.has(productId)
      ) {
        staleOrderProductIds += 1;
      }

      if (
        productId &&
        !currentProductIds.has(productId) &&
        pricingToProduct.has(productId)
      ) {
        pricingIdAsProductId += 1;
      }
    });

    const versionPending = currentSchemaVersion !== SYSTEM_SCHEMA_VERSION;
    const dataPending =
      legacyProductIds +
      privateProducts +
      unsafeProducts +
      legacyOrderPricing +
      missingSellerAccess +
      staleOrderProductIds +
      pricingIdAsProductId;

    return {
      appVersion: SYSTEM_APP_VERSION,
      targetSchemaVersion: SYSTEM_SCHEMA_VERSION,
      currentSchemaVersion: currentSchemaVersion || "sin registrar",
      versionPending,
      dataPending,
      pending: versionPending || dataPending > 0,
      counts: {
        legacyProductIds,
        privateProducts,
        unsafeProducts,
        legacyOrderPricing,
        missingSellerAccess,
        staleOrderProductIds,
        pricingIdAsProductId
      }
    };
  }

  async function runSystemMigration(actor) {
    if (!actor?.uid || actor?.role !== "admin") {
      throw new Error("Solo un administrador puede ejecutar migraciones.");
    }

    const before = await detectSystemMigration();
    const migration = await migratePrivatePricingData();

    await setDoc(doc(db, "configuracion", "sistema"), {
      appVersion: SYSTEM_APP_VERSION,
      schemaVersion: SYSTEM_SCHEMA_VERSION,
      migratedAt: serverTimestamp(),
      migratedAtClient: new Date().toISOString(),
      migratedBy: actor.uid,
      migratedByName: cleanText(actor.name || "Administrador", 160),
      previousSchemaVersion: before.currentSchemaVersion,
      lastMigrationSummary: {
        migratedProducts: Number(migration?.migratedProducts || 0),
        migratedOrders: Number(migration?.migratedOrders || 0),
        canonicalizedProducts: Number(migration?.canonicalizedProducts || 0),
        detectedChanges: Number(before.dataPending || 0)
      }
    }, { merge: true });

    await writeAudit(
      "migracion_sistema",
      "configuracion",
      "sistema",
      actor,
      {
        from: before.currentSchemaVersion,
        to: SYSTEM_SCHEMA_VERSION,
        detectedChanges: before.dataPending,
        migratedProducts: Number(migration?.migratedProducts || 0),
        migratedOrders: Number(migration?.migratedOrders || 0),
        canonicalizedProducts: Number(migration?.canonicalizedProducts || 0)
      }
    );

    const after = await detectSystemMigration();

    return {
      before,
      migration,
      after,
      completed: !after.pending
    };
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
    const name = cleanText(payload?.name || "", 160);
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

      await writeAudit("usuario_creado", "usuario", targetUser.uid, actor, { role, email, reusedAuthentication:!createdFresh });
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




  async function seedEtechCatalog(actor = null) {
    const supplierId = "etech-store";
    const supplierRef = doc(db, "proveedores", supplierId);

    const catalog = [
      { id:"star-air-pro-2", sku:"AIR-PRO-2", nombre:"AIR PRO 2", variante:"Audífonos TWS", costo:43000, precio:113500, envio:20000, despacho:3000, comisionTipo:"fixed", comision:30000, fee:3, publicidad:20000, modelo:"airpods",
        descripcion:"Audífonos inalámbricos TWS para música, llamadas y uso diario, con estuche portátil de carga.",
        funciones:["Conexión inalámbrica Bluetooth","Tecnología TWS sin cables entre audífonos","Estuche portátil de carga","Micrófono para llamadas","Controles desde los audífonos","Compatibilidad con Android y iPhone","Reconexión automática después del primer emparejamiento"],
        beneficios:["Uso cómodo sin cables","Permite escuchar música y atender llamadas","El estuche facilita la recarga durante el día","Alternativa práctica para trabajo, estudio y entretenimiento"], usos:["Música","Llamadas","Videos","Clases virtuales","Trabajo y uso diario"], validacion:"Confirmar con Etech Store autonomía exacta, versión Bluetooth, tipo de control y resistencia al agua de la unidad entregada." },
      { id:"star-air-pro-3", sku:"AIR-PRO-3", nombre:"AIR PRO 3", variante:"Audífonos TWS", costo:57000, precio:127950, envio:20000, despacho:3000, comisionTipo:"fixed", comision:30000, fee:3, publicidad:20000, modelo:"airpods",
        descripcion:"Audífonos inalámbricos TWS orientados a una experiencia más completa para música y llamadas.", funciones:["Conexión Bluetooth","Sonido estéreo TWS","Micrófono integrado","Control desde los audífonos","Estuche de carga","Emparejamiento y reconexión automática","Compatibilidad con Android y iPhone"], beneficios:["Mayor libertad de movimiento","Permite música y llamadas desde el mismo dispositivo","Fácil transporte y recarga","Uso práctico durante desplazamientos y jornada diaria"], usos:["Música","Llamadas","Trabajo","Estudio","Entretenimiento"], validacion:"Confirmar con Etech Store si esta referencia específica incluye sensor de proximidad, cancelación/reducción de ruido y carga inalámbrica." },
      { id:"star-airpods-3-serie-3", sku:"AIRPODS-3-S3", nombre:"Audífonos 3.ª generación serie 3", variante:"Diseño tipo AirPods", costo:40000, precio:110800, envio:20000, despacho:3000, comisionTipo:"fixed", comision:30000, fee:3, publicidad:200000, modelo:"airpods",
        descripcion:"Audífonos inalámbricos de tercera generación para reproducción multimedia, llamadas y uso cotidiano.", funciones:["Conexión Bluetooth","Emparejamiento inalámbrico","Micrófono para llamadas","Controles desde los audífonos","Estuche de carga","Compatibilidad con Android y iPhone"], beneficios:["Diseño compacto y fácil de transportar","Permite llamadas y reproducción de contenido sin cables","Estuche para almacenamiento y carga","Útil para actividades cotidianas"], usos:["Música","Llamadas","Videos","Trabajo","Estudio"], validacion:"Confirmar con Etech Store detección de oído, pausa automática, asistente de voz, carga inalámbrica y autonomía antes de anunciarlas. No comercializar como Apple original sin soporte de autenticidad." },
      { id:"star-airpods-4-serie-4", sku:"AIRPODS-4-S4", nombre:"Audífonos 4.ª generación serie 4", variante:"Diseño tipo AirPods", costo:43000, precio:113900, envio:20000, despacho:3000, comisionTipo:"fixed", comision:30000, fee:3, publicidad:10000, modelo:"airpods",
        descripcion:"Audífonos inalámbricos de cuarta generación con diseño moderno para música, llamadas y entretenimiento.", funciones:["Conexión Bluetooth","Micrófono integrado","Controles desde los audífonos","Estuche de carga","Reconexión automática","Compatibilidad con Android y iPhone"], beneficios:["Diseño moderno y portátil","Uso inalámbrico para música y llamadas","Carga y almacenamiento desde el estuche","Ideal para uso diario"], usos:["Música","Llamadas","Trabajo","Estudio","Entretenimiento y desplazamientos"], validacion:"Confirmar con Etech Store detección de oído, ANC/cancelación activa, carga inalámbrica, resistencia al agua y autonomía exacta. No comercializar como Apple original sin soporte de autenticidad." }
    ];

    await setDoc(supplierRef, {
      nombre: "Etech Store", telefono: "", modelo: "Proveedor principal · despacho directo / abastecimiento",
      liquidacion: "Por definir", activo: true, catalogoBase: true,
      updatedAt: serverTimestamp(), createdAt: serverTimestamp()
    }, { merge: true });

    const existingSnap = await getDocs(collection(db, "productos"));
    const existingBySku = new Map(existingSnap.docs.map(d => [String(d.data().sku || "").trim().toUpperCase(), d]));
    const batch = writeBatch(db);
    let created = 0, updated = 0;

    catalog.forEach(item => {
      const existing = existingBySku.get(item.sku.toUpperCase());
      const productRef = existing ? existing.ref : doc(db, "productos", item.id);
      const versionRef = doc(collection(db, "preciosVersiones"));

      const publicData = {
        sku:item.sku, nombre:item.nombre, variante:item.variante, precio:item.precio,
        proveedorId:supplierId, modeloPrecio:item.modelo, envioPredeterminado:item.envio,
        fuentePrecio:"PRECIOS STARTECH (1)(1).xlsx", proveedorCatalogo:"Etech Store",
        descripcionComercial:item.descripcion, funcionesComerciales:item.funciones,
        beneficiosComerciales:item.beneficios, usosComerciales:item.usos,
        validacionComercial:item.validacion, fichaComercialActiva:true,
        pricingVersionId:versionRef.id, sellerVisible:true, activo:true, updatedAt:serverTimestamp()
      };

      batch.set(versionRef, {
        productId: productRef.id, versionId: versionRef.id,
        costoPropio:item.costo, costoProveedor:item.costo, despachoPorUnidad:item.despacho,
        comisionAsesorTipo:item.comisionTipo, comisionAsesorValor:item.comision,
        feeTransportadoraPct:item.fee, publicidadPorVenta:item.publicidad,
        modeloPrecio:item.modelo, fuentePrecio:"PRECIOS STARTECH (1)(1).xlsx",
        createdAt:serverTimestamp(), updatedAt:serverTimestamp()
      });

      if (existing) {
        batch.set(productRef, publicData, { merge:true });
        updated++;
      } else {
        batch.set(productRef, { ...publicData, stockPropio:0, reservado:0, stockProveedor:0, reservadoProveedor:0, createdAt:serverTimestamp() });
        created++;
      }
    });
    await batch.commit();

    const counterRef = doc(db, "configuracion", "contadores");
    const counterSnap = await getDoc(counterRef);
    if (!counterSnap.exists()) {
      await setDoc(counterRef, { pedidoConsecutivo:0, updatedAt:serverTimestamp() });
    }

    await setDoc(doc(db, "configuracion", "catalogoBase"), {
      proveedorId:supplierId, proveedorNombre:"Etech Store", version:"etech-audifonos-secure-v15",
      productos:catalog.length, categorias:["Audífonos"], actualizadoAt:serverTimestamp()
    }, { merge:true });

    await writeAudit("catalogo_actualizado", "catalogo", "etech-store", actor, { created, updated, total:catalog.length });
    return { created, updated, total:catalog.length, supplierId, supplierName:"Etech Store" };
  }

  // Alias temporal para compatibilidad con versiones anteriores.
  async function seedStartechCatalog(actor = null) {
    return seedEtechCatalog(actor);
  }

  async function saveProduct(payload, actor = null) {
    const productId = cleanText(payload.id || "", 180);
    const productRef = productId ? doc(db, "productos", productId) : doc(collection(db, "productos"));
    const existingSnap = productId ? await getDoc(productRef) : null;
    const existing = existingSnap?.exists() ? existingSnap.data() : null;
    const supplierReserved = Number(existing?.reservadoProveedor || 0);

    const publicData = {
      sku: cleanText(payload.sku || "", 60).toUpperCase(),
      nombre: cleanText(payload.name || "", 140),
      variante: cleanText(payload.variant || "", 180),
      precio: Math.max(0, Number(payload.price || 0)),
      stockPropio: Math.max(0, Number(payload.ownStock || 0)),
      reservado: Math.max(0, Number(payload.reserved || 0)),
      proveedorId: payload.supplierId || null,
      stockProveedor: Math.max(0, Number(payload.supplierStock || 0)),
      modeloPrecio: cleanText(payload.pricingModel || "standard", 80),
      envioPredeterminado: Math.max(0, Number(payload.defaultShipping || 0)),
      fuentePrecio: cleanText(payload.pricingSource || "Manual", 180),
      descripcionComercial: cleanText(payload.commercialDescription || "", 1200),
      funcionesComerciales: (Array.isArray(payload.commercialFeatures) ? payload.commercialFeatures : []).map(v => cleanText(v, 300)).filter(Boolean),
      beneficiosComerciales: (Array.isArray(payload.commercialBenefits) ? payload.commercialBenefits : []).map(v => cleanText(v, 300)).filter(Boolean),
      usosComerciales: (Array.isArray(payload.commercialUses) ? payload.commercialUses : []).map(v => cleanText(v, 300)).filter(Boolean),
      validacionComercial: cleanText(payload.commercialValidation || "", 800),
      fichaComercialActiva: true,
      sellerVisible: true,
      activo: payload.active !== false,
      updatedAt: serverTimestamp()
    };

    if (!publicData.sku) throw new Error("El SKU es obligatorio.");
    if (!publicData.nombre) throw new Error("El nombre del producto es obligatorio.");
    if (publicData.reservado > publicData.stockPropio) throw new Error("El reservado no puede ser mayor que el stock propio.");
    if (publicData.stockProveedor < supplierReserved) throw new Error(`El stock proveedor no puede quedar por debajo de ${supplierReserved} unidad(es) reservadas.`);
    if (!publicData.proveedorId && supplierReserved > 0) throw new Error("No puedes quitar el proveedor mientras existan unidades reservadas con él.");
    if (!publicData.proveedorId) publicData.stockProveedor = 0;

    const versionRef = doc(collection(db, "preciosVersiones"));
    publicData.pricingVersionId = versionRef.id;
    const privateData = privatePricingFromPayload(payload);

    const batch = writeBatch(db);
    batch.set(productRef, {
      ...publicData,
      ...(!existing ? { reservadoProveedor:0, createdAt:serverTimestamp() } : {})
    }, { merge: Boolean(existing) });
    batch.set(versionRef, {
      productId:productRef.id, versionId:versionRef.id, ...privateData,
      createdAt:serverTimestamp(), updatedAt:serverTimestamp()
    });
    await batch.commit();

    await writeAudit(existing ? "producto_actualizado" : "producto_creado", "producto", productRef.id, actor, { sku:publicData.sku, pricingVersionId:versionRef.id });
    return { id:productRef.id, created:!existing, pricingVersionId:versionRef.id };
  }

  async function adjustSupplierStock(productId, operation, amount, supplierId = null, actor = null) {
    const ref = doc(db, "productos", productId);
    const qty = Math.max(0, Number(amount || 0));
    const result = await runTransaction(db, async transaction => {
      const snap = await transaction.get(ref);
      if (!snap.exists()) throw new Error("Producto no encontrado.");
      const product = snap.data();
      const current = Number(product.stockProveedor || 0);
      const reserved = Number(product.reservadoProveedor || 0);
      let next = current;
      if (operation === "add") next = current + qty;
      else if (operation === "remove") next = current - qty;
      else if (operation === "set") next = qty;
      else throw new Error("Operación de inventario no válida.");
      if (next < reserved) throw new Error(`Hay ${reserved} unidad(es) reservadas. El stock no puede quedar por debajo de ese valor.`);
      if (reserved > 0 && (supplierId || null) !== (product.proveedorId || null)) throw new Error("No puedes cambiar el proveedor mientras existan unidades reservadas.");
      transaction.update(ref, { stockProveedor:next, proveedorId:supplierId || null, updatedAt:serverTimestamp() });
      return { previous:current, current:next, reserved };
    });
    await writeAudit("inventario_proveedor_ajustado", "producto", productId, actor, { operation, amount:qty, ...result });
    return result;
  }

  async function saveSupplier(payload, actor = null) {
    const supplierId = String(payload.id || "").trim();
    const data = {
      nombre: cleanText(payload.name || "", 180),
      telefono: cleanText(payload.phone || "", 80),
      modelo: cleanText(payload.model || "", 220),
      liquidacion: cleanText(payload.settlement || "", 180),
      activo: payload.active !== false,
      updatedAt: serverTimestamp()
    };

    if (!data.nombre) throw new Error("El proveedor necesita un nombre.");

    if (supplierId) {
      await updateDoc(doc(db, "proveedores", supplierId), data);
      await writeAudit("proveedor_actualizado", "proveedor", supplierId, actor, { nombre:data.nombre });
      return { id: supplierId, created: false };
    }

    const ref = await addDoc(collection(db, "proveedores"), {
      ...data,
      createdAt: serverTimestamp()
    });

    await writeAudit("proveedor_creado", "proveedor", ref.id, actor, { nombre:data.nombre });
    return { id: ref.id, created: true };
  }

  async function removeSupplier(supplierId, actor = null) {
    const productsSnap = await getDocs(collection(db, "productos"));
    const linkedProducts = productsSnap.docs.filter(d => d.data().proveedorId === supplierId);
    if (linkedProducts.some(d => Number(d.data().reservadoProveedor || 0) > 0)) {
      throw new Error("No puedes eliminar este proveedor mientras existan unidades reservadas.");
    }

    const batch = writeBatch(db);

    linkedProducts.forEach(productDoc => {
      batch.update(productDoc.ref, {
        proveedorId: null,
        stockProveedor: 0,
        reservadoProveedor: 0,
        updatedAt: serverTimestamp()
      });
    });

    batch.delete(doc(db, "proveedores", supplierId));
    await batch.commit();
    await writeAudit("proveedor_eliminado", "proveedor", supplierId, actor, { unassignedProducts:linkedProducts.length });
    return { unassignedProducts: linkedProducts.length };
  }

  async function updateSystemUser(uid, patch, actor = null) {
    const safePatch = { ...patch };
    if (Object.prototype.hasOwnProperty.call(safePatch, "nombre")) safePatch.nombre = cleanText(safePatch.nombre, 160);
    await updateDoc(doc(db, "usuariosSistema", uid), {
      ...safePatch,
      updatedAt: serverTimestamp()
    });
    await writeAudit("usuario_actualizado", "usuario", uid, actor, { fields:Object.keys(safePatch) });
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
    await writeAudit("usuario_desactivado", "usuario", uid, actor);
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
    const result = await runTransaction(db, async transaction => {
      const orderSnap = await transaction.get(orderRef);
      if (!orderSnap.exists()) throw new Error("Pedido no encontrado.");
      const order = orderSnap.data();
      if (["cancelled", "delivered", "returned"].includes(order.status)) throw new Error("Este pedido ya no puede editarse.");

      const customer = {
        name:cleanText(changes.customer?.name || "", 180),
        documentId:String(changes.customer?.documentId || "").replace(/[^0-9A-Za-z.-]/g, "").slice(0, 20),
        phone:String(changes.customer?.phone || "").replace(/\D/g, "").slice(0, 20),
        department:cleanText(changes.customer?.department || "", 120),
        city:cleanText(changes.customer?.city || "", 120),
        address:cleanText(changes.customer?.address || "", 300),
        neighborhood:cleanText(changes.customer?.neighborhood || "", 160),
        reference:cleanText(changes.customer?.reference || "", 300)
      };
      const shipping = Math.max(0, Number(changes.shipping || 0));
      const discountApplied = order.discountApplied === true;
      const discountPercent = discountApplied ? Number(order.discountPercent || 8) : 0;
      const nowIso = new Date().toISOString();
      const basePatch = {
        customer, shipping, payment:changes.payment === "transfer" ? "transfer" : "cod",
        source:cleanText(changes.source || "", 120), notes:cleanText(changes.notes || "", 1200),
        timeline:[...(order.timeline || []), { at:nowIso, label:"Información del pedido editada", user:cleanText(actor.name,160), uid:actor.uid }],
        updatedAt:serverTimestamp()
      };

      if (!allowProductChange) {
        const currentProductRef = doc(db, "productos", order.productId);
        const currentProductSnap = await transaction.get(currentProductRef);
        if (!currentProductSnap.exists()) throw new Error("Producto no encontrado.");
        const currentProduct = currentProductSnap.data();
        transaction.update(orderRef, {
          ...basePatch,
          unitPrice:Number(currentProduct.precio || order.unitPrice || 0),
          grossTotal:Number(currentProduct.precio || order.unitPrice || 0) * Number(order.quantity || 1) + shipping,
          discountAmount:discountApplied ? Math.round((Number(currentProduct.precio || order.unitPrice || 0) * Number(order.quantity || 1) + shipping) * discountPercent / 100) : 0,
          total:(Number(currentProduct.precio || order.unitPrice || 0) * Number(order.quantity || 1) + shipping) - (discountApplied ? Math.round((Number(currentProduct.precio || order.unitPrice || 0) * Number(order.quantity || 1) + shipping) * discountPercent / 100) : 0),
          pricingVersionId:order.pricingVersionId || null
        });
        return { fulfillment:order.fulfillment, status:order.status };
      }

      if (!["confirmed", "supplier_pending"].includes(order.status)) throw new Error("Producto y cantidad solo pueden cambiar antes de iniciar despacho.");
      const newProductId = String(changes.productId || order.productId);
      const newQuantity = Math.max(1, Number(changes.quantity || 1));
      const oldProductRef = doc(db, "productos", order.productId);
      const newProductRef = doc(db, "productos", newProductId);
      const oldProductSnap = await transaction.get(oldProductRef);
      if (!oldProductSnap.exists()) throw new Error("El producto anterior no existe.");
      const newProductSnap = newProductId === order.productId ? oldProductSnap : await transaction.get(newProductRef);
      if (!newProductSnap.exists()) throw new Error("El nuevo producto no existe.");

      const oldProduct = oldProductSnap.data();
      const newProduct = newProductSnap.data();
      const oldQty = Number(order.quantity || 1);

      let oldOwnReserved = Number(oldProduct.reservado || 0);
      let oldSupplierReserved = Number(oldProduct.reservadoProveedor || 0);
      if (order.fulfillment === "own") oldOwnReserved = Math.max(0, oldOwnReserved - oldQty);
      else oldSupplierReserved = Math.max(0, oldSupplierReserved - oldQty);

      if (newProductId === order.productId) {
        const ownAvailable = Math.max(0, Number(newProduct.stockPropio || 0) - oldOwnReserved);
        const fulfillment = ownAvailable >= newQuantity ? "own" : "supplier";
        const supplierAvailable = Math.max(0, Number(newProduct.stockProveedor || 0) - oldSupplierReserved);
        if (fulfillment === "supplier" && supplierAvailable < newQuantity) throw new Error("El nuevo producto no tiene disponibilidad suficiente.");
        if (fulfillment === "own") oldOwnReserved += newQuantity; else oldSupplierReserved += newQuantity;
        transaction.update(newProductRef, { reservado:oldOwnReserved, reservadoProveedor:oldSupplierReserved, updatedAt:serverTimestamp() });
        const unitPrice = Number(newProduct.precio || 0);
        const status = fulfillment === "own" ? "confirmed" : "supplier_pending";
        transaction.update(orderRef, { ...basePatch, productId:newProductId, quantity:newQuantity, unitPrice,
          grossTotal:unitPrice*newQuantity+shipping,
          discountAmount:discountApplied ? Math.round((unitPrice*newQuantity+shipping) * discountPercent / 100) : 0,
          total:(unitPrice*newQuantity+shipping) - (discountApplied ? Math.round((unitPrice*newQuantity+shipping) * discountPercent / 100) : 0),
          pricingVersionId:newProduct.pricingVersionId || null, fulfillment, supplierId:fulfillment === "supplier" ? (newProduct.proveedorId || null) : null,
          supplierOrderId:null, guide:null, status });
        return { fulfillment, status };
      }

      transaction.update(oldProductRef, { reservado:oldOwnReserved, reservadoProveedor:oldSupplierReserved, updatedAt:serverTimestamp() });
      let newOwnReserved = Number(newProduct.reservado || 0);
      let newSupplierReserved = Number(newProduct.reservadoProveedor || 0);
      const ownAvailable = Math.max(0, Number(newProduct.stockPropio || 0) - newOwnReserved);
      const fulfillment = ownAvailable >= newQuantity ? "own" : "supplier";
      const supplierAvailable = Math.max(0, Number(newProduct.stockProveedor || 0) - newSupplierReserved);
      if (fulfillment === "supplier" && supplierAvailable < newQuantity) throw new Error("El nuevo producto no tiene disponibilidad suficiente.");
      if (fulfillment === "own") newOwnReserved += newQuantity; else newSupplierReserved += newQuantity;
      transaction.update(newProductRef, { reservado:newOwnReserved, reservadoProveedor:newSupplierReserved, updatedAt:serverTimestamp() });
      const unitPrice = Number(newProduct.precio || 0);
      const status = fulfillment === "own" ? "confirmed" : "supplier_pending";
      transaction.update(orderRef, { ...basePatch, productId:newProductId, quantity:newQuantity, unitPrice,
          grossTotal:unitPrice*newQuantity+shipping,
          discountAmount:discountApplied ? Math.round((unitPrice*newQuantity+shipping) * discountPercent / 100) : 0,
          total:(unitPrice*newQuantity+shipping) - (discountApplied ? Math.round((unitPrice*newQuantity+shipping) * discountPercent / 100) : 0),
        pricingVersionId:newProduct.pricingVersionId || null, fulfillment, supplierId:fulfillment === "supplier" ? (newProduct.proveedorId || null) : null,
        supplierOrderId:null, guide:null, status });
      return { fulfillment, status };
    });
    await writeAudit("pedido_editado", "pedido", orderId, actor, { allowProductChange, ...result });
    return result;
  }

  async function cancelOrder(orderId, actor, reason = "") {
    const orderRef = doc(db, "pedidos", orderId);
    await runTransaction(db, async transaction => {
      const orderSnap = await transaction.get(orderRef);
      if (!orderSnap.exists()) throw new Error("Pedido no encontrado.");
      const order = orderSnap.data();
      if (["cancelled", "delivered", "returned", "transit", "shipped"].includes(order.status)) throw new Error("Este pedido ya no puede cancelarse desde el sistema.");

      if (["confirmed", "preparing", "packed", "supplier_pending", "supplier_loaded"].includes(order.status)) {
        const productRef = doc(db, "productos", order.productId);
        const productSnap = await transaction.get(productRef);
        if (productSnap.exists()) {
          const product = productSnap.data();
          const qty = Number(order.quantity || 1);
          if (order.fulfillment === "own") {
            transaction.update(productRef, { reservado:Math.max(0, Number(product.reservado || 0)-qty), updatedAt:serverTimestamp() });
          } else {
            transaction.update(productRef, { reservadoProveedor:Math.max(0, Number(product.reservadoProveedor || 0)-qty), updatedAt:serverTimestamp() });
          }
        }
      }

      const safeReason = cleanText(reason || "", 500);
      transaction.update(orderRef, {
        status:"cancelled", cancellationReason:safeReason, cancelledAt:serverTimestamp(),
        timeline:[...(order.timeline || []), { at:new Date().toISOString(), label:`Pedido cancelado${safeReason ? ` · ${safeReason}` : ""}`, user:cleanText(actor.name,160), uid:actor.uid }],
        updatedAt:serverTimestamp()
      });
    });
    await writeAudit("pedido_cancelado", "pedido", orderId, actor, { reason:cleanText(reason,500) });
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
      preciosVersiones: 0,
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
    result.preciosVersiones = await deleteCollectionInChunks("preciosVersiones");
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

    await writeAudit("sistema_reiniciado", "sistema", "global", actor, result);
    return result;
  }

  function subscribeCollection(name, callback, onError) {
    return onSnapshot(collection(db, name), snap => callback(mapSnapshot(snap)), err => {
      console.error(`Firestore ${name}:`, err); if (onError) onError(err);
    });
  }

  function subscribeProductsForRole(role, callback, onError) {
    const source = ["seller","dispatch"].includes(role)
      ? query(collection(db, "productos"), where("sellerVisible", "==", true))
      : collection(db, "productos");
    return onSnapshot(source, snap => callback(mapSnapshot(snap)), err => {
      console.error("Firestore productos:", err); if (onError) onError(err);
    });
  }

  function subscribeOrdersForRole(role, uid, callback, onError) {
    const source = role === "seller"
      ? query(collection(db, "pedidos"), where("sellerAccessKey", "==", uid))
      : collection(db, "pedidos");
    return onSnapshot(source, snap => callback(mapSnapshot(snap)), err => {
      console.error("Firestore pedidos:", err); if (onError) onError(err);
    });
  }


  async function resolveProductDocumentId(productId, productSku = "") {
    const requested = String(productId || "").trim();
    const sku = String(productSku || "").trim().toUpperCase();
    if (!requested && !sku) return null;

    // 1) Caso normal: ID canónico de productos.
    if (requested) {
      const directRef = doc(db, "productos", requested);
      const directSnap = await getDoc(directRef);
      if (directSnap.exists()) return requested;
    }

    // 2) Compatibilidad con IDs antiguos embebidos en productos.
    if (requested) {
      try {
        const legacyQuery = query(collection(db, "productos"), where("legacyId", "==", requested));
        const legacySnap = await getDocs(legacyQuery);
        if (!legacySnap.empty) return legacySnap.docs[0].id;
      } catch (error) {
        // Algunos roles no pueden ejecutar consultas amplias por reglas. Seguimos
        // con las rutas deterministas sin convertir este fallback en un error.
        console.warn("No se pudo resolver legacyId:", error?.code || error);
      }

      try {
        const embeddedQuery = query(collection(db, "productos"), where("id", "==", requested));
        const embeddedSnap = await getDocs(embeddedQuery);
        if (!embeddedSnap.empty) return embeddedSnap.docs[0].id;
      } catch (error) {
        console.warn("No se pudo resolver id embebido:", error?.code || error);
      }
    }

    // 3) V16.2 podía enviar por error el ID del registro de precios privados
    // cuando admin/contabilidad mezclaban producto + preciosVersiones. Si llega
    // ese ID, lo traducimos al productId guardado en el registro contable.
    if (requested) {
      try {
        const pricingSnap = await getDoc(doc(db, "preciosVersiones", requested));
        if (pricingSnap.exists()) {
          const linkedProductId = String(pricingSnap.data()?.productId || "").trim();
          if (linkedProductId) {
            const linkedProductSnap = await getDoc(doc(db, "productos", linkedProductId));
            if (linkedProductSnap.exists()) return linkedProductId;
          }
        }
      } catch (error) {
        // Vendedores no tienen acceso a preciosVersiones; para ellos el selector
        // ya entrega el ID canónico y este fallback no es necesario.
        if (error?.code !== "permission-denied") console.warn("No se pudo resolver pricingVersionId:", error);
      }
    }

    // 4) Última defensa: resolver por SKU estable si el formulario proviene de
    // una pestaña/caché que conservó un ID anterior.
    if (sku) {
      try {
        const skuQuery = query(collection(db, "productos"), where("sku", "==", sku));
        const skuSnap = await getDocs(skuQuery);
        if (!skuSnap.empty) return skuSnap.docs[0].id;
      } catch (error) {
        console.warn("No se pudo resolver SKU:", error?.code || error);
      }
    }

    return null;
  }

  async function createOrder(baseOrder, actor) {
    const resolvedProductId = await resolveProductDocumentId(baseOrder.productId, baseOrder.productSku);
    if (!resolvedProductId) throw new Error("El producto ya no existe. Actualiza la página y vuelve a seleccionarlo.");
    const productRef = doc(db, "productos", resolvedProductId);
    const counterRef = doc(db, "configuracion", "contadores");
    const result = await runTransaction(db, async transaction => {
      const productSnap = await transaction.get(productRef);
      if (!productSnap.exists()) throw new Error("El producto ya no existe.");
      const counterSnap = await transaction.get(counterRef);
      if (!counterSnap.exists()) throw new Error("Falta inicializar configuracion/contadores. Ingresa como administrador e inicializa la base.");
      const product = productSnap.data();
      const quantity = Math.max(1, Number(baseOrder.quantity || 1));
      const ownReserved = Number(product.reservado || 0);
      const supplierReserved = Number(product.reservadoProveedor || 0);
      const availableOwn = Math.max(0, Number(product.stockPropio || 0)-ownReserved);
      const fulfillment = availableOwn >= quantity ? "own" : "supplier";
      const supplierAvailable = Math.max(0, Number(product.stockProveedor || 0)-supplierReserved);
      if (fulfillment === "supplier" && supplierAvailable < quantity) throw new Error("No existe disponibilidad suficiente en inventario propio ni proveedor.");

      const shipping = Math.max(0, Number(baseOrder.shipping || 0));
      const unitPrice = Math.max(0, Number(product.precio || 0));
      const discountApplied = baseOrder.discountApplied === true;
      const discountPercent = discountApplied ? 8 : 0;
      const grossTotal = unitPrice * quantity + shipping;
      const discountAmount = discountApplied ? Math.round(grossTotal * 0.08) : 0;
      const finalTotal = Math.max(0, grossTotal - discountAmount);
      const next = Number(counterSnap.data().pedidoConsecutivo || 0)+1;
      const orderId = `PED-${String(next).padStart(6, "0")}`;
      const orderRef = doc(db, "pedidos", orderId);
      const nowIso = new Date().toISOString();
      const customer = {
        name:cleanText(baseOrder.customer?.name,180),
        documentId:String(baseOrder.customer?.documentId || "").replace(/[^0-9A-Za-z.-]/g, "").slice(0,20),
        phone:String(baseOrder.customer?.phone || "").replace(/\D/g, "").slice(0,20),
        department:cleanText(baseOrder.customer?.department,120), city:cleanText(baseOrder.customer?.city,120),
        address:cleanText(baseOrder.customer?.address,300), neighborhood:cleanText(baseOrder.customer?.neighborhood,160), reference:cleanText(baseOrder.customer?.reference,300)
      };
      const order = {
        customer, productId:resolvedProductId, quantity, unitPrice, shipping,
        grossTotal, discountApplied, discountPercent, discountAmount, total:finalTotal,
        payment:baseOrder.payment === "transfer" ? "transfer" : "cod", source:cleanText(baseOrder.source,120), notes:cleanText(baseOrder.notes,1200),
        id:orderId, consecutivo:next, pricingVersionId:product.pricingVersionId || null,
        sellerUid:actor.uid, sellerAccessKey:actor.uid, seller:cleanText(actor.name,160), fulfillment,
        supplierId:fulfillment === "supplier" ? (product.proveedorId || null) : null,
        supplierOrderId:null, guide:null, status:fulfillment === "own" ? "confirmed" : "supplier_pending",
        collected:baseOrder.payment === "transfer", collectedAt:baseOrder.payment === "transfer" ? serverTimestamp() : null,
        createdAt:serverTimestamp(), createdAtClient:nowIso, updatedAt:serverTimestamp(),
        timeline:[{ at:nowIso, label:"Pedido confirmado", user:cleanText(actor.name,160), uid:actor.uid }]
      };
      transaction.set(orderRef, order);
      transaction.update(counterRef, { pedidoConsecutivo:next, updatedAt:serverTimestamp() });
      if (fulfillment === "own") transaction.update(productRef, { reservado:ownReserved+quantity, updatedAt:serverTimestamp() });
      else transaction.update(productRef, { reservadoProveedor:supplierReserved+quantity, updatedAt:serverTimestamp() });
      return { id:orderId, fulfillment, total:order.total };
    });
    await writeAudit("pedido_creado", "pedido", result.id, actor, { fulfillment:result.fulfillment, total:result.total });
    return result;
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
    const safeGuide = guide ? cleanText(guide, 180) : null;

    const next = await runTransaction(db, async transaction => {
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
        label = `Despachado · ${safeGuide || "sin guía"}`;

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
        ...(safeGuide ? { guide:safeGuide } : {}),
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
    await writeAudit("pedido_despacho_actualizado", "pedido", orderId, actor, { status:next, guide:safeGuide });
    return next;
  }

  async function loadSupplierOrder(orderId, supplierOrderId, actor) {
    const safeRef = cleanText(supplierOrderId, 180);
    await appendTimelineUpdate(orderId, {
      supplierOrderId:safeRef,
      status:"supplier_loaded"
    }, {
      at:new Date().toISOString(),
      label:`Cargado al proveedor · ${safeRef}`,
      user:cleanText(actor.name,160),
      uid:actor.uid
    });
    await writeAudit("pedido_cargado_proveedor", "pedido", orderId, actor, { supplierOrderId:safeRef });
  }

  async function setSupplierGuide(orderId, guide, actor) {
    const orderRef = doc(db, "pedidos", orderId);
    await runTransaction(db, async transaction => {
      const orderSnap = await transaction.get(orderRef);
      if (!orderSnap.exists()) throw new Error("Pedido no encontrado.");
      const order = orderSnap.data();
      if (order.fulfillment !== "supplier" || order.status !== "supplier_loaded") throw new Error("El pedido no está listo para registrar guía de proveedor.");
      const productRef = doc(db, "productos", order.productId);
      const productSnap = await transaction.get(productRef);
      if (!productSnap.exists()) throw new Error("Producto no encontrado.");
      const product = productSnap.data();
      const qty = Number(order.quantity || 1);
      const stock = Number(product.stockProveedor || 0);
      const reserved = Number(product.reservadoProveedor || 0);
      if (stock < qty || reserved < qty) throw new Error("El inventario reservado del proveedor no coincide con el pedido.");
      transaction.update(productRef, { stockProveedor:stock-qty, reservadoProveedor:Math.max(0,reserved-qty), updatedAt:serverTimestamp() });
      transaction.update(orderRef, {
        guide:cleanText(guide,180), status:"transit",
        timeline:[...(order.timeline || []), { at:new Date().toISOString(), label:`Proveedor despachó · ${cleanText(guide,180)}`, user:cleanText(actor.name,160), uid:actor.uid }],
        updatedAt:serverTimestamp()
      });
    });
    await writeAudit("pedido_guia_registrada", "pedido", orderId, actor, { guide:cleanText(guide,180) });
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
    await writeAudit("pedido_entregado", "pedido", orderId, actor);
  }

  async function markOrderCollected(orderId, actor, amount, reference = "") {
    const orderRef = doc(db, "pedidos", orderId);
    const safeReference = cleanText(reference, 240);
    await runTransaction(db, async transaction => {
      const snap = await transaction.get(orderRef);
      if (!snap.exists()) throw new Error("Pedido no encontrado.");
      const order = snap.data();
      if (order.status !== "delivered") throw new Error("Solo puedes conciliar pedidos entregados.");
      if (order.payment !== "cod") throw new Error("Este pedido no es contraentrega.");
      const received = Math.max(0, Number(amount || order.total || 0));
      transaction.update(orderRef, {
        collected:true, collectedAt:serverTimestamp(), collectedAmount:received, collectionReference:safeReference,
        timeline:[...(order.timeline || []), { at:new Date().toISOString(), label:`Recaudo conciliado · ${received}`, user:cleanText(actor.name,160), uid:actor.uid }],
        updatedAt:serverTimestamp()
      });
    });
    await writeAudit("recaudo_conciliado", "pedido", orderId, actor, { amount:Number(amount || 0), reference:safeReference });
  }

  async function addExpense(expense, actor) {
    const ref = await addDoc(collection(db, "gastos"), {
      category:cleanText(expense.category,120), concept:cleanText(expense.concept,600), amount:Math.max(0,Number(expense.amount||0)),
      createdBy:actor.uid, createdByName:cleanText(actor.name,160), date:serverTimestamp(), dateClient:new Date().toISOString()
    });
    await writeAudit("gasto_registrado", "gasto", ref.id, actor, { amount:Math.max(0,Number(expense.amount||0)) });
    return ref;
  }

  async function exportBackupData() {
    const names = ["productos", "preciosVersiones", "proveedores", "pedidos", "gastos", "usuariosSistema", "configuracion", "auditoria"];
    const result = { exportedAt:new Date().toISOString(), projectId:firebaseConfig.projectId, collections:{} };
    for (const name of names) {
      const snap = await getDocs(collection(db, name));
      result.collections[name] = snap.docs.map(d => ({ id:d.id, ...d.data() }));
    }
    return result;
  }

  async function seedDemoData(actor = null) {
    return seedEtechCatalog(actor);
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
    migratePrivatePricingData,
    detectSystemMigration,
    runSystemMigration,
    seedEtechCatalog,
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
    subscribeProductsForRole,
    subscribeOrdersForRole,
    createOrder,
    advanceOwnOrder,
    loadSupplierOrder,
    setSupplierGuide,
    markDelivered,
    markOrderCollected,
    addExpense,
    exportBackupData,
    writeAudit,
    seedDemoData
  };

  return window.FirebaseService;
})();
