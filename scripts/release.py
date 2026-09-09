"""Build an allowlisted Pages artifact and verify the exact deployed release.

No privileged Supabase key is accepted. Production and staging must use different
projects. Runtime config is generated only inside the deploy artifact.
"""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import time
import urllib.request

PROJECTS = {"production": "cvqvxclvizpltnflbdlh", "staging": "dwnocyvunvswdfgtmwst"}
SOURCE_REPO = "chota1business/PeedsParkClubhouse"
STAGING_REPO = "chota1business/PeedsParkClubhouse-Staging"


def fetch(url, headers=None):
    with urllib.request.urlopen(urllib.request.Request(url, headers=headers or {}), timeout=25) as response:
        return response.read()


def schema_hash(root):
    digest = hashlib.sha256()
    for path in sorted((Path(root) / "supabase/migrations").glob("*.sql")):
        digest.update(path.name.encode())
        digest.update(path.read_text(encoding="utf-8").replace("\r\n", "\n").encode())
    return digest.hexdigest()


def validate_config(environment, url, key):
    project = PROJECTS[environment]
    if url != f"https://{project}.supabase.co":
        raise ValueError("Supabase URL does not match the selected environment")
    if key.startswith("sb_publishable_"):
        return
    try:
        payload = key.split(".")[1]
        claims = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
        if claims.get("role") == "anon" and claims.get("ref") == project and claims.get("exp", 0) > time.time():
            return
    except (ValueError, IndexError):
        pass
    raise ValueError("Expected an unexpired anon/publishable key for this environment; never use service_role")


def build(root, output, environment, sha, url, key, run_id="local"):
    root, output = Path(root).resolve(), Path(output).resolve()
    validate_config(environment, url, key)
    if not re.fullmatch(r"[0-9a-f]{40}", sha):
        raise ValueError("Release must identify an exact Git commit")
    if output.exists():
        raise ValueError("Artifact output must be a new directory")
    output.mkdir(parents=True)
    for folder in ("css", "js", "images", "admin-v2"):
        for path in (root / folder).rglob("*"):
            if path.is_symlink():
                raise ValueError("Symlinks cannot be published")
            if path.is_file() and path.suffix.lower() in (".html", ".js", ".css", ".png", ".jpg", ".jpeg", ".webp", ".svg", ".ico", ".woff", ".woff2", ".gif"):
                target = output / path.relative_to(root)
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(path, target)
    for path in root.glob("*.html"):
        if path.is_symlink():
            raise ValueError("Symlinks cannot be published")
        shutil.copyfile(path, output / path.name)
    config = {"SUPABASE_URL": url, "SUPABASE_ANON_KEY": key}
    (output / "config.js").write_text("window.CONFIG = " + json.dumps(config) + ";\n", encoding="utf-8")
    (output / ".nojekyll").touch()
    if environment == "staging":
        (output / "robots.txt").write_text("User-agent: *\nDisallow: /\n", encoding="utf-8")
        for path in output.rglob("*.html"):
            html = path.read_text(encoding="utf-8")
            html = html.replace("</head>", '<meta name="robots" content="noindex,nofollow">\n</head>')
            html = re.sub(r"(<body[^>]*>)", r'\1<div style="background:#ffdf80;color:#222;text-align:center;padding:8px;font:14px sans-serif">STAGING — test data only. This is not the customer website.</div>', html, count=1)
            path.write_text(html, encoding="utf-8")
    manifest = {"environment": environment, "sha": sha, "schema_sha": schema_hash(root),
                "repository": SOURCE_REPO, "run_id": str(run_id)}
    (output / "release.json").write_text(json.dumps(manifest), encoding="utf-8")
    return manifest


def check_database(environment, url, key):
    validate_config(environment, url, key)
    headers = {"apikey": key}
    fetch(url + "/auth/v1/settings", headers)
    facilities = json.loads(fetch(url + "/rest/v1/facilities?select=id", headers))
    if not facilities:
        raise ValueError("Database schema/facility seed is missing")
    fetch(url + "/rest/v1/website_settings?select=id&limit=1", headers)


def verify(site, environment, sha):
    manifest = json.loads(fetch(site.rstrip("/") + "/release.json?check=" + str(time.time_ns())))
    if manifest.get("sha") != sha or manifest.get("environment") != environment:
        raise ValueError("Site has not served the expected release yet")
    text = fetch(site.rstrip("/") + "/config.js?check=" + str(time.time_ns())).decode()
    config = json.loads(text.removeprefix("window.CONFIG = ").strip().removesuffix(";"))
    url, key = config["SUPABASE_URL"], config["SUPABASE_ANON_KEY"]
    check_database(environment, url, key)
    return manifest


def candidate(site):
    manifest = json.loads(fetch(site.rstrip("/") + "/release.json?check=" + str(time.time_ns())))
    sha, run_id = manifest.get("sha", ""), manifest.get("run_id", "")
    if manifest.get("environment") != "staging" or manifest.get("repository") != SOURCE_REPO or not re.fullmatch(r"[0-9a-f]{40}", sha) or not str(run_id).isdigit():
        raise ValueError("Staging release manifest is invalid")
    headers = {"Accept": "application/vnd.github+json"}
    token = os.environ.get("GH_TOKEN")
    if token:
        headers["Authorization"] = "Bearer " + token
    run = json.loads(fetch(f"https://api.github.com/repos/{STAGING_REPO}/actions/runs/{run_id}", headers))
    if run.get("conclusion") != "success" or run.get("path") != ".github/workflows/staging-deploy.yml" or run.get("head_branch") != "main":
        raise ValueError("The deployed staging run has not successfully completed verification")
    verify(site, "staging", sha)
    return sha


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("build", "verify", "candidate", "schema"))
    parser.add_argument("--root", default=".")
    parser.add_argument("--output", default="_site")
    parser.add_argument("--environment", choices=PROJECTS)
    parser.add_argument("--sha")
    parser.add_argument("--site")
    args = parser.parse_args()
    try:
        if args.command == "build":
            check_database(args.environment, os.environ.get("SUPABASE_URL", ""),
                           os.environ.get("SUPABASE_ANON_KEY", ""))
            build(args.root, args.output, args.environment, args.sha,
                  os.environ.get("SUPABASE_URL", ""), os.environ.get("SUPABASE_ANON_KEY", ""), os.environ.get("GITHUB_RUN_ID", "local"))
        elif args.command == "schema":
            print(schema_hash(args.root))
        elif args.command == "candidate":
            print(candidate(args.site))
        else:
            for attempt in range(12):
                try:
                    verify(args.site, args.environment, args.sha)
                    print("Release, configuration, Auth and database checks passed")
                    break
                except Exception:
                    if attempt == 11:
                        raise
                    time.sleep(10)
    except Exception as error:
        # Never echo credentials, configuration or arbitrary HTTP bodies.
        raise SystemExit(f"Release check failed ({type(error).__name__}); check environment configuration, deployment status and database schema")


if __name__ == "__main__":
    main()
