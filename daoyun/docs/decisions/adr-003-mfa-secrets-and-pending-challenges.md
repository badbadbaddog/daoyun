# ADR-003: TOTP Secret Encryption and Pending MFA Challenges

## Status

Accepted

## Date

2026-08-10

## Context

DaoYun needs optional TOTP and recovery-code MFA. TOTP verification requires the server to recover a shared secret, while recovery codes must be one-time and cannot be stored in plaintext. Password and Passkey authentication must not create a full session before MFA completes.

## Decision

- Use `totp-rs 6.0.0` with RFC 6238 defaults: SHA-1, 6 digits, 30-second step and one-step clock skew.
- Encrypt TOTP secrets at rest with AES-256-GCM using a strict 32-byte deployment key from `DAOYUN_MFA_ENCRYPTION_KEY`. Generate a fresh 12-byte nonce per encryption and bind ciphertext to the user ID with associated data.
- Store recovery-code Argon2id PHC hashes only. Generate ten codes, display them once, and consume them with a conditional database update.
- Persist pending login challenges in PostgreSQL with a short TTL, attempt counter and SHA-256 hash of an HttpOnly browser binding token. The client submits only a challenge UUID and MFA code; the token is never logged or placed in browser storage.
- Complete MFA and session creation in one transaction after successful code verification. Revoke other sessions and rotate the current CSRF token for authenticated MFA changes.

## Alternatives considered

### Plaintext TOTP secret

Rejected: database readers or backups would immediately gain the ability to generate valid second factors.

### Hash TOTP secret

Rejected: the server must verify future codes and therefore needs recoverable key material; authenticated encryption provides confidentiality and tamper detection.

### Store pending MFA only in Redis

Rejected: Redis is optional and fail-open for this product. PostgreSQL is the authoritative source for authentication state and replay prevention.

### Let the client create a session before MFA

Rejected: a password or Passkey first step without MFA must not create a valid DaoYun session or CSRF token.

## Consequences

- Production deployments must back up and rotate the MFA encryption key through a documented secret-management process; losing the key makes existing TOTP secrets unreadable.
- MFA setup/verification adds small PostgreSQL transactions and Argon2 work for recovery-code checks.
- The API can safely expose a one-time setup secret and recovery-code bundle without exposing future secrets through reads or logs.

## Sources

- RFC 6238: <https://www.rfc-editor.org/rfc/rfc6238.html>
- totp-rs 6.0.0: <https://docs.rs/totp-rs/6.0.0/totp_rs/>
- aes-gcm 0.11.0: <https://docs.rs/aes-gcm/0.11.0/aes_gcm/>
