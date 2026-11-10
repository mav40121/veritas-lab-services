// Linked documents on a VeritaComp record (BUG-116, 2026-11-10): how the paperclip dialog groups them, and what the
// competency PDF prints.
//
// A technical record's documents go with its six CLIA elements. A waived or non-technical record has no elements (a
// waived record holds its 2-of-4 methods, a non-technical one its checklist), yet the dialog always listed Element 1 to
// 6 with the technical element names, and only the technical part of the PDF printed linked documents, so a link added
// to a waived or non-technical record never reached its printout. Those records now have one list for the record as a
// whole, and the PDF prints it after the record's table.
//
// The stored shape is unchanged: competency_element_documents.element_number is NOT NULL and the route takes 1 to 6,
// so a record-level link is stored under element 1 (RECORD_DOCUMENT_ELEMENT). A waived or non-technical record's list
// shows every link it holds whatever element it was stored under, so a link added through the old dialog isn't lost.

export const RECORD_DOCUMENT_ELEMENT = 1;
export const TECHNICAL_ELEMENTS = [1, 2, 3, 4, 5, 6] as const;

export function documentsByElement(programType: string | null | undefined): boolean {
  return programType === "technical";
}

export interface DocumentSection<T> {
  element: number;        // where the dialog's Link button stores a new document
  heading: string;        // "Element 1" or "Supporting documents"
  subheading: string;     // the element's name, or what the record holds
  docs: T[];
}

export function documentSections<T extends { element_number: number }>(
  programType: string | null | undefined,
  docs: T[],
  elementNames: Record<number, string>,
): DocumentSection<T>[] {
  if (documentsByElement(programType)) {
    return TECHNICAL_ELEMENTS.map((n) => ({ element: n, heading: `Element ${n}`, subheading: elementNames[n] ?? "", docs: docs.filter((d) => d.element_number === n) }));
  }
  const subheading = programType === "waived" ? "Evidence for this waived testing record" : "Evidence for this checklist record";
  return [{ element: RECORD_DOCUMENT_ELEMENT, heading: "Supporting documents", subheading, docs: docs.slice() }];
}
