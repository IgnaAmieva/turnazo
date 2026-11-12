/**
 * Normalizes an Argentine phone number to the E.164-like format used by WhatsApp:
 * always starts with "549" followed by 10 digits (area code + number).
 */
export function normalizeArgentinePhone(raw: string): string {
  // Strip everything that isn't a digit
  let digits = raw.replace(/\D/g, "");

  // 13 digits starting with "549" → international mobile, extract last 10
  if (digits.length === 13 && digits.startsWith("549")) {
    digits = digits.slice(3);
  }
  // 12 digits starting with "54" → international landline/old, extract last 10
  else if (digits.length === 12 && digits.startsWith("54")) {
    digits = digits.slice(2);
  }

  // Remove a leading "0" (trunk prefix) regardless of length
  if (digits.startsWith("0")) {
    digits = digits.slice(1);
  }

  // Old mobile format with "15" (12 digits after trunk removal failed or input was 12):
  // scan positions 2, 3, 4 for the substring "15" and remove those 2 digits
  if (digits.length === 12) {
    for (const pos of [2, 3, 4]) {
      if (digits.slice(pos, pos + 2) === "15") {
        digits = digits.slice(0, pos) + digits.slice(pos + 2);
        break;
      }
    }
  }

  return "549" + digits;
}

/**
 * Builds a WhatsApp deep-link URL.
 *
 * @param phone    Raw phone string (will be normalized via normalizeArgentinePhone).
 * @param template Optional message template; supports `{key}` placeholders.
 * @param vars     Values to substitute for placeholders in the template.
 */
export function buildWhatsAppUrl(
  phone: string,
  template?: string | null,
  vars?: Record<string, string>,
): string {
  const normalizedPhone = normalizeArgentinePhone(phone);
  let url = `https://wa.me/${normalizedPhone}`;

  if (template) {
    const message = template.replace(/\{(\w+)\}/g, (_, key) =>
      vars && key in vars ? vars[key] : `{${key}}`,
    );
    url += `?text=${encodeURIComponent(message)}`;
  }

  return url;
}
