# P19 — Article Management, Authoring & Publication Repair

## Scope
Article/content management only. The existing Service implementation was left unchanged unless required for an Article relationship contract.

## Architecture
- `CMSPage` remains the canonical article/content model.
- No `Article` model or duplicate article API was introduced.
- Existing Admin CMS permissions and `AdminActivityLog` are reused.
- Existing public Article serializer is strengthened and reused.
- Existing `RichTextEditor` is reused and upgraded in place.

## Article authoring
- Admin Articles now supports create, draft save, edit, review, publish, archive, preview and guarded delete.
- Mutations require the real backend response and then refetch authoritative state.
- Search/category/status filters are server-backed.
- Existing Doctor and Service records are selected by ID for relationships.

## Publishing safety
- Publish persists `status=published`, `visibility=public`, `isPublished=true`, `publishedAt`, and `publishedBy` together.
- Archive persists `status=archived`, `visibility=private`, `isPublished=false`, `archivedAt`, and `archivedBy` together.
- Published articles must be archived before destructive deletion.
- Normal edits do not silently change lifecycle state.

## Media and content safety
- Canonical CMS banner upload uses multer, MIME/extension validation, file signatures, generated filenames and `/uploads/cms` storage.
- Replaced/deleted local CMS banner files are cleaned up.
- Article content uses an allowlist-oriented sanitizer and public serialization sanitizes stored legacy content as well.
- Public ArticleDetail renders the sanitized canonical content representation.

## Public integration
- Public article list/detail/category endpoints remain publication-filtered.
- Related services are serialized through the canonical Service serializer and only published/public services are exposed.
- Related doctors use the canonical Doctor serializer and only approved/active doctors are exposed.
- Deterministic related-article selection remains based on persisted category/tags/specialties/services.

## Verification
- P19 article repair contract: PASS.
- Existing P19 content contract: PASS.
- Backend syntax validation: PASS for all backend JS/MJS files.
- Locale parity: PASS across English/Hindi/Hinglish.
- Production frontend build: BLOCKED because dependency installation timed out and Vite was not available in the environment.
- MongoDB/browser E2E: NOT VERIFIED in this environment.

P20 is not started.
