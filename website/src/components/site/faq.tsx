import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { SectionHeading } from "@/components/site/section-heading";
import { FAQS } from "@/lib/content";

export function Faq() {
  return (
    <section id="faq" className="mx-auto max-w-3xl px-6 py-20 sm:py-24">
      <SectionHeading eyebrow="FAQ" title="Frequently asked questions" />

      <Accordion type="single" collapsible className="mt-10">
        {FAQS.map((faq, index) => (
          <AccordionItem key={faq.question} value={`item-${index}`}>
            <AccordionTrigger>{faq.question}</AccordionTrigger>
            <AccordionContent>{faq.answer}</AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </section>
  );
}
