"""Exporting the documentation space as a zip of `.md` files.

The promise is that unzipping gives back what the sidebar shows, byte for byte:
the Library tree as directories, everything filed by a link in a directory named
after its kind, and every body exactly as it was written.
"""

import io
import zipfile

import pytest
from httpx import AsyncClient

from app.services.doc_export import ExportDoc, build_zip, export_paths, safe_segment


def _doc(id: str, kind: str = "page", *, title: str = "", slug: str = "", parent_id=None, body: str = "") -> ExportDoc:
    return ExportDoc(
        id=id,
        kind=kind,
        title=title or id,
        slug=slug or id,
        parent_id=parent_id,
        body=body,
    )


async def _device(client: AsyncClient, headers: dict, **body) -> dict:
    payload = {"label": "nas-01", "hostname": "nas-01.lan", "ip": "192.168.1.20", "discovery_source": "manual", **body}
    res = await client.post("/api/v1/scan/pending", json=payload, headers=headers)
    assert res.status_code in (200, 201), res.text
    return res.json()


async def _create(client: AsyncClient, headers: dict, **body) -> dict:
    res = await client.post("/api/v1/documents", json={"title": "Page", **body}, headers=headers)
    assert res.status_code == 201, res.text
    return res.json()


def _entries(payload: bytes) -> dict[str, str]:
    with zipfile.ZipFile(io.BytesIO(payload)) as archive:
        return {name: archive.read(name).decode() for name in archive.namelist()}


# ── path layout ─────────────────────────────────────────────────────────────


def test_a_page_at_the_root_is_a_file_at_the_root():
    assert export_paths([_doc("vlan-plan")]) == [("vlan-plan.md", "")]


def test_a_page_in_a_folder_lands_under_its_directory():
    folder = _doc("network", kind="folder")
    page = _doc("vlans", parent_id="network")
    paths = dict(export_paths([folder, page]))
    assert paths["network/vlans.md"] == ""


def test_a_folder_body_becomes_the_index_of_its_own_directory():
    folder = _doc("network", kind="folder", body="# Network\n")
    assert dict(export_paths([folder]))["network/index.md"] == "# Network\n"


def test_nesting_goes_as_deep_as_the_tree():
    paths = dict(
        export_paths(
            [
                _doc("a", kind="folder"),
                _doc("b", kind="folder", parent_id="a"),
                _doc("leaf", parent_id="b"),
            ]
        )
    )
    assert "a/b/leaf.md" in paths
    assert "a/b/index.md" in paths


@pytest.mark.parametrize(
    "kind,directory",
    [("device", "devices"), ("node", "nodes"), ("design", "designs")],
)
def test_linked_kinds_export_into_a_directory_named_for_the_kind(kind, directory):
    assert export_paths([_doc("nas-01", kind=kind)]) == [(f"{directory}/nas-01.md", "")]


def test_a_linked_document_ignores_a_stray_parent():
    """Only page/folder are placed by `parent_id`; a device is placed by its link."""
    paths = dict(export_paths([_doc("network", kind="folder"), _doc("nas", kind="device", parent_id="network")]))
    assert "devices/nas.md" in paths


def test_the_body_is_written_through_untouched():
    body = "---\ntags: [edge]\n---\n\n# OPNsense\n\nWAN on igb0.\n"
    assert export_paths([_doc("opnsense", body=body)])[0][1] == body


def test_a_missing_parent_files_the_page_at_the_root():
    """A folder deleted out from under a page must not lose the page."""
    assert export_paths([_doc("orphan", parent_id="gone")]) == [("orphan.md", "")]


def test_a_parent_cycle_terminates_instead_of_spinning():
    docs = [
        _doc("a", kind="folder", parent_id="b"),
        _doc("b", kind="folder", parent_id="a"),
    ]
    paths = [path for path, _ in export_paths(docs)]
    assert len(paths) == 2
    assert all(path.endswith("index.md") for path in paths)


# ── collisions and unsafe names ─────────────────────────────────────────────


def test_two_documents_wanting_one_path_both_survive():
    """Slugs are unique among siblings only, so a collision is reachable."""
    paths = [path for path, _ in export_paths([_doc("a", title="Same", slug="same"), _doc("b", title="Same", slug="same")])]
    assert sorted(paths) == ["same-2.md", "same.md"]


def test_a_collision_only_differing_by_case_is_still_a_collision():
    """Unzipping on macOS or Windows would otherwise overwrite one of them."""
    paths = [path for path, _ in export_paths([_doc("a", slug="Same"), _doc("b", slug="same")])]
    assert len(set(path.lower() for path in paths)) == 2


def test_a_collision_keeps_both_bodies():
    entries = dict(export_paths([_doc("a", slug="same", body="first"), _doc("b", slug="same", body="second")]))
    assert sorted(entries.values()) == ["first", "second"]


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("../../etc/passwd", "etc-passwd"),
        ("..", "untitled"),
        ("/", "untitled"),
        ("", "untitled"),
        ("   ", "untitled"),
        (".hidden", "hidden"),
        ("Salle des machines", "salle-des-machines"),
        ("a/b", "a-b"),
    ],
)
def test_a_segment_cannot_escape_the_archive(raw, expected):
    assert safe_segment(raw) == expected


def test_an_unsafe_title_cannot_escape_the_archive():
    path = export_paths([_doc("x", slug="../../../etc/passwd")])[0][0]
    assert ".." not in path
    assert not path.startswith("/")


# ── the archive ─────────────────────────────────────────────────────────────


def test_the_archive_reads_back_as_a_zip():
    payload = build_zip([_doc("vlan-plan", body="# VLANs\n")])
    assert _entries(payload) == {"vlan-plan.md": "# VLANs\n"}


def test_an_empty_documentation_space_is_an_empty_archive():
    assert _entries(build_zip([])) == {}


# ── the route ───────────────────────────────────────────────────────────────


async def test_export_requires_auth(client: AsyncClient):
    assert (await client.get("/api/v1/documents/export")).status_code == 401


async def test_export_is_not_read_as_a_document_id(client: AsyncClient, headers: dict):
    """`/export` is declared above `/{document_id}` — a 404 would mean it is not."""
    res = await client.get("/api/v1/documents/export", headers=headers)
    assert res.status_code == 200
    assert res.headers["content-type"] == "application/zip"


async def test_export_names_the_download(client: AsyncClient, headers: dict):
    res = await client.get("/api/v1/documents/export", headers=headers)
    assert res.headers["content-disposition"].startswith('attachment; filename="homelable-documentation-')
    assert res.headers["content-disposition"].endswith('.zip"')
    assert "Content-Disposition" in res.headers["access-control-expose-headers"]


async def test_export_mirrors_the_library_tree(client: AsyncClient, headers: dict):
    folder = await _create(client, headers, title="Network", kind="folder")
    await _create(client, headers, title="VLAN plan", parent_id=folder["id"])

    res = await client.get("/api/v1/documents/export", headers=headers)
    entries = _entries(res.content)
    assert "network/vlan-plan.md" in entries
    assert "network/index.md" in entries


async def test_export_carries_the_body_the_user_saved(client: AsyncClient, headers: dict):
    doc = await _create(client, headers, title="Runbook")
    body = "---\ntags: [ops]\n---\n\n# Runbook\n\nPull the plug.\n"
    res = await client.patch(f"/api/v1/documents/{doc['id']}", json={"body": body}, headers=headers)
    assert res.status_code == 200, res.text

    entries = _entries((await client.get("/api/v1/documents/export", headers=headers)).content)
    assert entries["runbook.md"] == body


async def test_export_files_a_device_document_under_devices(client: AsyncClient, headers: dict):
    device = await _device(client, headers)
    await _create(client, headers, title="nas-01", kind="device", device_id=device["id"])

    entries = _entries((await client.get("/api/v1/documents/export", headers=headers)).content)
    assert "devices/nas-01.md" in entries
    assert entries["devices/nas-01.md"].strip()


async def test_export_includes_every_document(client: AsyncClient, headers: dict):
    device = await _device(client, headers)
    await _create(client, headers, title="nas-01", kind="device", device_id=device["id"])
    folder = await _create(client, headers, title="Ops", kind="folder")
    await _create(client, headers, title="Incident 42", parent_id=folder["id"])
    await _create(client, headers, title="Loose page")

    listed = (await client.get("/api/v1/documents", headers=headers)).json()
    entries = _entries((await client.get("/api/v1/documents/export", headers=headers)).content)
    assert len(entries) == len(listed)


async def test_export_of_an_empty_space_is_a_valid_empty_zip(client: AsyncClient, headers: dict):
    res = await client.get("/api/v1/documents/export", headers=headers)
    assert res.status_code == 200
    assert _entries(res.content) == {}
