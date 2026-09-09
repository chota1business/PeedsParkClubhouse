"""Offline regression tests for isolated, verified Pages releases."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("release", Path(__file__).resolve().parents[1] / "scripts/release.py")
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)
SHA = "a" * 40
URL = "https://dwnocyvunvswdfgtmwst.supabase.co"
KEY = "sb_publishable_test"


class ReleaseTests(unittest.TestCase):
    def test_environment_mismatch_rejected(self):
        with self.assertRaises(ValueError):
            release.validate_config("production", URL, KEY)

    def test_privileged_and_malformed_keys_rejected(self):
        for key in ("sb_secret_test", "", "bad.jwt.key"):
            with self.subTest(key=key), self.assertRaises(ValueError):
                release.validate_config("staging", URL, key)

    def test_artifact_excludes_private_files_and_marks_staging(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "index.html").write_text("<html><head></head><body>Test</body></html>")
            (root / ".env").write_text("PRIVATE=value")
            (root / "config.js").write_text("old production config")
            (root / "supabase").mkdir()
            (root / "supabase/private.sql").write_text("private")
            (root / "js").mkdir()
            (root / "js/app.js").write_text("app()")
            out = root / "artifact"
            manifest = release.build(root, out, "staging", SHA, URL, KEY, "123")
            self.assertFalse((out / ".env").exists())
            self.assertFalse((out / "supabase").exists())
            self.assertTrue((out / "js/app.js").exists())
            self.assertIn("noindex,nofollow", (out / "index.html").read_text(encoding="utf-8"))
            self.assertIn("STAGING", (out / "index.html").read_text(encoding="utf-8"))
            self.assertIn(URL, (out / "config.js").read_text())
            self.assertEqual(manifest["sha"], SHA)
            self.assertEqual(manifest["run_id"], "123")

    def test_non_commit_revision_rejected(self):
        with tempfile.TemporaryDirectory() as directory, self.assertRaises(ValueError):
            release.build(directory, Path(directory) / "out", "staging", "main", URL, KEY)

    def test_existing_output_is_not_overwritten(self):
        with tempfile.TemporaryDirectory() as directory, self.assertRaises(ValueError):
            release.build(directory, directory, "staging", SHA, URL, KEY)

    def test_wrong_deployed_revision_rejected(self):
        with patch.object(release, "fetch", return_value=json.dumps({"sha": "b" * 40, "environment": "staging"}).encode()), self.assertRaises(ValueError):
            release.verify("https://example.test", "staging", SHA)

    def test_empty_database_rejected_before_release(self):
        with patch.object(release, "fetch", side_effect=[b"{}", b"[]"]), self.assertRaises(ValueError):
            release.check_database("staging", URL, KEY)

    def test_database_preflight_is_read_only(self):
        with patch.object(release, "fetch", side_effect=[b"{}", b'[{"id":"pool"}]', b'[{"id":1}]']) as fetch:
            release.check_database("staging", URL, KEY)
            self.assertEqual(fetch.call_count, 3)
            self.assertTrue(all(call.args[0].startswith(URL + "/") for call in fetch.call_args_list))

    def test_failed_staging_run_cannot_be_promoted(self):
        manifest = {"sha": SHA, "environment": "staging", "repository": release.SOURCE_REPO, "run_id": "123"}
        for conclusion in ("failure", None, "cancelled"):
            with self.subTest(conclusion=conclusion), patch.object(release, "fetch", side_effect=[json.dumps(manifest).encode(), json.dumps({"conclusion": conclusion}).encode()]), self.assertRaises(ValueError):
                release.candidate("https://example.test")

    def test_successful_verified_candidate(self):
        manifest = {"sha": SHA, "environment": "staging", "repository": release.SOURCE_REPO, "run_id": "123"}
        run = {"conclusion": "success", "path": ".github/workflows/staging-deploy.yml", "head_branch": "main"}
        with patch.object(release, "fetch", side_effect=[json.dumps(manifest).encode(), json.dumps(run).encode()]), patch.object(release, "verify") as verify:
            self.assertEqual(release.candidate("https://example.test"), SHA)
            verify.assert_called_once_with("https://example.test", "staging", SHA)


if __name__ == "__main__":
    unittest.main()
