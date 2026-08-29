/**
 * Prescription PDF.
 *
 * Built with @react-pdf/renderer, not HTML-to-PDF. Puppeteer and Playwright do
 * not fit inside a Vercel serverless function — Chromium exceeds the bundle
 * limit — and discovering that late means standing up a separate service.
 *
 * Layout follows the client's specification exactly:
 *   FRONT   the prescription — patient, medicine, price, paid status, prescriber
 *           with signature, a dispensing sign-off box, and a collection block
 *           for the person picking it up to print, sign and date.
 *   BACK    the consultation summary, so the dispensing pharmacist can review
 *           the clinical picture before handing anything over.
 *
 * The alert band is his idea and worth keeping: if the patient asked a question
 * or needs to be seen, it prints in a box nobody can miss.
 */

import {
  Document, Page, Text, View, StyleSheet, Image,
} from '@react-pdf/renderer';

const colours = {
  ink: '#191428',
  soft: '#544D6B',
  faint: '#7C7594',
  line: '#DEDAE9',
  brand: '#5B3A8E',
  stop: '#A32E22',
  stopSoft: '#F8E4E1',
};

/*
 * The front and the back are spaced differently on purpose. The front is a
 * form: short labels, fixed fields, read once and signed. The back is a
 * reference sheet of long questions, which is where answers were running into
 * their questions. Giving the front the back's generosity pushed it onto a
 * second sheet and made the document four pages.
 *
 * ── On the typography ─────────────────────────────────────────────────────
 *
 * The previous sheet set 9.5pt body with 4pt of padding on a question row and
 * no gutter at all between the question column and the answer column. On the
 * flu questionnaire that produced twenty-nine rows where a three-line question
 * ran straight into its answer with nothing between them.
 *
 * Three changes carry most of the improvement:
 *
 *   1. A GUTTER. The label column now reserves 16pt of its own width as
 *      padding, so a wrapping question can never touch its answer.
 *   2. ROOM. Rows breathe at 7pt vertical padding rather than 4, and the base
 *      size goes to 10pt — small enough to fit, large enough to read at a
 *      counter under pharmacy lighting.
 *   3. ALIGNMENT. Both columns hang from the top, so a question that wraps to
 *      three lines keeps its answer level with the first line rather than
 *      floating in the middle of it.
 *
 * Margins come in from 40pt to 34pt. A4 is 595pt wide, so that returns 12pt of
 * usable measure to every line without straying inside the 1cm most printers
 * will not reach.
 */
const styles = StyleSheet.create({
  page: { paddingTop: 28, paddingBottom: 34, paddingHorizontal: 34, fontSize: 10, lineHeight: 1.28, color: colours.ink, fontFamily: 'Helvetica' },

  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', borderBottomWidth: 1.5, borderBottomColor: colours.ink, paddingBottom: 9, marginBottom: 2 },
  brand: { fontSize: 16, fontFamily: 'Helvetica-Bold', color: colours.brand },
  addressLine: { fontSize: 8, color: colours.faint, marginTop: 2.5 },
  refBlock: { alignItems: 'flex-end' },
  refLabel: { fontSize: 7, color: colours.faint, textTransform: 'uppercase', letterSpacing: 0.8 },
  refValue: { fontSize: 12, fontFamily: 'Helvetica-Bold', marginTop: 2 },

  sectionTitle: { fontSize: 8, color: colours.faint, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4, marginTop: 12 },

  // Label and value hang from the top so a wrapped label keeps its value level
  // with the first line of the question rather than centred against it.
  row: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 3 },
  label: { width: 116, paddingRight: 14, color: colours.faint },
  value: { flex: 1, fontFamily: 'Helvetica-Bold' },

  panel: { borderWidth: 1, borderColor: colours.line, borderRadius: 4, padding: 9, marginTop: 3 },

  alert: { borderWidth: 1, borderColor: colours.stop, backgroundColor: colours.stopSoft, borderRadius: 4, padding: 9, marginTop: 11 },
  alertTitle: { fontFamily: 'Helvetica-Bold', color: colours.stop, marginBottom: 3, fontSize: 9.5 },
  alertBody: { color: colours.stop, fontSize: 9, lineHeight: 1.45 },

  signBox: { flexDirection: 'row', gap: 14, marginTop: 10 },
  signCell: { flex: 1, borderWidth: 1, borderColor: colours.line, borderRadius: 4, padding: 9, minHeight: 62 },
  signLabel: { fontSize: 7, color: colours.faint, textTransform: 'uppercase', letterSpacing: 0.7, marginBottom: 13 },
  signRule: { borderBottomWidth: 0.8, borderBottomColor: colours.faint, marginBottom: 3 },
  signHint: { fontSize: 6.5, color: colours.faint },
  signature: { width: 120, height: 38, marginTop: 6, marginBottom: 2, objectFit: 'contain' },
  signedRow: { flexDirection: 'row', alignItems: 'center', marginTop: 7, paddingTop: 6, borderTopWidth: 0.6, borderTopColor: colours.line },
  signedLabel: { width: 300, paddingRight: 14, fontSize: 8.5, color: colours.soft },
  patientSignature: { width: 140, height: 32, objectFit: 'contain' },

  footer: { position: 'absolute', bottom: 16, left: 34, right: 34, borderTopWidth: 0.8, borderTopColor: colours.line, paddingTop: 7, flexDirection: 'row', justifyContent: 'space-between' },
  footerText: { fontSize: 7, color: colours.faint },

  // ── The consultation summary ──
  groupTitle: { fontSize: 8.5, fontFamily: 'Helvetica-Bold', color: colours.brand, marginTop: 8, marginBottom: 3 },
  groupRule: { borderBottomWidth: 1, borderBottomColor: colours.brand, marginBottom: 2, opacity: 0.25 },

  /*
   * The summary sets its own, slightly smaller size. The front of the
   * prescription is read once and signed; this side is a reference sheet, and
   * fitting it on one page is what keeps the whole document to two — which the
   * pharmacy pays to print, every time.
   */
  qa: { flexDirection: 'row', alignItems: 'flex-start', borderBottomWidth: 0.6, borderBottomColor: colours.line, paddingVertical: 4, paddingHorizontal: 5, fontSize: 8.5 },
  // Every other row carries the faintest fill. On a page of near-identical
  // rows it is what stops the eye sliding from a question to the wrong answer.
  qaAlt: { backgroundColor: '#FAFAFC' },
  /*
   * A wide question column, because the questions are long.
   *
   * At 224pt, "Do you have a bleeding disorder, including taking any
   * medication that thins your blood?" wrapped to three lines. At 300 it takes
   * two. Across a questionnaire that is most of a page, and the answers are
   * short enough that the narrower value column costs nothing.
   */
  qaLabel: { width: 300, paddingRight: 14, color: colours.soft },
  qaValue: { flex: 1, fontFamily: 'Helvetica-Bold' },

  /*
   * Advice is a list with a rule above it, not a bordered box.
   *
   * A box that runs past the bottom of a page draws its border on both halves
   * and looks broken. The rule is drawn once, above the first item, so a break
   * anywhere in the list is invisible.
   */
  adviceList: { marginTop: 3, borderTopWidth: 0.6, borderTopColor: colours.line, paddingTop: 6 },
  adviceItem: { flexDirection: 'row', marginBottom: 4 },
  adviceText: { flex: 1, fontSize: 8.5, lineHeight: 1.35 },
  bullet: { width: 12, color: colours.faint },
});

export interface PrescriptionData {
  prescriptionNumber: string;
  issuedAt: Date;
  company: { name: string; gphcNumber: string | null; addressLine1: string | null; town: string | null; postcode: string | null };
  branch: { name: string; phone: string | null };
  patient: { fullName: string; dateOfBirth: string; addressLine1: string | null; town: string | null; postcode: string | null; phone: string | null; email: string | null };
  medicine: { name: string; strength: string; directions: string; quantity: string; duration: string };
  price: { amount: string; paid: boolean; method: string | null };
  prescriber: { fullName: string; gphcNumber: string; signatureDataUrl?: string | null };
  /** Printed in a box the dispensing pharmacist cannot miss. */
  alert?: string | null;
  consultation: {
    serviceName: string;
    completedAt: Date;
    outcome: string | null;
    sections: { title: string; entries: { label: string; value: string }[] }[];
    /** The patient's mark, as a data URL. Drawn, not printed as text. */
    patientSignature?: string | null;
    advice: string[];
  };
}

function formatDate(value: Date | string): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Isle_of_Man',
  }).format(date);
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

export function PrescriptionDocument({ data }: { data: PrescriptionData }) {
  const address = [
    data.company.addressLine1,
    data.company.town,
    data.company.postcode,
  ].filter(Boolean).join(', ');

  const patientAddress = [
    data.patient.addressLine1,
    data.patient.town,
    data.patient.postcode,
  ].filter(Boolean).join(', ');

  return (
    <Document
      title={`Prescription ${data.prescriptionNumber}`}
      author={data.company.name}
    >
      {/* ── FRONT — the prescription ─────────────────── */}
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <View>
            <Text style={styles.brand}>{data.company.name}</Text>
            <Text style={styles.addressLine}>{address}</Text>
            <Text style={styles.addressLine}>
              {data.branch.name}
              {data.branch.phone ? ` · ${data.branch.phone}` : ''}
              {data.company.gphcNumber ? ` · GPhC ${data.company.gphcNumber}` : ''}
            </Text>
          </View>
          <View style={styles.refBlock}>
            <Text style={styles.refLabel}>Prescription</Text>
            <Text style={styles.refValue}>{data.prescriptionNumber}</Text>
            <Text style={styles.addressLine}>{formatDate(data.issuedAt)}</Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Patient</Text>
        <View style={styles.panel} wrap={false}>
          <Row label="Name" value={data.patient.fullName} />
          <Row label="Date of birth" value={formatDate(data.patient.dateOfBirth)} />
          {patientAddress ? <Row label="Address" value={patientAddress} /> : null}
          <Row
            label="Contact"
            value={[data.patient.phone, data.patient.email].filter(Boolean).join(' · ') || '—'}
          />
        </View>

        <Text style={styles.sectionTitle}>Medicine</Text>
        <View style={styles.panel} wrap={false}>
          <Row label="Drug" value={data.medicine.name} />
          <Row label="Strength" value={data.medicine.strength} />
          <Row label="Directions" value={data.medicine.directions} />
          <Row label="Quantity" value={data.medicine.quantity} />
          <Row label="Duration" value={data.medicine.duration} />
        </View>

        <Text style={styles.sectionTitle}>Payment</Text>
        <View style={styles.panel} wrap={false}>
          <Row label="Price" value={data.price.amount} />
          <Row
            label="Status"
            value={
              data.price.paid
                ? `PAID${data.price.method ? ` — ${data.price.method}` : ''}`
                : 'TO BE PAID ON COLLECTION'
            }
          />
        </View>

        {data.alert ? (
          <View style={styles.alert} wrap={false}>
            <Text style={styles.alertTitle}>Speak to this patient before handing over</Text>
            <Text style={styles.alertBody}>{data.alert}</Text>
          </View>
        ) : null}

        <Text style={styles.sectionTitle}>Prescriber</Text>
        <View style={styles.panel} wrap={false}>
          <Row label="Name" value={data.prescriber.fullName} />
          <Row label="GPhC number" value={data.prescriber.gphcNumber} />
          {data.prescriber.signatureDataUrl ? (
            <Image style={styles.signature} src={data.prescriber.signatureDataUrl} />
          ) : (
            <View style={{ marginTop: 12 }}>
              <View style={styles.signRule} />
              <Text style={styles.signHint}>Signature</Text>
            </View>
          )}
        </View>

        <View style={styles.signBox} wrap={false}>
          <View style={styles.signCell}>
            <Text style={styles.signLabel}>Checked and dispensed by</Text>
            <View style={styles.signRule} />
            <Text style={styles.signHint}>Name and signature</Text>
            <View style={[styles.signRule, { marginTop: 12 }]} />
            <Text style={styles.signHint}>Date</Text>
          </View>
          <View style={styles.signCell}>
            <Text style={styles.signLabel}>Collected by</Text>
            <View style={styles.signRule} />
            <Text style={styles.signHint}>Print name</Text>
            <View style={[styles.signRule, { marginTop: 12 }]} />
            <Text style={styles.signHint}>Signature and date</Text>
          </View>
        </View>

        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>
            {data.company.name} · {data.branch.name}
          </Text>
          {/* Counted at render. It said "page 1 of 2" whatever the summary
              actually ran to, which on a long questionnaire was simply false. */}
          <Text
            style={styles.footerText}
            render={({ pageNumber, totalPages }) =>
              `${data.prescriptionNumber} · page ${pageNumber} of ${totalPages}`
            }
          />
        </View>
      </Page>

      {/* ── BACK — consultation summary ──────────────── */}
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <View>
            <Text style={styles.brand}>Consultation summary</Text>
            <Text style={styles.addressLine}>
              {data.consultation.serviceName} · {formatDate(data.consultation.completedAt)}
            </Text>
          </View>
          <View style={styles.refBlock}>
            <Text style={styles.refLabel}>Patient</Text>
            <Text style={styles.refValue}>{data.patient.fullName}</Text>
            <Text style={styles.addressLine}>{formatDate(data.patient.dateOfBirth)}</Text>
          </View>
        </View>

        {data.consultation.sections.map((section) => (
          <View key={section.title}>
            {/*
              The heading and its rows flow normally, with two constraints.

              `minPresenceAhead` refuses to print a heading with less than 64pt
              of page beneath it, so a section never starts at the foot of one
              page and continues on the next.

              An earlier version put `wrap={false}` on the whole group instead.
              That kept sections intact but pushed any group that did not fit
              entirely onto the next page — five groups turned a page and a bit
              of content into four pages of mostly white space, which is the
              opposite of the point.
            */}
            <View minPresenceAhead={64}>
              <Text style={styles.groupTitle}>{section.title}</Text>
              <View style={styles.groupRule} />
            </View>
            {section.entries.map((entry, i) => (
              // One row stays whole. A question split from its answer across a
              // page break is the one break that actually misleads.
              <View
                key={entry.label}
                wrap={false}
                style={i % 2 === 1 ? [styles.qa, styles.qaAlt] : styles.qa}
              >
                <Text style={styles.qaLabel}>{entry.label}</Text>
                <Text style={styles.qaValue}>{entry.value}</Text>
              </View>
            ))}
          </View>
        ))}

        {data.consultation.patientSignature ? (
          // Inline rather than in a titled panel of its own. A heading, a
          // border and their margins cost about as much height as the mark
          // itself, and this page has to end on the second sheet.
          <View wrap={false} style={styles.signedRow}>
            <Text style={styles.signedLabel}>Signed by the patient</Text>
            <Image style={styles.patientSignature} src={data.consultation.patientSignature} />
          </View>
        ) : null}

        {data.consultation.advice.length > 0 ? (
          <>
            {/* A heading printed at the very foot of a page, with everything
                it introduces on the next one, reads as a mistake. */}
            <View minPresenceAhead={56}>
              <Text style={styles.sectionTitle}>Advice given</Text>
            </View>
            <View style={styles.adviceList}>
              {data.consultation.advice.map((line) => (
                // Whole, or on the next page. Without this the row itself
                // split: the bullet printed at the foot of one page and its
                // sentence at the top of the next.
                <View key={line} wrap={false} style={styles.adviceItem}>
                  <Text style={styles.bullet}>·</Text>
                  <Text style={styles.adviceText}>{line}</Text>
                </View>
              ))}
            </View>
          </>
        ) : null}

        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>
            This record is retained for five years in line with data protection law.
          </Text>
          <Text
            style={styles.footerText}
            render={({ pageNumber, totalPages }) =>
              `${data.prescriptionNumber} · page ${pageNumber} of ${totalPages}`
            }
          />
        </View>
      </Page>
    </Document>
  );
}
