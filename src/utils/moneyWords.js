/* ══════════════════════════════════════════════════════════════════
   src/utils/moneyWords.js

   Rupee amounts spelled out, for the tooltips on the attendance and cost
   tables. The figures there run to lakhs — ₹1,92,032.90 — where miscounting
   a digit is both easy and expensive, so the words act as the check on the
   numerals rather than as decoration.

   Indian numbering throughout (thousand → lakh → crore), matching the
   `toLocaleString("en-IN")` grouping the same figures are printed with. A
   converter that said "one hundred ninety-two thousand" beside a numeral
   grouped as 1,92,032 would be worse than none at all.
   ══════════════════════════════════════════════════════════════════ */

const ONES = [
  "", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
  "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen",
  "seventeen", "eighteen", "nineteen",
];
const TENS = [
  "", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety",
];

// 0–99
function underHundred(n) {
  if (n < 20) return ONES[n];
  const tens = TENS[Math.floor(n / 10)];
  const ones = ONES[n % 10];
  return ones ? `${tens}-${ones}` : tens;
}

// 0–999
function underThousand(n) {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  if (!hundreds) return underHundred(rest);
  const head = `${ONES[hundreds]} hundred`;
  return rest ? `${head} and ${underHundred(rest)}` : head;
}

/* Whole number → words on the Indian scale. Recursive on the crore group so
   amounts past 99 crore ("one hundred and five crore") still read correctly
   rather than running off the end of a fixed list. */
function indianWords(n) {
  if (n === 0) return "zero";
  const out = [];
  let rest = n;

  const crore = Math.floor(rest / 10000000);
  if (crore) {
    out.push(`${indianWords(crore)} crore`);
    rest %= 10000000;
  }
  // Both of these are < 100 once the larger group is removed, so they never
  // need the hundreds form.
  const lakh = Math.floor(rest / 100000);
  if (lakh) {
    out.push(`${underHundred(lakh)} lakh`);
    rest %= 100000;
  }
  const thousand = Math.floor(rest / 1000);
  if (thousand) {
    out.push(`${underHundred(thousand)} thousand`);
    rest %= 1000;
  }
  if (rest) {
    /* "One lakh and five", not "one lakh five" — the connective goes before a
       final group under a hundred, which is how the amount is read aloud. Above
       a hundred it isn't needed: underThousand already supplies one inside the
       group ("four hundred and thirty-four"). */
    const tail = underThousand(rest);
    out.push(out.length && rest < 100 ? `and ${tail}` : tail);
  }

  return out.join(" ");
}

const capitalise = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/* The tooltip string for a rupee amount: "One lakh ninety-two thousand and
   thirty-two rupees and ninety paise".

   Returns "" for anything unparseable, so a caller can pass it straight to
   `title` — an empty title renders no tooltip, which is the right outcome for
   a missing figure. */
export function rupeesInWords(value) {
  const n = typeof value === "number" ? value : parseFloat(value);
  if (!Number.isFinite(n)) return "";

  const negative = n < 0;
  /* Rounded to paise BEFORE splitting: going via Math.floor on the rupees and
     rounding the fraction separately turns 99.999 into "ninety-nine rupees and
     one hundred paise". */
  const totalPaise = Math.round(Math.abs(n) * 100);
  const rupees = Math.floor(totalPaise / 100);
  const paise = totalPaise % 100;

  const parts = [];
  if (rupees || !paise) {
    parts.push(`${indianWords(rupees)} ${rupees === 1 ? "rupee" : "rupees"}`);
  }
  if (paise) {
    parts.push(`${indianWords(paise)} ${paise === 1 ? "paisa" : "paise"}`);
  }

  const words = parts.join(" and ");
  return capitalise(negative ? `minus ${words}` : words);
}

export default rupeesInWords;
