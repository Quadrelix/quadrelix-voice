# Price-update fix — 1 November 2026

The PostgreSQL price-update blocker from the launch review is fixed locally.
The old query assigned `items` twice and wrote the total in a second query.
The replacement updates both nested item fields and the total in one statement,
using the current locked row. Concurrent item additions and price edits retain
all changes and a consistent total.

Both database adapters reject negative/non-finite prices and invalid item indexes.
The API passes the original price into validation so blank strings, booleans and
arrays cannot silently become zero. Numeric price strings remain supported.
Missing items are rejected without changing the transaction.

Validation: all **135 tests passed**, with no skips, using a temporary local
PostgreSQL 18 instance. Coverage includes fractional quantities, missing prices,
zero prices, unchanged cost snapshots and other items, invalid API inputs, and
ten rounds of concurrent price edits and item additions. Production data was not
used. The temporary PostgreSQL instance was stopped after testing.

## Running the checks

From `backend`, `npm test` runs the offline tests. The PostgreSQL test is skipped
unless `TEST_DATABASE_URL` is set explicitly. To include it in PowerShell:

```powershell
$env:TEST_DATABASE_URL = 'postgresql://USER:PASSWORD@127.0.0.1:5432/TEST_DATABASE'
npm test
Remove-Item Env:TEST_DATABASE_URL
```

Use a disposable test database. The integration test creates a uniquely named
schema, directs the real adapter to that schema, and drops it on completion.
It does not load `.env` or use the application's `DATABASE_URL` as test credentials.

This fix does not resolve transaction authorization, edits to finalized sales,
sale/inventory atomicity, or delivery-state handling. Those remain separate
launch-review tasks. The existing voice-acceptance fix also passed its regression
tests in this run. No deployment or Android build was performed.
