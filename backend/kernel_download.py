"""The download of an SPK kernel file, outside every lock of the ephemeris."""
from __future__ import annotations

import hashlib
import os
import tempfile
from pathlib import Path
from urllib.request import urlopen

# The limit of each socket operation of a kernel download. A stalled download fails.
KERNEL_DOWNLOAD_TIMEOUT_SECONDS = 60
_CHUNK_BYTES = 1 << 20


class KernelDigestError(RuntimeError):
    """The downloaded kernel does not have the expected SHA-256, so it is not published."""


def download_kernel(url: str, path: Path, sha256: str) -> None:
    """Write the kernel to a unique temporary file, then publish it with one atomic rename.

    The rename occurs only when the SHA-256 of the bytes is `sha256`. Otherwise the temporary
    file is removed and `KernelDigestError` is raised.
    """
    descriptor, temporary_name = tempfile.mkstemp(dir=path.parent, prefix=f"{path.name}.", suffix=".download")
    temporary_path = Path(temporary_name)
    digest = hashlib.sha256()
    try:
        with os.fdopen(descriptor, "wb") as output, urlopen(url, timeout=KERNEL_DOWNLOAD_TIMEOUT_SECONDS) as response:
            while chunk := response.read(_CHUNK_BYTES):
                digest.update(chunk)
                output.write(chunk)
        if digest.hexdigest() != sha256.lower():
            raise KernelDigestError(f"Kernel {path.name} has an unexpected SHA-256: {digest.hexdigest()}")
        temporary_path.replace(path)
    finally:
        temporary_path.unlink(missing_ok=True)
