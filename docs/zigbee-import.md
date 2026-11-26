# Zigbee2MQTT Network Map Importer

This feature lets you connect Homelable to your MQTT broker, fetch the Zigbee2MQTT network topology, and drop all Zigbee devices onto the canvas as typed nodes with proper hierarchy.

---

## Feature Overview

- **Automatic device discovery** — Requests the Z2M networkmap via the MQTT bridge API and parses the full device list
- **Typed nodes** — Devices are mapped to three homelable node types:
  - `zigbee_coordinator` — The Zigbee coordinator (hub)
  - `zigbee_router` — Mains-powered router devices
  - `zigbee_enddevice` — Battery-powered end devices (sensors, bulbs, etc.)
- **Hierarchy** — `parent_id` is set automatically: coordinator → routers → end devices
- **LQI** — Link Quality Indicator is measured per *link*, so it is stored on the
  edge (and mirrored onto the device as the quality of its link to its parent).
  It is read-only: the import writes it, the edge modal only displays it.
- **IoT edges** — Links between devices are added as `IoT / Zigbee` edge type
- **Mesh links (optional)** — By default only the parent tree is imported: one
  edge per device. Tick **Import mesh links** to also draw neighbour-to-neighbour
  links, as a distinct `Zigbee Mesh` edge type in its own colour. Expect far more
  edges — a 37-device network goes from ~36 to ~115 — which is why it is off by
  default. The scheduled auto-sync and **Re-sync now** have their own
  **Import mesh links** toggle under Settings → Zigbee auto-sync, also off by
  default.

---

## Prerequisites

1. A running **MQTT broker** (e.g. Mosquitto) accessible from your Homelable host
2. **Zigbee2MQTT** connected to the broker and running
3. Z2M must respond to networkmap requests on:
   - **Request topic:** `<base_topic>/bridge/request/networkmap`
   - **Response topic:** `<base_topic>/bridge/response/networkmap`
   - The default base topic is `zigbee2mqtt`

---

## Step-by-step Usage

### 1. Open the Zigbee Import dialog

Click **Zigbee Import** in the left sidebar (below "Scan Network").

### 2. Configure the MQTT connection

| Field | Default | Description |
|---|---|---|
| Broker Host | — | IP or hostname of your MQTT broker |
| Port | 1883 | MQTT broker port |
| Base Topic | `zigbee2mqtt` | Zigbee2MQTT base topic |
| Username | _(optional)_ | MQTT username if authentication is enabled |
| Password | _(optional)_ | MQTT password |

### 3. Test the connection (optional)

Click **Test Connection** to verify broker reachability before fetching devices.  
A green indicator confirms success; red shows the error message from the broker.

### 4. Fetch devices

Click **Fetch Devices**. Homelable will:
1. Connect to the broker
2. Subscribe to the response topic
3. Publish `{"type": "raw", "routes": false}` to the request topic
4. Wait up to `ZIGBEE_NETWORKMAP_TIMEOUT` seconds (default 300) for the network map response
5. Parse and group devices by type

The fetch runs server-side and the browser polls for the result, so a mesh that
takes minutes to answer cannot be cut short by a reverse proxy's read timeout.

### Large meshes and timeouts

A network of 200+ devices can take several minutes to build its map. Two knobs:

| Variable | Default | What it bounds |
|---|---|---|
| `ZIGBEE_NETWORKMAP_TIMEOUT` | `300` | Seconds to wait for the Z2M bridge to answer a networkmap request. Raise it if an import fails with *Timed out waiting for networkmap response*. |
| `MQTT_RESPONSE_TIMEOUT` | `300` | The same bound for the Z-Wave MQTT round-trip. |

Both apply to manual imports and to auto-sync. If you reverse-proxy the API,
these are the only timeouts that matter — the import request itself returns
immediately.

### 5. Select and add to canvas

Devices are grouped by type (Coordinator / Router / End Device).  
Use the checkboxes to select which devices to add, then click **Add N to Canvas**.

> **Tip:** All devices are selected by default. Uncheck any you don't want.

### 6. Arrange on the canvas

Devices are placed in a grid at the top-right of the canvas.  
Use **Auto Layout** (toolbar) to re-arrange the full canvas, or drag nodes manually.

---

## Alternative source: Home Assistant ZHA (no MQTT broker)

If you run Zigbee through Home Assistant's native **ZHA** integration instead
of Zigbee2MQTT, there is no MQTT broker to query — the manual **Zigbee
Import** dialog above stays MQTT-only. Auto-sync and **Sync Now**
(Settings → Zigbee auto-sync) can instead pull the device list straight from
Home Assistant's WebSocket API.

### Setup

1. In Home Assistant: **Profile → Security → Long-Lived Access Tokens →
   Create Token**.
2. In the server `.env`:

   ```bash
   ZIGBEE_SOURCE=ha_api
   ZIGBEE_HA_URL=http://homeassistant.local:8123
   ZIGBEE_HA_TOKEN=<long-lived access token>
   ```
3. Restart the backend, then use **Settings → Zigbee auto-sync → Sync Now**
   (or enable auto-sync) exactly as you would for Zigbee2MQTT.

### What you get vs. Zigbee2MQTT

- **Coordinator / Router / End Device** typing, model, vendor, and the
  device's own LQI — same as Zigbee2MQTT.
- **Hierarchy is flat**: every device is drawn as a direct child of the
  coordinator. HA's `zha/devices` call reports each device's own radio
  stats, but — unlike Z2M's networkmap — it does not return the neighbour
  table needed to tell which router a device is actually routed through.
- `include_mesh_links` and the mesh-link edge type do not apply to this
  source (there is no neighbour data to draw).

`ZIGBEE_SOURCE` is mutually exclusive: `ha_api` takes over auto-sync/Sync Now
entirely, and the `ZIGBEE_MQTT_*` variables are ignored while it is set. The
default remains `mqtt`, so existing Zigbee2MQTT setups are unaffected.

---

## MQTT Configuration Tips

### Mosquitto without authentication

```
listener 1883
allow_anonymous true
```

### Mosquitto with password file

```
listener 1883
password_file /etc/mosquitto/passwd
```

Create a user:
```bash
mosquitto_passwd -c /etc/mosquitto/passwd <username>
```

### Zigbee2MQTT `configuration.yaml`

```yaml
mqtt:
  base_topic: zigbee2mqtt
  server: mqtt://localhost:1883
  # user: mqtt_user
  # password: mqtt_password
```

---

## Supported Z2M Versions

The networkmap bridge API is available in **Zigbee2MQTT 1.x and 2.x**.  
Tested against Z2M 1.35+ and 2.x.

The importer uses the `raw` topology format (`routes: false`) which is the most widely supported mode.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| "Connection refused" | Broker unreachable | Check host/port, firewall rules |
| "Timed out waiting for networkmap" | Z2M not running or wrong base_topic | Verify Z2M is connected, check base_topic setting |
| 0 devices returned | Z2M has no devices paired | Pair at least one device first |
| "Malformed networkmap response" | Z2M returned unexpected format | Check Z2M version; open an issue |

---

## Screenshots

_(Screenshots will be added in a future release)_
