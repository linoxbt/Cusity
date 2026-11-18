"""Vendor difflogic 0.1.0 into model/difflogic/ so it imports on CPU-only machines.

The PyPI package always compiles a CUDA extension when installed and imports it
(`import difflogic_cuda`) when loaded, so `implementation="python"` alone does not
avoid needing a GPU toolchain. This copies the pure-Python modules from the pinned
sdist and makes that import optional. difflogic is MIT-licensed (Felix Petersen).
"""
import hashlib, io, pathlib, tarfile, urllib.request

URL = ("https://files.pythonhosted.org/packages/9c/18/"
       "e7ee8ec8a895f000411853174636f6a90480076da43ca3df40e1e4875fcc/difflogic-0.1.0.tar.gz")
SHA256 = "979ce845a494bdf8ebeeb94d61f3bbf1ae018257ee5b048f936567b53fc115a1"
DEST = pathlib.Path(__file__).resolve().parent / "difflogic"
GUARD = ("try:\n    import difflogic_cuda\n"
         "except ImportError:   # CPU-only machine: implementation='python' still works\n"
         "    difflogic_cuda = None\n")

data = urllib.request.urlopen(URL).read()
assert hashlib.sha256(data).hexdigest() == SHA256, "difflogic sdist hash mismatch"
DEST.mkdir(exist_ok=True)
with tarfile.open(fileobj=io.BytesIO(data)) as tar:
    for m in tar.getmembers():
        p = pathlib.PurePosixPath(m.name)          # difflogic-0.1.0/difflogic/<file>.py
        if m.isfile() and len(p.parts) == 3 and p.parts[1] == "difflogic" and p.suffix == ".py":
            src = tar.extractfile(m).read().decode()
            src = src.replace("import difflogic_cuda\n", GUARD, 1)
            # forward_python prints the index dtype on every call; drop that noise
            src = "\n".join(l for l in src.split("\n") if "print(self.indices" not in l)
            (DEST / p.name).write_text(src)
print("vendored difflogic 0.1.0 into", DEST)
