import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ExternalLink, Award, BookOpen, Shield, Star } from "lucide-react";

const publications = [
  { title: "Co-Own Blood Administration Among Lab, Nursing and Providers", url: "https://www.medlabmag.com/article/2195", journal: "Medical Lab Management" },
  { title: "Laboratory Leadership's View of Accreditation", url: "https://www.medlabmag.com/article/1766", journal: "Medical Lab Management" },
  { title: "Forming a Blood Utilization and Management Program", url: "https://www.medlabmag.com/article/1732", journal: "Medical Lab Management" },
  { title: "Capturing Productivity in the Laboratory", url: "https://www.medlabmag.com/article/1575", journal: "Medical Lab Management" },
];

const credentials = [
  { icon: Award, text: "MBA - Master of Business Administration" },
  { icon: Award, text: "MS - Master of Science in Chemistry" },
  { icon: Award, text: "MLS (ASCP) - Medical Laboratory Scientist" },
  { icon: Award, text: "CPHQ - Certified Professional in Healthcare Quality" },
  { icon: Shield, text: "4 years as Joint Commission (TJC) Surveyor" },
  { icon: Star, text: "200+ healthcare facility inspections" },
  { icon: BookOpen, text: "Author, Lab Management 101 (forthcoming)" },
  { icon: BookOpen, text: "30-episode free webinar series on lab management" },
  { icon: Star, text: "Founder, VeritaAssure compliance software suite" },
];

export default function TeamPage() {
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

      {/* Michael Veri */}
      <section className="section-padding">
        <div className="container-default max-w-4xl">
          <div className="grid sm:grid-cols-3 gap-10 items-start">
            {/* Portrait placeholder with initials */}
            <div className="flex flex-col items-center sm:items-start gap-4">
              <div className="w-36 h-36 rounded-2xl bg-primary/10 border-2 border-primary/20 flex items-center justify-center">
                <span className="font-serif text-4xl font-bold text-primary">MV</span>
              </div>
              <div className="text-center sm:text-left">
                <h2 className="font-serif text-2xl font-bold">Michael Veri</h2>
                <p className="text-sm text-primary font-medium mt-0.5">MBA, MS, CPHQ, MLS (ASCP)</p>
                <p className="text-sm text-muted-foreground mt-0.5">Owner & CEO</p>
              </div>
              <a href="mailto:info@veritaslabservices.com" className="text-sm text-primary hover:underline">info@veritaslabservices.com</a>
            </div>

            <div className="sm:col-span-2 space-y-5">
              <p className="text-foreground leading-relaxed">
                I became a laboratory director without ever being taught how. That experience, the gap between clinical training and compliance responsibility, is why I built VeritaAssure.
              </p>
              <p className="text-muted-foreground leading-relaxed">
                Michael is a distinguished US Army veteran with 22 years of service and over a decade of director-level leadership in the civilian healthcare sector. Leveraging four years as a Joint Commission (TJC) Surveyor, he has conducted regulatory and compliance inspections at more than 200 healthcare facilities across the country.
              </p>
              <p className="text-muted-foreground leading-relaxed">
                In 2026, Michael founded VeritaAssure, a clinical laboratory compliance software suite built directly from his inspection experience. VeritaCheck, VeritaMap, VeritaScan, and VeritaComp are live and available at veritaslabservices.com, giving laboratory directors the documentation infrastructure that most labs have never had.
              </p>

              {/* Credentials */}
              <div>
                <h3 className="font-semibold text-sm mb-3 text-foreground">Credentials & Experience</h3>
                <div className="grid sm:grid-cols-2 gap-2">
                  {credentials.map(({ icon: Icon, text }) => (
                    <div key={text} className="flex items-start gap-2 text-sm">
                      <Icon size={13} className="text-primary shrink-0 mt-0.5" />
                      <span className="text-muted-foreground">{text}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Publications */}
          <div className="mt-14">
            <h3 className="font-serif text-xl font-bold mb-5">Publications & Resources</h3>
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
