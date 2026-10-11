# Official YouTube search in the parent website

Authenticated parents can explicitly search, view up to 20 video results per page, open a video on the official YouTube site, and add an individual video using the existing `mutate` API. Search does not approve anything automatically. Duplicate direct approvals are disabled. Approving a channel already permits its videos; the row's duplicate marker concerns explicit video approvals.

The Edge Function calls YouTube Data API v3 `search.list` with `type=video`, `safeSearch=strict`, Hebrew relevance and IL region. SafeSearch is not a parental approval or a guarantee of suitability. Titles are rendered as text; links are constructed from validated video IDs. Parent session expiry aborts pending requests and prevents late search responses restoring results.

## Activation (not performed by this change)

1. Enable YouTube Data API v3 in a Google Cloud project and create an API key restricted to that API. Set appropriate project quota limits. Search consumes Google's quota; this implementation only searches on an explicit parent action, never with automatic suggestions or automatic retries.
2. Store the key as `YOUTUBE_DATA_API_KEY` in the Supabase project's Edge Function Secrets. Never put it in Git, frontend JavaScript or chat. No key is returned by the endpoint or included in application diagnostics.
3. Deploy the reviewed `supabase/functions/kids-youtube/index.ts` to the existing `kids-youtube` function, then publish the parent website. No database migration or APK installation is required.
4. With a parent session, search and open a result. Only if desired, add it and confirm it appears in the approved list. Do not modify real family approvals merely to test deployment.

Without the secret, the authenticated endpoint returns `503 SEARCH_NOT_CONFIGURED` and the website offers the existing link-add flow. The current production secret configuration has not been inspected and live YouTube search has not been tested.

The outbound API URL is fixed. Requests time out after 8 seconds; response size, page size, query and pagination-token length are bounded. Unauthenticated users cannot consume the search endpoint. The API key is server-side, but quota is shared by authenticated parents; Google-side quotas must remain enabled.

Sources: https://developers.google.com/youtube/v3/docs/search/list and https://supabase.com/docs/guides/functions/secrets
