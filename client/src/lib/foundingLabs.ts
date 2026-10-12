// client/src/lib/foundingLabs.ts
//
// Founding labs shown on the public /founding-labs page (the page the Pricing page's Founding Lab Program card
// promises: "Your facility name on our Founding Labs page"). A lab's name goes public ONLY through a reviewed change
// to this list, approved by Michael; a logo only with the lab's written marketing approval. The internal record of
// each founding lab is a founding_lab_applications row with status 'accepted' (POST /api/admin/founding-lab/record).

export type FoundingLab = { name: string; location: string; since: string };

export const FOUNDING_LABS: FoundingLab[] = [
  // Michael 2026-10-12: "list them as a founder lab" (Q99 = 1). Customer since 2026-10-07; lab 34.
  { name: "Redington-Fairview General Hospital", location: "Skowhegan, Maine", since: "October 2026" },
];
