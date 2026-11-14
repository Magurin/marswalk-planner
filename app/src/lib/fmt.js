// Number formatting: decimal point and English plurals.
export const fx = (n, d = 0) => (+n).toFixed(d)

// plural(3, ['check', 'checks']) -> 'checks'
export const plural = (n, forms) => (Math.abs(n) === 1 ? forms[0] : forms[forms.length - 1])
