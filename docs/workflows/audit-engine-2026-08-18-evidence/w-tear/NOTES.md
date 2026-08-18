# W-TEAR

Live `DELETE /api/demo/simulate` for this file returned **504**. The client was still there after that call. The live file and the old test client were not touched.

The designed teardown (`teardownSimulated`) does not delete contracts, documents, consent, inquiry cases, events, sales, or bank inbox. Those rows blocked deleting the client.

After extra deletes of **this id only**, the client is gone. Known audit rows are gone. No leftover `client_id` rows.

Evidence: `delete-response.json`, `before.json`, `after.json`, `orphans.json`, `local-designed.json`, `local-cleanup.json`, `local-docs.json`, `final.json`.
