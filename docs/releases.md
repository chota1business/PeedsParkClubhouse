# Staging and production releases

Source: `chota1business/PeedsParkClubhouse`, development branch `staging`.
Staging host: `chota1business/PeedsParkClubhouse-Staging`, workflow on `main`.

The staging hosting workflow checks out the source staging branch, runs release
and browser form checks, builds an allowlisted website artifact with the staging
Supabase configuration, deploys Pages, and checks the live configuration, Auth,
database, and exact source revision. Its schedule is 9 PM India time every day.
GitHub schedules can be delayed; this is a requested start time, not a deadline.
Use Run workflow on the staging host for an earlier deployment.

## One-time activation

1. Merge the release tooling/workflows into source `main`, then synchronize
   `staging` with `main`. The source production publisher is reusable only:
   pushing main no longer automatically publishes production.
2. Put `deployment/staging-deploy.yml` at `.github/workflows/staging-deploy.yml`
   in the staging host. Set its Pages source to GitHub Actions.
3. Set `STAGING_SUPABASE_URL` and `STAGING_SUPABASE_ANON_KEY` in the staging
   host's Actions secrets or variables. These must belong to project
   `dwnocyvunvswdfgtmwst`. Only the public anon/publishable key is used.
4. Keep production `SUPABASE_URL` and `SUPABASE_ANON_KEY` in the source repo,
   pointing to project `cvqvxclvizpltnflbdlh`.
5. Initially use `https://chota1business.github.io/PeedsParkClubhouse-Staging/`.
   To enable `staging.peedspark.com`, create a DNS CNAME for `staging` pointing
   to `chota1business.github.io`, set the custom domain in the staging repo's
   Pages settings, enable HTTPS, and set source Actions variable
   `STAGING_SITE_URL` to `https://staging.peedspark.com`.
6. Configure staging Auth Site URL and allowed password-reset redirect URL for
   the staging site. Create a separate Auth user and an active admin staff row;
   production accounts do not carry over.

## Promote

After checking staging, open source Actions → Promote to Production → Run
workflow on main. No revision input is needed. The workflow selects the exact
revision currently served by staging and requires that its deployment run passed.
It rejects divergent history and database/function changes requiring separate
review. It builds that revision with production public configuration, verifies
the live deployment, then fast-forwards main and records a `production-NNN` tag.
Avoid concurrent manual changes to main during promotion; a moved main can
prevent release recording. Never force push to work around that failure.

## Database and functions

The migration directory now matches all 42 versions actually applied to
production, including previously missing manager, payment, and review migrations.
The staging database was initialized from schema history only, without customers,
staff, bookings, expenses, or production Auth users. Apply `supabase/staging-only.sql`
after schema updates on staging to disable owner notifications and digest jobs.
Never apply this file to production.

Database and Edge Function promotion is deliberately not automatic. Test new
migrations/functions on staging, review production compatibility and rollback,
apply the reviewed production database/function release, and synchronize the
approved supabase files into main before promoting the website. The website
workflow refuses to silently deploy against an incompatible database. Do not
put database passwords or service-role keys in website artifacts.

The old weekly reset was a placeholder, not a functioning reset. Its schedule
has been removed; manual dispatch now fails explicitly until a reviewed reset
procedure exists. Test data is retained rather than falsely reported deleted.

## Rollback and checks

Run Rollback with a previously recorded `production-NNN` tag. It republishes
that website without rewriting main or reverting customer data. Database changes
require separate compatibility review. Release metadata is at `/release.json`.

Automated local checks:

```sh
python -m unittest discover -s tests -p 'test_release.py'
python tests/run_tests.py --forms-only
```

Manual checks: staging banner visible; no production records; staging admin login
and reset remain on staging; facility availability, enquiry submission, expenses,
and photo uploads work with staging data; failed tests prevent promotion; live
release SHA matches staging after promotion. Check Auth/Edge Function setup
separately before declaring all admin functionality ready.
