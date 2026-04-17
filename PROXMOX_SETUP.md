# Proxmox (PVE) integration — Setup Guide for Homelable

This guide explains how to create a Proxmox API Token for Homelable and which node properties are required for the Proxmox sync/import feature.

## 1) Create an API Token in Proxmox (PVE)

1. Log in to the Proxmox web UI as `root@pam` (or another admin user).
2. Navigate to `Datacenter` → `Permissions` → `API Tokens`.
3. Select the user you want to create the token for (for example, `root@pam`).
4. Click `Add` and give the token a name (e.g., `homelable-token`).
5. Select appropriate roles for the token. For discovery only, `PVEVMUser` or read-only permissions for nodes may be sufficient; adjust as needed.
6. After creating the token, copy both the **Token ID** (format `username!tokenname`) and the **Secret** immediately — the secret will not be shown again.

Example token values:
- Token ID: `root@pam!homelable-token`
- Secret: `XyzAbc12345...`

## 2) Required node properties in Homelable

When adding a Proxmox host to the Canvas, attach the following properties to the node (the discover route will accept several common aliases):

- `proxmox_token` (or `token_id` or `user`): the token id, e.g. `root@pam!homelable-token`
- `proxmox_secret` (or `token_secret` or `token`): the token secret copied from Proxmox
- `proxmox_node` (optional): the target Proxmox node name to search for VMs/containers. If omitted, Homelable will use the node's label.

You can add them in the Canvas node properties as key/value pairs, for example:

- key: `proxmox_token` — value: `root@pam!homelable-token`
- key: `proxmox_secret` — value: `XyzAbc12345...`
- key: `proxmox_node` — value: `node1.example.local`

## 3) SSL verification and self-signed certificates

To make the integration easier for home-lab setups where Proxmox often uses a self-signed certificate, SSL verification is disabled by default in the Homelable Proxmox client. This allows the sync/discovery to work without providing a CA-signed certificate. If you need to enable strict verification for production environments, modify the Proxmox client configuration in `backend/app/services/proxmox_client.py` and set `verify_ssl=True` when instantiating `ProxmoxAPI`.

## 4) Troubleshooting

- If the discover action returns a 400 error: verify the node has a valid `ip` and `label` set in the Canvas and that the node properties contain the token and secret.
- If the integration cannot reach Proxmox: ensure the server's IP is reachable from the Homelable backend and that port `8006` is open.

## 5) Security note

Tokens grant access according to assigned roles. Create a token with the minimal privileges required for discovery, and rotate tokens regularly.

---

If you want, I can also add a short example of how to populate these properties via the frontend UI or include a sample Canvas JSON snippet.