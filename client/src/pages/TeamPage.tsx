import { useSEO } from "@/hooks/useSEO";
import { Badge } from "@/components/ui/badge";
import { ExternalLink, Award, BookOpen, Shield, Star, Newspaper, Handshake, PenLine } from "lucide-react";

const publications = [
  { title: "Co-Own Blood Administration Among Lab, Nursing and Providers", url: "https://www.medlabmag.com/article/2195", journal: "MedicalLab Management" },
  { title: "Laboratory Leadership's View of Accreditation", url: "https://www.medlabmag.com/article/1766", journal: "MedicalLab Management" },
  { title: "Forming a Blood Utilization and Management Program", url: "https://www.medlabmag.com/article/1732", journal: "MedicalLab Management" },
  { title: "Capturing Productivity in the Laboratory", url: "https://www.medlabmag.com/article/1575", journal: "MedicalLab Management" },
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

// David McCormick (added 2026-10-14 at Michael's request). Every line is sourced: the MLM managing-editor role is
// Michael's own statement (2026-10-01), the title is the one on David's signed partnership addendum, and the book
// edit is David's 8/22 "The Book is Done" email. No photo on file yet, so his card keeps the initials tile.
const davidHighlights = [
  { icon: Newspaper, text: "Former Managing Editor, MedicalLab Management magazine" },
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
              <div className="w-48 sm:w-full aspect-[4/5] rounded-2xl bg-primary/10 border-2 border-primary/20 flex items-center justify-center">
                <span className="font-serif text-5xl font-bold text-primary">DM</span>
              </div>
              <div className="text-center sm:text-left">
                <h2 className="font-serif text-2xl font-bold">David McCormick</h2>
                <p className="text-sm text-muted-foreground mt-0.5">Sales Partner</p>
              </div>
            </div>

            <div className="sm:col-span-2 space-y-5">
              <p className="text-foreground leading-relaxed">
                David McCormick is the former managing editor of MedicalLab Management magazine, where he edited the articles laboratory directors and leaders across the country write for their peers.
              </p>
              <p className="text-muted-foreground leading-relaxed">
                At Veritas Lab Services, David handles partnerships and client relationships. He follows up with laboratory leaders who want to learn more about VeritaAssure™ and our consulting work, and he joins Michael on product demonstrations.
              </p>
              <p className="text-muted-foreground leading-relaxed">
                David also edited Michael's forthcoming book, Lab Management 101.
              </p>
              <Highlights title="Background" items={davidHighlights} />
            </div>
          </div>

          {/* Publications */}
          <div className="mt-14">
            <h3 className="font-serif text-xl font-bold mb-1">Publications & Resources</h3>
            <p className="text-sm text-muted-foreground mb-5">Articles by Michael Veri in MedicalLab Management.</p>
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
