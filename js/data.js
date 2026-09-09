window.NEXO_DATA = {
  products: [
    { id: "P001", sku: "WATCH-X8-BLK", name: "Smartwatch X8", variant: "Negro", price: 129900, ownStock: 8, reserved: 1, ownCost: 43000, supplierId: "S001", supplierStock: 40, supplierCost: 48000 },
    { id: "P002", sku: "TWS-PRO-WHT", name: "Audífonos TWS Pro", variant: "Blanco", price: 89900, ownStock: 0, reserved: 0, ownCost: 35000, supplierId: "S001", supplierStock: 68, supplierCost: 39000 },
    { id: "P003", sku: "POWER-10K-BLK", name: "Power Bank 10.000 mAh", variant: "Negro", price: 109900, ownStock: 15, reserved: 0, ownCost: 42000, supplierId: "S002", supplierStock: 30, supplierCost: 46000 },
    { id: "P004", sku: "SPK-MINI-BLK", name: "Parlante Bluetooth Mini", variant: "Negro", price: 79900, ownStock: 3, reserved: 0, ownCost: 29000, supplierId: "S002", supplierStock: 25, supplierCost: 33000 }
  ],
  suppliers: [
    { id: "S001", name: "Tecnología XYZ", phone: "300 000 0001", model: "Despacho directo", settlement: "Semanal" },
    { id: "S002", name: "Importaciones ABC", phone: "300 000 0002", model: "Despacho directo", settlement: "Por pedido" }
  ],
  orders: [
    {
      id: "PED-001854", createdAt: "2026-08-31T15:20:00-05:00", seller: "Laura", customer: { name: "Juan Pérez", phone: "3101234567", department: "Quindío", city: "Armenia", address: "Cra 18 #23-45", neighborhood: "La Castellana", reference: "Casa blanca frente al parque" },
      productId: "P001", quantity: 1, unitPrice: 129900, shipping: 15000, total: 144900, payment: "cod", source: "Meta Ads", notes: "Llamar antes de entregar.",
      fulfillment: "own", supplierId: null, supplierOrderId: null, guide: null, status: "confirmed", collected: false,
      timeline: [{ at:"2026-08-31T15:20:00-05:00", label:"Pedido confirmado", user:"Laura" }]
    },
    {
      id: "PED-001853", createdAt: "2026-08-31T14:55:00-05:00", seller: "Laura", customer: { name: "Ana Gómez", phone: "3155551040", department: "Risaralda", city: "Pereira", address: "Av. 30 de Agosto #42-15", neighborhood: "Maraya", reference: "" },
      productId: "P002", quantity: 1, unitPrice: 89900, shipping: 14000, total: 103900, payment: "cod", source: "Meta Ads", notes: "",
      fulfillment: "supplier", supplierId: "S001", supplierOrderId: "XYZ-84639", guide: null, status: "supplier_loaded", collected: false,
      timeline: [{ at:"2026-08-31T14:55:00-05:00", label:"Pedido confirmado", user:"Laura" }, {at:"2026-08-31T15:05:00-05:00",label:"Cargado al proveedor",user:"Carlos"}]
    },
    {
      id: "PED-001852", createdAt: "2026-08-31T13:40:00-05:00", seller: "Andrés", customer: { name: "Miguel Rojas", phone: "3014412211", department: "Valle del Cauca", city: "Cali", address: "Calle 9 #56-20", neighborhood: "Limonar", reference: "" },
      productId: "P003", quantity: 1, unitPrice: 109900, shipping: 16000, total: 125900, payment: "transfer", source: "Instagram", notes: "",
      fulfillment: "own", supplierId: null, supplierOrderId: null, guide: "ENV-9581200", status: "transit", collected: true,
      timeline: [{at:"2026-08-31T13:40:00-05:00",label:"Pedido confirmado",user:"Andrés"},{at:"2026-08-31T14:10:00-05:00",label:"Despachado",user:"Carlos"}]
    },
    {
      id: "PED-001851", createdAt: "2026-08-30T18:20:00-05:00", seller: "Laura", customer: { name: "Camila Torres", phone: "3007896543", department: "Cundinamarca", city: "Bogotá", address: "Calle 80 #72-19", neighborhood: "Bonanza", reference: "Torre 2 apto 504" },
      productId: "P001", quantity: 1, unitPrice: 129900, shipping: 15000, total: 144900, payment: "cod", source: "Meta Ads", notes: "",
      fulfillment: "supplier", supplierId: "S001", supplierOrderId: "XYZ-84592", guide: "COO-11223344", status: "delivered", collected: true,
      timeline: [{at:"2026-08-30T18:20:00-05:00",label:"Pedido confirmado",user:"Laura"},{at:"2026-08-31T09:20:00-05:00",label:"Entregado",user:"Sistema"}]
    }
  ],
  expenses: [
    { id:"G-001", date:"2026-08-31T10:00:00-05:00", category:"Publicidad", concept:"Meta Ads - campaña Smartwatch", amount:180000 },
    { id:"G-002", date:"2026-08-31T12:00:00-05:00", category:"Empaques", concept:"Bolsas y etiquetas", amount:65000 }
  ]
};
