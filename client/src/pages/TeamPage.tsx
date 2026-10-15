import { useSEO } from "@/hooks/useSEO";
import { Badge } from "@/components/ui/badge";
import { ExternalLink, Award, BookOpen, Shield, Star, Newspaper, Handshake, PenLine } from "lucide-react";

const publications = [
  { title: "Co-Own Blood Administration Among Lab, Nursing and Providers", url: "https://www.medlabmag.com/article/2195", journal: "Medical Lab Management" },
  { title: "Laboratory Leadership's View of Accreditation", url: "https://www.medlabmag.com/article/1766", journal: "Medical Lab Management" },
  { title: "Forming a Blood Utilization and Management Program", url: "https://www.medlabmag.com/article/1732", journal: "Medical Lab Management" },
  { title: "Capturing Productivity in the Laboratory", url: "https://www.medlabmag.com/article/1575", journal: "Medical Lab Management" },
];

const credentials = [
  { icon: Award, text: "MS - Master of Science in Chemistry" },
  { icon: Award, text: "MBA - Master of Business Administration" },
  { icon: Award, text: "MLS (ASCP) - Medical Laboratory Scientist" },
  { icon: Award, text: "CPHQ - Certified Professional in Healthcare Quality" },
  { icon: Shield, text: "Former Joint Commission (TJC) Surveyor (4 years)" },
  { icon: Star, text: "200+ healthcare facility inspections" },
  { icon: BookOpen, text: "Author, Lab Management 101 (forthcoming)" },
  { icon: BookOpen, text: "30-episode free webinar series on lab management" },
  { icon: Star, text: "Founder, VeritaAssure™ compliance software suite" },
];

// David McCormick (added 2026-10-14 at Michael's request). His bio is his own blurb ("David McCormick_VLS_blurb.docx",
// emailed to info@ 10/14), changed only for house rules: the em dash became a comma and VeritaAssure carries ™.
// Title "Sales Partner" is Michael's pick (Q190 = 1), the title on David's signed partnership addendum. Headshot is the
// photo David emailed to info@ 10/14 ("Dmc headshot", DM Headshot.jpeg), served from /public as-is.
const davidHighlights = [
  { icon: Newspaper, text: "Co-founder, Medical Lab Management magazine (2012)" },
  { icon: Handshake, text: "Partnerships and client relationships, Veritas Lab Services" },
  { icon: PenLine, text: "Editor, Lab Management 101 (forthcoming)" },
];

function Highlights({ title, items }: { title: string; items: { icon: typeof Award; text: string }[] }) {
  return (
    <div>
      <h3 className="font-semibold text-sm mb-3 text-foreground">{title}</h3>
      <div className="grid sm:grid-cols-2 gap-2">
        {items.map(({ icon: Icon, text }) => (
          <div key={text} className="flex items-start gap-2 text-sm">
            <Icon size={13} className="text-primary shrink-0 mt-0.5" />
            <span className="text-muted-foreground">{text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function TeamPage() {
    useSEO({ title: "Our Team | Veritas Lab Services", description: "Meet the Veritas Lab Services team: founder Michael Veri, MS, MBA, MLS(ASCP), CPHQ, a former Joint Commission surveyor, and David McCormick." });
return (
    <div>
      {/* Header */}
      <section className="border-b border-border bg-secondary/20">
        <div className="container-default py-14">
          <Badge variant="outline" className="mb-4 text-primary border-primary/30">Our Team</Badge>
          <h1 className="font-serif text-4xl font-bold mb-3">Meet the Team</h1>
          <p className="text-muted-foreground text-lg max-w-xl">The people behind Veritas Lab Services.</p>
        </div>
      </section>

      <section className="section-padding">
        <div className="container-default max-w-4xl">
          {/* Michael Veri */}
          <div className="grid sm:grid-cols-3 gap-10 items-start" data-testid="team-member-michael">
            <div className="flex flex-col items-center sm:items-start gap-4">
              {/* Same headshot as Michael's LinkedIn profile; 900x991 portrait served from /public */}
              <img
                src="/michael-veri.jpg"
                alt="Michael Veri, MS, MBA, MLS(ASCP), CPHQ"
                className="w-48 sm:w-full aspect-[4/5] object-cover object-top rounded-2xl border border-border shadow-sm"
                width={900}
                height={991}
                data-testid="team-photo-michael"
              />
              <div className="text-center sm:text-left">
                <h2 className="font-serif text-2xl font-bold">Michael Veri</h2>
                <p className="text-sm text-primary font-medium mt-0.5">MS, MBA, MLS(ASCP), CPHQ</p>
                <p className="text-sm text-muted-foreground mt-0.5">Owner & CEO</p>
              </div>
              <a href="mailto:info@veritaslabservices.com" className="text-sm text-primary hover:underline">info@veritaslabservices.com</a>
            </div>

            <div className="sm:col-span-2 space-y-5">
              <p className="text-foreground leading-relaxed">
                I became a laboratory director without ever being taught how. That experience, the gap between clinical training and compliance responsibility, is why I built VeritaAssure™.
              </p>
              <p className="text-muted-foreground leading-relaxed">
                Michael is a distinguished US Army veteran with 22 years of service and over a decade of director-level leadership in the civilian healthcare sector. Leveraging four years as a Joint Commission (TJC) Surveyor, he has conducted regulatory and compliance inspections at more than 200 healthcare facilities across the country.
              </p>
              <p className="text-muted-foreground leading-relaxed">
                In 2026, Michael founded VeritaAssure™, a clinical laboratory compliance software suite built directly from his inspection experience. The eighteen-module suite is live at veritaslabservices.com, giving laboratory directors the documentation infrastructure that most labs have never had.
              </p>
              <Highlights title="Credentials & Experience" items={credentials} />
            </div>
          </div>

          {/* David McCormick */}
          <div className="grid sm:grid-cols-3 gap-10 items-start mt-14 pt-14 border-t border-border" data-testid="team-member-david">
            <div className="flex flex-col items-center sm:items-start gap-4">
              {/* David's own headshot, emailed 10/14; 427x640 portrait served from /public */}
              <img
                src="/david-mccormick.jpg"
                alt="David McCormick, Sales Partner"
                className="w-48 sm:w-full aspect-[4/5] object-cover object-top rounded-2xl border border-border shadow-sm"
                width={427}
                height={640}
                data-testid="team-photo-david"
              />
              <div className="text-center sm:text-left">
                <h2 className="font-serif text-2xl font-bold">David McCormick</h2>
                <p className="text-sm text-muted-foreground mt-0.5">Sales Partner</p>
              </div>
              <a href="mailto:info@veritaslabservices.com" className="text-sm text-primary hover:underline">info@veritaslabservices.com</a>
            </div>

            <div className="sm:col-span-2 space-y-5">
              <p className="text-foreground leading-relaxed">
                I co-founded Medical Lab Management magazine in 2012 after 5 years’ writing and editing for a trade magazine covering clinical pharmacy operations. The impetus to launch MLM was sparked by several eye-opening conversations held at what was then called the “ThinkLab” tradeshow (later, KnowledgeLab) hosted by the Clinical Laboratory Management Association (CLMA). I had the great fortune of meeting several luminaries at that show who helped me understand the knowledge gaps that existed in the practice of clinical and anatomic laboratorians. Additional encounters at AABB’s Annual Meeting, ASM Microbe, the AACC (now ADLM) Annual Meeting & Clinical Lab Expo, and the AMP Annual Meeting & Expo, among others, further fostered the need for a strictly peer-to-peer model of coverage focusing on improving the standing of laboratorians of all ranks in the healthcare continuum and amplifying their success stories.
              </p>
              <p className="text-muted-foreground leading-relaxed">
                After meeting Michael Veri at one such show in 2015, he quickly became a trusted author and advisor for our publication, as well as a friend. When he approached me in early 2026 to potentially join his exciting new software platform endeavor (and to edit his excellent forthcoming book on laboratory management, Lab Management 101) I was both excited and honored. The breadth, power, and clarity of the VeritaAssure™ platform is nothing short of astonishing. I hope to use my many years of covering and editing articles in MLM to help spread this word. Please feel free to contact me with any questions.
              </p>
              <Highlights title="Background" items={davidHighlights} />
            </div>
          </div>

          {/* Publications */}
          <div className="mt-14">
            <h3 className="font-serif text-xl font-bold mb-1">Publications & Resources</h3>
            <p className="text-sm text-muted-foreground mb-5">Articles by Michael Veri in Medical Lab Management.</p>
            <div className="space-y-3">
              {publications.map(({ title, url, journal }) => (
                <a key={url} href={url} target="_blank" rel="noopener noreferrer"
                  className="flex items-start justify-between gap-4 p-4 rounded-lg border border-border hover:border-primary/30 hover:bg-secondary/50 transition-colors group">
                  <div>
                    <p className="text-sm font-medium group-hover:text-primary transition-colors">{title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{journal}</p>
                  </div>
                  <ExternalLink size={13} className="shrink-0 mt-0.5 text-muted-foreground" />
                </a>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
