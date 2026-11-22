#!/usr/bin/env python3
"""Safely apply ZIP updates placed in the repository's upload/ directory."""
from __future__ import annotations

import argparse
import os
import re
import shutil
import stat
import sys
import zipfile
from dataclasses import dataclass
from pathlib import Path, PurePosixPath

MAX_ARCHIVES = 20
MAX_FILES = 10_000
MAX_FILE_BYTES = 100 * 1024 * 1024
MAX_TOTAL_BYTES = 500 * 1024 * 1024
MAX_COMPRESSION_RATIO = 1_000
DELETE_MANIFEST = ".update-delete.txt"
PROTECTED_DELETE_PATHS = {
    ".github/workflows/unpack-upload.yml",
    "scripts/process_uploads.py",
}


@dataclass(frozen=True)
class PlannedFile:
    archive: Path
    member: zipfile.ZipInfo
    destination: str


@dataclass(frozen=True)
class ArchivePlan:
    archive: Path
    files: tuple[PlannedFile, ...]
    deletions: tuple[str, ...]


def safe_relative_path(raw_name: str) -> str:
    """Normalize a ZIP member as a safe repository-relative POSIX path."""
    name = raw_name.replace("\\", "/")
    if not name or name.startswith("/") or re.match(r"^[A-Za-z]:", name):
        raise ValueError(f"Unsafe absolute ZIP path: {raw_name!r}")
    parts = PurePosixPath(name).parts
    if not parts or any(part in ("", ".", "..") for part in parts):
        raise ValueError(f"Unsafe ZIP path: {raw_name!r}")
    if parts[0] == ".git" or ".git" in parts:
        raise ValueError("ZIP updates may not write inside .git/")
    return "/".join(parts)


def archive_plan(archive: Path) -> ArchivePlan:
    try:
        zf = zipfile.ZipFile(archive)
    except (OSError, zipfile.BadZipFile) as exc:
        raise ValueError(f"{archive.name}: not a valid ZIP archive ({exc})") from exc

    with zf:
        entries = [item for item in zf.infolist() if not item.is_dir()]
        if not entries:
            raise ValueError(f"{archive.name}: archive contains no files")
        if len(entries) > MAX_FILES:
            raise ValueError(f"{archive.name}: too many files ({len(entries)} > {MAX_FILES})")

        normalized: list[tuple[zipfile.ZipInfo, str]] = []
        total_size = 0
        for item in entries:
            path = safe_relative_path(item.filename)
            mode = (item.external_attr >> 16) & 0xFFFF
            if stat.S_ISLNK(mode):
                raise ValueError(f"{archive.name}: symbolic links are not allowed ({path})")
            if item.file_size > MAX_FILE_BYTES:
                raise ValueError(f"{archive.name}: file exceeds 100 MiB ({path})")
            total_size += item.file_size
            if total_size > MAX_TOTAL_BYTES:
                raise ValueError(f"{archive.name}: expanded archive exceeds 500 MiB")
            if item.file_size and item.compress_size == 0:
                raise ValueError(f"{archive.name}: invalid compressed size ({path})")
            if item.compress_size and item.file_size / item.compress_size > MAX_COMPRESSION_RATIO:
                raise ValueError(f"{archive.name}: suspicious compression ratio ({path})")
            normalized.append((item, path))

        # Full initial packages use a single forma-studio/ wrapper. Strip it;
        # incremental update ZIPs use repository-relative paths and are untouched.
        if all(path.startswith("forma-studio/") for _, path in normalized):
            normalized = [(item, path[len("forma-studio/"):]) for item, path in normalized]

        files: list[PlannedFile] = []
        deletions: list[str] = []
        for item, path in normalized:
            if not path:
                continue
            if path == DELETE_MANIFEST:
                try:
                    lines = zf.read(item).decode("utf-8-sig").splitlines()
                except UnicodeDecodeError as exc:
                    raise ValueError(f"{archive.name}: {DELETE_MANIFEST} must be UTF-8") from exc
                for line in lines:
                    candidate = line.strip()
                    if not candidate or candidate.startswith("#"):
                        continue
                    target = safe_relative_path(candidate)
                    if target in PROTECTED_DELETE_PATHS:
                        raise ValueError(f"{archive.name}: refusing to delete protected file {target}")
                    deletions.append(target)
            else:
                files.append(PlannedFile(archive=archive, member=item, destination=path))

        if not files and not deletions:
            raise ValueError(f"{archive.name}: no usable update files or deletions found")
        return ArchivePlan(archive=archive, files=tuple(files), deletions=tuple(deletions))


def ensure_inside_repo(repo_root: Path, relative: str) -> Path:
    target = (repo_root / Path(*PurePosixPath(relative).parts)).resolve()
    root = repo_root.resolve()
    if target != root and root not in target.parents:
        raise ValueError(f"Path escapes repository: {relative}")
    return target


def apply_plans(repo_root: Path, plans: list[ArchivePlan]) -> tuple[int, int]:
    written = 0
    deleted = 0

    # Apply removals first, then writes. A file supplied in the same update wins.
    for plan in plans:
        for relative in plan.deletions:
            target = ensure_inside_repo(repo_root, relative)
            if target.is_file() or target.is_symlink():
                target.unlink()
                deleted += 1
            elif target.exists():
                raise ValueError(f"Deletion target is not a file: {relative}")

    for plan in plans:
        with zipfile.ZipFile(plan.archive) as zf:
            for item in plan.files:
                target = ensure_inside_repo(repo_root, item.destination)
                target.parent.mkdir(parents=True, exist_ok=True)
                with zf.open(item.member, "r") as source, target.open("wb") as destination:
                    shutil.copyfileobj(source, destination, length=1024 * 1024)
                written += 1

    return written, deleted


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--upload-dir", default="upload", help="Directory containing update ZIP files")
    args = parser.parse_args()

    repo_root = Path.cwd().resolve()
    upload_dir = ensure_inside_repo(repo_root, args.upload_dir)
    if not upload_dir.is_dir():
        print(f"Upload directory does not exist: {args.upload_dir}; nothing to do.")
        return 0

    archives = sorted(path for path in upload_dir.glob("*.zip") if path.is_file())
    if not archives:
        print("No ZIP updates found in upload/.")
        return 0
    if len(archives) > MAX_ARCHIVES:
        print(f"Found {len(archives)} ZIPs; limit is {MAX_ARCHIVES}. Nothing was changed.", file=sys.stderr)
        return 1

    try:
        # Validate every archive before changing any repository files.
        plans = [archive_plan(path) for path in archives]
        written, deleted = apply_plans(repo_root, plans)
    except (ValueError, OSError, zipfile.BadZipFile) as exc:
        print(f"Update rejected: {exc}", file=sys.stderr)
        return 1

    for archive in archives:
        archive.unlink()

    message = f"Applied {len(archives)} ZIP archive(s): {written} file(s) written, {deleted} file(s) deleted."
    print(message)
    print("Processed ZIP files were removed from upload/.")
    summary_value = os.environ.get("GITHUB_STEP_SUMMARY")
    summary_path = Path(summary_value) if summary_value else None
    if summary_path and summary_path.is_file():
        with summary_path.open("a", encoding="utf-8") as summary:
            summary.write("## ZIP extraction\n\n")
            summary.write(f"- Archives processed: {len(archives)}\n")
            summary.write(f"- Files written or replaced: {written}\n")
            summary.write(f"- Files deleted: {deleted}\n")
            summary.write("- Uploaded ZIP files removed from `upload/`.\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
