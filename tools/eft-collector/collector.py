"""Single-request EFT collector for Windows and Ubuntu; see docs/COLLECTOR.md."""
import argparse
from contextlib import contextmanager
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
import hashlib
import http.client
import ipaddress
from http.cookies import SimpleCookie, CookieError
import json
import math
import os
from pathlib import Path
import re
import ssl
import sys
import time
import uuid
import zlib
from urllib.parse import urlsplit

import protocol

HERE = Path(__file__).resolve().parent
VERSION = "1.0.0"
BACKEND = "gw-pvp.escapefromtarkov.com"
MIN_INTERVAL = 30


def tls_context():
    """Use Windows chain policy (including distrust), or the distro CA policy."""
    if sys.platform == "win32":
        import truststore
        return truststore.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    return ssl.create_default_context()


def utc():
    return datetime.now(timezone.utc).isoformat()


def load(path):
    return json.loads(Path(path).read_text(encoding="utf-8-sig"))


def save(path, value, binary=False):
    """Atomic writes, including request counters; restrictive Unix permissions."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    if os.name != "nt":
        os.chmod(path.parent, 0o700)
    temporary = path.with_name(path.name + "." + uuid.uuid4().hex + ".tmp")
    raw = value if binary else json.dumps(value, ensure_ascii=False, indent=2).encode("utf8")
    try:
        fd = os.open(temporary, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        with os.fdopen(fd, "wb") as stream:
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


@contextmanager
def lock(path):
    """OS advisory lock; automatically released even if the process dies."""
    path.parent.mkdir(parents=True, exist_ok=True)
    if os.name != "nt":
        os.chmod(path.parent, 0o700)
    fd = os.open(path, os.O_CREAT | os.O_RDWR, 0o600)
    stream = os.fdopen(fd, "r+b")
    held = False
    try:
        if os.fstat(fd).st_size == 0:
            stream.write(b"0")
            stream.flush()
        stream.seek(0)
        try:
            if os.name == "nt":
                import msvcrt
                msvcrt.locking(fd, msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            raise RuntimeError("collector-busy") from None
        held = True
        yield
    finally:
        if held:
            stream.seek(0)
            if os.name == "nt":
                import msvcrt
                msvcrt.locking(fd, msvcrt.LK_UNLCK, 1)
            else:
                import fcntl
                fcntl.flock(fd, fcntl.LOCK_UN)
        stream.close()


def registry():
    return load(HERE / "endpoints.json")


def summary(endpoint, data):
    result = {"type": type(data).__name__}
    if isinstance(data, (dict, list, str)):
        result["entries"] = len(data)
    if endpoint == "flea-item-price" and isinstance(data, dict):
        result.update({k: data.get(k) for k in ("templateId", "min", "avg", "max")})
    if endpoint == "flea-offers" and isinstance(data, dict):
        result.update({"returnedOffers": len(data.get("offers", [])),
                       "offersCount": data.get("offersCount"),
                       "selectedCategory": data.get("selectedCategory")})
    if endpoint == "locations" and isinstance(data, dict):
        locations = data.get("locations", {})
        if isinstance(locations, dict):
            rows = [v for v in locations.values() if isinstance(v, dict)]
            result["locationCount"] = len(rows)
            for field in ["BossLocationSpawn", "SpawnPointParams", "waves", "exits",
                          "secretExits", "transits", "Loot", "doors"]:
                result[field + "Entries"] = sum(len(v.get(field, [])) for v in rows
                                              if isinstance(v.get(field), list))
            result["paths"] = len(data.get("paths", []))
    elif endpoint == "items" and isinstance(data, dict):
        rows = [v for v in data.values() if isinstance(v, dict)]
        result["items"] = sum(v.get("_type") == "Item" for v in rows)
        result["categoryNodes"] = sum(v.get("_type") == "Node" for v in rows)
    elif endpoint == "handbook" and isinstance(data, dict):
        result["categories"] = len(data.get("Categories", []))
        result["priceEntries"] = len(data.get("Items", []))
    elif endpoint == "globals" and isinstance(data, dict):
        for key in ["config", "bot_presets", "ItemPresets"]:
            if isinstance(data.get(key), (dict, list)):
                result[key + "Entries"] = len(data[key])
    elif endpoint == "hideout-recipes" and isinstance(data, dict):
        for key in ["recipes", "scavRecipes", "cultistRecipes"]:
            if isinstance(data.get(key), list):
                result[key] = len(data[key])
    elif endpoint == "menu-locale-ch" and isinstance(data, dict):
        result["menuStrings"] = len(data.get("menu", {}))
    elif endpoint == "hideout-qte" and isinstance(data, list):
        result["steps"] = sum(len(r.get("quickTimeEvents", [])) for r in data if isinstance(r, dict))
    elif endpoint == "prestige" and isinstance(data, dict):
        rows = data.get("elements", [])
        result["elements"] = len(rows)
        for key in ["conditions", "rewards"]:
            result[key] = sum(len(r.get(key, [])) for r in rows if isinstance(r, dict))
    elif endpoint == "main-quest-notes" and isinstance(data, list):
        result["conditionReferences"] = sum(len(r.get("conditionIds", [])) for r in data if isinstance(r, dict))
        for key in ["items", "crafts", "offers"]:
            result[key + "Links"] = sum(len(r.get("links", {}).get(key, [])) for r in data if isinstance(r, dict))
    elif endpoint in ("tapes", "subtitle-tracks") and isinstance(data, list):
        result["subtitleCues"] = sum(len(r.get("subtitles", [])) for r in data if isinstance(r, dict))
    # Do not emit arbitrary keys, values, user IDs or backend error messages.
    return result


def accepted(endpoint, spec, status, obj):
    if status != 200 or not isinstance(obj, dict) or "err" not in obj:
        return False
    if obj["err"] not in ([0, None] if endpoint == "metadata" else [0]):
        return False
    data = obj.get("data")
    if endpoint == "locations":
        return isinstance(data, dict) and isinstance(data.get("locations"), dict)
    if endpoint == "metadata":
        return isinstance(data, dict) and isinstance(data.get("value"), str)
    if endpoint == "flea-item-price":
        return (isinstance(data, dict)
                and data.get("templateId") == spec.get("params", {}).get("templateId")
                and all(type(data.get(k)) in (int, float) and math.isfinite(data[k])
                        for k in ("min", "avg", "max")))
    if endpoint == "flea-offers":
        return (isinstance(data, dict) and isinstance(data.get("offers"), list)
                and type(data.get("offersCount")) is int and data["offersCount"] >= 0
                and data.get("selectedCategory") == spec["params"]["handbookId"]
                and all(isinstance(o, dict) and isinstance(o.get("_id"), str)
                        and isinstance(o.get("items"), list)
                        and any(isinstance(i, dict) and i.get("_id") == o.get("root")
                                and i.get("_tpl") == spec["params"]["handbookId"]
                                for i in o["items"]) for o in data["offers"]))
    return isinstance(data, {"dict": dict, "list": list, "any": (dict, list, str)}[spec["shape"]])


def session_cookie_from_headers(header_pairs):
    """Read only a valid server PHPSESSID, retaining duplicate Set-Cookie fields."""
    candidate = None
    for key, value in header_pairs:
        if key.lower() != "set-cookie":
            continue
        jar = SimpleCookie()
        try:
            jar.load(value)
        except CookieError:
            continue
        if "PHPSESSID" in jar:
            token = jar["PHPSESSID"].value
            if re.fullmatch(r"[A-Za-z0-9_-]{8,256}", token):
                candidate = token
    return candidate


def resolve_backend(config_manifest, spec, game_version):
    """Resolve only the PvP Main/RagFair origins from a verified saved login."""
    if config_manifest is None:
        return BACKEND, None
    path = Path(config_manifest)
    manifest = load(path)
    receipt = manifest.get("receipt", {})
    if (manifest.get("endpoint") != "game-config" or not receipt.get("success")
            or receipt.get("authKind") != "game-session"
            or manifest.get("requestedGameVersion") != game_version):
        raise ValueError("backend-config-needs-matching-successful-game-login")
    raw = (path.parent / "response.json").read_bytes()
    expected = manifest.get("files", {}).get("response.json", {})
    if len(raw) != expected.get("bytes") or hashlib.sha256(raw).hexdigest() != expected.get("sha256"):
        raise ValueError("backend-config-integrity-mismatch")
    config = json.loads(raw)
    if config.get("err") != 0:
        raise ValueError("backend-config-has-business-error")
    role = spec.get("backendRole", "Main")
    if role not in ("Main", "RagFair"):
        raise ValueError("unsupported-runtime-backend-role")
    url = config.get("data", {}).get("backend", {}).get(role)
    if not isinstance(url, str):
        raise ValueError("runtime-backend-missing")
    parsed = urlsplit(url)
    if (parsed.scheme != "https" or parsed.hostname not in (
            "gw-pvp.escapefromtarkov.com", "gw-pvp.escapefromtarkov.ru")
            or parsed.username or parsed.password or parsed.port not in (None, 443)
            or parsed.path not in ("", "/") or parsed.query or parsed.fragment):
        raise ValueError("runtime-backend-origin-not-reviewed")
    return parsed.hostname, {"role": role, "manifestSha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                             "responseSha256": expected["sha256"]}


def parse_http_proxy(value):
    """Only an explicit local HTTP CONNECT listener; never trust proxy environment."""
    if value is None:
        return None
    try:
        if not isinstance(value, str) or any(c.isspace() for c in value):
            raise ValueError()
        parsed = urlsplit(value)
        if (parsed.scheme != "http" or not parsed.hostname
                or not ipaddress.ip_address(parsed.hostname).is_loopback
                or parsed.port is None or not 1 <= parsed.port <= 65535
                or parsed.username is not None or parsed.password is not None
                or parsed.path or parsed.query or parsed.fragment):
            raise ValueError()
        return parsed.hostname, parsed.port
    except ValueError:
        raise ValueError("proxy-must-be-loopback-http-with-explicit-port") from None


def perform(endpoint, spec, game_version, capture, session=None, body_file=None, request_framing="none",
            backend=BACKEND, http_proxy=None):
    """One verified HTTPS request, optionally through local CONNECT; no retry/fallback."""
    proxy = parse_http_proxy(http_proxy)
    headers = {"Accept": "application/json", "Content-Type": "application/json",
               "App-Version": "EFT Client " + game_version}
    body = None
    if spec["body"] == "zlib-empty":
        body = zlib.compress(b"", 9)
    elif spec["body"] == "zlib-json":
        # Fixed, reviewed request parameters live in the versioned registry.
        body = zlib.compress(json.dumps(spec["params"], separators=(",", ":")).encode("utf8"), 9)
    elif spec["body"] == "metadata-json":
        content = load(body_file)
        if set(content) != {"version", "key"} or not all(isinstance(v, str) for v in content.values()):
            raise ValueError("metadata-body-must-have-string-version-and-key")
        body = json.dumps(content, separators=(",", ":")).encode("utf8")
    if request_framing == "spt-shuffle":
        if spec["method"] != "POST" or spec["body"] not in ("zlib-empty", "zlib-json"):
            raise ValueError("framing-only-supported-for-zlib-post")
        body = protocol.frame_request(body)
    elif request_framing != "none":
        raise ValueError("unknown-request-framing")
    if session is not None:
        headers["Cookie"] = "PHPSESSID=" + session["gameSession"]
        headers["GClient-RequestId"] = str(session["requestId"])
    receipt = {"at": utc(), "host": backend, "method": spec["method"], "path": spec["path"],
               "networkRoute": "loopback-http-connect" if proxy else "direct",
               "authKind": "game-session" if session else "anonymous",
               "requestFraming": request_framing, "requestBytes": len(body) if body is not None else 0}
    if request_framing == "spt-shuffle":
        receipt["requestBodySha256"] = hashlib.sha256(body).hexdigest()
        receipt["requestPaddingBytes"] = 6
    started = time.monotonic()
    if proxy:
        conn = http.client.HTTPSConnection(proxy[0], proxy[1], timeout=25,
                                          context=tls_context())
        # HTTPSConnection verifies TLS/SNI against the tunnel target, not the proxy.
        conn.set_tunnel(backend, 443)
        receipt["httpProxy"] = http_proxy
    else:
        conn = http.client.HTTPSConnection(backend, timeout=25, context=tls_context())
    obj = None
    try:
        conn.request(spec["method"], spec["path"], body=body, headers=headers)
        response = conn.getresponse()
        header_pairs = response.getheaders()
        response_headers = {k.lower(): v for k, v in header_pairs}
        if session is not None:
            renewed_cookie = session_cookie_from_headers(header_pairs)
            if renewed_cookie is not None and renewed_cookie != session["gameSession"]:
                session["gameSession"] = renewed_cookie
                receipt["sessionCookieUpdated"] = True
        receipt.update({"httpStatus": response.status, "serverDate": response_headers.get("date"),
                        "retryAfter": response_headers.get("retry-after")})
        save(capture / "headers.json", response_headers)
        save(capture / "header-pairs.json", header_pairs)
        raw = response.read(protocol.MAX_BYTES + 1)
        save(capture / "response.bin", raw, binary=True)
        receipt["bytes"] = len(raw)
        if len(raw) > protocol.MAX_BYTES:
            raise ValueError("response-too-large")
        try:
            obj, codec, _ = protocol.decoded_json(raw, response_headers)
        except (ValueError, zlib.error):
            obj, codec = None, "decode-failed"
        receipt["decoder"] = codec
        if obj is not None:
            save(capture / "response.json", obj)
            if isinstance(obj, dict):
                code = obj.get("err")
                receipt["backendErrorCode"] = code if type(code) in [int, type(None)] else "non-numeric"
                receipt["wrongEncryptionParams"] = "wrong encryption params" in str(obj.get("errmsg", "")).lower()
                # Some BSG origins return HTTP 200 with an access-denial envelope.
                envelope_code = obj.get("http code")
                if type(envelope_code) in (str, int) and str(envelope_code) in ("403", "429"):
                    receipt["applicationHttpStatus"] = int(envelope_code)
    except Exception as error:
        receipt["transportError"] = type(error).__name__
    finally:
        conn.close()
        receipt["elapsedSeconds"] = round(time.monotonic() - started, 3)
    receipt["success"] = accepted(endpoint, spec, receipt.get("httpStatus"), obj)
    if receipt["success"]:
        receipt["summary"] = summary(endpoint, obj["data"])
    return receipt


def retry_deadline(value):
    if not value:
        return None
    try:
        return time.time() + max(0, int(value))
    except ValueError:
        try:
            return parsedate_to_datetime(value).timestamp()
        except (TypeError, ValueError, OverflowError):
            return None


def preflight_state(home):
    state = load(home / "state.json") if (home / "state.json").exists() else {}
    if state.get("blocked"):
        raise RuntimeError("previous-403-or-429-use-status-and-review-before-resume")
    if time.time() - state.get("lastAttemptEpoch", 0) < MIN_INTERVAL:
        raise RuntimeError("minimum-30-second-gap-not-elapsed")
    return state


def collect(args):
    http_proxy = getattr(args, "http_proxy", None)
    parse_http_proxy(http_proxy)  # Reject before reserving a session counter or writing state.
    spec = dict(registry()["endpoints"][args.endpoint])
    item_template = getattr(args, "item_template", None)
    if args.endpoint in ("flea-item-price", "flea-offers"):
        if not isinstance(item_template, str) or not re.fullmatch(r"[0-9a-f]{24}", item_template):
            raise ValueError("flea-query-requires-one-item-template-id")
        if args.game_version != registry()["testedGameVersion"]:
            raise ValueError("flea-query-client-version-not-reviewed")
        if not getattr(args, "backend_config", None):
            raise ValueError("flea-query-requires-verified-runtime-backend")
        if args.endpoint == "flea-item-price":
            spec["params"] = {"templateId": item_template}
        else:
            page = getattr(args, "page", None)
            limit = getattr(args, "limit", None)
            if type(page) is not int or not 0 <= page <= 1000:
                raise ValueError("flea-offers-requires-explicit-page-0-to-1000")
            if type(limit) is not int or not 1 <= limit <= 100:
                raise ValueError("flea-offers-requires-explicit-limit-1-to-100")
            spec["params"] = {
                "page": page, "limit": limit, "sortType": 5, "sortDirection": 0,
                "currency": 0, "priceFrom": 0, "priceTo": 0, "quantityFrom": 0, "quantityTo": 0,
                "conditionFrom": 0, "conditionTo": 100, "oneHourExpiration": False,
                "removeBartering": False, "offerOwnerType": 2, "onlyFunctional": False,
                "updateOfferCount": True, "handbookId": item_template,
                "linkedSearchId": "", "neededSearchId": "", "buildItems": {}, "buildCount": 0,
                "tm": 18, "reload": 11,
            }
    elif item_template is not None:
        raise ValueError("item-template-only-supported-for-flea-queries")
    if args.endpoint != "flea-offers" and any(getattr(args, key, None) is not None for key in ("page", "limit")):
        raise ValueError("page-limit-only-supported-for-flea-offers")
    backend, backend_evidence = resolve_backend(getattr(args, "backend_config", None), spec, args.game_version)
    request_framing = getattr(args, "request_framing", "none")
    if request_framing != "none":
        if request_framing != "spt-shuffle":
            raise ValueError("unknown-request-framing")
        if not args.experimental:
            raise ValueError("request-framing-requires-experimental-flag")
        if spec["method"] != "POST" or spec["body"] not in ("zlib-empty", "zlib-json"):
            raise ValueError("framing-only-supported-for-zlib-post")
        if args.game_version != registry()["testedGameVersion"]:
            raise ValueError("framing-client-version-not-reviewed")
    if spec["status"] != "verified" and not args.experimental:
        raise ValueError("endpoint-requires-experimental-flag")
    if spec["auth"] == "required" and not args.session_file:
        raise ValueError("endpoint-requires-session-file")
    if spec["body"] == "metadata-json" and not args.body_file:
        raise ValueError("metadata-requires-derived-body-file")
    if spec["body"] != "metadata-json" and args.body_file:
        raise ValueError("body-file-only-supported-for-metadata")
    # Check body schema before reserving a request ID or sending anything.
    if args.body_file:
        body = load(args.body_file)
        if set(body) != {"version", "key"} or not all(isinstance(v, str) for v in body.values()):
            raise ValueError("invalid-metadata-body")
    with lock(args.home / "collector.lock"):
        state = preflight_state(args.home)
        run_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S") + "-" + args.endpoint + "-" + uuid.uuid4().hex[:8]
        capture = args.home / "captures" / run_id
        capture.mkdir(parents=True, exist_ok=False)
        if os.name != "nt":
            os.chmod(capture, 0o700)
        state["lastAttemptEpoch"] = time.time()
        save(args.home / "state.json", state)
        if args.session_file:
            with lock(args.session_file.with_suffix(".lock")):
                session = load(args.session_file)
                if set(session) != {"gameVersion", "gameSession", "requestId"}:
                    raise ValueError("use-minimal-session-file-with-exact-three-fields")
                if session["gameVersion"] != args.game_version:
                    raise ValueError("session-version-mismatch")
                if not isinstance(session["gameSession"], str) or not re.fullmatch(r"[A-Za-z0-9_-]{8,256}", session["gameSession"]):
                    raise ValueError("invalid-session-format")
                if type(session["requestId"]) is not int or session["requestId"] < 0:
                    raise ValueError("invalid-session-counter")
                # Persist BEFORE sending, so failed/uncertain attempts never reuse the ID.
                session["requestId"] += 1
                save(args.session_file, session)
                receipt = perform(args.endpoint, spec, args.game_version, capture, session, args.body_file,
                                  request_framing=request_framing, backend=backend, http_proxy=http_proxy)
                # Keep the same request counter; a returned cookie is not a new login.
                if receipt.get("sessionCookieUpdated"):
                    save(args.session_file, session)
        else:
            receipt = perform(args.endpoint, spec, args.game_version, capture, body_file=args.body_file,
                              request_framing=request_framing, backend=backend, http_proxy=http_proxy)
        if backend_evidence:
            receipt["runtimeBackendEvidence"] = backend_evidence
        manifest = {
            "schemaVersion": 1, "collectorVersion": VERSION, "endpoint": args.endpoint,
            "collectorSourceSha256": {name: hashlib.sha256((HERE / name).read_bytes()).hexdigest()
                                      for name in ["collector.py", "protocol.py", "endpoints.json"]},
            "requestedGameVersion": args.game_version, "backend": "https://" + backend,
            "endpointEvidence": spec, "accountCredentialsUsed": bool(args.session_file),
            "gameStarted": False, "retryCount": 0, "receipt": receipt,
            "files": {p.name: {"bytes": p.stat().st_size, "sha256": hashlib.sha256(p.read_bytes()).hexdigest()}
                      for p in capture.iterdir() if p.is_file()},
        }
        save(capture / "manifest.json", manifest)
        state["lastManifest"] = str(capture / "manifest.json")
        state["lastHttpStatus"] = receipt.get("httpStatus")
        if receipt.get("httpStatus") in [403, 429] or receipt.get("applicationHttpStatus") in [403, 429]:
            state.update({"blocked": True, "blockedAt": utc(),
                          "blockHost": receipt["host"],
                          "blockReason": ("http-" + str(receipt["httpStatus"])
                                          if receipt.get("httpStatus") in (403, 429)
                                          else "http-200-with-application-" + str(receipt["applicationHttpStatus"])),
                          "retryNotBeforeEpoch": retry_deadline(receipt.get("retryAfter"))})
        save(args.home / "state.json", state)
        return {"success": receipt["success"], "manifest": str(capture / "manifest.json"), **receipt}


def parser():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--home", type=Path, default=Path(os.environ.get(
        "EFT_COLLECTOR_HOME", str(Path.home() / ".local/state/eft-collector"))))
    sub = p.add_subparsers(dest="command", required=True)
    for name in ["list", "doctor", "status", "resume"]:
        sub.add_parser(name)
    c = sub.add_parser("collect")
    c.add_argument("endpoint", choices=list(registry()["endpoints"]))
    c.add_argument("--game-version", required=True, help="Explicit verified five-part client version")
    c.add_argument("--experimental", action="store_true")
    c.add_argument("--session-file", type=Path)
    c.add_argument("--body-file", type=Path)
    c.add_argument("--request-framing", choices=["none", "spt-shuffle"], default="none",
                   help="Explicit experimental SPT request framing; does not change default requests")
    c.add_argument("--backend-config", type=Path,
                   help="Verified game-config capture manifest supplying Main/RagFair origin")
    c.add_argument("--http-proxy", help="Explicit loopback HTTP CONNECT URL, e.g. http://127.0.0.1:18080")
    c.add_argument("--item-template", help="One 24-character item template ID, for flea price/offers")
    c.add_argument("--page", type=int, help="One explicit zero-based page for flea-offers; no auto-pagination")
    c.add_argument("--limit", type=int, help="Explicit page size 1..100 for flea-offers; server cap unknown")
    d = sub.add_parser("decode")
    d.add_argument("--raw", type=Path, required=True)
    d.add_argument("--headers", type=Path, required=True)
    d.add_argument("--out", type=Path, required=True)
    return p


def main(argv=None):
    args = parser().parse_args(argv)
    args.home = args.home.resolve()
    if args.command == "list":
        return registry(), 0
    if args.command == "doctor":
        import cryptography
        return {"collectorVersion": VERSION, "python": sys.version.split()[0],
                "cryptography": cryptography.__version__, "home": str(args.home),
                "networkTested": False, "lastVerifiedClient": registry()["testedGameVersion"]}, 0
    if args.command == "status":
        return load(args.home / "state.json") if (args.home / "state.json").exists() else {"previousAttempts": False}, 0
    if args.command == "resume":
        with lock(args.home / "collector.lock"):
            state = load(args.home / "state.json") if (args.home / "state.json").exists() else {}
            if state.get("retryNotBeforeEpoch") and time.time() < state["retryNotBeforeEpoch"]:
                raise RuntimeError("server-retry-after-not-elapsed")
            state["blocked"] = False
            state["resumedAt"] = utc()
            save(args.home / "state.json", state)
        return {"resumed": True, "requestSent": False}, 0
    if args.command == "decode":
        if args.out.exists():
            raise ValueError("decode-output-already-exists")
        if args.raw.stat().st_size > protocol.MAX_BYTES:
            raise ValueError("raw-file-too-large")
        obj, codec, _ = protocol.decoded_json(args.raw.read_bytes(), load(args.headers))
        if obj is None:
            return {"success": False, "decoder": codec}, 1
        save(args.out, obj)
        return {"success": True, "decoder": codec, "out": str(args.out)}, 0
    if not re.fullmatch(r"\d+(?:\.\d+){4}", args.game_version):
        raise ValueError("explicit-five-part-game-version-required")
    result = collect(args)
    return result, 0 if result["success"] else 1


if __name__ == "__main__":
    try:
        result, exit_code = main()
    except Exception as error:
        # Never render arbitrary exception text: libraries can include credentials.
        result, exit_code = {"success": False, "errorType": type(error).__name__,
                             "reason": str(error) if type(error) in [ValueError, RuntimeError]
                             and re.fullmatch(r"[a-z0-9-]+", str(error)) else "see-local-state-and-inputs"}, 2
    print(json.dumps(result, ensure_ascii=False))
    sys.exit(exit_code)
