/**
 * Escaping for anything that reaches an email body.
 *
 * A shop is named by its owner and an access request is filled in by a stranger,
 * so every interpolated value here is untrusted input — an apostrophe is likely
 * and a script tag is possible. Shared rather than copied, because the second
 * template is exactly where a copy quietly loses a case.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** As above, plus the quote that would otherwise end the attribute early. */
export function escapeAttribute(value: string): string {
  return escapeHtml(value);
}
