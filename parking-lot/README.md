# Parking Lot

Files held here are paused work, not active in the build.

## aabbRequirements.ts.parked
- Generated 2026-05-01 from `veritaassure_master_citation_index.xlsx`
  (Accreditor_Orphans sheet, AABB filter) by `gen_requirements_from_xlsx.py`.
- 91 rows. Same shape as `tjcRequirements.ts`, `capRequirements.ts`,
  `colaRequirements.ts`, `cfrRequirements.ts`.
- Removed from `server/routes.ts` `veritapolicyReqSetsForLab` on 2026-05-03 at
  Michael's direction. AABB was added without sign-off; review and approve
  the data shape before re-introducing.
- To re-activate: move back to `server/aabbRequirements.ts`, restore the
  import and dispatch line in `server/routes.ts`, and add AABB to the
  accreditor profile map in `client/src/pages/VeritaPolicyPage.tsx`.
