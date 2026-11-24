# Omada Import

Connects Homelable to a TP-Link **Omada SDN Controller** through its official
**Open API** and brings the adopted network gear and, optionally, the online
clients into the Device Inventory. It can also **sync** on a schedule.

The same API is served by a software controller, an OC200/OC300 hardware
controller and a cloud-based controller, so all three work.

> **Server-dependent feature** - requires the Homelable backend. It is hidden in
> the no-backend standalone/demo build.

---

## What is imported

- **Infrastructure** (on by default): every adopted device, typed by what it is:

  | Omada type | Homelable type |
  |------------|----------------|
  | `gateway`  | `router`       |
  | `switch`   | `switch`       |
  | `ap`       | `ap`           |
  | anything else | `device`    |

  Each device keeps its name, IP and MAC, the vendor `TP-Link` and its model,
  plus hidden-by-default properties: Omada type, Model, Firmware, Serial,
  Uptime, **Uplink** (the device it is plugged into) with the **Uplink port**,
  and the **Omada site**.
- **Clients** (opt-in): every client connected right now, with its name, IP,
  MAC and vendor, plus hidden-by-default properties: Connection (wired or
  wifi), the **Access point**, **Switch** or **Gateway** it hangs off, the
  switch **Port** for a wired client, SSID, Network, VLAN and Omada site.
  Clients land as `computer`; retype them on approve, as with any discovery.

Everything goes to the Device Inventory as *pending*; nothing reaches a canvas
until you approve it. Properties stay hidden on the node until you show them
from the right panel.

---

## Prerequisites

1. An Omada controller with the **Open API**: Settings > Platform Integration.
2. A **client-mode application** created there, with access to the sites to
   import. Note its **Client ID** and **Client Secret**.
3. The **Omada ID**, shown on the same page. A local controller publishes it,
   so it may be left blank; a cloud-based controller needs it.
4. The controller reachable from the Homelable backend:
   - software controller: `https://<host>:8043`
   - OC200/OC300: `https://<host>`
   - cloud-based controller: the interface URL shown under Platform
     Integration.

   A local controller ships a self-signed certificate, so **Verify TLS
   certificate** is off by default. Tick it for a trusted certificate, such as
   a cloud-based controller's.

---

## Importing

Open **Import** in the sidebar and pick **Omada**. Enter the controller URL,
the Omada ID if needed, an optional **site** name (blank imports every site)
and the client ID and secret, then tick what to import:

- **Infrastructure** - gateways, switches and access points.
- **Clients** - clients connected right now.

**Test Connection** checks the credentials and shows how many rows each ticked
source holds. **Import to Inventory** runs the import, records it in Scan
History and opens the Device Inventory on what it found.

Leave the client ID and secret blank to use the ones from the server `.env`.
They are only ever sent to the `OMADA_URL` configured there; any other address
needs its own credentials.

---

## Matching

A device is identified by its MAC. Re-importing updates rows in place and
never deletes anything: an approved device stays approved, and a hidden device
the controller still reports comes back as pending.

A device an IP scan or another import found first is the same row when the MAC
matches, so nothing is duplicated. It gains the Omada properties and the
`OMADA` source badge but keeps its own name and type; on a row only Omada has
seen, a re-sync refreshes them too. A MAC listed both as a device and as a
client is imported once, as the device.

---

## Auto-sync

Connection settings live in the server `.env` only. The client secret is never
written to disk by the app and never returned by the API.

```env
OMADA_URL=https://192.168.0.2:8043
# OMADA_ID=              # required for a cloud-based controller
OMADA_CLIENT_ID=xxxxxxxxxxxxxxxx
OMADA_CLIENT_SECRET=xxxxxxxxxxxxxxxx
# OMADA_SITE=            # blank = every site
OMADA_VERIFY_TLS=false
```

With those set, **Settings > Omada auto-sync** turns on a scheduled import into
the pending inventory (minimum 5 minutes), chooses whether it imports
infrastructure, clients or both, and offers **Re-sync now**. Each run appears
in Scan History under **Omada**.

---

## Troubleshooting

- **Could not read the Omada ID** - the controller does not publish it (a
  cloud-based controller never does). Enter it from Platform Integration.
- **Authorization failed** - the Omada ID, client ID or secret is wrong, or
  the application is not in client mode. The controller's own message is shown.
- **No Omada Open API at ...** - the URL points somewhere without the API,
  usually the wrong port.
- **... redirects to ...** - enter the address it names. Redirects are not
  followed, so the secret is never sent to a host you did not enter.
- **Site 'x' not found** - the message lists the controller's site names.
