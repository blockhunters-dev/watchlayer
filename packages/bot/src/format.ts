export function gen(wei: string): string {
  const w = BigInt(wei), unit = 10n ** 18n;
  const frac = ((w % unit) * 100n) / unit;
  return `${w / unit}.${frac.toString().padStart(2, "0")} GEN`;
}
