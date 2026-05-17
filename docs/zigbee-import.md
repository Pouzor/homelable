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
- **LQI display** — Link Quality Indicator is stored as a node property
- **IoT edges** — Links between devices are added as `IoT / Zigbee` edge type

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
4. Wait up to 60 seconds for the network map response (large meshes can take 30 s+)
5. Parse and group devices by type

### 5. Select and add to canvas

Devices are grouped by type (Coordinator / Router / End Device).  
Use the checkboxes to select which devices to add, then click **Add N to Canvas**.

> **Tip:** All devices are selected by default. Uncheck any you don't want.

### 6. Arrange on the canvas

Devices are placed in a grid at the top-right of the canvas.  
Use **Auto Layout** (toolbar) to re-arrange the full canvas, or drag nodes manually.

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
