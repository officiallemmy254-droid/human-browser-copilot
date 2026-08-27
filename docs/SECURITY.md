# AI Browser Runtime — Security Model & Permission Contract

## 1. Threat Model & Guarantees

The AI Browser Runtime treats all external AI agent input as potentially untrusted and strictly contains browser operations through:

1. **Local Authentication (M9)**:
   - High-entropy cryptographic tokens generated locally per session.
   - Rejection of unauthenticated localhost agents with `AUTHENTICATION_REQUIRED`.
2. **Deterministic Origin Authorization (M8)**:
   - Evaluates exact `scheme://host:port`.
   - Rejects substring matches (e.g. `example.com` will never authorize `evil-example.com`).
   - Default: `DENY` for unconfigured origins.
3. **Four-Tier Permission Classification (M7)**:
   - **`READ`**: Read-only perception (`observe`, `readPageText`, `find`, in-memory `screenshot`). Never prompts.
   - **`INTERACT`**: Routine DOM mutations (`click`, `type`, `clear`, `keypress`, `scroll`, `navigate`, tab control, `screenshot` with `save_to_disk=true`). Prompts once per origin per session.
   - **`EXTERNAL_SIDE_EFFECT`**: Actions that mutate external state (`submit`, `send`, `publish`, `purchase`, `modify`, `delete`). **Always requires human approval per action**.
   - **`HIGH_RISK`**: Financial, credential, authentication, security, or irreversible mutations. **Always requires explicit human sign-off showing exact target and payload**.
4. **Non-Bypassable Runtime Tier Enforcement**:
   - The AI agent **CANNOT** self-declare its own permission tier.
   - In-page web content **CANNOT** alter the permission tier or grant approvals.
5. **No Secret Leakage (M20)**:
   - Passwords, cookies, private keys, and authorization headers are never logged or exposed as raw observation data.
