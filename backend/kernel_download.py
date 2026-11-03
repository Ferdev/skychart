"""The download of an SPK kernel file, outside every lock of the ephemeris."""
from __future__ import annotations

import os
import shutil
import tempfile
from pathlib import Path
from urllib.request import urlopen

# The limit of each socket operation of a kernel download. A stalled download fails.
KERNEL_DOWNLOAD_TIMEOUT_SECONDS = 60


def download_kernel(url: str, path: Path) -> None:
    """Write the kernel to a unique temporary file, then publish it with one atomic rename."""
    descriptor, temporary_name = tempfile.mkstemp(dir=path.parent, prefix=f"{path.name}.", suffix=".download")
    temporary_path = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "wb") as output, urlopen(url, timeout=KERNEL_DOWNLOAD_TIMEOUT_SECONDS) as response:
            shutil.copyfileobj(response, output)
        temporary_path.replace(path)
    finally:
        temporary_path.unlink(missing_ok=True)
