/**
 * Grand Exchange sales tax (OSRS, 2026): 2% of the sale price per item, rounded down,
 * capped at 5,000,000; no tax on items sold under 50 gp; a fixed exempt list.
 * Exempt items are matched by exact name against /mapping (names use the "(tablet)" suffix).
 */
export const TAX_RATE = 0.02;
export const TAX_CAP = 5_000_000;
export const TAX_MIN_PRICE = 50;

export const EXEMPT_NAMES: readonly string[] = [
  "Old school bond",
  "Mind rune",
  "Bronze arrow", "Iron arrow", "Steel arrow",
  "Bronze dart", "Iron dart", "Steel dart",
  "Bass", "Bread", "Cake", "Cooked chicken", "Cooked meat", "Herring", "Lobster",
  "Mackerel", "Meat pie", "Pike", "Salmon", "Shrimps", "Tuna",
  "Games necklace(8)", "Ring of dueling(8)",
  "Chisel", "Gardening trowel", "Glassblowing pipe", "Hammer", "Needle",
  "Pestle and mortar", "Rake", "Saw", "Secateurs", "Seed dibber", "Shears", "Spade",
  "Varrock teleport (tablet)", "Lumbridge teleport (tablet)", "Falador teleport (tablet)",
  "Camelot teleport (tablet)", "Ardougne teleport (tablet)", "Kourend castle teleport (tablet)",
  "Civitas illa fortis teleport (tablet)", "Teleport to house (tablet)",
];
export const EXEMPT_PREFIXES: readonly string[] = ["Energy potion(", "Watering can"];

export function isExemptName(name: string): boolean {
  const n = name.trim().toLowerCase();
  if (EXEMPT_NAMES.some((e) => e.toLowerCase() === n)) return true;
  return EXEMPT_PREFIXES.some((p) => n.startsWith(p.toLowerCase()));
}

export function buildExemptIds(items: { id: number; name: string }[]): Set<number> {
  return new Set(items.filter((i) => isExemptName(i.name)).map((i) => i.id));
}

/** Tax paid when selling ONE unit at `price`. */
export function geTax(price: number, itemId: number, exempt: Set<number>): number {
  if (price < TAX_MIN_PRICE || exempt.has(itemId)) return 0;
  return Math.min(Math.floor(price * TAX_RATE), TAX_CAP);
}

export function netAfterTax(price: number, itemId: number, exempt: Set<number>): number {
  return price - geTax(price, itemId, exempt);
}
