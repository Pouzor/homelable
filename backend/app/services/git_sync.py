"""Push the documentation space and every diagram to a git repository.

One way for now: Homelable is the source of truth and the repository receives a
commit per sync that changed something. An import from the repository is the
next step, which is why every pushed file is recorded in a manifest against the
id it came from — paths alone cannot follow a rename.

Layout, under `GIT_SYNC_PATH` (the repository root when empty):

    README.md                       written on the first sync only, then the user's
    Documentation/…                 one `.md` per document, laid out by `doc_export`
    Documentation/_media/…          every uploaded file a document embeds
    Diagrams/<name>/design.json     the design itself
    Diagrams/<name>/canvas.json     nodes, edges, viewport  (network, electrical)
    Diagrams/<name>/rack.json       racks, mounts, cables   (rack)
    Diagrams/<name>/floor-plan.*    the canvas' uploaded floor plan, if it has one
    .homelable/manifest.json        path -> id, for the import to come

`Documentation/`, `Diagrams/` and `.homelable/` are owned by the sync and
rewritten whole each time, so a document deleted in Homelable disappears from
the repository too. Nothing else under the sync path, nor outside it, is ever
touched — the repository can be a monorepo the sync shares with other content.

Documents embed uploads as `/api/v1/media/<name>`, a URL only the Homelable
server answers. The pushed copy points at the file under `_media/` instead, by
a path relative to the document, so the repository renders on its own. A floor
plan is copied next to its canvas instead; `canvas.json` keeps its URL as is,
the raw state an import saves back.

The working copy lives on the data volume and is only a cache: it is reset to
the remote branch before every sync, so a failed push never leaks into the next
one.
"""

from __future__ import annotations

import base64
import json
import os
import re
import shlex
import shutil
import subprocess
from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlsplit, urlunsplit

from app.services.doc_export import ExportDoc, export_layout, safe_segment

DOCS_DIR = "Documentation"
DIAGRAMS_DIR = "Diagrams"
META_DIR = ".homelable"
MANIFEST = f"{META_DIR}/manifest.json"
README = "README.md"
# Directories the sync owns under its path: wiped and rewritten on every sync.
MANAGED_DIRS = (DOCS_DIR, DIAGRAMS_DIR, META_DIR)
MANIFEST_FORMAT = 1
MEDIA_DIR = f"{DOCS_DIR}/_media"
# An upload as the editor writes it: the media route's own names, behind a path
# that starts the URL. A full `http://host/api/v1/media/…` is someone else's
# link, and is left alone.
_MEDIA_NAME = r"[0-9a-f]{32}\.(?:png|jpg|webp|svg|pdf)"
_MEDIA_REF = re.compile(rf"(?<![\w./:-])/api/v1/media/({_MEDIA_NAME})")
# A floor plan's `imageData` is the upload URL itself — or, on a canvas older
# than uploads, a base64 `data:` URL already inside `canvas.json`.
_MEDIA_URL = re.compile(rf"/api/v1/media/({_MEDIA_NAME})")
FLOOR_PLAN = "floor-plan"

# Live reachability, refreshed by the status checker every minute. Committing it
# would turn every sync into a diff of who answered a ping, so it never leaves.
VOLATILE_NODE_KEYS = frozenset({"status", "last_seen", "last_scan", "response_time_ms"})
VOLATILE_RACK_DEVICE_KEYS = frozenset({"status"})

GIT_TIMEOUT = 120  # seconds, per git command

README_TEXT = """# Homelab documentation

Pushed by [Homelable](https://github.com/Pouzor/homelable). This file is written
on the first sync only — edit it freely, it is never overwritten.

- `Documentation/` — every document, one Markdown file each, frontmatter included.
  Library folders are folders here, and a folder's own page is its `index.md`.
  Documents linked to a device, a canvas node or a whole canvas sit under
  `devices/`, `nodes/` and `designs/`. Images and files a document embeds are in
  `Documentation/_media/`.
- `Diagrams/` — one folder per canvas: `design.json`, plus `canvas.json` for a
  network or electrical canvas, or `rack.json` for a rack, and the floor plan
  image when the canvas has one.

`Documentation/`, `Diagrams/` and `.homelable/` are rewritten on every sync:
anything changed there by hand is overwritten by the next one.
"""


class GitSyncError(Exception):
    """A sync that could not complete. The message is safe to show the user."""


@dataclass(frozen=True)
class GitSyncConfig:
    repo_url: str
    branch: str = "main"
    path: str = ""
    token: str = ""
    username: str = "git"
    ssh_key: str = ""
    author_name: str = "Homelable"
    author_email: str = "homelable@localhost"

    @property
    def auth(self) -> str:
        """Which credential the sync authenticates with: token, ssh or none."""
        if self.token or _url_userinfo(self.repo_url):
            return "token"
        if self.ssh_key:
            return "ssh"
        return "none"


@dataclass(frozen=True)
class DiagramExport:
    """One design and its raw state, as the API serves it."""

    id: str
    name: str
    design_type: str
    icon: str | None
    # `canvas.json` or `rack.json` content — already a plain JSON-able dict.
    state: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class SyncResult:
    status: str  # "pushed" | "unchanged"
    commit: str | None
    files_changed: int


# ── Layout (pure) ─────────────────────────────────────────────────────────────


def sync_subdir(raw: str) -> str:
    """`GIT_SYNC_PATH` as a clean relative path, or "" for the repository root.

    It decides what the sync wipes, so anything that could point outside the
    working copy — or at `.git` — is refused rather than normalised.
    """
    parts = [p for p in (raw or "").replace("\\", "/").split("/") if p not in ("", ".")]
    if any(p == ".." for p in parts) or (parts and parts[0] == ".git"):
        raise GitSyncError(f"GIT_SYNC_PATH {raw!r} must be a folder inside the repository")
    return "/".join(parts)


def _json_bytes(data: Any) -> bytes:
    return (json.dumps(data, indent=2, ensure_ascii=False) + "\n").encode()


def _strip(rows: list[dict[str, Any]], keys: frozenset[str]) -> list[dict[str, Any]]:
    return [{k: v for k, v in row.items() if k not in keys} for row in rows]


def diagram_files(diagram: DiagramExport) -> dict[str, bytes]:
    """The files of one diagram folder, relative to it."""
    meta = {
        "id": diagram.id,
        "name": diagram.name,
        "design_type": diagram.design_type,
        "icon": diagram.icon,
    }
    state = dict(diagram.state)
    if diagram.design_type == "rack":
        state["devices"] = _strip(list(state.get("devices", [])), VOLATILE_RACK_DEVICE_KEYS)
        return {"design.json": _json_bytes(meta), "rack.json": _json_bytes(state)}
    state["nodes"] = _strip(list(state.get("nodes", [])), VOLATILE_NODE_KEYS)
    # Whether the canvas was ever saved is load-time bookkeeping, not content.
    state.pop("initialized", None)
    return {"design.json": _json_bytes(meta), "canvas.json": _json_bytes(state)}


def _diagram_folders(diagrams: list[DiagramExport]) -> list[tuple[DiagramExport, str]]:
    """A folder name per diagram, stable and never colliding (names are not unique)."""
    taken: set[str] = set()
    out: list[tuple[DiagramExport, str]] = []
    for diagram in sorted(diagrams, key=lambda d: (d.name.lower(), d.id)):
        name = safe_segment(diagram.name)
        candidate, suffix = name, 2
        while candidate in taken:
            candidate = f"{name}-{suffix}"
            suffix += 1
        taken.add(candidate)
        out.append((diagram, candidate))
    return out


def floor_plan_ref(diagram: DiagramExport) -> str | None:
    """The upload name of the diagram's floor plan, or None."""
    viewport = diagram.state.get("viewport")
    floor_map = viewport.get("floor_map") if isinstance(viewport, dict) else None
    image = floor_map.get("imageData") if isinstance(floor_map, dict) else None
    match = _MEDIA_URL.fullmatch(image) if isinstance(image, str) else None
    return match.group(1) if match else None


def media_refs(docs: list[ExportDoc], diagrams: list[DiagramExport] | None = None) -> set[str]:
    """The upload names the documents embed and the diagrams use as floor plans."""
    names = {match.group(1) for doc in docs for match in _MEDIA_REF.finditer(doc.body or "")}
    for diagram in diagrams or []:
        name = floor_plan_ref(diagram)
        if name:
            names.add(name)
    return names


def _relink(body: str, path: str, media: Mapping[str, bytes]) -> str:
    """`body` with each embedded upload pointing at its copy in `_media/`.

    `path` is the document's, relative to `Documentation/`. An upload that is
    gone from the server keeps its link: rewriting it would only break it
    differently.
    """
    prefix = "../" * path.count("/") + MEDIA_DIR.removeprefix(f"{DOCS_DIR}/") + "/"

    def swap(match: re.Match[str]) -> str:
        name = match.group(1)
        return prefix + name if name in media else match.group(0)

    return _MEDIA_REF.sub(swap, body)


def build_tree(
    docs: list[ExportDoc],
    diagrams: list[DiagramExport],
    media: Mapping[str, bytes] | None = None,
) -> dict[str, bytes]:
    """Every file the sync owns, keyed by its path relative to the sync path.

    `media` maps an upload name to its bytes, for those `media_refs` found.
    Pure, so the whole layout is testable without git or a database.
    """
    media = media or {}
    files: dict[str, bytes] = {}
    doc_entries: dict[str, dict[str, str]] = {}
    for doc, path in export_layout(docs):
        files[f"{DOCS_DIR}/{path}"] = _relink(doc.body or "", path, media).encode()
        entry = {"id": doc.id, "kind": doc.kind}
        for key in ("device_id", "node_id", "design_id"):
            value = getattr(doc, key)
            if value:
                entry[key] = value
        doc_entries[f"{DOCS_DIR}/{path}"] = entry

    diagram_entries: dict[str, dict[str, str]] = {}
    floor_plans: dict[str, str] = {}
    for diagram, folder in _diagram_folders(diagrams):
        base = f"{DIAGRAMS_DIR}/{folder}"
        for name, content in diagram_files(diagram).items():
            files[f"{base}/{name}"] = content
        diagram_entries[base] = {"id": diagram.id, "design_type": diagram.design_type}
        plan = floor_plan_ref(diagram)
        if plan and plan in media:
            path = f"{base}/{FLOOR_PLAN}{Path(plan).suffix}"
            files[path] = media[plan]
            floor_plans[path] = f"/api/v1/media/{plan}"

    media_entries: dict[str, str] = {}
    for name in sorted(media_refs(docs) & media.keys()):
        files[f"{MEDIA_DIR}/{name}"] = media[name]
        # What the import turns the relative link back into.
        media_entries[f"{MEDIA_DIR}/{name}"] = f"/api/v1/media/{name}"
    media_entries.update(floor_plans)

    files[MANIFEST] = _json_bytes(
        {
            "format": MANIFEST_FORMAT,
            "documents": doc_entries,
            "diagrams": diagram_entries,
            "media": media_entries,
        }
    )
    return files


def commit_message(doc_count: int, diagram_count: int) -> str:
    docs = f"{doc_count} document{'s' if doc_count != 1 else ''}"
    diagrams = f"{diagram_count} diagram{'s' if diagram_count != 1 else ''}"
    return f"Homelable sync: {docs}, {diagrams}"


# ── Credentials ───────────────────────────────────────────────────────────────


def public_url(url: str) -> str:
    """The repository URL with any `user:password@` stripped, for display."""
    parts = urlsplit(url)
    if parts.scheme in ("http", "https") and "@" in parts.netloc:
        host = parts.netloc.rsplit("@", 1)[1]
        return urlunsplit((parts.scheme, host, parts.path, parts.query, parts.fragment))
    return url


def _url_userinfo(url: str) -> tuple[str, str] | None:
    """`(user, password)` embedded in an HTTP(S) URL, or None.

    Accepted as an alternative to GIT_SYNC_TOKEN, but never handed to git as
    part of the URL: git would store it in `.git/config`, on the data volume.
    """
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https") or not parts.password:
        return None
    return unquote(parts.username or "git"), unquote(parts.password)


def _basic(cfg: GitSyncConfig) -> str | None:
    """The basic-auth value git sends, from GIT_SYNC_TOKEN or else the URL."""
    if cfg.token:
        user, secret = cfg.username or "git", cfg.token
    else:
        creds = _url_userinfo(cfg.repo_url)
        if creds is None:
            return None
        user, secret = creds
    return base64.b64encode(f"{user}:{secret}".encode()).decode()


def _secrets(cfg: GitSyncConfig) -> list[str]:
    out: list[str | None] = [cfg.token, _basic(cfg)]
    creds = _url_userinfo(cfg.repo_url)
    if creds:
        out.append(creds[1])
    userinfo = urlsplit(cfg.repo_url).netloc.rpartition("@")[0]
    if userinfo:
        out.append(userinfo)
    return [s for s in out if s]


def scrub(text: str, cfg: GitSyncConfig) -> str:
    """Remove every credential from a git message before it reaches a user."""
    for secret in _secrets(cfg):
        text = text.replace(secret, "***")
    return text


def git_env(cfg: GitSyncConfig, known_hosts: Path) -> dict[str, str]:
    """The environment every git command runs in.

    The token goes in as an `http.extraHeader` through `GIT_CONFIG_*`, never on
    the command line (`ps` shows that) nor in `.git/config` (the data volume
    is backed up). Git never prompts: a missing credential fails, it does not
    hang the request.
    """
    # Nothing git-specific is inherited: a GIT_DIR, GIT_INDEX_FILE or
    # GIT_AUTHOR_* in the backend's environment (a hook, a dev shell) would point
    # the sync at another repository or commit under another name.
    env = {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}
    env["GIT_TERMINAL_PROMPT"] = "0"
    env["GIT_CONFIG_NOSYSTEM"] = "1"
    basic = _basic(cfg)
    if basic:
        env["GIT_CONFIG_COUNT"] = "1"
        env["GIT_CONFIG_KEY_0"] = "http.extraHeader"
        env["GIT_CONFIG_VALUE_0"] = f"Authorization: Basic {basic}"
    if cfg.ssh_key:
        env["GIT_SSH_COMMAND"] = " ".join(
            [
                "ssh",
                "-i", shlex.quote(cfg.ssh_key),
                "-o", "IdentitiesOnly=yes",
                "-o", "BatchMode=yes",
                # First contact pins the host key; a changed one then fails.
                "-o", "StrictHostKeyChecking=accept-new",
                "-o", f"UserKnownHostsFile={shlex.quote(str(known_hosts))}",
            ]
        )
    return env


# ── Git (blocking — run it in a thread) ───────────────────────────────────────


_REJECTED = re.compile(r"\[rejected\]|non-fast-forward|fetch first", re.IGNORECASE)


class _Git:
    def __init__(self, cfg: GitSyncConfig, workdir: Path, env: dict[str, str]) -> None:
        self.cfg = cfg
        self.workdir = workdir
        self.env = env

    def __call__(self, *args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
        try:
            result = subprocess.run(
                ["git", *args],
                cwd=self.workdir,
                env=self.env,
                capture_output=True,
                text=True,
                timeout=GIT_TIMEOUT,
            )
        except FileNotFoundError as exc:
            raise GitSyncError("git is not installed on the server") from exc
        except subprocess.TimeoutExpired as exc:
            raise GitSyncError(f"git {args[0]} timed out after {GIT_TIMEOUT}s") from exc
        if check and result.returncode != 0:
            message = (result.stderr or result.stdout).strip() or f"git {args[0]} failed"
            raise GitSyncError(scrub(message, self.cfg))
        return result


def _reset_workdir(workdir: Path) -> None:
    if workdir.exists():
        shutil.rmtree(workdir)
    workdir.mkdir(parents=True)


def _checkout_remote(git: _Git, cfg: GitSyncConfig) -> None:
    """Make the working copy exactly the remote branch — or empty, if it has none."""
    workdir = git.workdir
    if not (workdir / ".git").is_dir():
        _reset_workdir(workdir)
        git("init", "-q")
    # Credentials-free: any user:password in the URL travels in the auth header.
    git("config", "remote.origin.url", public_url(cfg.repo_url))

    heads = git("ls-remote", "--heads", "origin", f"refs/heads/{cfg.branch}").stdout.strip()
    if heads:
        # Shallow: the repository may be a whole monorepo, and a commit on top of
        # the remote tip needs only that tip to push.
        git("fetch", "-q", "--depth=1", "origin", f"refs/heads/{cfg.branch}")
        git("checkout", "-q", "-f", "-B", cfg.branch, "FETCH_HEAD")
        git("clean", "-q", "-f", "-d")
    else:
        # An empty repository, or a branch the sync is about to create: start
        # from nothing, never from a commit a previous failed push left behind.
        _reset_workdir(workdir)
        git("init", "-q")
        git("config", "remote.origin.url", public_url(cfg.repo_url))
        git("symbolic-ref", "HEAD", f"refs/heads/{cfg.branch}")


def _write_tree(root: Path, files: dict[str, bytes]) -> None:
    for name in MANAGED_DIRS:
        target = root / name
        if target.is_dir() and not target.is_symlink():
            shutil.rmtree(target)
        elif target.exists() or target.is_symlink():
            target.unlink()
    for rel, content in files.items():
        path = root / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
    readme = root / README
    # `lexists`, not `exists`: a README committed as a symlink to a missing
    # target reads as absent, and writing it would create that target — outside
    # the working copy. Any README, link or not, belongs to the user.
    if not os.path.lexists(readme):
        with open(readme, "x", encoding="utf-8") as handle:
            handle.write(README_TEXT)


def push(
    cfg: GitSyncConfig,
    workdir: Path,
    files: dict[str, bytes],
    message: str,
    known_hosts: Path,
) -> SyncResult:
    """Commit `files` under the sync path and push them. Blocking."""
    subdir = sync_subdir(cfg.path)
    git = _Git(cfg, workdir, git_env(cfg, known_hosts))
    workdir.mkdir(parents=True, exist_ok=True)
    _checkout_remote(git, cfg)

    root = workdir / subdir if subdir else workdir
    if root.is_symlink() or not root.resolve().is_relative_to(workdir.resolve()):
        raise GitSyncError(f"GIT_SYNC_PATH {cfg.path!r} must be a folder inside the repository")
    root.mkdir(parents=True, exist_ok=True)
    _write_tree(root, files)

    git("add", "-A", "--", subdir or ".")
    changed = [
        line for line in git("diff", "--cached", "--name-only").stdout.splitlines() if line.strip()
    ]
    if not changed:
        head = git("rev-parse", "--verify", "-q", "HEAD", check=False).stdout.strip()
        return SyncResult(status="unchanged", commit=head or None, files_changed=0)

    # The host's global git config is not ours: a signing requirement or a hook
    # there would fail a commit no one is at the keyboard for.
    git(
        "-c", f"user.name={cfg.author_name}",
        "-c", f"user.email={cfg.author_email}",
        "-c", "commit.gpgsign=false",
        "commit", "-q", "--no-verify", "-m", message,
    )
    commit = git("rev-parse", "HEAD").stdout.strip()
    try:
        git("push", "-q", "origin", f"HEAD:refs/heads/{cfg.branch}")
    except GitSyncError as exc:
        if _REJECTED.search(str(exc)):
            raise GitSyncError(
                "The remote branch moved during the sync — sync again to push on top of it"
            ) from exc
        raise
    return SyncResult(status="pushed", commit=commit, files_changed=len(changed))
