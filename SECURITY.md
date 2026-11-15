# Security policy

## Reporting a vulnerability
Please report security issues privately through GitHub's **Report a vulnerability** button
(Security tab → Advisories) rather than a public issue. We aim to acknowledge reports within
3 working days.

## How Chiktsa protects care data
- **Tenant isolation:** every record lives under `households/{id}`; every API call checks membership,
  role permissions, the senior's consent scope and access expiry. Firestore rules repeat these checks.
- **Authentication:** Firebase Auth in production; locally, scrypt-hashed passwords, 15-minute access
  tokens and rotating HttpOnly refresh cookies with reuse detection.
- **AI guardrails:** cloud AI is off until a household admin opts in; prompts carry only the minimum
  context for one senior; outputs are proposals a person confirms, never diagnoses or dose changes.
- **Transport and browser:** strict Content-Security-Policy, HSTS, `X-Frame-Options: DENY`,
  same-site cookies, rate-limited auth endpoints, open-redirect-safe navigation.
- **Uploads:** size limits and magic-byte type checks; files are served only to authorised members.
- **Supply chain:** `pip-audit`, `bandit` and `npm audit` run in CI; Dependabot keeps dependencies current.
- **Audit trail:** every change to care data is recorded with who, when and what changed.

The public Vercel demo uses sample data only. Never enter real medical information into it.
