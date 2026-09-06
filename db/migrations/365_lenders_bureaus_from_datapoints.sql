-- 365_lenders_bureaus_from_datapoints.sql — the bureau each bank pulls, finally on the row.
--
-- WHAT WAS WRONG. lenders.bureaus_pulled was NULL on all 307 rows. The Client
-- Control Panel already draws "pulls EX" on every apply-door row
-- (client-control-panel.html ~3889) and src/lenders/match.mjs already skips a
-- bank whose bureaus intersect the client's gated ones. Both were built and
-- both were blind, because nothing ever moved the bureau data into the table.
-- Chris, on the live screen 2026-09-06: "it doesn't tell us what bureau they
-- pull from... that's the whole sauce."
--
-- SOURCE. docs/legacy-strong/bank-datapoints-active-banks.md (Alec / Legacy
-- Strong shared datapoints, 26 issuers) matched to lender names by issuer
-- token — FNBO, Elan, First Citizens, Chase and so on. 54 rows come from
-- that. A further 16 come from an exact name match against
-- docs/legacy-strong/inquiry-master-database.csv where that creditor pulls the
-- same bureau in every state it appears in.
--
-- Only NULL rows are written. A value someone set by hand is never overwritten,
-- and re-running this file changes nothing. 237 banks stay NULL because
-- neither source names them; that is a data gap, not a guess to fill.

UPDATE lenders SET bureaus_pulled='EX,TU' WHERE id='97f2ce2d-d996-46ca-80eb-ea2432604aec'::uuid AND bureaus_pulled IS NULL; -- American Express
UPDATE lenders SET bureaus_pulled='EX' WHERE id='e3e26374-f87b-4aad-9f24-10da46206ae3'::uuid AND bureaus_pulled IS NULL; -- AmTrust / FNBO
UPDATE lenders SET bureaus_pulled='EX' WHERE id='f6187d82-1c0d-4c3a-9055-d859e362c790'::uuid AND bureaus_pulled IS NULL; -- AmTrust Bank (0% - FNBO)
UPDATE lenders SET bureaus_pulled='EX,TU,EQ' WHERE id='f16c8dd9-d700-4f68-9d87-e01d4ffdb8de'::uuid AND bureaus_pulled IS NULL; -- Bank of America
UPDATE lenders SET bureaus_pulled='EX,TU,EQ' WHERE id='d9bd0743-5439-4041-bd11-18925ac8ecf3'::uuid AND bureaus_pulled IS NULL; -- Bank of America
UPDATE lenders SET bureaus_pulled='EX,TU' WHERE id='18e55218-21c2-47f5-ae5a-69f079107a08'::uuid AND bureaus_pulled IS NULL; -- BMO Harris
UPDATE lenders SET bureaus_pulled='EX,EQ,TU' WHERE id='c48de3d4-1742-4d32-a474-4c6ea0794b18'::uuid AND bureaus_pulled IS NULL; -- Capital One
UPDATE lenders SET bureaus_pulled='TU' WHERE id='862d48e6-7717-4550-8819-768d35d5b054'::uuid AND bureaus_pulled IS NULL; -- Central Pacific Bank (0% - Elan Financial)
UPDATE lenders SET bureaus_pulled='EX,EQ,TU' WHERE id='9f4d147d-d1c9-4603-b9e3-60cd2ad7c66c'::uuid AND bureaus_pulled IS NULL; -- Chase
UPDATE lenders SET bureaus_pulled='EX,EQ,TU' WHERE id='d1951308-c2d2-4eb9-8890-6a4ad79a22fe'::uuid AND bureaus_pulled IS NULL; -- Chase Bank
UPDATE lenders SET bureaus_pulled='EQ,TU' WHERE id='a48bac63-5eba-431e-a1b5-3ebee8e2883a'::uuid AND bureaus_pulled IS NULL; -- Desert Financial CU
UPDATE lenders SET bureaus_pulled='TU' WHERE id='add28c99-6f94-4559-af91-58b99e62f535'::uuid AND bureaus_pulled IS NULL; -- Elan Financial
UPDATE lenders SET bureaus_pulled='TU' WHERE id='b4a51be8-8b06-4596-849b-a4eab10dc3d2'::uuid AND bureaus_pulled IS NULL; -- Elan Financial (0%
UPDATE lenders SET bureaus_pulled='TU' WHERE id='bed2ca28-4932-408f-bf2c-7b7604ff9c55'::uuid AND bureaus_pulled IS NULL; -- Elan Financial (0% for 20 Months
UPDATE lenders SET bureaus_pulled='TU' WHERE id='d9c5fb93-66df-4f4c-bdb1-007d2492bf7e'::uuid AND bureaus_pulled IS NULL; -- Elan Financial Banks (0% for 20 Months
UPDATE lenders SET bureaus_pulled='TU' WHERE id='232cf381-0313-4d06-b1af-6329725fda27'::uuid AND bureaus_pulled IS NULL; -- Elan Financial Issued Cards (20 months 0%)
UPDATE lenders SET bureaus_pulled='TU' WHERE id='fa17f0e7-853f-4694-b95a-bd73b01c364c'::uuid AND bureaus_pulled IS NULL; -- Elan Financial Issuers
UPDATE lenders SET bureaus_pulled='TU' WHERE id='5bf3fbb9-0282-4c96-8a9b-b117ba51d0fa'::uuid AND bureaus_pulled IS NULL; -- Elan Financial Network
UPDATE lenders SET bureaus_pulled='TU' WHERE id='9cff45c8-14c6-41c4-9669-6ec34cf1f22d'::uuid AND bureaus_pulled IS NULL; -- Elan Financial Partner Banks
UPDATE lenders SET bureaus_pulled='EQ,TU' WHERE id='4f0bd421-8dc6-477b-9fe1-72919a01328c'::uuid AND bureaus_pulled IS NULL; -- ENT Credit Union
UPDATE lenders SET bureaus_pulled='EX' WHERE id='81b2ed6f-f173-4bdd-8122-cd25911503ee'::uuid AND bureaus_pulled IS NULL; -- Fifth Third
UPDATE lenders SET bureaus_pulled='EX' WHERE id='07c3cac4-a7eb-4471-aac7-02d6f106a4d9'::uuid AND bureaus_pulled IS NULL; -- Fifth Third Bank
UPDATE lenders SET bureaus_pulled='EQ' WHERE id='91469996-40e2-4dce-a3ca-98495cde7b82'::uuid AND bureaus_pulled IS NULL; -- First Citizens
UPDATE lenders SET bureaus_pulled='EQ' WHERE id='555a682b-614c-46b7-b509-c3c8ec78589e'::uuid AND bureaus_pulled IS NULL; -- First Citizens Bank
UPDATE lenders SET bureaus_pulled='EQ' WHERE id='746e37fd-4ed1-4dec-b2cd-ee25796b939a'::uuid AND bureaus_pulled IS NULL; -- First Citizens Bank
UPDATE lenders SET bureaus_pulled='EQ' WHERE id='c1ab16ed-057d-441c-8a55-3e65bc4994f0'::uuid AND bureaus_pulled IS NULL; -- First Citizens Bank (0% for 9 months)
UPDATE lenders SET bureaus_pulled='EQ' WHERE id='17ab7999-b5e0-4975-b291-de2ddda74fd6'::uuid AND bureaus_pulled IS NULL; -- First Citizens Bank (Apply in-branch)
UPDATE lenders SET bureaus_pulled='EQ' WHERE id='7ed14d18-7f91-4f05-8246-ed90e43a3dfd'::uuid AND bureaus_pulled IS NULL; -- First Citizens National
UPDATE lenders SET bureaus_pulled='EX' WHERE id='da4b5a4e-30c4-4048-b3d2-a4c87dcab64e'::uuid AND bureaus_pulled IS NULL; -- First National Bank of Omaha (FNBO)
UPDATE lenders SET bureaus_pulled='EX' WHERE id='706b1d71-e6d9-4cc6-bf53-f9bc385df5b4'::uuid AND bureaus_pulled IS NULL; -- FNBO
UPDATE lenders SET bureaus_pulled='EX' WHERE id='96c81cce-c429-4b60-9865-afb8d01c4a36'::uuid AND bureaus_pulled IS NULL; -- FNBO Evergreen
UPDATE lenders SET bureaus_pulled='EX' WHERE id='a1578e03-a031-42f2-bbab-f251ba9d018a'::uuid AND bureaus_pulled IS NULL; -- Garden State Community Bank (FNBO)
UPDATE lenders SET bureaus_pulled='EQ,TU' WHERE id='03c980ba-2095-4fce-9ea7-21947947de78'::uuid AND bureaus_pulled IS NULL; -- Greater Nevada Credit Union
UPDATE lenders SET bureaus_pulled='TU' WHERE id='5e48fb78-d881-41f1-912d-aba133e3baee'::uuid AND bureaus_pulled IS NULL; -- Hawaii National Bank (0% - Elan Financial)
UPDATE lenders SET bureaus_pulled='EQ' WHERE id='41b34dc4-dee7-431f-8983-17ce9ffdaeeb'::uuid AND bureaus_pulled IS NULL; -- KeyBank
UPDATE lenders SET bureaus_pulled='EQ' WHERE id='ecf06810-f808-4d3a-9b52-ce12153812f5'::uuid AND bureaus_pulled IS NULL; -- KeyBank
UPDATE lenders SET bureaus_pulled='TU' WHERE id='491addee-0a25-40fb-ab6f-b530e1d29043'::uuid AND bureaus_pulled IS NULL; -- M&T Bank
UPDATE lenders SET bureaus_pulled='EX' WHERE id='15aec7e5-3999-4100-8741-e17ba77aa6bc'::uuid AND bureaus_pulled IS NULL; -- New York Community Bank (FNBO)
UPDATE lenders SET bureaus_pulled='EX' WHERE id='1fec614c-2caf-4127-913f-935988665a5a'::uuid AND bureaus_pulled IS NULL; -- Ohio Savings Bank (FNBO)
UPDATE lenders SET bureaus_pulled='EX' WHERE id='e5e8b0d8-40d0-48c5-b715-5b568afe81af'::uuid AND bureaus_pulled IS NULL; -- Pacific Premier Bank (0% - FNBO)
UPDATE lenders SET bureaus_pulled='EX' WHERE id='1526be41-5f06-439c-81bb-235517b1a8eb'::uuid AND bureaus_pulled IS NULL; -- Pacific Premier Bank (FNBO)
UPDATE lenders SET bureaus_pulled='TU' WHERE id='4d40ef47-052c-41ef-b239-f572288cc437'::uuid AND bureaus_pulled IS NULL; -- People’s United Bank (Now M&T)
UPDATE lenders SET bureaus_pulled='EX,EQ' WHERE id='e1116896-b321-4970-a04c-22ca5b2eb7a3'::uuid AND bureaus_pulled IS NULL; -- PNC Bank
UPDATE lenders SET bureaus_pulled='EX,EQ' WHERE id='3ed7b3e0-32d2-4008-b373-b571143f119c'::uuid AND bureaus_pulled IS NULL; -- PNC Bank
UPDATE lenders SET bureaus_pulled='EX,EQ' WHERE id='6cd24ce2-1505-4f12-904a-0b9339e8ccb2'::uuid AND bureaus_pulled IS NULL; -- PNC Bank (0% BT only)
UPDATE lenders SET bureaus_pulled='TU,EQ' WHERE id='b4f1327a-7b79-4bee-bc2a-9d93db438c65'::uuid AND bureaus_pulled IS NULL; -- Synovus Bank
UPDATE lenders SET bureaus_pulled='TU,EQ' WHERE id='5b907eac-1808-42e5-8c6f-b1cb9ef2ec6d'::uuid AND bureaus_pulled IS NULL; -- Synovus Bank
UPDATE lenders SET bureaus_pulled='TU' WHERE id='ab57ca53-4e29-46c8-9ecc-bc8f01d0ea7f'::uuid AND bureaus_pulled IS NULL; -- Territorial Savings Bank (0% - Elan Financial)
UPDATE lenders SET bureaus_pulled='EQ' WHERE id='bb1e8cc2-b524-4b50-8d2c-58ee1673b9a4'::uuid AND bureaus_pulled IS NULL; -- Truist
UPDATE lenders SET bureaus_pulled='EQ' WHERE id='2cd3b84c-1a49-4034-9031-1d7bd8e83250'::uuid AND bureaus_pulled IS NULL; -- Truist
UPDATE lenders SET bureaus_pulled='TU,EQ' WHERE id='44625fe4-ac53-4ce4-8209-d82ca751b06b'::uuid AND bureaus_pulled IS NULL; -- US Bank
UPDATE lenders SET bureaus_pulled='TU,EQ' WHERE id='6b2a28ff-bd0f-4bca-8a56-7d781cc53099'::uuid AND bureaus_pulled IS NULL; -- US Bank
UPDATE lenders SET bureaus_pulled='EX,EQ,TU' WHERE id='612158b4-a71c-4b69-b286-b9930d112ced'::uuid AND bureaus_pulled IS NULL; -- Wells Fargo
UPDATE lenders SET bureaus_pulled='EX,EQ,TU' WHERE id='764d53ed-d4c8-4cc0-9224-3060d5852acf'::uuid AND bureaus_pulled IS NULL; -- Wells Fargo
UPDATE lenders SET bureaus_pulled='EQ' WHERE id='95505bbe-0916-4a67-a9fc-2ac23e318856'::uuid AND bureaus_pulled IS NULL; -- Bank of Hawaii
UPDATE lenders SET bureaus_pulled='EX' WHERE id='9c66f732-e793-47c7-945a-0bda38cc94c1'::uuid AND bureaus_pulled IS NULL; -- Bank of the West
UPDATE lenders SET bureaus_pulled='EX' WHERE id='5a5f1635-67ca-47e2-bd1c-9d49bff86775'::uuid AND bureaus_pulled IS NULL; -- Bank of the West
UPDATE lenders SET bureaus_pulled='TU' WHERE id='6a6e8862-34e8-4f09-8285-52c6f720ab08'::uuid AND bureaus_pulled IS NULL; -- Cadence Bank
UPDATE lenders SET bureaus_pulled='EQ' WHERE id='c5cc2bbc-152a-4a89-8050-8a78b443b4a9'::uuid AND bureaus_pulled IS NULL; -- Citizens Bank
UPDATE lenders SET bureaus_pulled='EQ' WHERE id='ac619960-c366-4801-88e9-ee1515872821'::uuid AND bureaus_pulled IS NULL; -- First PREMIER Bank
UPDATE lenders SET bureaus_pulled='TU' WHERE id='56cd4c21-9b81-4b04-898b-795782290d65'::uuid AND bureaus_pulled IS NULL; -- Huntington Bank
UPDATE lenders SET bureaus_pulled='EQ' WHERE id='fe06d6fd-a68b-43a2-8e86-c3994c4b1451'::uuid AND bureaus_pulled IS NULL; -- Independent Bank
UPDATE lenders SET bureaus_pulled='EQ' WHERE id='9fa5f180-e340-47ad-a919-171b5ee773a2'::uuid AND bureaus_pulled IS NULL; -- Mechanics Bank
UPDATE lenders SET bureaus_pulled='EX' WHERE id='03f436d3-35d9-4af1-8a08-128097a9b4a2'::uuid AND bureaus_pulled IS NULL; -- MidFirst Bank
UPDATE lenders SET bureaus_pulled='TU' WHERE id='163944ad-034f-40df-a0b8-e0dce686e7d5'::uuid AND bureaus_pulled IS NULL; -- Premier Bank
UPDATE lenders SET bureaus_pulled='TU' WHERE id='0e6ed92e-ed38-4249-83d9-e561daf4b08a'::uuid AND bureaus_pulled IS NULL; -- Regions Bank
UPDATE lenders SET bureaus_pulled='TU' WHERE id='c09be34c-a91c-4bd7-ac58-744e038a7a24'::uuid AND bureaus_pulled IS NULL; -- Regions Bank
UPDATE lenders SET bureaus_pulled='TU' WHERE id='e9ff8008-6291-4055-b049-432485b8cf93'::uuid AND bureaus_pulled IS NULL; -- Simmons Bank
UPDATE lenders SET bureaus_pulled='EX' WHERE id='e9111831-5859-4033-8872-7295b590e006'::uuid AND bureaus_pulled IS NULL; -- TD Bank
UPDATE lenders SET bureaus_pulled='EX' WHERE id='6ae30a1e-1aa3-4b5d-b2ff-67ab5aeb824a'::uuid AND bureaus_pulled IS NULL; -- TD Bank

DO $$ BEGIN RAISE NOTICE '365: bureaus_pulled now set on % lender(s)', (SELECT count(*) FROM lenders WHERE coalesce(btrim(bureaus_pulled),'')<>''); END $$;
