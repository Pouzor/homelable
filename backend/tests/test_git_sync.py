"""Git sync: the pushed layout, the git round trip, and the routes.

The git tests push to a bare repository on disk, so they exercise real git —
the layout, the README-once rule and the "touch nothing else" rule are all
properties of what lands in a commit, not of a mocked subprocess.
"""

import json
import os
import subprocess
import uuid
from pathlib import Path

import pytest
from httpx import AsyncClient

from app.api.routes import git_sync as git_sync_route
from app.core.config import settings
from app.services.doc_export import ExportDoc
from app.services.git_sync import (
    README_TEXT,
    DiagramExport,
    GitSyncConfig,
    GitSyncError,
    build_tree,
    commit_message,
    git_env,
    media_refs,
    public_url,
    push,
    scrub,
    sync_subdir,
)


def _run(*args: str, cwd: Path | None = None) -> str:
    # Run outside any enclosing git context: under a pre-commit hook, git exports
    # GIT_INDEX_FILE and friends, which would aim these commands at this repo.
    env = {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}
    return subprocess.run(
        ["git", *args], cwd=cwd, env=env, check=True, capture_output=True, text=True
    ).stdout


def _bare(tmp_path: Path) -> Path:
    remote = tmp_path / "remote.git"
    # HEAD on main, so a clone of it checks out what the sync pushed.
    _run("init", "-q", "--bare", "-b", "main", str(remote))
    return remote


def _tree(remote: Path, branch: str = "main") -> list[str]:
    return sorted(
        _run("--git-dir", str(remote), "ls-tree", "-r", "--name-only", branch).splitlines()
    )


def _show(remote: Path, path: str, branch: str = "main") -> str:
    return _run("--git-dir", str(remote), "show", f"{branch}:{path}")


def _commits(remote: Path, branch: str = "main") -> int:
    return int(_run("--git-dir", str(remote), "rev-list", "--count", branch).strip())


def _doc(id_: str, title: str, *, kind: str = "page", parent_id=None, body="# x\n", **links) -> ExportDoc:
    return ExportDoc(
        id=id_,
        kind=kind,
        title=title,
        slug=title.lower().replace(" ", "-"),
        parent_id=parent_id,
        body=body,
        **links,
    )


def _diagram(id_: str, name: str, design_type: str = "network", state=None) -> DiagramExport:
    return DiagramExport(
        id=id_,
        name=name,
        design_type=design_type,
        icon="dashboard",
        state=state if state is not None else {"nodes": [], "edges": [], "viewport": {}},
    )


# ── Layout ────────────────────────────────────────────────────────────────────


class TestBuildTree:
    def test_documents_land_under_documentation_mirroring_the_tree(self):
        files = build_tree(
            [
                _doc("f1", "Network", kind="folder", body="folder index\n"),
                _doc("p1", "VLAN plan", parent_id="f1", body="---\ntags: [net]\n---\n# VLANs\n"),
                _doc("d1", "nas", kind="device", device_id="inv-1"),
            ],
            [],
        )
        assert files["Documentation/network/index.md"] == b"folder index\n"
        # The body goes out byte for byte, frontmatter included.
        assert files["Documentation/network/vlan-plan.md"] == b"---\ntags: [net]\n---\n# VLANs\n"
        assert "Documentation/devices/nas.md" in files

    def test_each_diagram_gets_a_folder_with_its_raw_state(self):
        files = build_tree(
            [],
            [
                _diagram("g1", "Home LAN", state={"nodes": [{"id": "n1"}], "edges": [], "viewport": {"zoom": 1}}),
                _diagram("g2", "Rack Room", "rack", state={"racks": [{"id": "r1"}], "devices": [], "cables": []}),
            ],
        )
        assert json.loads(files["Diagrams/home-lan/design.json"]) == {
            "id": "g1",
            "name": "Home LAN",
            "design_type": "network",
            "icon": "dashboard",
        }
        assert json.loads(files["Diagrams/home-lan/canvas.json"])["nodes"] == [{"id": "n1"}]
        assert "Diagrams/home-lan/rack.json" not in files
        assert json.loads(files["Diagrams/rack-room/rack.json"])["racks"] == [{"id": "r1"}]
        assert "Diagrams/rack-room/canvas.json" not in files

    def test_live_status_never_reaches_the_repository(self):
        node = {"id": "n1", "label": "nas", "status": "online", "last_seen": "2026-11-03T10:00:00Z",
                "last_scan": None, "response_time_ms": 3}
        files = build_tree(
            [],
            [
                _diagram("g1", "Lan", state={"nodes": [node], "edges": [], "viewport": {}, "initialized": True}),
                _diagram("g2", "Rack", "rack", state={"racks": [], "devices": [{"id": "m1", "status": "offline"}],
                                                      "cables": []}),
            ],
        )
        canvas = json.loads(files["Diagrams/lan/canvas.json"])
        assert canvas["nodes"] == [{"id": "n1", "label": "nas"}]
        assert "initialized" not in canvas
        assert json.loads(files["Diagrams/rack/rack.json"])["devices"] == [{"id": "m1"}]

    def test_diagrams_sharing_a_name_never_overwrite_each_other(self):
        files = build_tree([], [_diagram("b", "Lab"), _diagram("a", "lab")])
        assert json.loads(files["Diagrams/lab/design.json"])["id"] == "a"
        assert json.loads(files["Diagrams/lab-2/design.json"])["id"] == "b"

    def test_manifest_maps_every_path_to_its_id(self):
        files = build_tree(
            [_doc("p1", "Notes"), _doc("d1", "nas", kind="device", device_id="inv-1")],
            [_diagram("g1", "Lan")],
        )
        manifest = json.loads(files[".homelable/manifest.json"])
        assert manifest["format"] == 1
        assert manifest["documents"] == {
            "Documentation/notes.md": {"id": "p1", "kind": "page"},
            "Documentation/devices/nas.md": {"id": "d1", "kind": "device", "device_id": "inv-1"},
        }
        assert manifest["diagrams"] == {"Diagrams/lan": {"id": "g1", "design_type": "network"}}

    def test_same_input_builds_the_same_bytes(self):
        """A sync with nothing new must commit nothing."""
        docs = [_doc("p2", "B"), _doc("p1", "A")]
        diagrams = [_diagram("g2", "Two"), _diagram("g1", "One")]
        assert build_tree(docs, diagrams) == build_tree(list(reversed(docs)), list(reversed(diagrams)))

    def test_commit_message_counts_what_was_pushed(self):
        assert commit_message(1, 2) == "Homelable sync: 1 document, 2 diagrams"
        assert commit_message(0, 1) == "Homelable sync: 0 documents, 1 diagram"


IMG = "269ae443d75d4f43abb690d75da8b746.png"
PDF = "0123456789abcdef0123456789abcdef.pdf"


class TestMedia:
    def test_an_embedded_upload_is_pushed_and_linked_relative_to_the_document(self):
        files = build_tree(
            [
                _doc("p1", "VLAN", body=f"![shot](/api/v1/media/{IMG})\n"),
                _doc("d1", "nas", kind="device", body=f"[manual](/api/v1/media/{PDF})\n"),
            ],
            [],
            {IMG: b"png-bytes", PDF: b"pdf-bytes"},
        )
        assert files[f"Documentation/_media/{IMG}"] == b"png-bytes"
        assert files[f"Documentation/_media/{PDF}"] == b"pdf-bytes"
        assert files["Documentation/vlan.md"] == f"![shot](_media/{IMG})\n".encode()
        assert files["Documentation/devices/nas.md"] == f"[manual](../_media/{PDF})\n".encode()

    def test_a_nested_document_climbs_back_to_the_media_folder(self):
        files = build_tree(
            [
                _doc("f1", "Network", kind="folder"),
                _doc("f2", "Lab", kind="folder", parent_id="f1"),
                _doc("p1", "VLAN", parent_id="f2", body=f'<img src="/api/v1/media/{IMG}">'),
            ],
            [],
            {IMG: b"x"},
        )
        assert files["Documentation/network/lab/vlan.md"] == f'<img src="../../_media/{IMG}">'.encode()

    def test_an_upload_gone_from_the_server_keeps_its_link(self):
        body = f"![shot](/api/v1/media/{IMG})"
        files = build_tree([_doc("p1", "VLAN", body=body)], [], {})
        assert files["Documentation/vlan.md"] == body.encode()
        assert not any(path.startswith("Documentation/_media/") for path in files)

    def test_links_to_another_server_are_left_alone(self):
        body = f"![a](https://example.com/api/v1/media/{IMG}) ![b](/api/v1/media/not-an-upload.png)"
        assert media_refs([_doc("p1", "VLAN", body=body)]) == set()
        assert build_tree([_doc("p1", "VLAN", body=body)], [], {IMG: b"x"})["Documentation/vlan.md"] == body.encode()

    def test_the_manifest_maps_each_media_file_back_to_its_url(self):
        files = build_tree([_doc("p1", "VLAN", body=f"![](/api/v1/media/{IMG})")], [], {IMG: b"x"})
        manifest = json.loads(files[".homelable/manifest.json"])
        assert manifest["media"] == {f"Documentation/_media/{IMG}": f"/api/v1/media/{IMG}"}


def _planned(id_: str, name: str, image: str) -> DiagramExport:
    viewport = {"x": 0, "y": 0, "zoom": 1, "floor_map": {"imageData": image, "opacity": 0.5}}
    return _diagram(id_, name, state={"nodes": [], "edges": [], "viewport": viewport})


class TestFloorPlans:
    def test_a_floor_plan_is_pushed_next_to_its_canvas(self):
        files = build_tree([], [_planned("lan", "Home LAN", f"/api/v1/media/{IMG}")], {IMG: b"plan"})
        assert files["Diagrams/home-lan/floor-plan.png"] == b"plan"
        # Not duplicated among the documents' media.
        assert not any(path.startswith("Documentation/_media/") for path in files)

    def test_canvas_json_keeps_the_raw_url(self):
        files = build_tree([], [_planned("lan", "Home LAN", f"/api/v1/media/{IMG}")], {IMG: b"plan"})
        canvas = json.loads(files["Diagrams/home-lan/canvas.json"])
        assert canvas["viewport"]["floor_map"]["imageData"] == f"/api/v1/media/{IMG}"

    def test_the_manifest_maps_the_floor_plan_back_to_its_url(self):
        files = build_tree([], [_planned("lan", "Home LAN", f"/api/v1/media/{IMG}")], {IMG: b"plan"})
        manifest = json.loads(files[".homelable/manifest.json"])
        assert manifest["media"] == {"Diagrams/home-lan/floor-plan.png": f"/api/v1/media/{IMG}"}

    def test_media_refs_include_floor_plans(self):
        diagrams = [_planned("lan", "Home LAN", f"/api/v1/media/{IMG}"), _diagram("bare", "Bare")]
        assert media_refs([], diagrams) == {IMG}

    @pytest.mark.parametrize("image", ["data:image/png;base64,iVBORw0KGgo=", "/api/v1/media/nope.png", ""])
    def test_no_file_for_a_legacy_or_foreign_floor_plan(self, image):
        diagram = _planned("lan", "Home LAN", image)
        assert media_refs([], [diagram]) == set()
        files = build_tree([], [diagram], {IMG: b"plan"})
        assert not any("floor-plan" in path for path in files)

    def test_a_floor_plan_gone_from_the_server_is_skipped(self):
        files = build_tree([], [_planned("lan", "Home LAN", f"/api/v1/media/{IMG}")], {})
        assert not any("floor-plan" in path for path in files)


SVG = "fedcba9876543210fedcba9876543210.svg"


def _iconed(id_: str, name: str, nodes: list) -> DiagramExport:
    return _diagram(id_, name, state={"nodes": nodes, "edges": [], "viewport": {}})


class TestNodeIcons:
    def test_an_uploaded_node_icon_is_pushed_under_the_canvas_icons_folder(self):
        diagram = _iconed("lan", "Home LAN", [{"id": "n1", "custom_icon": f"url:/api/v1/media/{IMG}"}])
        files = build_tree([], [diagram], {IMG: b"icon"})
        assert files[f"Diagrams/home-lan/icons/{IMG}"] == b"icon"
        assert not any(path.startswith("Documentation/_media/") for path in files)

    def test_an_uploaded_service_icon_is_pushed_too(self):
        node = {"id": "n1", "services": [{"service_name": "nas", "icon": f"url:/api/v1/media/{SVG}"}]}
        files = build_tree([], [_iconed("lan", "Home LAN", [node])], {SVG: b"<svg/>"})
        assert files[f"Diagrams/home-lan/icons/{SVG}"] == b"<svg/>"

    def test_an_icon_shared_by_two_nodes_is_pushed_once(self):
        key = f"url:/api/v1/media/{IMG}"
        diagram = _iconed("lan", "Home LAN", [{"id": "a", "custom_icon": key}, {"id": "b", "custom_icon": key}])
        files = build_tree([], [diagram], {IMG: b"icon"})
        assert [p for p in files if "/icons/" in p] == [f"Diagrams/home-lan/icons/{IMG}"]

    def test_each_canvas_carries_its_own_copy(self):
        key = f"url:/api/v1/media/{IMG}"
        diagrams = [_iconed("a", "Alpha", [{"id": "n", "custom_icon": key}]),
                    _iconed("b", "Beta", [{"id": "n", "custom_icon": key}])]
        files = build_tree([], diagrams, {IMG: b"icon"})
        assert f"Diagrams/alpha/icons/{IMG}" in files
        assert f"Diagrams/beta/icons/{IMG}" in files

    def test_canvas_json_keeps_the_raw_icon_key(self):
        key = f"url:/api/v1/media/{IMG}"
        files = build_tree([], [_iconed("lan", "Home LAN", [{"id": "n1", "custom_icon": key}])], {IMG: b"icon"})
        canvas = json.loads(files["Diagrams/home-lan/canvas.json"])
        assert canvas["nodes"][0]["custom_icon"] == key

    def test_the_manifest_maps_each_icon_back_to_its_url(self):
        diagram = _iconed("lan", "Home LAN", [{"id": "n1", "custom_icon": f"url:/api/v1/media/{IMG}"}])
        manifest = json.loads(build_tree([], [diagram], {IMG: b"icon"})[".homelable/manifest.json"])
        assert manifest["media"] == {f"Diagrams/home-lan/icons/{IMG}": f"/api/v1/media/{IMG}"}

    def test_media_refs_include_node_and_service_icons(self):
        node = {"id": "n1", "custom_icon": f"url:/api/v1/media/{IMG}",
                "services": [{"icon": f"url:/api/v1/media/{SVG}"}]}
        assert media_refs([], [_iconed("lan", "Home LAN", [node])]) == {IMG, SVG}

    @pytest.mark.parametrize("key", [
        "database",
        "brand:plex",
        "url:https://cdn.jsdelivr.net/gh/selfhst/icons/svg/immich.svg",
        f"url:https://other.host/api/v1/media/{IMG}",
        f"/api/v1/media/{IMG}",
        "url:/api/v1/media/nope.png",
        None,
        42,
    ])
    def test_no_file_for_an_icon_that_is_not_an_upload(self, key):
        diagram = _iconed("lan", "Home LAN", [{"id": "n1", "custom_icon": key, "services": [{"icon": key}]}])
        assert media_refs([], [diagram]) == set()
        assert not any("/icons/" in path for path in build_tree([], [diagram], {IMG: b"icon"}))

    def test_an_icon_gone_from_the_server_is_skipped(self):
        diagram = _iconed("lan", "Home LAN", [{"id": "n1", "custom_icon": f"url:/api/v1/media/{IMG}"}])
        assert not any("/icons/" in path for path in build_tree([], [diagram], {}))

    def test_malformed_node_rows_are_ignored(self):
        diagram = _iconed("lan", "Home LAN", ["not-a-node", {"id": "n1", "services": ["nope", None]}])
        assert media_refs([], [diagram]) == set()

    def test_a_rack_has_no_icons_folder(self):
        rack = _diagram("r", "Rack Room", "rack", {"racks": [], "devices": [], "cables": []})
        assert media_refs([], [rack]) == set()
        assert not any("/icons/" in path for path in build_tree([], [rack], {IMG: b"icon"}))


class TestSyncSubdir:
    @pytest.mark.parametrize(("raw", "expected"), [("", ""), ("docs", "docs"), ("/docs/homelable/", "docs/homelable"),
                                                   ("./docs", "docs"), ("a\\b", "a/b")])
    def test_normalises_a_folder_inside_the_repository(self, raw, expected):
        assert sync_subdir(raw) == expected

    @pytest.mark.parametrize("raw", ["..", "docs/../..", ".git", ".git/hooks"])
    def test_refuses_a_path_outside_the_working_copy(self, raw):
        with pytest.raises(GitSyncError):
            sync_subdir(raw)


class TestCredentials:
    def test_public_url_strips_userinfo(self):
        assert public_url("https://bob:s3cret@git.example.com/me/lab.git") == "https://git.example.com/me/lab.git"  # trufflehog:ignore
        assert public_url("git@github.com:me/lab.git") == "git@github.com:me/lab.git"

    def test_scrub_removes_the_token_and_url_credentials(self):
        cfg = GitSyncConfig(repo_url="https://bob:pw@host/x.git", token="tok-123")  # trufflehog:ignore
        text = scrub("fatal: tok-123 rejected for https://bob:pw@host/x.git", cfg)  # trufflehog:ignore
        assert "tok-123" not in text
        assert "bob:pw" not in text

    def test_token_goes_through_the_environment_not_the_command_line(self, tmp_path):
        env = git_env(GitSyncConfig(repo_url="https://host/x.git", token="tok", username="me"), tmp_path / "kh")
        assert env["GIT_CONFIG_KEY_0"] == "http.extraHeader"
        assert env["GIT_CONFIG_VALUE_0"] == "Authorization: Basic bWU6dG9r"  # base64("me:tok")
        assert env["GIT_TERMINAL_PROMPT"] == "0"
        assert "GIT_SSH_COMMAND" not in env

    def test_inherited_git_variables_are_dropped(self, tmp_path, monkeypatch):
        """Regression: under a git hook, GIT_INDEX_FILE / GIT_AUTHOR_* leaked in."""
        monkeypatch.setenv("GIT_INDEX_FILE", "/elsewhere/index")
        monkeypatch.setenv("GIT_DIR", "/elsewhere/.git")
        monkeypatch.setenv("GIT_AUTHOR_NAME", "Someone else")
        env = git_env(GitSyncConfig(repo_url="https://host/x.git"), tmp_path / "kh")
        assert "GIT_INDEX_FILE" not in env
        assert "GIT_DIR" not in env
        assert "GIT_AUTHOR_NAME" not in env
        assert env["GIT_TERMINAL_PROMPT"] == "0"

    def test_ssh_key_pins_the_known_hosts_file(self, tmp_path):
        env = git_env(GitSyncConfig(repo_url="git@host:x.git", ssh_key="/keys/id"), tmp_path / "kh")
        assert "-i /keys/id" in env["GIT_SSH_COMMAND"]
        assert f"UserKnownHostsFile={tmp_path / 'kh'}" in env["GIT_SSH_COMMAND"]
        assert "GIT_CONFIG_KEY_0" not in env

    def test_auth_reports_the_credential_in_use(self):
        assert GitSyncConfig(repo_url="u", token="t").auth == "token"
        assert GitSyncConfig(repo_url="u", ssh_key="/k").auth == "ssh"
        assert GitSyncConfig(repo_url="u").auth == "none"
        assert GitSyncConfig(repo_url="https://bob:pw@host/x.git").auth == "token"  # trufflehog:ignore

    def test_url_credentials_travel_in_the_header(self, tmp_path):
        env = git_env(GitSyncConfig(repo_url="https://bob:p%40ss@host/x.git"), tmp_path / "kh")  # trufflehog:ignore
        assert env["GIT_CONFIG_VALUE_0"] == "Authorization: Basic Ym9iOnBAc3M="  # base64("bob:p@ss")

    def test_the_token_wins_over_url_credentials(self, tmp_path):
        env = git_env(GitSyncConfig(repo_url="https://bob:pw@host/x.git", token="tok", username="me"),  # trufflehog:ignore
                      tmp_path / "kh")
        assert env["GIT_CONFIG_VALUE_0"] == "Authorization: Basic bWU6dG9r"  # base64("me:tok")

    def test_url_credentials_are_never_written_to_git_config(self, tmp_path):
        """Regression: the URL went into `.git/config` as-is, password included."""
        # Nothing listens on port 9: the sync fails fast, after configuring the remote.
        cfg = GitSyncConfig(repo_url="https://bob:s3cret@127.0.0.1:9/lab.git")  # trufflehog:ignore
        with pytest.raises(GitSyncError) as exc:
            push(cfg, tmp_path / "work", {}, "sync", tmp_path / "kh")
        config = (tmp_path / "work" / ".git" / "config").read_text()
        assert "https://127.0.0.1:9/lab.git" in config
        assert "s3cret" not in config
        assert "s3cret" not in str(exc.value)


# ── Git round trip ────────────────────────────────────────────────────────────


def _push(tmp_path: Path, remote: Path, files: dict[str, bytes], **cfg):
    return push(
        GitSyncConfig(repo_url=str(remote), **cfg),
        tmp_path / "work",
        files,
        "sync",
        tmp_path / "known_hosts",
    )


class TestPush:
    def test_first_sync_creates_the_branch_with_a_readme(self, tmp_path):
        remote = _bare(tmp_path)
        result = _push(tmp_path, remote, build_tree([_doc("p1", "Notes")], [_diagram("g1", "Lan")]))

        assert result.status == "pushed"
        assert result.commit
        assert _tree(remote) == [
            ".homelable/manifest.json",
            "Diagrams/lan/canvas.json",
            "Diagrams/lan/design.json",
            "Documentation/notes.md",
            "README.md",
        ]
        assert _show(remote, "README.md") == README_TEXT

    def test_a_sync_with_nothing_new_commits_nothing(self, tmp_path):
        remote = _bare(tmp_path)
        files = build_tree([_doc("p1", "Notes")], [])
        first = _push(tmp_path, remote, files)
        second = _push(tmp_path, remote, files)

        assert second.status == "unchanged"
        assert second.files_changed == 0
        assert second.commit == first.commit
        assert _commits(remote) == 1

    def test_readme_is_written_once_and_then_left_to_the_user(self, tmp_path):
        remote = _bare(tmp_path)
        _push(tmp_path, remote, build_tree([], []))
        # The user rewrites the README from another clone.
        other = tmp_path / "other"
        _run("clone", "-q", str(remote), str(other))
        (other / "README.md").write_text("# Mine\n")
        _run("-c", "user.name=u", "-c", "user.email=u@x", "commit", "-qam", "mine", cwd=other)
        _run("push", "-q", cwd=other)

        _push(tmp_path, remote, build_tree([_doc("p1", "Notes")], []))
        assert _show(remote, "README.md") == "# Mine\n"

    def test_a_deleted_document_disappears_from_the_repository(self, tmp_path):
        remote = _bare(tmp_path)
        _push(tmp_path, remote, build_tree([_doc("p1", "Keep"), _doc("p2", "Gone")], [_diagram("g1", "Old")]))
        result = _push(tmp_path, remote, build_tree([_doc("p1", "Keep")], []))

        assert result.status == "pushed"
        assert "Documentation/gone.md" not in _tree(remote)
        assert not any(p.startswith("Diagrams/") for p in _tree(remote))
        assert "Documentation/keep.md" in _tree(remote)

    def test_a_sub_folder_leaves_the_rest_of_a_monorepo_alone(self, tmp_path):
        remote = _bare(tmp_path)
        seed = tmp_path / "seed"
        _run("init", "-q", "-b", "main", str(seed))
        (seed / "README.md").write_text("# Monorepo\n")
        (seed / "infra").mkdir()
        (seed / "infra" / "main.tf").write_text("terraform {}\n")
        # A hand-written folder named like a managed one, outside the sync path.
        (seed / "Documentation").mkdir()
        (seed / "Documentation" / "own.md").write_text("mine\n")
        _run("add", "-A", cwd=seed)
        _run("-c", "user.name=u", "-c", "user.email=u@x", "commit", "-qm", "seed", cwd=seed)
        _run("push", "-q", str(remote), "main", cwd=seed)

        _push(tmp_path, remote, build_tree([_doc("p1", "Notes")], []), path="docs/homelable")

        tree = _tree(remote)
        assert "infra/main.tf" in tree
        assert "Documentation/own.md" in tree
        assert _show(remote, "README.md") == "# Monorepo\n"
        assert "docs/homelable/Documentation/notes.md" in tree
        assert "docs/homelable/README.md" in tree

    def test_pushes_to_the_configured_branch(self, tmp_path):
        remote = _bare(tmp_path)
        _push(tmp_path, remote, build_tree([_doc("p1", "Notes")], []), branch="homelable")
        assert "Documentation/notes.md" in _tree(remote, "homelable")

    def test_commits_as_the_configured_author(self, tmp_path):
        remote = _bare(tmp_path)
        _push(tmp_path, remote, build_tree([], []), author_name="Lab Bot", author_email="bot@lab")
        author = _run("--git-dir", str(remote), "log", "-1", "--format=%an <%ae>", "main").strip()
        assert author == "Lab Bot <bot@lab>"

    def test_a_symlinked_readme_is_never_written_through(self, tmp_path):
        """Regression: a README committed as a link to a missing file read as
        absent, and the first-sync write created the link's target."""
        remote = _bare(tmp_path)
        outside = tmp_path / "outside.txt"
        seed = tmp_path / "seed"
        _run("init", "-q", "-b", "main", str(seed))
        (seed / "README.md").symlink_to(outside)
        _run("add", "-A", cwd=seed)
        _run("-c", "user.name=u", "-c", "user.email=u@x", "commit", "-qm", "seed", cwd=seed)
        _run("push", "-q", str(remote), "main", cwd=seed)

        result = _push(tmp_path, remote, build_tree([_doc("p1", "Notes")], []))

        assert result.status == "pushed"
        assert not outside.exists()
        # Still the user's link, untouched.
        assert _show(remote, "README.md") == str(outside)

    def test_an_unreachable_remote_raises_a_sync_error(self, tmp_path):
        with pytest.raises(GitSyncError):
            _push(tmp_path, tmp_path / "missing.git", build_tree([], []))

    def test_a_failed_push_does_not_leak_into_the_next_sync(self, tmp_path):
        remote = _bare(tmp_path)
        _push(tmp_path, remote, build_tree([_doc("p1", "One")], []))
        # Someone else pushes meanwhile, so the next local commit is rejected...
        other = tmp_path / "other"
        _run("clone", "-q", str(remote), str(other))
        (other / "elsewhere.txt").write_text("x\n")
        _run("add", "-A", cwd=other)
        _run("-c", "user.name=u", "-c", "user.email=u@x", "commit", "-qm", "x", cwd=other)
        _run("push", "-q", cwd=other)

        # ...but the sync starts from the remote tip, so it lands on top of it.
        result = _push(tmp_path, remote, build_tree([_doc("p1", "One"), _doc("p2", "Two")], []))
        assert result.status == "pushed"
        assert "elsewhere.txt" in _tree(remote)
        assert "Documentation/two.md" in _tree(remote)


# ── Routes ────────────────────────────────────────────────────────────────────


@pytest.fixture
def configured(tmp_path, monkeypatch):
    remote = _bare(tmp_path)
    monkeypatch.setattr(settings, "sqlite_path", str(tmp_path / "data" / "homelab.db"))
    monkeypatch.setattr(settings, "git_sync_repo_url", str(remote))
    monkeypatch.setattr(settings, "git_sync_branch", "main")
    monkeypatch.setattr(settings, "git_sync_path", "")
    monkeypatch.setattr(settings, "git_sync_token", "")
    monkeypatch.setattr(settings, "git_sync_ssh_key", "")
    return remote


@pytest.fixture
def unconfigured(monkeypatch):
    monkeypatch.setattr(settings, "git_sync_repo_url", "")


async def _seed(client: AsyncClient, headers: dict) -> None:
    lan = (await client.post("/api/v1/designs", json={"name": "Home LAN", "design_type": "network"},
                             headers=headers)).json()["id"]
    node = {"id": str(uuid.uuid4()), "type": "server", "label": "nas", "status": "online", "pos_x": 0, "pos_y": 0}
    res = await client.post("/api/v1/canvas/save",
                            json={"design_id": lan, "nodes": [node], "edges": [], "viewport": {"x": 0, "y": 0, "zoom": 1}},
                            headers=headers)
    assert res.status_code == 200, res.text
    rack = (await client.post("/api/v1/designs", json={"name": "Rack Room", "design_type": "rack"},
                              headers=headers)).json()["id"]
    res = await client.post(
        "/api/v1/racks/save",
        json={"design_id": rack, "racks": [{"id": "rack-1", "name": "Main", "u_height": 12}], "devices": [],
              "cables": [], "viewport": {"x": 0, "y": 0, "zoom": 1}},
        headers=headers,
    )
    assert res.status_code == 200, res.text
    res = await client.post("/api/v1/documents", json={"title": "VLAN plan", "body": "# VLANs\n"}, headers=headers)
    assert res.status_code == 201, res.text


class TestRoutes:
    async def test_status_requires_auth(self, client: AsyncClient):
        assert (await client.get("/api/v1/git-sync")).status_code == 401

    async def test_sync_requires_auth(self, client: AsyncClient):
        assert (await client.post("/api/v1/git-sync")).status_code == 401

    async def test_status_when_not_configured(self, client: AsyncClient, headers, unconfigured):
        res = await client.get("/api/v1/git-sync", headers=headers)
        assert res.status_code == 200
        assert res.json()["configured"] is False
        assert res.json()["repo_url"] is None

    async def test_status_never_returns_a_credential(self, client: AsyncClient, headers, configured, monkeypatch):
        monkeypatch.setattr(settings, "git_sync_repo_url", "https://bob:pw@git.example.com/lab.git")  # trufflehog:ignore
        monkeypatch.setattr(settings, "git_sync_token", "tok-secret")
        monkeypatch.setattr(settings, "git_sync_path", "docs")
        res = await client.get("/api/v1/git-sync", headers=headers)
        body = res.json()
        assert body["configured"] is True
        assert body["repo_url"] == "https://git.example.com/lab.git"
        assert body["auth"] == "token"
        assert body["path"] == "docs"
        assert "tok-secret" not in res.text
        assert "bob:pw" not in res.text

    async def test_sync_when_not_configured_is_a_400(self, client: AsyncClient, headers, unconfigured):
        res = await client.post("/api/v1/git-sync", headers=headers)
        assert res.status_code == 400
        assert "GIT_SYNC_REPO_URL" in res.json()["detail"]

    async def test_sync_refuses_a_path_outside_the_repository(self, client: AsyncClient, headers, configured,
                                                              monkeypatch):
        monkeypatch.setattr(settings, "git_sync_path", "../escape")
        res = await client.post("/api/v1/git-sync", headers=headers)
        assert res.status_code == 400

    async def test_sync_pushes_documents_and_every_diagram(self, client: AsyncClient, headers, configured):
        await _seed(client, headers)
        res = await client.post("/api/v1/git-sync", headers=headers)
        assert res.status_code == 200, res.text
        body = res.json()
        assert body["status"] == "pushed"
        assert body["documents"] == 1
        assert body["diagrams"] == 2

        tree = _tree(configured)
        assert "README.md" in tree
        assert "Documentation/vlan-plan.md" in tree
        assert "Diagrams/home-lan/canvas.json" in tree
        assert "Diagrams/rack-room/rack.json" in tree
        assert _show(configured, "Documentation/vlan-plan.md") == "# VLANs\n"
        canvas = json.loads(_show(configured, "Diagrams/home-lan/canvas.json"))
        assert [n["label"] for n in canvas["nodes"]] == ["nas"]
        assert "status" not in canvas["nodes"][0]
        rack = json.loads(_show(configured, "Diagrams/rack-room/rack.json"))
        assert [r["name"] for r in rack["racks"]] == ["Main"]

    async def test_sync_pushes_the_uploads_a_document_embeds(self, client: AsyncClient, headers, configured,
                                                            monkeypatch, tmp_path):
        media = tmp_path / "uploads"
        media.mkdir()
        (media / IMG).write_bytes(b"\x89PNG\r\n\x1a\nimage")
        (media / PDF).write_bytes(b"%PDF-unreferenced")
        monkeypatch.setattr(settings, "upload_dir", str(media))
        res = await client.post("/api/v1/documents",
                                json={"title": "VLAN", "body": f"![shot](/api/v1/media/{IMG})\n"}, headers=headers)
        assert res.status_code == 201, res.text

        assert (await client.post("/api/v1/git-sync", headers=headers)).status_code == 200
        tree = _tree(configured)
        assert f"Documentation/_media/{IMG}" in tree
        # Only what a document embeds: the uploads folder also holds floor plans.
        assert f"Documentation/_media/{PDF}" not in tree
        assert _show(configured, "Documentation/vlan.md") == f"![shot](_media/{IMG})\n"

    async def test_sync_pushes_a_canvas_floor_plan(self, client: AsyncClient, headers, configured,
                                                   monkeypatch, tmp_path):
        media = tmp_path / "uploads"
        media.mkdir()
        (media / IMG).write_bytes(b"\x89PNG\r\n\x1a\nplan")
        monkeypatch.setattr(settings, "upload_dir", str(media))
        lan = (await client.post("/api/v1/designs", json={"name": "Home LAN", "design_type": "network"},
                                 headers=headers)).json()["id"]
        viewport = {"x": 0, "y": 0, "zoom": 1, "floor_map": {"imageData": f"/api/v1/media/{IMG}"}}
        res = await client.post("/api/v1/canvas/save",
                                json={"design_id": lan, "nodes": [], "edges": [], "viewport": viewport},
                                headers=headers)
        assert res.status_code == 200, res.text

        assert (await client.post("/api/v1/git-sync", headers=headers)).status_code == 200
        assert "Diagrams/home-lan/floor-plan.png" in _tree(configured)
        canvas = json.loads(_show(configured, "Diagrams/home-lan/canvas.json"))
        assert canvas["viewport"]["floor_map"]["imageData"] == f"/api/v1/media/{IMG}"

    async def test_sync_pushes_uploaded_node_icons(self, client: AsyncClient, headers, configured,
                                                   monkeypatch, tmp_path):
        media = tmp_path / "uploads"
        media.mkdir()
        (media / IMG).write_bytes(b"\x89PNG\r\n\x1a\nicon")
        monkeypatch.setattr(settings, "upload_dir", str(media))
        lan = (await client.post("/api/v1/designs", json={"name": "Home LAN", "design_type": "network"},
                                 headers=headers)).json()["id"]
        node = {"id": str(uuid.uuid4()), "type": "server", "label": "nas", "status": "online",
                "services": [], "custom_icon": f"url:/api/v1/media/{IMG}", "pos_x": 0, "pos_y": 0}
        res = await client.post("/api/v1/canvas/save",
                                json={"design_id": lan, "nodes": [node], "edges": [], "viewport": {}},
                                headers=headers)
        assert res.status_code == 200, res.text

        assert (await client.post("/api/v1/git-sync", headers=headers)).status_code == 200
        assert f"Diagrams/home-lan/icons/{IMG}" in _tree(configured)
        canvas = json.loads(_show(configured, "Diagrams/home-lan/canvas.json"))
        assert canvas["nodes"][0]["custom_icon"] == f"url:/api/v1/media/{IMG}"

    async def test_second_sync_reports_unchanged(self, client: AsyncClient, headers, configured):
        await _seed(client, headers)
        await client.post("/api/v1/git-sync", headers=headers)
        res = await client.post("/api/v1/git-sync", headers=headers)
        assert res.json()["status"] == "unchanged"
        assert _commits(configured) == 1

    async def test_status_reports_the_last_sync(self, client: AsyncClient, headers, configured):
        await client.post("/api/v1/git-sync", headers=headers)
        last = (await client.get("/api/v1/git-sync", headers=headers)).json()["last"]
        assert last["status"] == "pushed"
        assert last["commit"]

    async def test_failed_sync_is_a_502_without_the_token(self, client: AsyncClient, headers, configured,
                                                          monkeypatch, tmp_path):
        monkeypatch.setattr(settings, "git_sync_repo_url", str(tmp_path / "nowhere.git"))
        monkeypatch.setattr(settings, "git_sync_token", "tok-secret")
        res = await client.post("/api/v1/git-sync", headers=headers)
        assert res.status_code == 502
        assert res.json()["detail"].startswith("Git sync failed")
        assert "tok-secret" not in res.text
        last = (await client.get("/api/v1/git-sync", headers=headers)).json()["last"]
        assert last["status"] == "failed"
        assert last["error"]

    async def test_a_second_sync_while_one_runs_is_a_409(self, client: AsyncClient, headers, configured):
        await git_sync_route._lock.acquire()
        try:
            res = await client.post("/api/v1/git-sync", headers=headers)
            assert res.status_code == 409
            status = (await client.get("/api/v1/git-sync", headers=headers)).json()
            assert status["running"] is True
        finally:
            git_sync_route._lock.release()
