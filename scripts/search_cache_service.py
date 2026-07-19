#!/usr/bin/env python3
"""Compat shim — moved to backend/scripts/search_cache_service.py.

Keeps the EC2 systemd/host launcher working during the layout rollout.
Remove once the host unit points at the new path.
"""
import os
import sys

NEW = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "backend", "scripts", "search_cache_service.py",
)
os.execv(sys.executable, [sys.executable, NEW, *sys.argv[1:]])
