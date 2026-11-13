/**
 * The demo shop: a fictional hardware and sanitary store in Pune (SPEC F12, Phase 12 plan).
 *
 * Products are everyday items with their 4-digit HSN heading. Every one is at 18%, a rate that
 * is well established for these headings after the September 2025 changes (cement moved to 18%
 * then). Demo data only: every demo page says so, and it is not tax advice.
 */

export const DEMO_BUSINESS = {
  slug: "demo-sharma-hardware",
  legalName: "Sharma Hardware & Sanitary",
  tradeName: "Sharma Hardware",
  addressLine1: "Shop 12, Market Yard Road",
  addressLine2: "Gultekdi",
  city: "Pune",
  pincode: "411037",
  stateCode: "27",
  gstScheme: "REGULAR",
  /** Fictional, with a valid check character (built in `demoGstin`). */
  panBody: "ZZSPH4821K",
  invoicePrefix: "SH",
  creditNotePrefix: "SHCN",
  hsnDigitsRequired: 4,
} as const;

export interface DemoProduct {
  name: string;
  hsnSac: string;
  unit: string;
  /** Rupees, as typed in the product form. */
  price: string;
  sku: string;
  /** Some prices are MRP-style, tax included. */
  priceIncludesTax?: boolean;
}

export const DEMO_RATE_BP = 1800;

export const DEMO_PRODUCTS: readonly DemoProduct[] = [
  // Fasteners (7317, 7318)
  { name: "Wire nails 2 inch (1 kg)", hsnSac: "7317", unit: "KGS", price: "95", sku: "NAIL-2IN" },
  { name: "Wire nails 3 inch (1 kg)", hsnSac: "7317", unit: "KGS", price: "92", sku: "NAIL-3IN" },
  {
    name: "Wood screws 1 inch (box of 100)",
    hsnSac: "7318",
    unit: "BOX",
    price: "140",
    sku: "SCR-W1",
  },
  {
    name: "Self-drilling screws (box of 100)",
    hsnSac: "7318",
    unit: "BOX",
    price: "260",
    sku: "SCR-SD",
  },
  { name: "Anchor fasteners 10 mm", hsnSac: "7318", unit: "PCS", price: "18", sku: "ANC-10" },
  { name: "Nut and bolt set M8", hsnSac: "7318", unit: "SET", price: "12", sku: "NB-M8" },
  // Pipes and fittings (3917)
  { name: "PVC pipe 1/2 inch (3 m)", hsnSac: "3917", unit: "PCS", price: "165", sku: "PVC-05" },
  { name: "PVC pipe 1 inch (3 m)", hsnSac: "3917", unit: "PCS", price: "290", sku: "PVC-10" },
  { name: "CPVC pipe 3/4 inch (3 m)", hsnSac: "3917", unit: "PCS", price: "385", sku: "CPVC-075" },
  { name: "PVC elbow 1 inch", hsnSac: "3917", unit: "PCS", price: "22", sku: "ELB-10" },
  { name: "PVC tee 1 inch", hsnSac: "3917", unit: "PCS", price: "28", sku: "TEE-10" },
  { name: "Garden hose 15 m", hsnSac: "3917", unit: "ROL", price: "720", sku: "HOSE-15" },
  // Paints and finishes (3208, 3209, 3214)
  {
    name: "Enamel paint white (1 L)",
    hsnSac: "3208",
    unit: "LTR",
    price: "345",
    sku: "ENA-W1",
    priceIncludesTax: true,
  },
  {
    name: "Enamel paint black (1 L)",
    hsnSac: "3208",
    unit: "LTR",
    price: "345",
    sku: "ENA-B1",
    priceIncludesTax: true,
  },
  {
    name: "Wood primer (1 L)",
    hsnSac: "3208",
    unit: "LTR",
    price: "260",
    sku: "PRM-W1",
    priceIncludesTax: true,
  },
  {
    name: "Interior emulsion (4 L)",
    hsnSac: "3209",
    unit: "NOS",
    price: "1180",
    sku: "EMU-I4",
    priceIncludesTax: true,
  },
  {
    name: "Exterior emulsion (4 L)",
    hsnSac: "3209",
    unit: "NOS",
    price: "1560",
    sku: "EMU-E4",
    priceIncludesTax: true,
  },
  { name: "Wall putty (20 kg)", hsnSac: "3214", unit: "BAG", price: "690", sku: "PUT-20" },
  { name: "Tile grout (1 kg)", hsnSac: "3214", unit: "KGS", price: "85", sku: "GRT-1" },
  // Adhesives and sealants (3506, 3214)
  { name: "Synthetic adhesive (1 kg)", hsnSac: "3506", unit: "KGS", price: "310", sku: "ADH-1" },
  { name: "PVC solvent cement (100 ml)", hsnSac: "3506", unit: "NOS", price: "75", sku: "SOL-100" },
  { name: "Silicone sealant (300 ml)", hsnSac: "3214", unit: "NOS", price: "190", sku: "SIL-300" },
  { name: "Epoxy putty (100 g)", hsnSac: "3506", unit: "NOS", price: "60", sku: "EPX-100" },
  // Taps, valves and sanitary fittings (8481, 6910, 3922)
  { name: "Brass bib tap", hsnSac: "8481", unit: "NOS", price: "420", sku: "TAP-BIB" },
  { name: "Pillar tap chrome", hsnSac: "8481", unit: "NOS", price: "650", sku: "TAP-PIL" },
  { name: "Ball valve 1 inch", hsnSac: "8481", unit: "NOS", price: "240", sku: "VAL-10" },
  { name: "Angle valve", hsnSac: "8481", unit: "NOS", price: "210", sku: "VAL-ANG" },
  { name: "Wash basin (ceramic)", hsnSac: "6910", unit: "NOS", price: "1450", sku: "BAS-CER" },
  { name: "Western toilet seat cover", hsnSac: "3922", unit: "NOS", price: "540", sku: "SEAT-COV" },
  { name: "Flush tank (PVC)", hsnSac: "3922", unit: "NOS", price: "980", sku: "FLT-PVC" },
  { name: "Health faucet set", hsnSac: "8481", unit: "SET", price: "560", sku: "HF-SET" },
  { name: "Connection pipe 18 inch", hsnSac: "3917", unit: "NOS", price: "95", sku: "CON-18" },
  // Electricals (8536, 8544) and plastics (3919, 3926)
  { name: "Modular switch 6 A", hsnSac: "8536", unit: "NOS", price: "48", sku: "SW-6A" },
  { name: "Modular socket 16 A", hsnSac: "8536", unit: "NOS", price: "135", sku: "SKT-16A" },
  { name: "MCB 32 A single pole", hsnSac: "8536", unit: "NOS", price: "260", sku: "MCB-32" },
  {
    name: "Copper wire 1.5 sq mm (90 m)",
    hsnSac: "8544",
    unit: "ROL",
    price: "1590",
    sku: "WIR-15",
  },
  {
    name: "Copper wire 2.5 sq mm (90 m)",
    hsnSac: "8544",
    unit: "ROL",
    price: "2450",
    sku: "WIR-25",
  },
  { name: "Extension cord 4 sockets", hsnSac: "8544", unit: "NOS", price: "380", sku: "EXT-4" },
  {
    name: "Cable ties 200 mm (pack of 100)",
    hsnSac: "3926",
    unit: "PAC",
    price: "70",
    sku: "CTIE-200",
  },
  {
    name: "Plastic wall plugs (pack of 100)",
    hsnSac: "3926",
    unit: "PAC",
    price: "55",
    sku: "PLUG-100",
  },
  { name: "PVC insulation tape", hsnSac: "3919", unit: "ROL", price: "20", sku: "TAPE-INS" },
  // Hand tools (8203, 8204, 8205, 8206, 8207)
  { name: "Claw hammer", hsnSac: "8205", unit: "NOS", price: "320", sku: "HAM-CLW" },
  { name: "Screwdriver set (6 pieces)", hsnSac: "8205", unit: "SET", price: "280", sku: "SD-SET6" },
  { name: "Combination pliers 8 inch", hsnSac: "8203", unit: "NOS", price: "260", sku: "PLR-8" },
  { name: "Adjustable spanner 10 inch", hsnSac: "8204", unit: "NOS", price: "340", sku: "SPN-ADJ" },
  { name: "Hacksaw frame with blade", hsnSac: "8205", unit: "NOS", price: "230", sku: "HSW-FRM" },
  { name: "Measuring tape 5 m", hsnSac: "9017", unit: "NOS", price: "150", sku: "TAPE-5M" },
  { name: "Masonry drill bit 8 mm", hsnSac: "8207", unit: "NOS", price: "75", sku: "DRB-8" },
  { name: "Spirit level 12 inch", hsnSac: "9015", unit: "NOS", price: "210", sku: "LVL-12" },
  // Locks and door hardware (8301, 8302)
  { name: "Padlock 50 mm", hsnSac: "8301", unit: "NOS", price: "290", sku: "PAD-50" },
  { name: "Mortise lock set", hsnSac: "8301", unit: "SET", price: "1250", sku: "MOR-SET" },
  { name: "Door hinge 4 inch (pair)", hsnSac: "8302", unit: "PRS", price: "110", sku: "HNG-4" },
  { name: "Tower bolt 6 inch", hsnSac: "8302", unit: "NOS", price: "85", sku: "TWB-6" },
  { name: "Door handle stainless steel", hsnSac: "8302", unit: "NOS", price: "240", sku: "DH-SS" },
  // Building materials (2523, 6810, 7214, 7217)
  { name: "OPC cement 53 grade (50 kg)", hsnSac: "2523", unit: "BAG", price: "370", sku: "CEM-53" },
  { name: "White cement (1 kg)", hsnSac: "2523", unit: "KGS", price: "48", sku: "CEM-WH" },
  { name: "Tile adhesive (20 kg)", hsnSac: "3214", unit: "BAG", price: "520", sku: "TAD-20" },
  { name: "Binding wire (1 kg)", hsnSac: "7217", unit: "KGS", price: "88", sku: "BWR-1" },
  { name: "Waterproofing compound (1 L)", hsnSac: "3824", unit: "LTR", price: "240", sku: "WPC-1" },
  { name: "Sandpaper sheet (pack of 10)", hsnSac: "6805", unit: "PAC", price: "90", sku: "SND-10" },
];
