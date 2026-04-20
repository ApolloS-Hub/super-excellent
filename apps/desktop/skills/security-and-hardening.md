---
name: security-and-hardening
description: Use when writing code that handles user input, authentication, file operations, database queries, or external API calls. Enforces OWASP Top 10 and defense-in-depth.
phase: review
category: security
tags: [security, owasp, auth, injection, xss, csrf, vulnerability]
triggers: [安全, security, 漏洞, vulnerability, owasp, auth, 加密, encryption]
workers: [security, developer, code_reviewer]
---

# Security and Hardening

## Overview
Security is not a feature you add later. Every code change is a security decision — explicit or implicit. This skill enforces OWASP Top 10 thinking and defense-in-depth on every touch of sensitive surfaces.

## When to Use
- Any code that accepts external input (HTTP body, query params, file uploads)
- Authentication / authorization logic
- Cryptography (storing passwords, signing tokens, encrypting data)
- File system operations (paths from user input)
- Database queries
- Process execution (shell commands)
- External API calls

## OWASP Top 10 Checks

### A01:2021 Broken Access Control
- Every protected endpoint checks authentication AND authorization
- Authorization checks the right OBJECT — "can user X access resource Y" not just "is user X logged in"
- IDOR: never trust IDs in URLs — verify ownership

### A02:2021 Cryptographic Failures
- No MD5/SHA1 for passwords — use Argon2id or bcrypt
- No custom crypto — use battle-tested libraries
- Secrets in environment/secret-manager, never in code or logs
- TLS everywhere, no HTTP

### A03:2021 Injection
- SQL: parameterized queries only, never string concatenation
- Shell: don't pass user input to `exec()`. If you must, use array form + allowlist
- LDAP / XPath / NoSQL: same rules as SQL
- Template injection: escape all variables

### A04:2021 Insecure Design
- Threat model the feature: "what would an attacker do?"
- Rate limiting on auth, expensive endpoints, APIs
- Fail closed (deny by default), not open
- Audit trail for sensitive operations

### A05:2021 Security Misconfiguration
- Default passwords changed
- Error messages don't leak internals (stack traces, query strings)
- Unused features/endpoints removed
- Security headers (CSP, HSTS, X-Frame-Options) present

### A06:2021 Vulnerable Components
- Dependencies scanned (npm audit, snyk, dependabot)
- Stay on supported versions
- Pin exact versions in lockfile

### A07:2021 Authentication Failures
- Strong password policy with breach-list check
- MFA for sensitive accounts
- Lockout / throttle on repeated failures
- Session tokens: HttpOnly, Secure, SameSite, rotate on login/privilege change
- Timing-safe comparison for secrets

### A08:2021 Data Integrity Failures
- Verify signatures on code/data you didn't generate
- Don't deserialize untrusted data (no Pickle/Java Serialize from user input)

### A09:2021 Logging Failures
- Log auth events, authz denials, admin actions
- Don't log passwords, tokens, PII
- Centralize logs, alert on anomalies

### A10:2021 SSRF
- Server-side URL fetch: allowlist hosts, block private IP ranges (127.0.0.0/8, 10.0.0.0/8, 169.254.0.0/16, etc.)
- DNS rebinding: resolve the hostname yourself, don't let the HTTP library do it

## Defense in Depth
- Each layer assumes the layer before it has been breached
- Firewall → App auth → DB user with minimum privileges → Encrypted columns
- If one layer fails, others still protect

## Process

1. **Identify the sensitive surface**: what data flows through this change?
2. **Threat model**: what would an attacker try? (injection, bypass, DoS, data exfil)
3. **Apply relevant OWASP categories** from the list above
4. **Code with the threat in mind**: validate input, escape output, parameterize queries, scope auth
5. **Add security tests**: negative tests (unauthorized user, malformed input, oversized payload)
6. **Log + monitor**: the attack should be detectable

## STRIDE Threat Model (quick check)
- **S**poofing — can someone pretend to be another user?
- **T**ampering — can data be modified in transit or at rest?
- **R**epudiation — can someone deny an action? (audit logs)
- **I**nformation disclosure — does an error/response leak data?
- **D**enial of Service — can a small request cause large cost?
- **E**levation of privilege — can a normal user gain admin?

## Rationalizations

| Rationalization | Reality |
|-----------------|---------|
| "It's an internal endpoint" | Internal becomes external in a breach |
| "The frontend validates it" | Attackers don't use your frontend |
| "We'll add auth later" | "Later" means "never" |
| "This input is safe, it's a number" | Until someone sends "1; DROP TABLE" |

## Red Flags
- `eval()` / `Function()` / `setTimeout(string)` with any user input
- String concatenation to build SQL / shell commands / HTML
- `SELECT *` with PII (over-fetching sensitive columns)
- Hardcoded credentials or API keys
- `Access-Control-Allow-Origin: *` with credentialed requests
- Passwords stored with SHA1/MD5 or reversibly encrypted
- Errors returned to clients with stack traces / query text
- `chmod 777` / world-writable files

## Verification
- [ ] All external inputs validated at the boundary (schema, size, type)
- [ ] All SQL uses parameterized queries
- [ ] All output (HTML/JSON) escaped for its context
- [ ] Auth + authz checked on every protected route
- [ ] Secrets in env/vault, never code
- [ ] Security tests added for the auth/authz cases
- [ ] Threat model documented in PR description
