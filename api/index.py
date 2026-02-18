"""Vercel serverless entry point – re-exports the Flask app."""
import sys
from pathlib import Path

# Make the backend package importable
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from app import app  # noqa: E402
