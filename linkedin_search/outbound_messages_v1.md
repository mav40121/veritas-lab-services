# Outbound demo-invite messaging templates (v1)

Parking-lot #42, pre-implementation step 5. Drafted 2026-10-04.
Owner: Michael Veri. These are the message bodies for the staged 1st-degree
LinkedIn outreach. This file is step 5 of the pre-implementation checklist;
steps 1 to 4 (contact export, engager cross-reference, bucket build, customer
and COLA dedupe) and the sends themselves are operator-driven and are not done
here.

## Hard rules for every send

- No em dashes anywhere. Commas, colons, hyphens only.
- Verita product names carry the trademark mark on first mention in a message
  (VeritaCheck(TM), VeritaAssure(TM), etc.). If a trademark mark in a casual DM
  reads stiff to you, drop it to plain text, but keep it consistent within a
  message. Flagging this as your call.
- Only ever www URLs. The demo link is www.veritaslabservices.com/demo, never a
  hash route and never a bare apex.
- Vary the body per recipient. LinkedIn spam detection keys on identical bodies
  sent in volume. Every template below ships in 3 to 4 variants for exactly this
  reason. Rotate variants and let the merge fields do real work; do not paste the
  same variant 30 times.
- Pace 20 to 30 per day, well under the ~80 to 100/day 1st-degree cap.
- Do not push Tier 2 until Tier 1 reply rate is a real signal.
- No opening with a hard pitch. Lead with them, not with us.

## Merge fields

- `{{first_name}}` — recipient first name
- `{{engagement_ref}}` — the specific post/comment/share (Tier 1 only), e.g.
  "your comment on the reference-interval post"
- `{{module}}` — the VeritaAssure module that matches their pain, e.g.
  "VeritaCheck" for method comparison / verification, "VeritaComp" for
  competency, "VeritaPolicy/VeritaDC" for document control, "VeritaQC" for QC
- `{{role_noun}}` — how they would describe their own work, e.g. "QC program",
  "competency program", "survey prep"
- `{{org_first_name}}` — their lab or health system short name, when natural

---

## Tier 1 — Engagers + role match (highest conversion)

Reference the specific engagement, align to one module, offer a 30-minute
walkthrough. Warm, specific, no hype. One module per message, not a feature list.

**T1-A**
> Hi {{first_name}}, {{engagement_ref}} got me thinking. That is exactly the
> workflow VeritaCheck(TM) was built around. Would a 30-minute walkthrough be
> useful? No pitch, I would just show you the menu-to-studies flow and you can
> tell me where it would or would not fit your {{role_noun}}.

**T1-B**
> {{first_name}}, I appreciated {{engagement_ref}}. I have been building out the
> verification side of VeritaAssure(TM) and it lines up closely with what you
> raised. Open to a quick screen share sometime? 30 minutes, your questions drive
> it.

**T1-C**
> Hi {{first_name}}, your note on {{engagement_ref}} is the kind of thing
> {{module}} handles directly. If it is helpful I can walk you through it live in
> about half an hour and you can judge it against what you run today.

**T1-D** (shorter, for very warm contacts)
> {{first_name}}, {{engagement_ref}} is squarely what {{module}} does. Want a
> 30-minute look? Happy to work around your schedule.

---

## Tier 2 — Role match, no engagement

Soft intro anchored on the content arc and the Lab Management 101 release, then
a low-pressure demo offer. No assumption of prior interaction.

**T2-A**
> Hi {{first_name}}, we connected a while back and I wanted to reach out properly.
> I have been writing on lab quality and verification for lab directors, and just
> put out Lab Management 101. Alongside that I built VeritaAssure(TM), a
> compliance and operations toolset for labs. If survey prep or verification is on
> your plate, I am glad to show you {{module}} in about 30 minutes. No obligation.

**T2-B**
> {{first_name}}, hope things are going well at {{org_first_name}}. I have spent
> the last stretch building VeritaAssure(TM) for the regulatory and QC side of
> lab operations, and writing Lab Management 101 to go with it. Would a short
> walkthrough be worth your time? I can tailor it to whatever is most live for
> you right now.

**T2-C**
> Hi {{first_name}}, quick note from one lab person to another. I have been
> publishing on verification, QC, and survey readiness, and the software behind it
> is VeritaAssure(TM). If any of that maps to what you are dealing with, I would
> be happy to show you the relevant piece in 30 minutes.

**T2-D**
> {{first_name}}, I will keep this short. I build compliance software for labs
> (VeritaAssure(TM)) and write about the same topics for lab leaders. If you want,
> I can give you a focused 30-minute look at the part that fits your lab. If the
> timing is off, no worries at all.

---

## Tier 3 — Allied roles (QC managers, supervisors, POC coordinators)

Position as a tool that makes their work easier in support of their director.
Demo or trial, lighter ask than Tier 1/2.

**T3-A**
> Hi {{first_name}}, a lot of what I build is aimed at making the day-to-day
> easier for the people actually running {{role_noun}}, not just the director on
> paper. VeritaAssure(TM) handles the documentation and verification grind. If you
> think it could save your team time, I am glad to show you or set you up with a
> trial.

**T3-B**
> {{first_name}}, you are closer to the bench than most of who I talk to, which is
> exactly who VeritaAssure(TM) is meant to help. Would a short walkthrough of
> {{module}} be useful? If it is a fit, it is the kind of thing you could bring to
> your director already vetted.

**T3-C**
> Hi {{first_name}}, I built {{module}} to take the manual load off the people who
> keep the lab compliant behind the scenes. Happy to give you a quick look or a
> trial login so you can try it against real work, no strings.

---

## Tier 4 — Adjacent (consultants, accreditor staff, IVD vendors)

Influencer audience, not buyers. "fyi this exists" framing, no hard demo push.
These are for word-of-mouth and referral reach.

**T4-A**
> Hi {{first_name}}, mostly an fyi since you see a lot of labs. I built
> VeritaAssure(TM), a compliance and operations toolset for clinical labs. If it
> ever comes up with someone you work with, happy to walk you through it so you
> know what it does. No pitch intended.

**T4-B**
> {{first_name}}, you are plugged into this space, so I wanted you to know
> VeritaAssure(TM) exists. It covers verification, QC, competency, and document
> control for labs. If it is ever useful to point someone my way, I would
> appreciate it, and I am glad to give you the tour first.

**T4-C**
> Hi {{first_name}}, no ask here, just keeping people I respect in the loop. I
> have been building VeritaAssure(TM) for lab compliance and operations. If you
> are ever curious what it looks like, say the word.

---

## Reply-handling quick reference (operator-side, at send time)

- A "yes / tell me more" goes to booking a 30-minute demo. Honor the calendar
  blackout dates and the one-hour default demo length from the demo-booking
  protocol.
- Dedupe against the COLA cohort and the active pipeline by domain before any
  batch, so a named prospect is not double-touched.
- Log every send in the working CSV (name, URL, role, tier, variant used, sent
  date, replied, demo booked, outcome), per step 3 of the pre-implementation
  checklist.

## What still needs Michael before this campaign runs

- Steps 1 to 4 of the pre-implementation checklist: the LinkedIn data export,
  the engager cross-reference, the Tier 1 to 4 bucket build, and the
  customer/COLA/opt-out dedupe. These need his LinkedIn export and are not
  agent-doable from here.
- The implementation triggers in the parking lot: Lab Management 101 shipped,
  Tier 1 size at 50+, COLA outreach concluded, and 2 to 3 hours/week available to
  drive batches. Confirm these are met before lift-off.
