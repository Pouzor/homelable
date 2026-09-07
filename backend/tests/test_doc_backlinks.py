"""Backlinks — the inverse of a wiki-link.

Two halves. The pure resolution rules, which must stay identical to
`frontend/src/documentation/wikilinks.ts`, and the route, which has to find a
target document that carries no links of its own and must not pay for the
inventory when nothing links to a device.
"""

from dataclasses import dataclass

from httpx import AsyncClient

from app.services import doc_backlinks


@dataclass
class FakeDoc:
    id: str
    slug: str = ""
    title: str = ""
    body: str = ""
    device_id: str | None = None
    node_id: str | None = None


@dataclass
class FakeDevice:
    id: str
    label: str | None = None
    friendly_name: str | None = None
    hostname: str | None = None
    ip: str | None = None


# ── parsing ─────────────────────────────────────────────────────────────────


def test_a_bare_link_is_a_document_link():
    link = doc_backlinks.parse_link("VLAN plan")
    assert link is not None
    assert (link.target, link.key, link.label) == ("doc", "VLAN plan", "VLAN plan")


def test_a_prefix_picks_the_target():
    assert doc_backlinks.parse_link("device:nas-01").target == "device"
    assert doc_backlinks.parse_link("NODE:abc").target == "node"
    assert doc_backlinks.parse_link("doc:vlan-plan").target == "doc"


def test_an_unknown_prefix_stays_part_of_the_key():
    link = doc_backlinks.parse_link("http://nas.lan")
    assert link is not None
    assert (link.target, link.key) == ("doc", "http://nas.lan")


def test_a_pipe_sets_the_label():
    link = doc_backlinks.parse_link("device:nas-01|the big NAS")
    assert link is not None
    assert (link.key, link.label) == ("nas-01", "the big NAS")


def test_an_empty_link_is_not_a_link():
    assert doc_backlinks.parse_link("") is None
    assert doc_backlinks.parse_link("device:") is None


def test_links_are_collected_with_their_line():
    body = "intro\nsee [[a]] and [[b]]\n"
    found = list(doc_backlinks.iter_links(body))
    assert [link.key for _, link in found] == ["a", "b"]
    assert {line for line, _ in found} == {"see [[a]] and [[b]]"}


# ── resolution ──────────────────────────────────────────────────────────────


def _resolve(inner: str, docs: list[FakeDoc], devices: list[FakeDevice] | None = None):
    link = doc_backlinks.parse_link(inner)
    assert link is not None
    return doc_backlinks.resolve(link, docs, devices or [])


def test_a_document_resolves_by_id_then_slug_then_title():
    docs = [
        FakeDoc(id="d1", slug="vlan-plan", title="VLAN plan"),
        FakeDoc(id="d2", slug="other", title="Other"),
    ]
    assert _resolve("d1", docs) == "d1"
    assert _resolve("vlan-plan", docs) == "d1"
    assert _resolve("VLAN PLAN", docs) == "d1"


def test_an_unmatched_document_link_resolves_to_nothing():
    assert _resolve("nowhere", [FakeDoc(id="d1", slug="s", title="t")]) is None


def test_a_device_link_resolves_by_id_or_label():
    docs = [FakeDoc(id="d1", device_id="dev1")]
    devices = [FakeDevice(id="dev1", label="nas-01")]
    assert _resolve("device:dev1", docs, devices) == "d1"
    assert _resolve("device:NAS-01", docs, devices) == "d1"


def test_a_device_label_falls_back_the_way_the_tree_does():
    assert doc_backlinks.device_label(FakeDevice(id="x", hostname="h")) == "h"
    assert doc_backlinks.device_label(FakeDevice(id="x", ip="10.0.0.1")) == "10.0.0.1"
    assert doc_backlinks.device_label(FakeDevice(id="x")) == "Unnamed device"


def test_a_device_with_no_document_resolves_to_nothing():
    assert _resolve("device:dev1", [], [FakeDevice(id="dev1", label="nas")]) is None


def test_a_node_link_resolves_through_node_id():
    docs = [FakeDoc(id="d1", node_id="n1")]
    assert _resolve("node:n1", docs) == "d1"
    assert _resolve("node:n2", docs) is None


# ── inversion ───────────────────────────────────────────────────────────────


def test_a_document_that_links_here_is_a_backlink():
    docs = [
        FakeDoc(id="d1", slug="a", title="A", body="see [[B]]"),
        FakeDoc(id="d2", slug="b", title="B", body="no links"),
    ]
    hits = doc_backlinks.backlinks_for("d2", docs, [])
    assert [h.doc_id for h in hits] == ["d1"]
    assert hits[0].context == "see [[B]]"


def test_a_document_does_not_link_to_itself():
    docs = [FakeDoc(id="d1", slug="a", title="A", body="[[A]] again")]
    assert doc_backlinks.backlinks_for("d1", docs, []) == []


def test_two_links_from_one_document_are_one_backlink_with_a_count():
    docs = [
        FakeDoc(id="d1", slug="a", title="A", body="[[B]] and later [[b]]"),
        FakeDoc(id="d2", slug="b", title="B"),
    ]
    hits = doc_backlinks.backlinks_for("d2", docs, [])
    assert len(hits) == 1
    assert hits[0].count == 2


def test_the_written_label_is_kept():
    docs = [
        FakeDoc(id="d1", slug="a", title="A", body="[[B|the other one]]"),
        FakeDoc(id="d2", slug="b", title="B"),
    ]
    assert doc_backlinks.backlinks_for("d2", docs, [])[0].label == "the other one"


def test_a_long_line_is_windowed_around_the_link():
    filler = "word " * 60
    docs = [
        FakeDoc(id="d1", slug="a", title="A", body=f"{filler}[[B]]{filler}"),
        FakeDoc(id="d2", slug="b", title="B"),
    ]
    context = doc_backlinks.backlinks_for("d2", docs, [])[0].context
    assert "[[B]]" in context
    assert len(context) < 200


def test_has_device_link_only_fires_on_a_device_link():
    assert doc_backlinks.has_device_link([FakeDoc(id="d", body="[[device:x]]")])
    assert not doc_backlinks.has_device_link([FakeDoc(id="d", body="[[plain]]")])


# ── route ───────────────────────────────────────────────────────────────────


async def test_backlinks_requires_auth(client: AsyncClient):
    assert (await client.get("/api/v1/documents/x/backlinks")).status_code == 401


async def test_backlinks_404_on_an_unknown_document(client: AsyncClient, headers: dict):
    res = await client.get("/api/v1/documents/nope/backlinks", headers=headers)
    assert res.status_code == 404


async def test_the_route_finds_a_target_that_carries_no_links(client: AsyncClient, headers: dict):
    """The target's own body has no `[[`, so it is only ever a resolution target."""
    target = (
        await client.post("/api/v1/documents", json={"title": "VLAN plan"}, headers=headers)
    ).json()
    source = (
        await client.post("/api/v1/documents", json={"title": "Runbook"}, headers=headers)
    ).json()
    await client.patch(
        f"/api/v1/documents/{source['id']}",
        json={"body": "Read the [[VLAN plan]] first."},
        headers=headers,
    )

    res = await client.get(f"/api/v1/documents/{target['id']}/backlinks", headers=headers)
    assert res.status_code == 200
    hits = res.json()
    assert [h["doc_id"] for h in hits] == [source["id"]]
    assert hits[0]["title"] == "Runbook"
    assert hits[0]["label"] == "VLAN plan"
    assert hits[0]["context"] == "Read the [[VLAN plan]] first."


async def test_a_device_document_is_reachable_by_its_device_link(client: AsyncClient, headers: dict):
    res = await client.post(
        "/api/v1/scan/pending",
        json={
            "label": "nas-01",
            "hostname": "nas-01.lan",
            "ip": "192.168.1.20",
            "discovery_source": "manual",
        },
        headers=headers,
    )
    assert res.status_code in (200, 201), res.text
    device = res.json()
    doc = (
        await client.post(
            "/api/v1/documents",
            json={"title": "nas-01", "kind": "device", "device_id": device["id"]},
            headers=headers,
        )
    ).json()
    source = (
        await client.post("/api/v1/documents", json={"title": "Backups"}, headers=headers)
    ).json()
    await client.patch(
        f"/api/v1/documents/{source['id']}",
        json={"body": "Runs on [[device:nas-01]]."},
        headers=headers,
    )

    hits = (await client.get(f"/api/v1/documents/{doc['id']}/backlinks", headers=headers)).json()
    assert [h["doc_id"] for h in hits] == [source["id"]]
    assert hits[0]["device_id"] is None  # the *source* is a page, not a device


async def test_an_unresolved_link_is_not_a_backlink(client: AsyncClient, headers: dict):
    target = (
        await client.post("/api/v1/documents", json={"title": "Target"}, headers=headers)
    ).json()
    source = (
        await client.post("/api/v1/documents", json={"title": "Source"}, headers=headers)
    ).json()
    await client.patch(
        f"/api/v1/documents/{source['id']}",
        json={"body": "Points at [[Something else]]."},
        headers=headers,
    )
    hits = (await client.get(f"/api/v1/documents/{target['id']}/backlinks", headers=headers)).json()
    assert hits == []
