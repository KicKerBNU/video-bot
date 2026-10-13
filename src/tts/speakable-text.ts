/**
 * Expand money, percents, versions, and dates into words XTTS can pronounce
 * reliably (avoids "$100M" → gibberish / wrong tokens).
 */

const ONES = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
];
const TENS = [
  '',
  '',
  'twenty',
  'thirty',
  'forty',
  'fifty',
  'sixty',
  'seventy',
  'eighty',
  'ninety',
];

function under100(n: number): string {
  if (n < 20) return ONES[n];
  const t = Math.floor(n / 10);
  const o = n % 10;
  return o === 0 ? TENS[t] : `${TENS[t]} ${ONES[o]}`;
}

function under1000(n: number): string {
  if (n < 100) return under100(n);
  const h = Math.floor(n / 100);
  const rest = n % 100;
  return rest === 0
    ? `${ONES[h]} hundred`
    : `${ONES[h]} hundred ${under100(rest)}`;
}

/** Integer 0–999_999_999_999 → English words (US). */
export function integerToWords(value: number): string {
  if (!Number.isFinite(value) || value < 0) return String(value);
  const n = Math.floor(value);
  if (n === 0) return 'zero';
  if (n < 1000) return under1000(n);

  const scales: Array<[number, string]> = [
    [1_000_000_000, 'billion'],
    [1_000_000, 'million'],
    [1_000, 'thousand'],
  ];
  const parts: string[] = [];
  let rest = n;
  for (const [scale, name] of scales) {
    if (rest >= scale) {
      const chunk = Math.floor(rest / scale);
      parts.push(`${under1000(chunk)} ${name}`);
      rest %= scale;
    }
  }
  if (rest > 0) parts.push(under1000(rest));
  return parts.join(' ');
}

function decimalToWords(raw: string): string {
  const cleaned = raw.replace(/,/g, '');
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return raw;
  const [whole, frac] = cleaned.split('.');
  const wholeWords = integerToWords(Number(whole));
  if (!frac) return wholeWords;
  const fracWords = frac
    .split('')
    .map((d) => ONES[Number(d)] ?? d)
    .join(' ');
  return `${wholeWords} point ${fracWords}`;
}

function moneyAmountToWords(amount: string, suffix?: string): string {
  const cleaned = amount.replace(/,/g, '');
  const num = Number(cleaned);
  if (!Number.isFinite(num)) return amount;

  let scaleWords = '';
  let value = num;
  const suf = (suffix ?? '').toUpperCase();
  if (suf === 'K') {
    scaleWords = 'thousand';
  } else if (suf === 'M') {
    scaleWords = 'million';
  } else if (suf === 'B') {
    scaleWords = 'billion';
  } else if (suf === 'T') {
    scaleWords = 'trillion';
  }

  const core = cleaned.includes('.')
    ? decimalToWords(cleaned)
    : integerToWords(Math.round(value));
  return scaleWords ? `${core} ${scaleWords} dollars` : `${core} dollars`;
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** Make news copy speakable for neural TTS. */
export function toSpeakableText(input: string): string {
  let text = input;

  // Country / orgs (US before shorter letter expansions)
  text = text.replace(/\bU\.S\.A\.\b/g, 'United States');
  text = text.replace(/\bU\.S\.\b/g, 'United States');
  text = text.replace(/\bUSA\b/g, 'United States');
  text = text.replace(/\bUS\b/g, 'United States');
  text = text.replace(/\bU\.K\.\b/g, 'United Kingdom');
  text = text.replace(/\bUK\b/g, 'United Kingdom');
  text = text.replace(/\bE\.U\.\b/g, 'European Union');
  text = text.replace(/\bEU\b/g, 'European Union');

  // Vendors
  text = text.replace(/\bNVIDIA\b/gi, 'Nvidia');
  text = text.replace(/\bDeepSeek\b/gi, 'Deep Seek');
  text = text.replace(/\bChatGPT\b/g, 'Chat G P T');
  text = text.replace(/\bGPT-?(\d+)\b/gi, 'G P T $1');
  text = text.replace(/\bLlama\b/gi, 'Llama');

  // User-tested: "A-I" (dash) is the most reliable Kokoro/Edge reading —
  // better than "A.I.", "A I", or "artificial intelligence" for our news reads.
  text = text.replace(
    /\bZanshin(?:AI|\s+A\.?\s*I\.?|\s+A\s*[-–—]\s*I|\s+ay\s+eye|\s+Artificial\s+Intelligence)\b/gi,
    'Zanshin A-I',
  );
  text = text.replace(
    /\bOpen(?:AI|\s+A\.?\s*I\.?|\s+A\s*[-–—]\s*I|\s+ay\s+eye)\b/gi,
    'Open A-I',
  );
  text = text.replace(/\bay\s+eye\b/gi, 'A-I');
  text = text.replace(/\bartificial intelligence\b/gi, 'A-I');
  // Match "A.I." without needing a word-boundary after the final dot.
  text = text.replace(/\bA\.I\./gi, 'A-I');
  text = text.replace(/\bA\.I\b/gi, 'A-I');
  text = text.replace(/\bA\s*[-–—]\s*I\b/gi, 'A-I');
  text = text.replace(/\bA,\s*I\b/gi, 'A-I');
  text = text.replace(/\bA\s+I\b/g, 'A-I');
  text = text.replace(/\bAI\b/g, 'A-I');
  text = text.replace(/\bA-I\.(?=\s+[a-z])/g, 'A-I');

  // Other tech acronyms — spaced letters
  text = text.replace(/\bAPI\b/g, 'A P I');
  text = text.replace(/\bGPUs\b/g, 'G P Us');
  text = text.replace(/\bGPU\b/g, 'G P U');
  text = text.replace(/\bCPUs\b/g, 'C P Us');
  text = text.replace(/\bCPU\b/g, 'C P U');
  text = text.replace(/\bIPO\b/g, 'I P O');
  text = text.replace(/\bCEO\b/g, 'C E O');

  // $100M / $1.5B / $100 million (currency symbol forms)
  text = text.replace(
    /\$\s*(\d{1,3}(?:,\d{3})*(?:\.\d+)?|\d+(?:\.\d+)?)\s*([KMBT])\b/gi,
    (_m, amount: string, suffix: string) => moneyAmountToWords(amount, suffix),
  );
  text = text.replace(
    /\$\s*(\d{1,3}(?:,\d{3})*(?:\.\d+)?|\d+(?:\.\d+)?)\s*(million|billion|trillion|thousand)\b/gi,
    (_m, amount: string, scale: string) => {
      const words = amount.includes('.')
        ? decimalToWords(amount.replace(/,/g, ''))
        : integerToWords(Number(amount.replace(/,/g, '')));
      return `${words} ${scale.toLowerCase()} dollars`;
    },
  );
  text = text.replace(
    /\$\s*(\d{1,3}(?:,\d{3})*(?:\.\d+)?|\d+(?:\.\d+)?)\b/g,
    (_m, amount: string) => moneyAmountToWords(amount),
  );

  // 100M / 1B without $ when clearly money context is harder — still expand bare M/B after numbers in news
  text = text.replace(
    /\b(\d{1,3}(?:,\d{3})*(?:\.\d+)?|\d+(?:\.\d+)?)\s*([KMBT])\b/g,
    (full, amount: string, suffix: string, offset: number, src: string) => {
      // skip if already handled as dollars nearby
      const before = src.slice(Math.max(0, offset - 12), offset).toLowerCase();
      if (before.includes('dollar')) return full;
      const scale =
        suffix.toUpperCase() === 'K'
          ? 'thousand'
          : suffix.toUpperCase() === 'M'
            ? 'million'
            : suffix.toUpperCase() === 'B'
              ? 'billion'
              : 'trillion';
      const words = amount.includes('.')
        ? decimalToWords(amount.replace(/,/g, ''))
        : integerToWords(Number(amount.replace(/,/g, '')));
      return `${words} ${scale}`;
    },
  );

  // 40% → forty percent
  text = text.replace(
    /\b(\d{1,3}(?:,\d{3})*(?:\.\d+)?|\d+(?:\.\d+)?)\s*%/g,
    (_m, amount: string) =>
      `${amount.includes('.') ? decimalToWords(amount.replace(/,/g, '')) : integerToWords(Number(amount.replace(/,/g, '')))} percent`,
  );

  // ISO dates 2026-10-12 → October twelfth, twenty twenty-six (simple)
  text = text.replace(
    /\b(20\d{2})-(\d{2})-(\d{2})\b/g,
    (_m, y: string, mo: string, d: string) => {
      const month = MONTHS[Number(mo) - 1];
      if (!month) return `${y} ${mo} ${d}`;
      return `${month} ${integerToWords(Number(d))}, ${integerToWords(Number(y))}`;
    },
  );

  // Version-like decimals after a word: Haiku 5.5 → Haiku five point five
  text = text.replace(
    /\b([A-Za-z][A-Za-z0-9+]*)\s+(\d+)\.(\d+)\b/g,
    (_m, label: string, whole: string, frac: string) => {
      const fracWords = frac
        .split('')
        .map((ch) => ONES[Number(ch)] ?? ch)
        .join(' ');
      return `${label} ${integerToWords(Number(whole))} point ${fracWords}`;
    },
  );

  // Standalone thousands with commas: 10,000 → ten thousand
  text = text.replace(/\b(\d{1,3}(?:,\d{3})+)\b/g, (_m, raw: string) =>
    integerToWords(Number(raw.replace(/,/g, ''))),
  );

  // Slash dates 10/12/2026
  text = text.replace(
    /\b(\d{1,2})\/(\d{1,2})\/(20\d{2})\b/g,
    (_m, mo: string, d: string, y: string) => {
      const month = MONTHS[Number(mo) - 1];
      if (!month) return `${mo} ${d} ${y}`;
      return `${month} ${integerToWords(Number(d))}, ${integerToWords(Number(y))}`;
    },
  );

  return text.replace(/\s+/g, ' ').trim();
}
