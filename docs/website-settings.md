# Website Settings

Admins open **Dashboard → More tools → Website Settings**. Managers and Pool Managers cannot publish settings or upload photos.

1. Update the two phone numbers, two email addresses and WhatsApp number.
2. Replace a named photo/banner, or add, remove and reorder gallery photos (1–12).
3. Add a meaningful image description. Hero images are cropped to their existing frame; banners retain their proportions.
4. Select **Preview changes** and review the contact details and photos.
5. Select **Publish changes**. New page loads use the published content without another code deployment.

Uploads accept JPG, PNG and WebP up to 5 MB, resize to a maximum of 1600 pixels and encode to WebP. Upload only public website imagery. Files are stored under unique paths in the public `website-images` bucket; replacing/removing a photo does not delete the old file. Uploaded but unpublished photos are not linked on the public pages, but their URLs are public. Text embedded inside an image is part of the photo: replace that image if its phone/email text changes.

Edits remain in the current browser page until published; leaving warns about unsaved work. Publish history records the authenticated Admin, time, old/new content and version. Optimistic version checks reject stale publishes from another open editor. Settings or network errors keep the public HTML fallback available. A reload is required to see newly published settings; existing open visitor pages are not changed mid-booking.

## Deployment

Apply the `website_settings` migration, then deploy the updated public pages, shared scripts and admin page together. Public pages require the existing root `config.js` containing the public Supabase URL/key. No service-role key is used in the browser. Updating website contact details does not change authentication emails, staff accounts, notification recipients or text embedded in uploaded photos.

## Checks

- `node tests/website-settings.cjs`: preview before publish, upload validation, publication/conflict handling, denied non-admin UI, mobile layout, public contacts, gallery/lightbox and network fallback.
- `tests/website-settings-permissions.sql`: rollback-only database checks for public read access, admin publishing/storage access, audit/version behavior and denied non-admin/inactive writes.
- Manual after deployment: replace each named photo; verify home, Club House, Pool, Badminton, halls, lawn and Privacy contacts; test tel/mailto/WhatsApp including newly generated booking confirmations; enlarge/reorder gallery photos; inspect mobile and desktop crop; verify reduced-motion gallery; try a second editor to confirm stale publish rejection. Use test content in a staging environment for publish checks.
