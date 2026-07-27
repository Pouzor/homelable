# OpenID Connect (OIDC) Authentication

Homelable can delegate login to your own identity provider (IdP) instead of the
built-in username/password. Sign-in uses the standard **Authorization Code flow
with PKCE**: the browser is redirected to your IdP, and on return Homelable
issues its own short-lived session cookie. Provider access/ID tokens are
exchanged server-side and **never** reach the browser.

Use it when you want single sign-on, per-user accounts managed at the IdP, MFA,
or central account revocation — Authentik, Keycloak, Authelia, Zitadel, Google,
Microsoft Entra ID, Okta, or any spec-compliant OpenID Connect provider.

> 🔒 **Server-dependent feature** — requires the Homelable backend. It is hidden
> in the no-backend standalone/demo build, which has no login at all.

---

## How it works

1. Homelable exposes its mode at `GET /api/v1/auth/config`. In OIDC mode the
   login screen shows **Sign in with OpenID Connect**.
2. `GET /api/v1/auth/oidc/login` redirects to your IdP with `state`, `nonce`,
   and a PKCE `code_challenge` (S256).
3. The IdP authenticates the user and redirects back to
   `GET /api/v1/auth/oidc/callback`.
4. Homelable validates the response (signature via the IdP's JWKS, issuer,
   audience, expiry, `nonce`, `state`, PKCE) and mints its **own** session token.
5. That token is stored in a `__Host-`, `HttpOnly`, `Secure`, `SameSite=Lax`
   cookie. The browser never sees the provider tokens.

The display name shown in the app is the first present of
`preferred_username` → `name` → `email` → `sub`.

Local Bearer authentication and the MCP service key keep working unchanged, so
the API and the MCP server are unaffected.

---

## Prerequisites

1. A reachable **OpenID Connect** provider with a discovery document
   (`.well-known/openid-configuration`).
2. Homelable served over **HTTPS** in production (required for the secure
   session cookie).
3. A **confidential** OIDC client (client id **and** secret) registered at the
   IdP, with Homelable's callback URL allow-listed as a redirect URI.

---

## Configuration

All settings live in `.env` (see `.env.example`). Switching to OIDC is
exclusive — it replaces local login. Existing installs stay on
`AUTH_MODE=local` until you change this.

```env
AUTH_MODE=oidc

# Pin CORS to the exact browser origin(s). Wildcard is rejected in OIDC mode.
CORS_ORIGINS=["https://homelable.example"]

# From your IdP:
OIDC_DISCOVERY_URL=https://idp.example/application/o/homelable/.well-known/openid-configuration
OIDC_CLIENT_ID=homelable
OIDC_CLIENT_SECRET=replace-with-a-secret

# Must EXACTLY match a redirect URI registered at the IdP.
OIDC_REDIRECT_URI=https://homelable.example/api/v1/auth/oidc/callback

OIDC_SCOPES="openid profile email"
OIDC_COOKIE_SECURE=true
OIDC_SESSION_EXPIRE_MINUTES=480
OIDC_TRANSACTION_EXPIRE_SECONDS=600
```

Then restart the backend (`docker compose restart backend`).

### Reference

| Variable | Required | Default | Notes |
|---|---|---|---|
| `AUTH_MODE` | yes | `local` | Set to `oidc` to enable. |
| `OIDC_DISCOVERY_URL` | yes | — | The IdP's `.well-known/openid-configuration` URL. |
| `OIDC_CLIENT_ID` | yes | — | Confidential client id. |
| `OIDC_CLIENT_SECRET` | yes | — | Client secret. Keep it out of Git and Compose YAML. |
| `OIDC_REDIRECT_URI` | yes | — | Must equal the registered redirect **exactly**, path included. |
| `OIDC_SCOPES` | no | `openid profile email` | Must contain `openid`. |
| `OIDC_COOKIE_SECURE` | no | `true` | `true` requires an HTTPS redirect URI and enables the `__Host-` cookie prefix. Set `false` only for local HTTP testing. |
| `OIDC_SESSION_EXPIRE_MINUTES` | no | `480` | App session lifetime (5–1440). |
| `OIDC_TRANSACTION_EXPIRE_SECONDS` | no | `600` | Lifetime of the short login-flow cookie holding `state`/`nonce`/PKCE (60–3600). |
| `SECRET_KEY` | yes | — | Must be **≥ 32 bytes** in OIDC mode. Generate: `python3 -c "import secrets; print(secrets.token_hex(32))"`. |
| `CORS_ORIGINS` | yes | — | Exact browser origin(s). `*` is rejected in OIDC mode. |

### Fail-closed validation

The backend refuses to start in OIDC mode unless the configuration is complete
and safe. It errors if any of the following is true:

- any of `OIDC_DISCOVERY_URL`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`,
  `OIDC_REDIRECT_URI` is missing;
- `SECRET_KEY` is shorter than 32 bytes;
- `OIDC_SCOPES` does not contain `openid`;
- `OIDC_DISCOVERY_URL` or `OIDC_REDIRECT_URI` is not an HTTP(S) URL;
- `OIDC_COOKIE_SECURE=true` but `OIDC_REDIRECT_URI` is not HTTPS;
- `CORS_ORIGINS` contains `*`.

---

## Provider setup

The callback URL to register everywhere is:

```
https://<your-host>/api/v1/auth/oidc/callback
```

### Authentik

1. **Applications → Providers → Create → OAuth2/OpenID Provider.**
2. Client type **Confidential**; add the redirect URI above.
3. Note the client id/secret and the discovery URL:
   `https://authentik.example/application/o/<app-slug>/.well-known/openid-configuration`.
4. Create an **Application** bound to that provider.

### Keycloak

1. In your realm: **Clients → Create client** (OpenID Connect), **Client
   authentication ON** (confidential).
2. Set **Valid redirect URIs** to the callback URL.
3. Discovery URL:
   `https://kc.example/realms/<realm>/.well-known/openid-configuration`.
4. Copy the secret from the **Credentials** tab.

### Authelia

1. Add Homelable to the `identity_providers.oidc.clients` list with a
   `client_secret`, the redirect URI, and scopes `openid profile email`.
2. Discovery URL: `https://auth.example/.well-known/openid-configuration`.

### Google

1. **Google Cloud Console → APIs & Services → Credentials → OAuth client ID**
   (type *Web application*).
2. Add the callback URL under **Authorized redirect URIs** (Google requires
   HTTPS).
3. Discovery URL: `https://accounts.google.com/.well-known/openid-configuration`.

Any other spec-compliant provider works the same way — point
`OIDC_DISCOVERY_URL` at its discovery document.

---

## Behind a reverse proxy

Homelable derives the redirect target from `OIDC_REDIRECT_URI`, so set it to the
**public** HTTPS URL your users reach — not the internal container address. Make
sure the proxy:

- terminates TLS and forwards `/api/v1/auth/oidc/*` to the backend;
- passes the original `Host` and `X-Forwarded-Proto` headers;
- does not strip the `Cookie` / `Set-Cookie` headers on those routes.

---

## Logout & sessions

- **Logout** clears the Homelable session cookie (`POST /api/v1/auth/logout`).
- Sessions are stateless JWTs signed with `SECRET_KEY`; there is no server-side
  revocation, so a session stays valid until `OIDC_SESSION_EXPIRE_MINUTES`
  elapses. Keep the lifetime modest for sensitive deployments.
- Logout is local to Homelable; it does not sign the user out at the IdP.

---

## Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| IdP shows `redirect_uri_mismatch` | `OIDC_REDIRECT_URI` must equal the registered URI **exactly**, including scheme, host, port and the `/api/v1/auth/oidc/callback` path. |
| `OIDC authentication failed` (401) after IdP login | Wrong client secret, `openid` missing from scopes, or clock skew breaking `nonce`/`exp` — sync server time (NTP). |
| Logged out immediately / cookie not set | `OIDC_COOKIE_SECURE=true` while serving over HTTP. Serve HTTPS, or set `OIDC_COOKIE_SECURE=false` for local testing only. |
| `403 CSRF validation failed` on save/actions | The request `Origin` is not in `CORS_ORIGINS`, or a stale tab is missing the CSRF token — reload the page. |
| Backend won't start in OIDC mode | Re-read the error: a required `OIDC_*` value is missing, `SECRET_KEY` < 32 bytes, `CORS_ORIGINS` has `*`, or the redirect isn't HTTPS while the cookie is secure. |
| Login button doesn't appear | `AUTH_MODE` is still `local`, or the frontend can't reach `/api/v1/auth/config` — check the proxy and `CORS_ORIGINS`. |

---

## Reverting to local auth

Set `AUTH_MODE=local` (or remove it) and restart the backend. The
`AUTH_USERNAME` / `AUTH_PASSWORD_HASH` login is restored; the `OIDC_*` values are
ignored while in local mode.
