const CURRENCY_SYMBOL: Record<string, string> = {
  USD: "$",
  EUR: "€",
  GBP: "£",
  RUB: "₽",
  RUR: "₽",
};

export function parseAmount(raw: string | number | undefined): number | undefined {
  if (raw === undefined || raw === null) return undefined;
  const n =
    typeof raw === "number"
      ? raw
      : parseFloat(String(raw).replace(/[^\d.,]/g, "").replace(",", "."));
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return n;
}

export function formatPrice(
  amount: number | undefined,
  currency?: string,
  highAmount?: number
): string | undefined {
  if (amount === undefined) return undefined;

  const code = (currency ?? "USD").toUpperCase();
  const sym = CURRENCY_SYMBOL[code];
  const fmt = (n: number) => {
    const rounded = Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, "");
    if (sym) return `${sym}${rounded}`;
    return `${rounded} ${code}`;
  };

  const high = highAmount !== undefined ? parseAmount(highAmount) : undefined;
  if (high !== undefined && high !== amount) {
    return `от ${fmt(amount)} до ${fmt(high)}`;
  }
  return fmt(amount);
}

export function formatPledgeFromCents(cents: number, currency?: string): string | undefined {
  return formatPrice(cents / 100, currency);
}
