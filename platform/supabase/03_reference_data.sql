-- ═══════════════════════════════════════════════════════════
-- 03 · Reference data
-- Karsons Pharmacy platform
-- ═══════════════════════════════════════════════════════════
-- Karsons' real data: both branches, all six pharmacists with their GPhC
-- numbers, all eleven GP surgeries with their @gov.im prescription mailboxes,
-- the flu vaccines with real batch numbers, and opening stock.
-- 
-- None of this is personal data. Re-running is safe — every insert is
-- idempotent on its primary key.

begin;

-- Organisation ────────────────────────────────────────────
insert into organisation (id, name, slug) values
  ('e91b8b9a-54e8-55a1-8412-d3ade3da0b53', 'Karsons Pharmacy Group', 'karsons')
  on conflict (id) do nothing;

-- Companies ───────────────────────────────────────────────
-- NOTE: gphc_number is null because the client has not supplied it. The
-- number in the previous build was taken from an Ashcroft screenshot and is
-- not his. It prints on prescriptions, so it must be correct before go-live.
insert into company (id, organisation_id, name, trading_name, gphc_number, town, postcode) values
  ('a6afe63e-ecd1-5a35-a3c8-929f27f787de', 'e91b8b9a-54e8-55a1-8412-d3ade3da0b53', 'Karsons Pharmacy Limited', null, null, 'Onchan', 'IM3 1BA')
on conflict (id) do nothing;

-- Branches ────────────────────────────────────────────────
-- NOTE: Kirk Michael currently uses a personal Gmail address. Clinical mail
-- cannot go out from it — this needs an address on the pharmacy domain.
insert into branch (id, organisation_id, company_id, name, code, address_line1, town, postcode, phone, inbox_email) values
  ('2e9d53ca-ce0a-50a3-9ad0-e639a45741b2', 'e91b8b9a-54e8-55a1-8412-d3ade3da0b53', 'a6afe63e-ecd1-5a35-a3c8-929f27f787de', 'Onchan', 'ONC', '1 Main Road', 'Onchan', 'IM3 1BA', '01624 615150', 'clinic@karsonspharmacy.co.uk'),
  ('91d6d112-e3c0-5676-8b3c-029428a17e97', 'e91b8b9a-54e8-55a1-8412-d3ade3da0b53', 'a6afe63e-ecd1-5a35-a3c8-929f27f787de', 'Kirk Michael', 'KMI', 'Main Road', 'Kirk Michael', 'IM6 1AB', '01624 878545', 'villagepharmacykm@gmail.com')
on conflict (id) do nothing;

-- Pharmacists ─────────────────────────────────────────────
-- Selecting a pharmacist auto-fills their GPhC number on the record.
insert into clinician (id, organisation_id, full_name, gphc_number) values
  ('765b67d1-776d-5019-9ea7-eb19d3412657', 'e91b8b9a-54e8-55a1-8412-d3ade3da0b53', 'Mukunda Measuria', '2077837'),
  ('c114f9d9-f18a-5361-9bad-7dad31bb28f7', 'e91b8b9a-54e8-55a1-8412-d3ade3da0b53', 'Valentin Oancea', '2072600'),
  ('30819bf7-cd8a-5152-a16a-6b54a6201d5a', 'e91b8b9a-54e8-55a1-8412-d3ade3da0b53', 'Haresh Measuria', '2028159'),
  ('17ac8ce2-9f33-5d0b-875f-b462450f961a', 'e91b8b9a-54e8-55a1-8412-d3ade3da0b53', 'Carol Hutchinson', '2032817'),
  ('20a94147-3380-5659-8f2f-d1454e19a5c3', 'e91b8b9a-54e8-55a1-8412-d3ade3da0b53', 'Chs Moura Hermidas', '2204492'),
  ('b501ae1e-c0d9-58e5-a417-75696ec10d8a', 'e91b8b9a-54e8-55a1-8412-d3ade3da0b53', 'Kathryn Ions', '2060816')
on conflict (id) do nothing;

-- GP surgeries ────────────────────────────────────────────
-- The mailbox rides along hidden with the selection and is what the
-- end-of-day notification is addressed to.
insert into gp_surgery (id, organisation_id, name, email) values
  ('41c08df0-09c5-541f-aa13-9b78831745c5', 'e91b8b9a-54e8-55a1-8412-d3ade3da0b53', 'Ballasalla Medical centre', 'Ballasallamedicalcentre@gov.im'),
  ('1d808e41-32fd-585f-8201-6f3c54b73bb7', 'e91b8b9a-54e8-55a1-8412-d3ade3da0b53', 'Castletown Medical centre', 'cmc@gov.im'),
  ('e06bcca7-63cb-57fd-9876-80c152d9d4ab', 'e91b8b9a-54e8-55a1-8412-d3ade3da0b53', 'Hailwood Medical centre', 'Hailwoodmeds@gov.im'),
  ('7cfd41d4-d601-5399-8437-6789fd23e8c5', 'e91b8b9a-54e8-55a1-8412-d3ade3da0b53', 'Finch Hill Health centre', 'finchhill.gp@gov.im'),
  ('42849886-627e-5d5b-b510-26aad5f976de', 'e91b8b9a-54e8-55a1-8412-d3ade3da0b53', 'Kensington Group Practice', 'DHSCKensingtonPrescription@gov.im'),
  ('3ff70869-a568-572a-957f-7b93a189c3d9', 'e91b8b9a-54e8-55a1-8412-d3ade3da0b53', 'Palatine Health centre', 'palatineprescriptions@gov.im'),
  ('1692fb0a-e2f0-5e5e-a89c-b7af91c35c27', 'e91b8b9a-54e8-55a1-8412-d3ade3da0b53', 'Peel Group Practice', 'peeldoctors@gov.im'),
  ('c6b21694-af8d-5bd5-9d5f-3d3b902838b3', 'e91b8b9a-54e8-55a1-8412-d3ade3da0b53', 'Ramsey and Jurby Group Practice', 'RGP.General@gov.im'),
  ('db9128d6-c8b2-5935-9df4-2dde1e0124d2', 'e91b8b9a-54e8-55a1-8412-d3ade3da0b53', 'Snaefell Surgery', 'medicine.snaefell@gov.im'),
  ('f876b27f-26fd-5c7e-873e-15705a36881c', 'e91b8b9a-54e8-55a1-8412-d3ade3da0b53', 'Southern Group Practice', 'sgp@gov.im'),
  ('40e7247e-59ca-5ff5-9258-781ce374024e', 'e91b8b9a-54e8-55a1-8412-d3ade3da0b53', 'Village Walk and Laxey Health centre', 'laxey&villagewalk@gov.im')
on conflict (id) do nothing;

-- Products ────────────────────────────────────────────────
insert into product (id, organisation_id, name, category, allergens) values
  ('5305024c-121f-53a8-a682-eacbc06edd66', 'e91b8b9a-54e8-55a1-8412-d3ade3da0b53', 'Cell Based TIV', 'Influenza vaccine', '[]'::jsonb),
  ('2de217fd-0e91-525b-8ef3-da8680f860e9', 'e91b8b9a-54e8-55a1-8412-d3ade3da0b53', 'Adjuvant TIV', 'Influenza vaccine', '["egg"]'::jsonb),
  ('d80598b7-d363-5ecf-bf00-dcf374aced43', 'e91b8b9a-54e8-55a1-8412-d3ade3da0b53', 'Mounjaro', 'Weight management', '[]'::jsonb),
  ('fec61f90-f1f2-548d-b5b3-5a62d137b487', 'e91b8b9a-54e8-55a1-8412-d3ade3da0b53', 'Wegovy', 'Weight management', '[]'::jsonb)
on conflict (id) do nothing;

-- Batches ─────────────────────────────────────────────────
insert into batch (id, organisation_id, product_id, batch_number, expiry_date) values
  ('be42c896-50be-52dd-85c1-f4275783b03f', 'e91b8b9a-54e8-55a1-8412-d3ade3da0b53', '5305024c-121f-53a8-a682-eacbc06edd66', '3051270', '2026-05-31'),
  ('fbd90626-0740-5dcc-9853-4cdca2702cf0', 'e91b8b9a-54e8-55a1-8412-d3ade3da0b53', '2de217fd-0e91-525b-8ef3-da8680f860e9', '0767711P1', '2026-04-30')
on conflict (id) do nothing;

-- Opening stock ───────────────────────────────────────────
-- Stock is a ledger. The opening balance is a movement like any other, so
-- the cached level can always be reconciled against the movements.
insert into stock_level (id, organisation_id, branch_id, batch_id, quantity) values
  ('0bc5677c-15b3-5db5-95d1-13969405bd6e', 'e91b8b9a-54e8-55a1-8412-d3ade3da0b53', '2e9d53ca-ce0a-50a3-9ad0-e639a45741b2', 'be42c896-50be-52dd-85c1-f4275783b03f', 120),
  ('15354386-e6b8-5868-b6d2-780a37b38737', 'e91b8b9a-54e8-55a1-8412-d3ade3da0b53', '91d6d112-e3c0-5676-8b3c-029428a17e97', 'be42c896-50be-52dd-85c1-f4275783b03f', 80),
  ('a604cc9c-1c2b-58b5-a8ae-1fe879d910cf', 'e91b8b9a-54e8-55a1-8412-d3ade3da0b53', '2e9d53ca-ce0a-50a3-9ad0-e639a45741b2', 'fbd90626-0740-5dcc-9853-4cdca2702cf0', 90),
  ('43d7f95c-1b30-5d19-adee-96b09454e63b', 'e91b8b9a-54e8-55a1-8412-d3ade3da0b53', '91d6d112-e3c0-5676-8b3c-029428a17e97', 'fbd90626-0740-5dcc-9853-4cdca2702cf0', 60)
on conflict (id) do nothing;

insert into stock_movement (id, organisation_id, branch_id, batch_id, kind, quantity, reason) values
  ('913f1e35-1443-57d3-85a8-daeaf65fd43c', 'e91b8b9a-54e8-55a1-8412-d3ade3da0b53', '2e9d53ca-ce0a-50a3-9ad0-e639a45741b2', 'be42c896-50be-52dd-85c1-f4275783b03f', 'RECEIPT', 120, 'Opening stock'),
  ('a602a938-e90a-52de-94de-db4762cf08c0', 'e91b8b9a-54e8-55a1-8412-d3ade3da0b53', '91d6d112-e3c0-5676-8b3c-029428a17e97', 'be42c896-50be-52dd-85c1-f4275783b03f', 'RECEIPT', 80, 'Opening stock'),
  ('2a14517f-a480-55bf-8a91-89d4e4d28fa8', 'e91b8b9a-54e8-55a1-8412-d3ade3da0b53', '2e9d53ca-ce0a-50a3-9ad0-e639a45741b2', 'fbd90626-0740-5dcc-9853-4cdca2702cf0', 'RECEIPT', 90, 'Opening stock'),
  ('991c662c-f561-5364-bd47-80ff3e63be39', 'e91b8b9a-54e8-55a1-8412-d3ade3da0b53', '91d6d112-e3c0-5676-8b3c-029428a17e97', 'fbd90626-0740-5dcc-9853-4cdca2702cf0', 'RECEIPT', 60, 'Opening stock')
on conflict (id) do nothing;

commit;
