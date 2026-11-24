"""Offline transport, credential, blocking and integrity checks."""
import argparse
import hashlib
import json
import ssl
from pathlib import Path
import tempfile
import unittest
import zlib
from unittest.mock import patch

import collector
import protocol


class Response:
    status = 200

    def read(self, limit):
        return b'{"err":0,"data":{"en":"English"}}'

    def getheaders(self):
        return [("Content-Type", "application/json"), ("Set-Cookie", "private-server-cookie")]


class Connection:
    sent = []
    opened = []
    tunnels = []
    response = Response

    def __init__(self, *args, **kwargs):
        self.opened.append((args, kwargs))

    def set_tunnel(self, host, port):
        self.tunnels.append((host, port))

    def request(self, method, path, body, headers):
        self.sent.append((method, path, body, headers))

    def getresponse(self):
        return self.response()

    def close(self):
        pass


class CollectorTests(unittest.TestCase):
    def test_tls_context_uses_native_windows_policy_and_checks_hostname(self):
        context = collector.tls_context()
        self.assertEqual(context.verify_mode, ssl.CERT_REQUIRED)
        self.assertTrue(context.check_hostname)
        if collector.sys.platform == "win32":
            import truststore
            self.assertIsInstance(context, truststore.SSLContext)

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.home = Path(self.temp.name)
        Connection.sent = []
        Connection.opened = []
        Connection.tunnels = []
        Connection.response = Response
        self.transport = patch.object(collector.http.client, "HTTPSConnection", Connection)
        self.transport.start()

    def tearDown(self):
        self.transport.stop()
        self.temp.cleanup()

    def args(self, **changes):
        args = dict(home=self.home, endpoint="languages", game_version="1.2.5.0.48146",
                    experimental=False, session_file=None, body_file=None)
        args.update(changes)
        return argparse.Namespace(**args)

    def test_anonymous_omits_all_credentials_and_verifies_files(self):
        result = collector.collect(self.args())
        self.assertTrue(result["success"])
        headers = Connection.sent[0][3]
        self.assertFalse({"Cookie", "Authorization", "GClient-RequestId"} & set(headers))
        self.assertEqual(headers["App-Version"], "EFT Client 1.2.5.0.48146")
        self.assertNotIn("private-server-cookie", json.dumps(result))
        manifest_path = Path(result["manifest"])
        manifest = collector.load(manifest_path)
        self.assertEqual(manifest["retryCount"], 0)
        for name, spec in manifest["files"].items():
            self.assertEqual(hashlib.sha256((manifest_path.parent / name).read_bytes()).hexdigest(), spec["sha256"])

    def test_proxy_tunnels_to_verified_backend_with_certificate_validation(self):
        result = collector.collect(self.args(http_proxy="http://127.0.0.1:18080"))
        self.assertTrue(result["success"])
        self.assertEqual(Connection.opened[0][0], ("127.0.0.1", 18080))
        self.assertEqual(Connection.tunnels, [(collector.BACKEND, 443)])
        context = Connection.opened[0][1]["context"]
        self.assertTrue(context.check_hostname)
        self.assertEqual(context.verify_mode, ssl.CERT_REQUIRED)
        self.assertEqual(result["host"], collector.BACKEND)
        self.assertEqual(result["networkRoute"], "loopback-http-connect")
        self.assertEqual(result["httpProxy"], "http://127.0.0.1:18080")
        self.assertFalse({"Cookie", "Authorization", "Proxy-Authorization"} & set(Connection.sent[0][3]))

    def test_proxy_rejects_remote_or_credential_urls_before_state_changes(self):
        for url in ["http://example.org:8080", "http://10.0.0.1:8080", "https://127.0.0.1:8080",
                    "http://127.0.0.1", "http://127.0.0.1:0", "http://user:secret@127.0.0.1:18080",
                    "http://127.0.0.1:18080/path", "http://127.0.0.1:18080?token=secret",
                    "http://127.0.0.1:18080#secret", "\nhttp://127.0.0.1:18080"]:
            with self.subTest(url=url), self.assertRaisesRegex(ValueError, "loopback-http"):
                collector.collect(self.args(http_proxy=url))
        self.assertEqual(Connection.opened, [])
        self.assertFalse((self.home / "state.json").exists())
        self.assertEqual(collector.parse_http_proxy("http://[::1]:18080"), ("::1", 18080))

    def test_proxy_failure_has_no_direct_fallback_or_retry(self):
        with patch.object(Connection, "request", side_effect=OSError("tunnel unavailable")) as request:
            result = collector.collect(self.args(http_proxy="http://127.0.0.1:18080"))
        self.assertFalse(result["success"])
        self.assertEqual(result["transportError"], "OSError")
        self.assertEqual(request.call_count, 1)
        self.assertEqual(len(Connection.opened), 1)
        self.assertEqual(result["networkRoute"], "loopback-http-connect")

    def test_proxy_environment_does_not_change_default_direct_connection(self):
        with patch.dict(collector.os.environ, {"HTTPS_PROXY": "http://127.0.0.1:18080"}):
            result = collector.collect(self.args())
        self.assertEqual(result["networkRoute"], "direct")
        self.assertEqual(Connection.opened[0][0], (collector.BACKEND,))
        self.assertEqual(Connection.tunnels, [])

    def test_429_blocks_next_run_without_retry(self):
        class Limited(Response):
            status = 429
            def read(self, limit):
                return b""
            def getheaders(self):
                return [("Retry-After", "3600")]
        Connection.response = Limited
        result = collector.collect(self.args())
        self.assertFalse(result["success"])
        with self.assertRaisesRegex(RuntimeError, "previous-403-or-429"):
            collector.collect(self.args())
        with self.assertRaisesRegex(RuntimeError, "server-retry-after"):
            collector.main(["--home", str(self.home), "resume"])
        self.assertEqual(len(Connection.sent), 1)

    def test_no_redirect_follow_or_success_from_http_alone(self):
        class Redirect(Response):
            status = 302
            def getheaders(self):
                return [("Location", "https://unrelated.example/")]
        Connection.response = Redirect
        result = collector.collect(self.args())
        self.assertFalse(result["success"])
        self.assertEqual(len(Connection.sent), 1)

    def test_http_200_access_denial_still_pauses_future_requests(self):
        class Denied(Response):
            def read(self, limit):
                return b'{"http code":"403","message":"Access denied"}'
        Connection.response = Denied
        result = collector.collect(self.args())
        self.assertFalse(result["success"])
        self.assertEqual(result["applicationHttpStatus"], 403)
        with self.assertRaisesRegex(RuntimeError, "previous-403-or-429"):
            collector.collect(self.args())
        self.assertEqual(len(Connection.sent), 1)

    def test_minimum_gap_is_across_endpoints(self):
        collector.collect(self.args())
        with self.assertRaisesRegex(RuntimeError, "minimum-30"):
            collector.collect(self.args(endpoint="locations"))
        self.assertEqual(len(Connection.sent), 1)

    def test_session_counter_saved_before_request(self):
        session = self.home / "session.json"
        collector.save(session, {"gameVersion": "1.2.5.0.48146", "gameSession": "example_session_123", "requestId": 7})
        original = Connection.request
        def checked(instance, method, path, body, headers):
            self.assertEqual(collector.load(session)["requestId"], 8)
            self.assertEqual(headers["GClient-RequestId"], "8")
            original(instance, method, path, body, headers)
        with patch.object(Connection, "request", checked):
            result = collector.collect(self.args(session_file=session))
        self.assertNotIn("example_session_123", json.dumps(result))
        self.assertEqual(collector.load(session)["requestId"], 8)

    def test_experimental_endpoint_requires_flag(self):
        with self.assertRaisesRegex(ValueError, "experimental"):
            collector.collect(self.args(endpoint="game-config"))
        self.assertEqual(Connection.sent, [])

    def test_session_rotation_persisted_without_resetting_counter_or_printing_cookie(self):
        class Rotated(Response):
            def getheaders(self):
                return [("Set-Cookie", "PHPSESSID=renewed_session_456; Path=/; Secure; HttpOnly"),
                        ("Set-Cookie", "unrelated=unrelated_value; Path=/")]
        Connection.response = Rotated
        session = self.home / "session.json"
        collector.save(session, {"gameVersion": "1.2.5.0.48146", "gameSession": "initial_session_123", "requestId": 7})
        result = collector.collect(self.args(session_file=session))
        saved = collector.load(session)
        self.assertEqual(saved["gameSession"], "renewed_session_456")
        self.assertEqual(saved["requestId"], 8)
        self.assertTrue(result["sessionCookieUpdated"])
        self.assertEqual(Connection.sent[0][3]["Cookie"], "PHPSESSID=initial_session_123")
        self.assertNotIn("renewed_session_456", json.dumps(result))

    def test_anonymous_does_not_adopt_a_server_session(self):
        class Cookie(Response):
            def getheaders(self):
                return [("Set-Cookie", "PHPSESSID=server_session_123; Path=/")]
        Connection.response = Cookie
        result = collector.collect(self.args())
        self.assertNotIn("sessionCookieUpdated", result)
        self.assertNotIn("Cookie", Connection.sent[0][3])

    def test_cookie_deletion_or_invalid_value_does_not_replace_owned_session(self):
        self.assertIsNone(collector.session_cookie_from_headers([
            ("Set-Cookie", "PHPSESSID=; Max-Age=0"),
            ("Set-Cookie", 'PHPSESSID="bad value here"; Path=/'),
        ]))

    def test_quest_query_includes_completed_boolean_in_compressed_json(self):
        collector.collect(self.args(endpoint="quest-list", experimental=True))
        method, path, body, headers = Connection.sent[0]
        self.assertEqual((method, path), ("POST", "/client/quest/list"))
        self.assertEqual(json.loads(zlib.decompress(body)), {"completed": True})
        self.assertFalse({"Cookie", "Authorization", "GClient-RequestId"} & set(headers))

    def test_single_item_price_uses_explicit_template_and_runtime_ragfair(self):
        class Price(Response):
            def read(self, limit):
                return b'{"err":0,"data":{"templateId":"544fb45d4bdc2dee738b4568","min":100.5,"avg":200,"max":350}}'
        Connection.response = Price
        manifest = self.login_manifest()
        result = collector.collect(self.args(endpoint="flea-item-price", experimental=True,
                                             item_template="544fb45d4bdc2dee738b4568",
                                             backend_config=manifest, request_framing="spt-shuffle"))
        method, path, body, headers = Connection.sent[0]
        self.assertTrue(result["success"])
        self.assertEqual((method, path), ("POST", "/client/ragfair/itemMarketPrice"))
        self.assertEqual(json.loads(zlib.decompress(protocol.unframe_response(body))),
                         {"templateId": "544fb45d4bdc2dee738b4568"})
        self.assertEqual(result["host"], "gw-pvp.escapefromtarkov.ru")
        self.assertEqual(result["runtimeBackendEvidence"]["role"], "RagFair")
        self.assertEqual(result["summary"]["avg"], 200)
        self.assertFalse({"Cookie", "Authorization"} & set(headers))

    def test_item_price_rejects_incomplete_or_non_numeric_payload(self):
        spec = {**collector.registry()["endpoints"]["flea-item-price"],
                "params": {"templateId": "544fb45d4bdc2dee738b4568"}}
        for data in [{}, {"min": 1, "avg": 2}, {"min": 1, "avg": True, "max": 3},
                     {"min": 1, "avg": "2", "max": 3}, {"min": 1, "avg": float("inf"), "max": 3}]:
            with self.subTest(data=data):
                self.assertFalse(collector.accepted("flea-item-price", spec, 200, {
                    "err": 0, "data": {"templateId": "544fb45d4bdc2dee738b4568", **data}}))
        self.assertFalse(collector.accepted("flea-item-price", spec, 200, {
            "err": 0, "data": {"templateId": "000000000000000000000000", "min": 1, "avg": 2, "max": 3}}))

    def test_item_price_requires_single_id_matching_version_and_ragfair_evidence(self):
        manifest = self.login_manifest()
        base = dict(endpoint="flea-item-price", experimental=True, backend_config=manifest,
                    item_template="544fb45d4bdc2dee738b4568")
        for changes in [dict(item_template=None), dict(item_template="bad"), dict(backend_config=None),
                        dict(item_template="544fb45d4bdc2dee738b4568,544fb45d4bdc2dee738b4568"),
                        dict(game_version="1.2.0.0.47965"), dict(endpoint="quest-list")]:
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                collector.collect(self.args(**{**base, **changes}))
        self.assertEqual(Connection.sent, [])
        self.assertFalse((self.home / "state.json").exists())

    def test_flea_offers_reads_one_explicit_player_page(self):
        template = "544fb45d4bdc2dee738b4568"
        class Offers(Response):
            def read(self, limit):
                return json.dumps({"err": 0, "data": {"offers": [], "offersCount": 0,
                                  "selectedCategory": template}}).encode()
        Connection.response = Offers
        session = self.home / "session.json"
        collector.save(session, {"gameVersion": "1.2.5.0.48146",
                                "gameSession": "example_session_123", "requestId": 7})
        result = collector.collect(self.args(endpoint="flea-offers", experimental=True,
                                             item_template=template, page=2, limit=15,
                                             backend_config=self.login_manifest(), session_file=session,
                                             request_framing="spt-shuffle"))
        self.assertTrue(result["success"])
        self.assertEqual(len(Connection.sent), 1)
        method, path, body, headers = Connection.sent[0]
        self.assertEqual((method, path), ("POST", "/client/ragfair/find"))
        params = json.loads(zlib.decompress(protocol.unframe_response(body)))
        self.assertEqual(len(params), 23)
        self.assertEqual((params["page"], params["limit"], params["handbookId"]), (2, 15, template))
        self.assertEqual((params["offerOwnerType"], params["tm"], params["reload"]), (2, 18, 11))
        self.assertFalse(params["removeBartering"])
        self.assertFalse(params["onlyFunctional"])
        self.assertEqual(collector.load(session)["requestId"], 8)
        self.assertEqual(result["summary"]["returnedOffers"], 0)

    def test_flea_offers_rejects_invalid_pagination_before_sending(self):
        base = dict(endpoint="flea-offers", experimental=True,
                    item_template="544fb45d4bdc2dee738b4568", page=0, limit=15,
                    backend_config=self.login_manifest())
        for changes in [dict(page=None), dict(page=-1), dict(page=True), dict(limit=0),
                        dict(limit=101), dict(limit=None), dict(endpoint="flea-item-price"), {}]:
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                collector.collect(self.args(**{**base, **changes}))
        self.assertEqual(Connection.sent, [])
        self.assertFalse((self.home / "state.json").exists())

    def test_flea_offers_rejects_foreign_item_and_invalid_count(self):
        template = "544fb45d4bdc2dee738b4568"
        spec = {"shape": "dict", "params": {"handbookId": template}}
        good = {"offersCount": 1, "selectedCategory": template,
                "offers": [{"_id": "offer", "root": "root",
                            "items": [{"_id": "root", "_tpl": template}]}]}
        self.assertTrue(collector.accepted("flea-offers", spec, 200, {"err": 0, "data": good}))
        for data in [dict(good, offersCount=True), dict(good, offersCount=-1),
                     dict(good, selectedCategory="different"),
                     dict(good, offers=[{"_id": "offer", "root": "root",
                                         "items": [{"_id": "root", "_tpl": "different"}]}])]:
            self.assertFalse(collector.accepted("flea-offers", spec, 200, {"err": 0, "data": data}))

    def test_experimental_framed_quest_is_anonymous_and_audited(self):
        result = collector.collect(self.args(endpoint="quest-list", experimental=True,
                                             request_framing="spt-shuffle"))
        method, path, body, headers = Connection.sent[0]
        self.assertEqual((method, path), ("POST", "/client/quest/list"))
        self.assertEqual(json.loads(zlib.decompress(protocol.unframe_response(body))), {"completed": True})
        self.assertFalse({"Cookie", "Authorization", "GClient-RequestId"} & set(headers))
        self.assertEqual(result["requestFraming"], "spt-shuffle")
        self.assertEqual(result["requestPaddingBytes"], 6)
        self.assertEqual(result["requestBodySha256"], hashlib.sha256(body).hexdigest())

    def test_request_framing_requires_explicit_experiment_and_reviewed_version(self):
        for changes in [
            dict(endpoint="quest-list", experimental=False),
            dict(endpoint="quest-list", experimental=True, game_version="1.2.0.0.47965"),
            dict(endpoint="languages", experimental=True),
            dict(endpoint="metadata", experimental=True),
        ]:
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                collector.collect(self.args(request_framing="spt-shuffle", **changes))
        self.assertEqual(Connection.sent, [])
        self.assertFalse((self.home / "state.json").exists())

    def login_manifest(self, main="https://gw-pvp.escapefromtarkov.com",
                       ragfair="https://gw-pvp.escapefromtarkov.ru"):
        folder = self.home / "login"
        collector.save(folder / "response.json", {"err": 0, "data": {"backend": {
            "Main": main, "RagFair": ragfair}}})
        raw = (folder / "response.json").read_bytes()
        collector.save(folder / "manifest.json", {
            "endpoint": "game-config", "requestedGameVersion": "1.2.5.0.48146",
            "receipt": {"success": True, "authKind": "game-session"},
            "files": {"response.json": {"bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}},
        })
        return folder / "manifest.json"

    def test_runtime_backend_selects_role_and_records_verified_input(self):
        manifest = self.login_manifest()
        main, evidence = collector.resolve_backend(manifest, {}, "1.2.5.0.48146")
        flea, _ = collector.resolve_backend(manifest, {"backendRole": "RagFair"}, "1.2.5.0.48146")
        self.assertEqual(main, "gw-pvp.escapefromtarkov.com")
        self.assertEqual(flea, "gw-pvp.escapefromtarkov.ru")
        self.assertEqual(evidence["manifestSha256"], hashlib.sha256(manifest.read_bytes()).hexdigest())

    def test_runtime_backend_refuses_unreviewed_origins_tampering_and_version_mismatch(self):
        for origin in ["https://unrelated.example", "https://gw-pvp.escapefromtarkov.ru.attacker.example",
                       "http://gw-pvp.escapefromtarkov.ru", "https://user@gw-pvp.escapefromtarkov.ru",
                       "https://gw-pvp.escapefromtarkov.ru/path"]:
            manifest = self.login_manifest(main=origin)
            with self.subTest(origin=origin), self.assertRaises(ValueError):
                collector.resolve_backend(manifest, {}, "1.2.5.0.48146")
        manifest = self.login_manifest()
        with self.assertRaisesRegex(ValueError, "matching-successful"):
            collector.resolve_backend(manifest, {}, "1.2.0.0.47965")
        (manifest.parent / "response.json").write_bytes(b"{}")
        with self.assertRaisesRegex(ValueError, "integrity"):
            collector.resolve_backend(manifest, {}, "1.2.5.0.48146")
        self.assertEqual(Connection.sent, [])

    def test_framed_experiment_preserves_pause_on_denial(self):
        class Denied(Response):
            def read(self, limit):
                return b'{"http code":"403","message":"Access denied"}'
        Connection.response = Denied
        args = self.args(endpoint="quest-list", experimental=True, request_framing="spt-shuffle")
        result = collector.collect(args)
        self.assertFalse(result["success"])
        state = collector.load(self.home / "state.json")
        self.assertEqual(state["blockHost"], collector.BACKEND)
        self.assertEqual(state["blockReason"], "http-200-with-application-403")
        with self.assertRaisesRegex(RuntimeError, "previous-403-or-429"):
            collector.collect(args)
        self.assertEqual(len(Connection.sent), 1)

    def test_lock_excludes_concurrent_reader(self):
        with collector.lock(self.home / "collector.lock"):
            with self.assertRaisesRegex(RuntimeError, "collector-busy"):
                collector.collect(self.args())
        self.assertEqual(Connection.sent, [])

    def test_business_error_not_success(self):
        class Error(Response):
            def read(self, limit):
                return b'{"err":1000,"errmsg":"wrong encryption params","data":null}'
        Connection.response = Error
        result = collector.collect(self.args())
        self.assertFalse(result["success"])
        self.assertTrue(result["wrongEncryptionParams"])
        self.assertEqual(result["backendErrorCode"], 1000)


if __name__ == "__main__":
    unittest.main()
