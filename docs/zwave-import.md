# Z-Wave (Z-Wave JS UI) Network Map Importer

This feature lets you connect Homelable to your MQTT broker, fetch the Z-Wave node list from **Z-Wave JS UI** (formerly `zwavejs2mqtt`), and drop all Z-Wave devices onto the canvas as typed nodes with proper hierarchy.

It mirrors the [Zigbee2MQTT importer](./zigbee-import.md): same MQTT request/response pattern, same node-type model, same canvas behaviour.

---

## Feature Overview

- **Automatic device discovery** — Requests the node list from the Z-Wave JS UI MQTT gateway API and parses the full device list
- **Typed nodes** — Devices are mapped to three homelable node types:
  - `zwave_coordinator` — The Z-Wave controller (hub)
  - `zwave_router` — Mains-powered / routing nodes
  - `zwave_enddevice` — Battery-powered end devices (sensors, locks, etc.)
- **Hierarchy** — `parent_id` is set automatically: controller → routers → end devices, derived from each node's neighbor list
- **IoT edges** — Links between devices are added as `IoT / Zigbee` edge type
- **Import targets** — Send discovered devices to the **Pending** section (review before adding) or drop them on the **Canvas** directly

> **Note:** Z-Wave does not expose an LQI value the way Zigbee does, so the LQI property is omitted. (RSSI may be surfaced in a future release.)

---

## Prerequisites

1. A running **MQTT broker** (e.g. Mosquitto) accessible from your Homelable host
2. **Z-Wave JS UI** connected to the broker with the **MQTT gateway** enabled
3. The gateway must respond to `getNodes` requests on:
   - **Request topic:** `<prefix>/_CLIENTS/ZWAVE_GATEWAY-<gateway>/api/getNodes/set`
   - **Response topic:** `<prefix>/_CLIENTS/ZWAVE_GATEWAY-<gateway>/api/getNodes`
   - The default prefix is `zwave` and the default gateway name is `zwavejs2mqtt`

---

## Step-by-step Usage

### 1. Open the Z-Wave Import dialog

Click **Z-Wave Import** in the left sidebar (below "Zigbee Import").

### 2. Configure the MQTT connection

| Field | Default | Description |
|---|---|---|
| Broker Host | — | IP or hostname of your MQTT broker |
| Port | 1883 | MQTT broker port (auto-switches to 8883 when TLS is enabled) |
| MQTT Prefix | `zwave` | Z-Wave JS UI MQTT prefix (Settings → MQTT → "Prefix") |
| Gateway Name | `zwavejs2mqtt` | Z-Wave JS UI gateway name (Settings → MQTT → "Name") |
| Username | _(optional)_ | MQTT username if authentication is enabled |
| Password | _(optional)_ | MQTT password |
| Use TLS | off | Connect over TLS (typically port 8883) |
| Skip cert verify | off | Accept self-signed certificates (TLS only) |

> The **Prefix** and **Gateway Name** together form the MQTT topic the importer talks to. They must match your Z-Wave JS UI **Settings → MQTT** configuration exactly, or the request will time out.

### 3. Test the connection (optional)

Click **Test Connection** to verify broker reachability before fetching devices.
A green indicator confirms success; red shows the error message from the broker.

### 4. Choose an import target

Pick where discovered devices should go:

- **Pending section** — Devices are queued for review in the Pending list (and tracked as a scan run in Scan History). The controller is auto-approved as a canvas node; the rest wait for you to approve, hide, or delete them.
- **Canvas directly** — Devices are fetched and shown grouped in the dialog so you can pick which ones to add immediately.

### 5. Fetch devices

Click **Import to Pending** (or **Fetch Devices** in canvas mode). Homelable will:
1. Connect to the broker
2. Subscribe to the response topic
3. Publish a `getNodes` request to the gateway request topic
4. Wait for the node-list response
5. Parse and group devices by type

### 6. Select and add to canvas

(Canvas mode) Devices are grouped by type (Controller / Router / End Device).
Use the checkboxes to select which devices to add, then click **Add N to Canvas**.

> **Tip:** All devices are selected by default. Uncheck any you don't want.

### 7. Arrange on the canvas

Devices are placed in a grid at the top-right of the canvas.
Use **Auto Layout** (toolbar) to re-arrange the full canvas, or drag nodes manually.

---

## Node Type Mapping

The importer reads each Z-Wave node's role flags from the gateway and maps them as follows:

| Z-Wave JS UI flag | homelable type | Role label |
|---|---|---|
| `isControllerNode` | `zwave_coordinator` | Controller |
| `isRouting` | `zwave_router` | Router |
| _(everything else)_ | `zwave_enddevice` | EndDevice |

Each node keeps its name (`name` → `loc` → `Node <id>` fallback), vendor (`manufacturer`), and model (`productLabel` / `productDescription`) where available.

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

### Z-Wave JS UI MQTT settings

In **Settings → MQTT**, make sure the gateway is enabled and note these two values — they must match the importer fields:

| Z-Wave JS UI setting | Importer field | Default |
|---|---|---|
| Name | Gateway Name | `zwavejs2mqtt` |
| Prefix | MQTT Prefix | `zwave` |
| Host / Port | Broker Host / Port | `localhost` / `1883` |

The gateway must be in **"Named topics"** mode (the default) so the `getNodes` API topic is exposed.

---

## Supported Versions

The `getNodes` MQTT gateway API is provided by **Z-Wave JS UI** (and its predecessor `zwavejs2mqtt`). Any recent release with the MQTT gateway enabled is supported.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| "Connection refused" | Broker unreachable | Check host/port, firewall rules |
| "Timed out waiting for response" | Gateway not running, or wrong prefix/gateway name | Verify Z-Wave JS UI is connected to MQTT; match **Prefix** and **Gateway Name** to Settings → MQTT |
| 0 devices returned | No nodes included in the Z-Wave network | Include at least one device first |
| "Z-Wave gateway reported failure" | Gateway returned `success: false` | Check the Z-Wave JS UI logs |
| "Malformed getNodes response" | Gateway returned an unexpected format | Check the Z-Wave JS UI version; open an issue |
| TLS errors with a self-signed cert | Certificate not trusted | Enable **Use TLS** + **Skip cert verify** |

---

## Screenshots

_(Screenshots will be added in a future release)_
