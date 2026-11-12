import { describe, expect, it } from 'vitest';
import { describeAuthError, isValidEmail, normalizeCode } from './validate';

describe('account input', () => {
  it('accepts ordinary email addresses and trims them', () => {
    expect(isValidEmail('  maria@example.com ')).toBe(true);
    expect(isValidEmail('a.b+goa@mail.co.in')).toBe(true);
  });

  it('rejects things that are not email addresses', () => {
    for (const bad of ['', 'maria', 'maria@', '@example.com', 'maria@example', 'a b@example.com']) {
      expect(isValidEmail(bad)).toBe(false);
    }
    expect(isValidEmail(`${'a'.repeat(250)}@example.com`)).toBe(false);
  });

  it('keeps only the digits of a pasted code', () => {
    expect(normalizeCode(' 123 456 ')).toBe('123456');
    expect(normalizeCode('12-34-56')).toBe('123456');
    expect(normalizeCode('1234567890123')).toBe('1234567890');
    expect(normalizeCode('abc')).toBe('');
  });

  it('turns auth failures into plain words', () => {
    expect(describeAuthError({ status: 429 })).toMatch(/wait/i);
    expect(describeAuthError({ code: 'over_email_send_rate_limit' })).toMatch(/wait/i);
    expect(describeAuthError({ code: 'otp_expired' })).toMatch(/code/i);
    expect(describeAuthError({ message: 'Token has expired or is invalid' })).toMatch(/code/i);
    expect(describeAuthError({ message: 'reviewer_account' })).toMatch(/review team/i);
    expect(describeAuthError(new Error('Network request failed'))).toMatch(/connection/i);
    expect(describeAuthError(null)).toMatch(/try again/i);
  });
});
