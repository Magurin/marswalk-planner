// Russian number formatting: decimal comma and plural forms.
export const fx = (n, d = 0) => (+n).toFixed(d).replace('.', ',')

// plural(3, ['проверка', 'проверки', 'проверок']) -> 'проверки'
export function plural(n, [one, few, many]) {
  const a = Math.abs(n) % 100, b = a % 10
  if (a > 10 && a < 20) return many
  if (b === 1) return one
  if (b >= 2 && b <= 4) return few
  return many
}
