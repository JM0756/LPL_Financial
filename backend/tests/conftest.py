"""Test bootstrap: deterministic, offline, no AWS calls."""

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

os.environ["BEDROCK_ENABLED"] = "false"   # template explanations only
os.environ["STORAGE_ENABLED"] = "false"   # in-memory store
os.environ["AWS_REGION"] = "us-east-1"

import pytest  # noqa: E402

from app.config import get_settings  # noqa: E402

get_settings.cache_clear()


@pytest.fixture(autouse=True)
def _clean_store():
    from app.storage import reset_storage_for_tests

    reset_storage_for_tests()
    yield
    reset_storage_for_tests()