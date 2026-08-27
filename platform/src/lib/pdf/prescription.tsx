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

const styles = StyleSheet.create({
  page: { paddingTop: 36, paddingBottom: 44, paddingHorizontal: 40, fontSize: 9.5, color: colours.ink, fontFamily: 'Helvetica' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', borderBottomWidth: 1.5, borderBottomColor: colours.ink, paddingBottom: 10, marginBottom: 14 },
  brand: { fontSize: 15, fontFamily: 'Helvetica-Bold', color: colours.brand },
  addressLine: { fontSize: 8, color: colours.faint, marginTop: 2 },
  refBlock: { alignItems: 'flex-end' },
  refLabel: { fontSize: 7, color: colours.faint, textTransform: 'uppercase', letterSpacing: 0.8 },
  refValue: { fontSize: 11, fontFamily: 'Helvetica-Bold', marginTop: 1 },
  sectionTitle: { fontSize: 7.5, color: colours.faint, textTransform: 'uppercase', letterSpacing: 0.9, marginBottom: 5, marginTop: 14 },
  row: { flexDirection: 'row', marginBottom: 3 },
  label: { width: 96, color: colours.faint },
  value: { flex: 1, fontFamily: 'Helvetica-Bold' },
  panel: { borderWidth: 1, borderColor: colours.line, borderRadius: 4, padding: 10, marginTop: 4 },
  alert: { borderWidth: 1, borderColor: colours.stop, backgroundColor: colours.stopSoft, borderRadius: 4, padding: 9, marginTop: 12 },
  alertTitle: { fontFamily: 'Helvetica-Bold', color: colours.stop, marginBottom: 2, fontSize: 9 },
  alertBody: { color: colours.stop, fontSize: 8.5, lineHeight: 1.4 },
  signBox: { flexDirection: 'row', gap: 14, marginTop: 8 },
  signCell: { flex: 1, borderWidth: 1, borderColor: colours.line, borderRadius: 4, padding: 9, minHeight: 62 },
  signLabel: { fontSize: 7, color: colours.faint, textTransform: 'uppercase', letterSpacing: 0.7, marginBottom: 14 },
  signRule: { borderBottomWidth: 0.8, borderBottomColor: colours.faint, marginBottom: 3 },
  signHint: { fontSize: 6.5, color: colours.faint },
  signature: { width: 110, height: 34, marginTop: 4, marginBottom: 2 },
  footer: { position: 'absolute', bottom: 24, left: 40, right: 40, borderTopWidth: 0.8, borderTopColor: colours.line, paddingTop: 6, flexDirection: 'row', justifyContent: 'space-between' },
  footerText: { fontSize: 7, color: colours.faint },
  qa: { borderBottomWidth: 0.6, borderBottomColor: colours.line, paddingVertical: 4, flexDirection: 'row' },
  qaLabel: { width: 190, color: colours.soft },
  qaValue: { flex: 1, fontFamily: 'Helvetica-Bold' },
  adviceItem: { flexDirection: 'row', marginBottom: 3 },
  bullet: { width: 10, color: colours.faint },
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
    summary: { label: string; value: string }[];
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
        <View style={styles.panel}>
          <Row label="Name" value={data.patient.fullName} />
          <Row label="Date of birth" value={formatDate(data.patient.dateOfBirth)} />
          {patientAddress ? <Row label="Address" value={patientAddress} /> : null}
          <Row
            label="Contact"
            value={[data.patient.phone, data.patient.email].filter(Boolean).join(' · ') || '—'}
          />
        </View>

        <Text style={styles.sectionTitle}>Medicine</Text>
        <View style={styles.panel}>
          <Row label="Drug" value={data.medicine.name} />
          <Row label="Strength" value={data.medicine.strength} />
          <Row label="Directions" value={data.medicine.directions} />
          <Row label="Quantity" value={data.medicine.quantity} />
          <Row label="Duration" value={data.medicine.duration} />
        </View>

        <Text style={styles.sectionTitle}>Payment</Text>
        <View style={styles.panel}>
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
          <View style={styles.alert}>
            <Text style={styles.alertTitle}>Speak to this patient before handing over</Text>
            <Text style={styles.alertBody}>{data.alert}</Text>
          </View>
        ) : null}

        <Text style={styles.sectionTitle}>Prescriber</Text>
        <View style={styles.panel}>
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

        <View style={styles.signBox}>
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
          <Text style={styles.footerText}>
            {data.prescriptionNumber} · page 1 of 2
          </Text>
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

        <Text style={styles.sectionTitle}>Recorded at the consultation</Text>
        <View>
          {data.consultation.summary.map((entry) => (
            <View key={entry.label} style={styles.qa}>
              <Text style={styles.qaLabel}>{entry.label}</Text>
              <Text style={styles.qaValue}>{entry.value}</Text>
            </View>
          ))}
        </View>

        {data.consultation.advice.length > 0 ? (
          <>
            <Text style={styles.sectionTitle}>Advice given</Text>
            <View style={styles.panel}>
              {data.consultation.advice.map((line) => (
                <View key={line} style={styles.adviceItem}>
                  <Text style={styles.bullet}>·</Text>
                  <Text style={{ flex: 1, lineHeight: 1.4 }}>{line}</Text>
                </View>
              ))}
            </View>
          </>
        ) : null}

        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>
            This record is retained for five years in line with data protection law.
          </Text>
          <Text style={styles.footerText}>
            {data.prescriptionNumber} · page 2 of 2
          </Text>
        </View>
      </Page>
    </Document>
  );
}
