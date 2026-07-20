import { useSEO } from "@/hooks/useSEO";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CheckCircle2, ChevronRight, Clock, FlaskConical, User, ExternalLink } from "lucide-react";
import { NewsletterSignup } from "@/components/NewsletterSignup";
import { MOCK_INSPECTION_FAQ } from "@/lib/faqContent";

export default function ArticleMockInspectionPage() {
  useSEO({ title: "What Happens During a TJC Laboratory Inspection, 2026 Guide | Veritas Lab Services", description: "A former Joint Commission surveyor walks through a laboratory survey phase by phase, the tour, PT review, records, tracers, personnel, and procedures, and how to rehearse it with a mock inspection." });
  return (
    <div className="min-h-screen bg-background">
      <section className="border-b border-border bg-gradient-to-br from-primary/5 via-transparent to-transparent">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-4">
            <Link href="/resources" className="hover:text-primary transition-colors">Resources</Link>
            <span>/</span>
            <span>Inspection Readiness</span>
          </div>
          <Badge variant="outline" className="mb-4 text-primary border-primary/30 bg-primary/5">Inspection Readiness</Badge>
          <h1 className="font-serif text-3xl sm:text-4xl font-bold tracking-tight mb-4 leading-tight">
            The Anatomy of a Joint Commission Laboratory Survey
          </h1>
          <p className="text-muted-foreground text-lg leading-relaxed mb-6">
            A former surveyor walks through the survey, phase by phase, and shows how to turn it into a mock inspection that finds your gaps first.
          </p>
          <div className="flex items-center gap-5 text-xs text-muted-foreground border-t border-border pt-4">
            <span className="flex items-center gap-1.5"><User size={12} /> Michael Veri, Former Joint Commission Surveyor, CPHQ</span>
            <span className="flex items-center gap-1.5"><Clock size={12} /> 18 min read</span>
            <span>July 2026</span>
          </div>
        </div>
      </section>

      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10">
        <Card className="border-primary/20 bg-primary/5 mb-10">
          <CardContent className="p-5">
            <div className="font-semibold text-sm text-primary mb-3">Key Takeaways</div>
            <ul className="space-y-2">
              {[
                "A mock inspection is a full rehearsal of the real survey, run before it, to surface gaps while there is still time to fix them.",
                "The survey is a method, not a checklist: a recognizable arc, opening, tour, PT and license review, records, tracers, personnel, and summation, with the record review recurring throughout and procedures observed live whenever they happen.",
                "The reviewer is independent of the area under review. You cannot find the gap in a system you built.",
                "Tracers are the defining move. The surveyor follows a real patient from the laboratory result into the clinical chart, and the gap is usually on the clinical side.",
                "A passing PT score is not a perfect score. A passing grade with an incorrect result still needs a documented corrective action.",
              ].map(t => (
                <li key={t} className="flex items-start gap-2 text-sm">
                  <CheckCircle2 size={13} className="text-primary shrink-0 mt-0.5" />
                  <span>{t}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <div className="prose prose-slate dark:prose-invert max-w-none space-y-6 text-[15px] leading-relaxed">
          <p>A laboratory mock inspection is a full rehearsal of an accreditation survey, run by an independent reviewer before the real surveyor arrives, so the laboratory finds its own gaps first. The goal is not to pass the mock. It is to fail it in private, on the items that would otherwise be found in public.</p>
          <p>Most laboratories prepare for a Joint Commission survey by working a checklist. They confirm the binders are current, the policies are signed, the competency files are complete, and then they wait. The surveyor arrives and works nothing like a checklist. A Joint Commission laboratory survey is a method, a specific sequence with a specific logic, carried out over one or more days depending on the size of the laboratory, and the laboratories that do well are the ones that understand the method well enough to rehearse it.</p>
          <p>I conducted more than two hundred of these surveys. What follows is how one actually unfolds, phase by phase, and how to turn that knowledge into a mock inspection that finds your gaps before a surveyor does. The single most useful thing I can tell you is that a mock inspection built on a checklist rehearses the wrong thing. A mock inspection built on the real sequence rehearses the real thing.</p>
          <h2 className="font-serif text-2xl font-bold mt-10 mb-3">What the survey actually is</h2>
          <p>A Joint Commission laboratory survey is an on-site assessment of whether the laboratory meets the current TJC standards for laboratory accreditation and the federal requirements beneath them. What separates the method from a checklist audit is the tracer: rather than only reading records, the surveyor follows real cases through the system, from a result back to the patient and the care team, to see whether the process worked in practice and not only on paper. It runs across one or more days, with the document review returning between other activities and each day after the first opening with a briefing that revisits the findings so far, and in a well-run survey those findings are shared as they emerge rather than held for the end. This walk-through covers the general and clinical laboratory. Anatomic pathology follows the same method with its own document set, from cytology workload and cyto-histo correlation to grossing review and frozen sections, and everything here applies there as well.</p>
          <h2 className="font-serif text-2xl font-bold mt-10 mb-3">The survey, phase by phase</h2>
          <h3 className="font-semibold text-lg mt-8 mb-2">Phase 1: The opening</h3>
          <p>The survey begins as a conversation, not an inspection. The laboratory and the facility describe their services, both the clinical scope of the organization and the testing the laboratory performs, and the surveyor outlines how the survey will be conducted. On a multi-day survey each day after the first opens with a short briefing that revisits the day's plan and the findings taking shape. It sounds procedural, and most labs treat the opening as a formality. It is not. During the opening the surveyor is already deciding which live procedures they will want to observe later, and they are forming a first impression of whether this laboratory understands its own scope. It is also worth knowing that a document you cannot produce in the moment is not necessarily a finding: you generally have until the report is prepared on the final day to put it in front of them. What you cannot do is invent it.</p>
          <p className="rounded-lg border border-emerald-300 bg-emerald-50 dark:bg-emerald-950/30 p-4 my-4 text-sm"><strong>To mock it:</strong> have someone who does not run the lab ask you to describe your services and your full testing footprint from memory, then check what you said against reality. The gaps in that description are often the gaps in the survey.</p>
          <h3 className="font-semibold text-lg mt-8 mb-2">Phase 2: The tour</h3>
          <p>The surveyor then tours every place laboratory testing occurs, with particular attention to non-waived testing. They will walk the main laboratory, but they will also walk the floors, and they will ask questions in the emergency department. I always asked in the ED. I cannot count the number of times I found an emergency department running a test the laboratory had no idea was happening, including a pH on the surface of the eye that no one in the laboratory knew was being performed. Every one of those results lives on the laboratory's CLIA certificate whether the laboratory knows about it or not. The testing you are accountable for includes the testing you have never seen, and it includes the waived testing scattered across the building, the bedside glucose, the occult blood, the urine pregnancy test the ED runs instead of sending to you.</p>
          <p>While the tour is underway, the laboratory should already be laying out its proficiency testing records for the next phase. A survey is a set of parallel tracks, and the laboratory that treats it as a single line loses time it does not have.</p>
          <p className="rounded-lg border border-emerald-300 bg-emerald-50 dark:bg-emerald-950/30 p-4 my-4 text-sm"><strong>To mock it:</strong> physically walk every place a test could be run, and ask each clinical area what they test. You are looking for the rogue glucometer, the ED dipstick, the point of care device nobody registered.</p>
          <h3 className="font-semibold text-lg mt-8 mb-2">Phase 3: Proficiency testing and license review</h3>
          <p>The surveyor reviews the CLIA certificate, any state licensure, and then the proficiency testing records. This phase also covers a few credentials that labs forget are in scope: the laboratory director's own license, board certification, and qualification for the role, and the contracts and documented contract evaluations for your reference laboratories and pathology services, because you are accountable for the testing you send out as well as the testing you keep. The personnel report that lists your testing staff and their responsibilities belongs here too.</p>
          <p>Then the surveyor turns to proficiency testing, and they do not skim. They look at every PT score below one hundred percent, and for each of those they expect to see three things: the attestation, the documented PT review, and the corrective action. The most common finding here is subtle. A score of eighty percent is a passing score for most analytes, so the laboratory files it and moves on, and there is no corrective action on record for the one result that was wrong. A passing score with an incorrect response is still an incorrect response, and the surveyor wants to see that the laboratory investigated it.</p>
          <p>The serious finding is unsuccessful performance. Under CLIA, an analyte that fails to attain a satisfactory score in two of three consecutive testing events is unsuccessful, and it will be cited. There is no discretion there. While the surveyor works the PT records, the laboratory should be gathering the quality control, maintenance, and temperature records for the months the surveyor is about to request.</p>
          <p className="rounded-lg border border-emerald-300 bg-emerald-50 dark:bg-emerald-950/30 p-4 my-4 text-sm"><strong>To mock it:</strong> pull every PT score below one hundred percent for the last two years and confirm that each one has an attestation, a review, and a corrective action. Separately, confirm your own director file and your reference-lab contracts are current, because those are easy to leave a year out of date.</p>
          <h3 className="font-semibold text-lg mt-8 mb-2">Phase 4: Quality control, maintenance, and the rest of the record</h3>
          <p>The surveyor cannot review twenty-four months of daily records in the time they have, so they select three or four months inside the window. This is important to understand: if those months look excellent, the working assumption is that all twenty-four do. If those months look weak, they will ask for more, and the survey gets longer and harder. A small, clean sample buys you the benefit of the doubt on everything you were not asked to show.</p>
          <p>They are looking for documented review of those records once per calendar month, and they are reading the review critically. When a month was signed off as reviewed with no issues, but the record in front of them contains an issue that should have been caught, that is not a quality control finding. That is a finding about the effectiveness of laboratory leadership, and it is a more serious category. A review that misses things is evidence that the review is not real. If you run an individualized quality control plan for any test, expect the risk assessment and the ongoing quality assessment behind it to be reviewed with the same eye, not just the daily runs.</p>
          <p>The word maintenance in the name of this phase is not decoration. The surveyor pulls the maintenance records for your instruments and reads them the way they read the quality control, not to confirm that a schedule exists but to confirm the scheduled work was done and documented on time. Manufacturers define daily, weekly, monthly, quarterly, semiannual, and annual maintenance for every analyzer, and the surveyor checks the timing the same way they check everything else on a clock. Early is never the problem, you can run any of it ahead of schedule; late is the problem, and the ceiling is firm, a monthly task done within the calendar month and a semiannual done any time up to six months plus twenty days. A function check skipped for a month, a preventive maintenance visit that slipped a quarter, a log with a gap no one initialed, all of it reads the same way: the instrument was running on faith. And it is not only the analyzers. The surveyor reaches the equipment a laboratory stops thinking of as equipment, the alarm checks on the blood bank refrigerators and freezers, the blood warmers, the centrifuges, the timers, the pipettes, the thermometers, and the microscopes, each with its own calibration or function check on its own interval.</p>
          <p>Temperature is its own record and its own trap. Every refrigerator, freezer, incubator, water bath, and heat block that touches a reagent or a specimen has a temperature that is monitored and recorded, and the surveyor is less interested in the days that were in range than in the days that were not. An out-of-range temperature with a documented corrective action is a system working. An out-of-range temperature that was logged, initialed, and left alone is the finding, and a month of temperatures signed off as reviewed with an excursion sitting in the middle of it is the same leadership finding as a quality control review that misses things. The alarm checks on the monitored units belong here as well. And in the same family sits the water the laboratory tests with. Reagent-grade water is not assumed to be clean, it is proven clean on a schedule, through the microbial colony counts and the resistivity monitoring that show the water feeding your analyzers and your reagent preparation is within specification. A laboratory that monitors every refrigerator to the degree and never tests its water has left exactly the kind of quiet gap a surveyor is trained to find.</p>
          <p>They will also select a few analytes and pull every correlation and linearity study from the last two years, and they will check the timing against the six-month interval. You can perform them early with no penalty, but the late edge is fixed at six months plus twenty days, and they know that limit to the day. This is also where they look at the verification you performed when you brought a new test or a new instrument online, and at the checks confirming your information system moves results from analyzer to chart without altering them. Reagent and kit lot tracking, lot-to-lot crossover, and reagent labeling sit in the same review.</p>
          <p>And the records review is not only about the bench, though the safety piece a lab surveyor actually owns is narrower than most mock inspections assume. What I looked at directly was hands-on laboratory safety: the eyewash stations and the safety showers, that they are present, accessible, and checked, and whether the staff at the bench were wearing the proper personal protective equipment while they worked. The broader environment-of-care program, the fire drills, the hazardous waste manifests, the emergency operations plan, and the chemical exposure monitoring for formalin and xylene, is real and it is surveyed, but when the hospital carries its own Joint Commission accreditation alongside the laboratory, the lab surveyor leaves that to the hospital survey rather than duplicating it. A standalone laboratory owns all of it. A laboratory that is flawless at quality control but has an eyewash no one checks has still left a flank open. While all of this is happening, the tracers are being assembled.</p>
          <p className="rounded-lg border border-emerald-300 bg-emerald-50 dark:bg-emerald-950/30 p-4 my-4 text-sm"><strong>To mock it:</strong> choose three or four months at random and audit them the way a surveyor would, then ask whether your monthly review would actually have caught what is in them. Pull the maintenance logs for those same months and confirm every scheduled task was done on time, not merely scheduled, and walk your temperature records for the excursion that was logged and never acted on. Confirm your reagent water testing, the microbial counts and the resistivity, is current and in specification. Then lay out every instrument comparison and linearity study for two years and check the dates against the interval, and walk the bench for the safety items the lab survey lands on: an eyewash and a safety shower that are accessible and checked, and staff wearing the right PPE while they work.</p>
          <h3 className="font-semibold text-lg mt-8 mb-2">Phase 5: Tracers</h3>
          <p>Tracers are what define the Joint Commission method, and they are where most of the survey's time and most of its findings live. There will be many of them, across every department, chemistry, hematology, coagulation, microbiology, immunology, blood bank, and the waived testing on the floors, and each one sounds simple. Find a unit of blood that was transfused in the ICU in June. Find a critical troponin in the emergency department in March. Find a transfusion reaction from the fourth quarter. To answer, you have to be able to search your medical record and produce the case quickly, and you need someone who can drive that record system live while the surveyor watches. Your critical value reports will usually get you there, and if you cannot get there, that inability is itself the finding.</p>
          <p>There is an order to this that is worth understanding. A surveyor usually works the records first and the tracers second, because assembling the tracers takes time: someone has to pull nursing together and get a navigator on the medical record. When a laboratory instead starts handing over records and tracer cases piecemeal, in whatever order it can produce them, the two braid together into a scramble, and an experienced surveyor reads that scramble as an early sign the survey is going to go badly. The laboratory that produces its records cleanly first, then brings the tracers when they are ready, is signaling that it is in control of its own house.</p>
          <p>Then comes the part laboratories underestimate. The surveyor does not want the case the way the laboratory sees it in its own internal reports. They want it the way the care team sees it, in the patient record, because they are verifying that the people making decisions can see the reference ranges and the documentation they need. On a critical result, the laboratory will proudly show its documentation of the call to nursing. The surveyor will accept that, then turn to nursing and ask where the documentation is that the ordering provider was notified. That second handoff is where the trail usually goes cold. On a unit of blood, they will ask to see your blood administration policy, and then ask you to show that the vital sign monitoring documented for that specific transfusion matches what your own policy requires.</p>
          <p>They will educate to best practice while they do this, and they will move to the left and the right of what they originally asked. A tracer is never really about the one case. It is a thread they pull, and they pull it in whatever direction the documentation lets them. Make no mistake, they do this fifty times a year. They know exactly what the typical gaps are, and they are very good at finding them.</p>
          <p className="rounded-lg border border-emerald-300 bg-emerald-50 dark:bg-emerald-950/30 p-4 my-4 text-sm"><strong>To mock it:</strong> run your own tracers. Pick a transfusion from three months ago and reconstruct it from the record, not from your laboratory system. Follow a critical value all the way to the provider notification. Pull a unit of blood and lay its vital signs against your own policy, line by line.</p>
          <h3 className="font-semibold text-lg mt-8 mb-2">Phase 6: Personnel</h3>
          <p>Through every phase above, the surveyor is dropping employee names into the conversation. That is deliberate. The expectation is that when the personnel session arrives, those files are already pulled and ready. They will review competency assessments, and they will compare each employee's job description against their actual file. If the job description requires a master's degree, that degree had better be in the file, verified from the primary source rather than taken on faith. They will look at annual training such as HIPAA and bloodborne pathogens. The purview extends as far as mandatory influenza vaccination documentation, though I will tell you honestly that I was never comfortable going there, and not every surveyor will.</p>
          <p className="rounded-lg border border-emerald-300 bg-emerald-50 dark:bg-emerald-950/30 p-4 my-4 text-sm"><strong>To mock it:</strong> as you run your tracers, write down every name that surfaces, then pull exactly those files and check the competency, the job-description match, and the annual training. The names that come up in the cases are the names the surveyor will ask for.</p>
          <h3 className="font-semibold text-lg mt-8 mb-2">Phase 7: Observed procedures</h3>
          <p>This is the one part of the survey that does not wait its turn. It appears here, near the end, only because that is the easiest place to explain it. In the real survey the observed procedures are not a phase at all; they are scattered across every day, on the clinical event's schedule and not the surveyor's, and they are catch as catch can by nature, because a transfusion or an arterial draw or a positive blood culture happens when the patient needs it, not when it is convenient. Remember the procedures the surveyor flagged during the opening. The moment one of them is about to happen, wherever the surveyor is and whatever else is underway, the records review, a tracer, the personnel files, they stop, go watch it live, and then return to what they were doing. I always wanted to see a transfusion from the point of issue through the fifteen-minute vitals. I was watching for the details that policies gloss over. When was the transfusion actually started, when the blood reached the patient's arm, when the line was spiked, or when the pump was turned on? How was identification performed, and was the patient included in that process? I would also watch a phlebotomy and an arterial collection, a positive blood culture being processed, and a point of care glucose. In every case I read the policy first, and then I noted any point where the observed practice departed from it.</p>
          <p className="rounded-lg border border-emerald-300 bg-emerald-50 dark:bg-emerald-950/30 p-4 my-4 text-sm"><strong>To mock it:</strong> watch these same procedures in your own laboratory whenever they next occur, with the policy in your hand, and note every deviation. Watching a transfusion against your own transfusion policy is one of the highest-yield hours you can spend before a survey.</p>
          <h3 className="font-semibold text-lg mt-8 mb-2">Phase 8: The summation conference</h3>
          <p>The survey ends where its findings are laid out. The surveyor presents every Requirement for Improvement identified during the survey and provides the final report. Each finding is scored on the SAFER matrix, the Joint Commission's grid that plots how likely a finding is to cause harm against how widespread it is in your operation, and that placement, not the surveyor's mood, is what determines how urgently you have to respond. In a well-run survey that scoring is not saved for the end: the surveyor places each finding on the matrix as it emerges and walks it through at the daily briefing, in real time after each session, so by the time you reach this conference you have already seen every finding and where it landed. Nothing here should be a surprise. The surprises happen to the laboratories that were working a checklist while the surveyor was working the method.</p>
          <h2 className="font-serif text-2xl font-bold mt-10 mb-3">How to run your own mock inspection</h2>
          <p>The value of understanding the method is that you can run it on yourself, as many times as you want, with the one advantage a real survey never gives you: no Requirement for Improvement at the end. Follow the same sequence.</p>
          <ol className="list-decimal list-outside pl-5 space-y-2 my-4">
            <li>Open with an honest description of your own scope, from memory, and check it against reality.</li>
            <li>Tour for the testing you do not know about, waived testing included, and find the unregistered device.</li>
            <li>Assign an independent reviewer, someone who does not run the area, because you cannot find the gap in a system you built.</li>
            <li>Work your PT records for the imperfect passing scores, and confirm your director file and reference-lab contracts are current.</li>
            <li>Sample three or four months of QC, maintenance, and temperatures, and ask whether your monthly review would truly have caught what is in them. Confirm your reagent water is tested, and check the eyewash, the safety shower, and PPE at the bench.</li>
            <li>Run tracers from the patient record outward, across every department, and follow a critical value all the way to the provider notification.</li>
            <li>Pull the personnel files your tracers named, and check competency, the job-description match, and primary-source-verified credentials.</li>
            <li>Observe your own high-risk procedures against your own policies, line by line.</li>
            <li>Write your own findings, place each one on the same SAFER matrix a surveyor would use, and fix them on your timeline instead of the surveyor's.</li>
          </ol>
          <p>The surveyor's only real advantage is repetition. They see fifty laboratories a year and you see one, so they know where labs break and you have to work to see it. A disciplined mock inspection closes that gap. It lets you see your own laboratory the way someone who has walked two hundred of them would.</p>
          <h2 className="font-serif text-2xl font-bold mt-10 mb-3">From finding to corrective action</h2>
          <p>A finding is only closed when the corrective action is defensible, and a defensible corrective action has three parts: the root cause, the action taken, and the verification that the action worked. Naming the root cause is what separates a real fix from a promise to try harder. The verification of effectiveness is what a surveyor looks for on the next visit. Final sign-off rests with the medical director or designee. A mock inspection that produces findings without corrective actions has only rehearsed the bad news.</p>

          <p>That is the work VeritaAssure™ was built to make repeatable, from the proficiency testing and correlation records a surveyor pulls first to the competency, policy, and readiness documentation the tracers eventually reach. The method in this article works with any tool or none. What matters is that you run it before someone else does.</p>

          <div className="rounded-xl border-2 border-primary/20 bg-primary/5 p-6 my-8">
            <div className="flex items-start gap-3">
              <FlaskConical size={20} className="text-primary shrink-0 mt-0.5" />
              <div>
                <div className="font-semibold text-sm mb-1">VeritaAssure&#8482; keeps your lab survey-ready</div>
                <p className="text-sm text-muted-foreground mb-3">
                  The proficiency testing, correlation, competency, and readiness records a surveyor pulls first, kept current and retrievable in one place.
                </p>
                <Button asChild size="sm" className="bg-primary text-primary-foreground">
                  <Link href="/veritaassure">Explore VeritaAssure&#8482; <ChevronRight size={13} className="ml-1" /></Link>
                </Button>
              </div>
            </div>
          </div>

          <h2 className="font-serif text-2xl font-bold mt-10 mb-3">Frequently Asked Questions</h2>
          {MOCK_INSPECTION_FAQ.map(({ q, a }) => (
            <div key={q} className="border-b border-border py-5 last:border-0">
              <h3 className="font-semibold text-base mb-2">{q}</h3>
              <p className="text-muted-foreground text-sm leading-relaxed">{a}</p>
            </div>
          ))}

          <NewsletterSignup variant="inline" source="article-mock-inspection" />

          <div className="rounded-xl bg-primary text-primary-foreground p-7 mt-10 text-center">
            <FlaskConical size={28} className="mx-auto mb-3 opacity-80" />
            <h3 className="font-serif text-xl font-bold mb-2">Rehearse the method before someone else does</h3>
            <p className="text-primary-foreground/80 text-sm max-w-md mx-auto mb-5">
              VeritaScan&#8482; maps a mock inspection to every standard so you can find your gaps first. See the full VeritaAssure&#8482; suite.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Button asChild size="lg" className="bg-white text-primary hover:bg-white/90 font-semibold">
                <Link href="/veritascan">Explore VeritaScan&#8482; <ChevronRight size={15} className="ml-1" /></Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="border-white/40 text-white hover:bg-white/10">
                <Link href="/veritaassure">Full VeritaAssure&#8482; Suite <ExternalLink size={13} className="ml-1" /></Link>
              </Button>
            </div>
          </div>

          <div className="mt-10 pt-6 border-t border-border">
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-3">References</div>
            <ol className="space-y-1.5 text-xs text-muted-foreground list-decimal list-inside">
              <li>The Joint Commission. Comprehensive Accreditation Manual for Laboratory and Point-of-Care Testing. Laboratory Accreditation Program.</li>
              <li>Code of Federal Regulations. Title 42, Part 493: Laboratory Requirements. <a href="https://www.ecfr.gov/current/title-42/chapter-IV/subchapter-G/part-493" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">ecfr.gov</a></li>
            </ol>
          </div>

          <div className="mt-8 pt-6 border-t border-border flex items-start gap-4">
            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <User size={20} className="text-primary" />
            </div>
            <div>
              <div className="font-semibold text-sm">Michael Veri</div>
              <div className="text-xs text-muted-foreground mb-1">Owner, Veritas Lab Services, LLC &middot; Former Joint Commission Laboratory Surveyor &middot; CPHQ</div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Michael Veri is a former Joint Commission laboratory surveyor who conducted more than 200 facility inspections, and a CPHQ-certified healthcare quality professional. He founded Veritas Lab Services to provide expert consulting and accessible compliance tools to clinical laboratories nationwide.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
