# Architecture: Canvas Export to Base64

## Overview
This specification describes the proposed architecture for exporting the canvas state (nodes, edges, metadata) into a portable Base64 string. The goal is to allow users to easily export/import the canvas state, embed it in short URLs (when possible), or store it as secure files.

## Requirements
* Serialize the complete canvas state (nodes, edges, metadata, version) deterministically.
* Support frontend export and import without requiring a backend.
* Ensure cross-version compatibility by adding a `schema_version` field to the payload.
* Limit the recommended size for URL exports; for larger payloads, offer a `.hlc` (homelable canvas) file download.
* Protect against injection and invalid characters during encoding/decoding (UTF-8-safe).

## Payload Format
JSON Payload (example):

```json
{
  "schema_version": 1,
  "canvas": {
    "nodes": [...],
    "edges": [...],
    "meta": { "label": "My Floor Plan", "created_at": "..." }
  }
} 
```

## Export Process (frontend)
1. **Serialization:** Reuse the existing `canvasSerializer` to produce a serializable object (clean circular references, ensure correct field names).
2. **Metadata:** Include version fields (`schema_version`) and minimal metadata.
3. **Stringify:** Convert the object to JSON: `JSON.stringify(payload)`.
4. **Encoding:** Correctly encode to UTF-8 and apply Base64:
    * **Browser:** `btoa(unescape(encodeURIComponent(json)))` for Unicode compatibility.
    * **Node/SSR:** `Buffer.from(json, 'utf-8').toString('base64')`.
5. **Output Options:**
    * Copy Base64 to clipboard (suitable for short transfers).
    * Download a `.hlc` file containing the Base64 or serialized JSON.

## Import Process (frontend)
1. **Decoding:** Detect if the string is a valid Base64; decode UTF-8 correctly.
2. **Validation:** Perform `JSON.parse()` and validate the `schema_version`.
3. **Reconstruction:** Pass through the deserializer (the inverse of `canvasSerializer`) to reconstruct nodes/edges in the format expected by the store.
4. **Error Handling:** If the `schema_version` is unknown or incompatible, show a conversion option or an error message.

## Size Considerations
* URLs have practical limits; it is recommended not to use URLs for payloads exceeding ~2000 characters.
* For larger canvases, suggest a file download or the use of a backend for temporary storage (e.g., upload and generate a short link).

## Security
* Never execute code contained within the payload.
* Validate expected types and sanitize strings before applying them to the DOM.
* **Sensitive Data:** Avoid storing secrets; sensitive `properties` should be excluded or masked before export.

## Versioning and Compatibility
* Include `schema_version` at the top level of the payload.
* Maintain converters for older versions when format changes occur.

## Testing and QA
* **Unit tests:** For `exportCanvasToBase64` and `importCanvasFromBase64` covering Unicode characters, optional fields, and errors.
* **Integration:** Export a real canvas, import it into a new session, and validate semantic equality (identical nodes/edges/parent relations).

## Implementation Roadmap
1. `docs/CANVAS_EXPORT_BASE64_ARCHITECTURE.md` (this document).
2. `frontend/src/utils/exportCanvas.ts` with basic export/import functions and unit tests.
3. **UI:** Export button in the canvas panel and an import modal.
4. **(Optional)** Backend endpoint for temporary upload and short link generation.

---
*Note: This document covers the initial solution; UI/UX details and size limits should be adjusted during implementation.*