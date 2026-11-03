// The public Terms of Use and Confidentiality Agreement. The text lives in shared/termsOfUse.ts, the same words every
// user accepts in the app (client/src/components/TermsAcceptance.tsx; Michael 2026-11-03, Q141 = 1).
import { TERMS_SECTIONS, TERMS_TITLE, TERMS_VERSION_LABEL } from "@shared/termsOfUse";

const MAIL = "info@veritaslabservices.com";

function withMailLink(text: string) {
  const parts = text.split(MAIL);
  return parts.flatMap((p, i) => (i === 0 ? [p] : [<a key={i} href={`mailto:${MAIL}`} className="text-primary hover:underline">{MAIL}</a>, p]));
}

export default function TermsPage() {
  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-16">
      <h1 className="font-serif text-3xl font-bold mb-2">{TERMS_TITLE}</h1>
      <p className="text-sm text-muted-foreground mb-8">{TERMS_VERSION_LABEL} · Veritas Lab Services, LLC</p>

      <div className="prose prose-sm dark:prose-invert max-w-none space-y-6 text-sm leading-relaxed">
        {TERMS_SECTIONS.map((s) => (
          <section key={s.title}>
            <h2 className="font-semibold text-base mb-2">{s.title}</h2>
            {s.paragraphs.map((p, i) => <p key={i} className={i ? "mt-2" : undefined}>{withMailLink(p)}</p>)}
          </section>
        ))}
      </div>
    </div>
  );
}
