-- =====================================================================================
-- HighGround database — part 4 of 4: Iowa rule values
-- Each value says how sure we are: verified (checked against a source), recalled (general
-- knowledge, confirm before selling on it) or assumed (a modeling choice).
-- Re-running is safe: values are updated in place.
-- =====================================================================================

insert into public.rule_value (state, key, fy, value, unit, status, source_note, checked_on) values
  -- SF 2472: incremental SAVE cut to school infrastructure, derived by HighGround from the LSA fiscal note
  -- (15 Jul 2026): statewide reduction ÷ FY2026 statewide SAVE of $652.7M. Held at FY2031 level after.
  ('IA','sf2472_save_cut',2027,0.060,'share','verified','LSA final fiscal note 2026-07-15: $38.9M / $652.7M; derivation is HighGround''s own','2026-09-24'),
  ('IA','sf2472_save_cut',2028,0.090,'share','verified','LSA fiscal note: $58.6M / $652.7M','2026-09-24'),
  ('IA','sf2472_save_cut',2029,0.110,'share','verified','LSA fiscal note: $71.7M / $652.7M','2026-09-24'),
  ('IA','sf2472_save_cut',2030,0.162,'share','verified','LSA fiscal note: $105.5M / $652.7M','2026-09-24'),
  ('IA','sf2472_save_cut',2031,0.186,'share','verified','LSA fiscal note: $121.5M / $652.7M; held for later years','2026-09-24'),
  ('IA','statewide_save',2026,652700000,'dollars','verified','LSA fiscal note, FY2026 statewide SAVE estimate','2026-09-24'),
  ('IA','certified_enrollment',2026,480665,'students','verified','Iowa DE certified enrollment as used 2026-09-24; re-verify yearly','2026-09-24'),
  ('IA','taxable_valuation_per_pupil',2026,447221,'dollars','recalled','Statewide average used in samples; re-verify with Iowa DE',null),
  ('IA','ppel_max_rate',null,0.33,'per $1,000','recalled','Board-approved PPEL cap; confirm with DE/DOM',null),
  ('IA','vppel_max_rate',null,1.34,'per $1,000','recalled','Voter-approved PPEL cap; confirm with DE/DOM',null),
  ('IA','vppel_max_years',null,10,'years','recalled','Maximum V-PPEL term; confirm',null),
  ('IA','perl_max_rate',null,0.135,'per $1,000','recalled','Not modeled yet',null),
  ('IA','go_debt_limit_share',null,0.05,'share of actual valuation','recalled','Constitutional debt limit; confirm with bond counsel',null),
  ('IA','go_referendum_threshold',null,0.60,'share of votes','recalled','Supermajority for GO bond referendum; confirm',null),
  ('IA','save_bond_coverage',null,1.20,'ratio','assumed','Screening assumption for SAVE revenue-bond capacity',null),
  ('IA','save_bond_rate',null,0.045,'rate','assumed','Screening assumption',null),
  ('IA','save_bond_years',null,20,'years','assumed','Screening assumption',null),
  ('IA','grant_yield_default',null,0.75,'share','assumed','Default share of grants that reach capital',null)
on conflict (state, key, fy) do update
  set value = excluded.value, unit = excluded.unit, status = excluded.status,
      source_note = excluded.source_note, checked_on = excluded.checked_on;
