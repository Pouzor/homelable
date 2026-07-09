"""
Tests for automatic DB backup before migrations.
"""
import os

os.environ.setdefault("SECRET_KEY", "test-only-secret-key-not-for-production")

from pathlib import Path
from unittest.mock import patch

import pytest

from app.db.database import _backup_db


@pytest.fixture()
def tmp_db(tmp_path: Path):
    db = tmp_path / "homelab.db"
    db.write_bytes(b"SQLite placeholder")
    return db


def test_backup_created_when_db_exists(tmp_db: Path):
    with patch("app.db.database.settings") as mock_settings, \
         patch("app.db.database.APP_VERSION", "1.9"):
        mock_settings.sqlite_path = str(tmp_db)
        _backup_db()
        backup = tmp_db.parent / "homelab.db.back-1.9"
        assert backup.exists()
        assert backup.read_bytes() == b"SQLite placeholder"


def test_backup_skipped_when_db_missing(tmp_path: Path):
    with patch("app.db.database.settings") as mock_settings, \
         patch("app.db.database.APP_VERSION", "1.9"):
        mock_settings.sqlite_path = str(tmp_path / "nonexistent.db")
        _backup_db()
        assert not any(tmp_path.glob("*.back-*"))


def test_backup_idempotent_second_call_no_overwrite(tmp_db: Path):
    with patch("app.db.database.settings") as mock_settings, \
         patch("app.db.database.APP_VERSION", "1.9"):
        mock_settings.sqlite_path = str(tmp_db)
        _backup_db()
        backup = tmp_db.parent / "homelab.db.back-1.9"
        backup.write_bytes(b"original backup")
        _backup_db()
        assert backup.read_bytes() == b"original backup"


def test_backup_version_in_filename(tmp_db: Path):
    with patch("app.db.database.settings") as mock_settings, \
         patch("app.db.database.APP_VERSION", "2.0"):
        mock_settings.sqlite_path = str(tmp_db)
        _backup_db()
        assert (tmp_db.parent / "homelab.db.back-2.0").exists()
