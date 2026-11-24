"""Atlas application entry point with native certificate validation on Windows.

Supports a script path, -m module, or -c code. Install requirements-atlas-tls.txt
in the actual Atlas venv first. Missing dependencies stop before executing code.
"""
import runpy
import sys

args = sys.argv[1:]
# pip owns its vendored truststore; injecting a second copy causes recursion.
if args[:2] == ["-m", "pip"]:
    from importlib.metadata import version
    if tuple(map(int, version("pip").split("."))) < (26, 2, 2):
        raise SystemExit("Initialize Atlas Python first: npm run atlas:setup (Windows: powershell -File scripts/project-npm.ps1 run atlas:setup)")
elif sys.platform == "win32":
    import truststore
    # Inject at application startup, before importing UnityPy/urllib/requests.
    # Windows certificate distrust must not be lost when copying roots to OpenSSL.
    truststore.inject_into_ssl()

if not args:
    raise SystemExit("Usage: run-atlas-python.mjs script.py | -m module | -c code")
if args[0] in ("-m", "-c"):
    if len(args) < 2:
        raise SystemExit("Missing module or code")
    sys.argv = args[1:] if args[0] == "-m" else ["-c", *args[2:]]
    if args[0] == "-m":
        runpy.run_module(args[1], run_name="__main__", alter_sys=True)
    else:
        exec(compile(args[1], "<string>", "exec"), {"__name__": "__main__"})
elif args[0].startswith("-"):
    raise SystemExit("Unsupported Python option; use a script path, -m, or -c")
else:
    from pathlib import Path
    sys.argv = args
    sys.path.insert(0, str(Path(args[0]).resolve().parent))
    runpy.run_path(args[0], run_name="__main__")
