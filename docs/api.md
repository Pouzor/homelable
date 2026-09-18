# REST API

Everything the Homelable UI does, it does through a JSON API under `/api/v1`.
That API is public surface: script it to register machines, attach properties,
wire links between nodes, trigger scans, or keep a canvas in sync with whatever
provisions your infrastructure.

The reference is generated from the code itself, so it never drifts from what
the server actually accepts.

---

## Interactive documentation

| URL | What |
|---|---|
| `/docs` | **Swagger UI** — every endpoint, every field, with a *Try it out* button that issues real calls |
| `/redoc` | ReDoc — the same schema in a reference layout, easier to read end to end |
| `/openapi.json` | The raw OpenAPI schema, for client generators (`openapi-generator`, `openapi-python-client`, Kiota…) |

Where they live depends on how you installed:

| Install | Base URL |
|---|---|
| Docker Compose (default) | `http://<your-homelab-ip>:3000` |
| Docker Compose under a subpath (`VITE_BASE_PATH=/homelab/`) | `http://<your-homelab-ip>:3000/homelab` |
| LXC / bare metal (`scripts/install-baremetal.sh`) | `http://<your-homelab-ip>` |
| Development (`uvicorn app.main:app`) | `http://localhost:8000` |

So on a default Docker install, Swagger UI is at
`http://<your-homelab-ip>:3000/docs`.

> [!NOTE]
> Swagger UI and ReDoc load their JavaScript from a public CDN. On a machine
> with no internet access the page renders blank — `/openapi.json` still works,
> and so does every endpoint. It is the viewer that needs the CDN, not the API.

---

## Authentication

Every endpoint except `/api/v1/health`, `/api/v1/auth/*` and the opt-in
read-only ones (Live View, the gethomepage stats widget) requires a token.

### Local auth mode (default)

`POST /api/v1/auth/login` with the credentials from your `.env`
(`AUTH_USERNAME` / `AUTH_PASSWORD_HASH`) returns a JWT:

```bash
BASE=http://<your-homelab-ip>:3000

TOKEN=$(curl -s "$BASE/api/v1/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"your-password"}' | jq -r .access_token)
```

```json
{ "access_token": "eyJhbGciOiJIUzI1NiIs...", "token_type": "bearer" }
```

Send it on every subsequent call:

```bash
curl -s "$BASE/api/v1/nodes" -H "Authorization: Bearer $TOKEN"
```

In Swagger UI, click **Authorize** (top right) and paste the token — the *Try it
out* buttons then carry it for you.

**The token expires after 24 hours** (`ACCESS_TOKEN_EXPIRE_MINUTES`, default
`1440`). A long-lived script must log in again when it gets a `401`, which means
keeping the password where the script can read it. There is no revocation list:
rotating `SECRET_KEY` invalidates every token at once.

### OIDC auth mode

`AUTH_MODE=oidc` disables local login — `POST /api/v1/auth/login` answers `404`.
The browser session is a cookie issued by your identity provider, and there is
currently **no scripting path in OIDC mode**. If you need one, say so on
[issue #291](https://github.com/Pouzor/homelable/issues/291).

### Who am I

`GET /api/v1/auth/me` echoes back the authenticated subject and which method
authenticated it — handy when a script's `401` could be either a bad token or a
server in the wrong auth mode.

---

## Conventions

- **Prefix** `/api/v1`, JSON in and out.
- **Errors** are FastAPI's shape: `{"detail": "..."}`. `detail` is a string,
  except for structured conflicts (a duplicate device, for instance) where it is
  an object.
- **Status codes**: `201` on create, `204` on delete, `401` unauthenticated,
  `404` unknown id, `409` conflict, `422` payload rejected by validation — the
  body then names the offending field.
- **Ids** are server-generated strings. Never invent one.
- **Timestamps** are ISO 8601, UTC.

---

## The endpoints you will actually script

Full list in `/docs`. These are the ones that matter for automation:

| Method | Path | What |
|---|---|---|
| `GET` | `/api/v1/designs` | List canvases, with node counts |
| `POST` | `/api/v1/designs` | Create a canvas (`design_type`: `network`, `electrical`, `rack`) |
| `GET` | `/api/v1/nodes?design_id=<id>` | List nodes |
| `POST` | `/api/v1/nodes` | Create a node |
| `GET` | `/api/v1/nodes/{id}` | Read one node |
| `PATCH` | `/api/v1/nodes/{id}` | Update any subset of a node's fields |
| `DELETE` | `/api/v1/nodes/{id}` | Delete a node |
| `GET` | `/api/v1/edges` | List links |
| `POST` | `/api/v1/edges` | Create a link |
| `PATCH` | `/api/v1/edges/{id}` | Update a link |
| `DELETE` | `/api/v1/edges/{id}` | Delete a link |
| `GET` | `/api/v1/canvas?design_id=<id>` | Load a whole canvas — nodes, edges, viewport |
| `POST` | `/api/v1/canvas/save` | Save a whole canvas at once |
| `GET` | `/api/v1/health` | Liveness, no auth |

---

## Creating a node

`design_id` picks the canvas; omit it and the node lands on the first one. Omit
`pos_x` / `pos_y` and the server drops the node in a free grid slot, which is
what you want from a script — no overlap bookkeeping on your side.

```bash
curl -s "$BASE/api/v1/nodes" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "type": "server",
    "label": "vps-fra-01",
    "ip": "10.8.0.12",
    "hostname": "vps-fra-01.example.net",
    "os": "Debian 13",
    "check_method": "ping",
    "notes": "Provisioned by terraform, do not edit by hand.",
    "properties": [
      { "key": "Provider",  "value": "Hetzner",     "icon": null, "visible": true },
      { "key": "Region",    "value": "fsn1",        "icon": null, "visible": true },
      { "key": "VPN",       "value": "wg0 10.8.0.12", "icon": null, "visible": false }
    ]
  }'
```

Returns `201` and the full node, including its `id`.

**`type`** is a free string on the wire — the backend does not validate it — but
only the ~40 values the frontend knows about get an icon and a shape. `server`,
`vm`, `lxc`, `docker_host`, `docker_container`, `router`, `firewall`, `switch`,
`nas`, `ap`. An unknown type still stores and still draws, just generically.

**`properties`** is the list rendered on the node's detail panel. Each entry is
`{ key, value, icon, visible }`; `icon` may be `null`, and `visible` controls
whether the row is printed on the node itself or only shown in the panel.

**Duplicates**: creating a node whose `ip` or `mac` already exists on the target
design answers `409` rather than silently doubling your canvas. Pass
`"force": true` in the body to create it anyway — the right call in a script
that knows what it is doing.

## Updating a node

`PATCH` takes any subset. Anything you leave out is untouched, so a script can
own one field and stay out of the way of hand edits:

```bash
curl -s -X PATCH "$BASE/api/v1/nodes/$NODE_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"status": "online", "os": "Debian 13.2"}'
```

`properties` is replaced wholesale, not merged — read the node first, edit the
list, send it back.

## Linking two nodes

```bash
curl -s "$BASE/api/v1/edges" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "source": "'"$NODE_A"'",
    "target": "'"$NODE_B"'",
    "type": "virtual",
    "label": "wireguard",
    "line_style": "dashed"
  }'
```

`type` is one of `ethernet`, `wifi`, `iot`, `vlan`, `virtual`, `cluster`,
`fibre`, `electrical` — it drives the colour and the default styling.

Leave `source_handle` / `target_handle` out and the server picks the connection
points from where the two nodes sit relative to each other. Pass them only when
you care which port the line leaves from; a handle that does not exist on the
node is rejected with `422`.

## Reading a whole canvas

One call, everything on it:

```bash
curl -s "$BASE/api/v1/canvas?design_id=$DESIGN_ID" -H "Authorization: Bearer $TOKEN"
```

`POST /api/v1/canvas/save` writes the whole thing back — nodes, edges, viewport.
It is a **full replace** for the design: anything absent from the payload is
deleted. For incremental scripting, prefer the per-node and per-edge endpoints
above; reach for `canvas/save` only when your script genuinely owns the entire
canvas.

---

## Security

> [!WARNING]
> Homelable is meant for a LAN. Do not expose it to the internet.

- **`/docs`, `/redoc` and `/openapi.json` are not authenticated.** Anyone who can
  reach the app can read the API's *shape* — endpoints, field names, types. No
  homelab data is exposed that way: every endpoint behind them still demands a
  token. If that bothers you, block the three paths at your reverse proxy.
- **There is no rate limiting** on the login endpoint. The password check is
  constant-time and bcrypt-slow, but a machine that can reach the API can grind
  at it. Keep it off the internet.
- **The token is a bearer token**: whoever holds it is you, until it expires.
  Store it in memory, not in a file your whole homelab can read, and prefer HTTPS
  via a reverse proxy over plain HTTP if the traffic leaves the machine.
- `MCP_SERVICE_KEY`, when set, also authenticates against every endpoint via the
  `X-MCP-Service-Key` header. It exists for the bundled MCP server and does not
  expire. Treat it as a root credential — do not reuse it as your script's
  token.

---

## Related

- **MCP server** — if what you want is an *AI assistant* reading and editing the
  canvas rather than a script, that already exists and speaks a higher-level
  vocabulary. See the MCP section in the [README](../README.md).
- **Live View** — a read-only public canvas URL, no token, for a wall display.
- **gethomepage widget** — `GET /api/v1/stats/summary`, its own `X-API-Key`.
- Standalone mode (`VITE_STANDALONE=true`) runs with no backend at all, so it
  has **no** API. Canvases live in the browser's `localStorage`.
