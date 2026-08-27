/**
 * Prescription document.
 *
 * Layout follows the client's specification exactly:
 *   - Front: prescription details, price, paid status, prescriber signature,
 *     sign-off block for the dispensing pharmacist, and print/sign/date for
 *     whoever collects.
 *   - Back: consultation summary and the advice given, plus a prominent flag
 *     when the patient asked a question.
 *
 * Rendered with `@react-pdf/renderer`, never Puppeteer. Chromium does not fit in
 * a serverless function and the deploy fails at runtime, not build time — which
 * is a bad way to discover it.
 *
 * Documents are immutable once generated. A correction is a new prescription
 * referencing the original via `supersedesId`; there is no edit path.
 */

import {
  Document,
  Page,
  StyleSheet,
  Text,
  View,
} from '@react-pdf/renderer';

const COLOURS = {
  ink: '#211A2C',
  soft: '#5A5266',
  line: '#D8D4E2',
  brand: '#3E2465',
  amber: '#8A5A12',
  amberBg: '#FDF0DA',
  red: '#B3402E',
  green: '#166B41',
};

const styles = StyleSheet.create({
  page: { padding: 36, fontSize: 9.5, color: COLOURS.ink, fontFamily: 'Helvetica' },

  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderBottomWidth: 2,
    borderBottomColor: COLOURS.brand,
    paddingBottom: 8,
    marginBottom: 14,
  },
  brand: { fontSize: 15, fontFamily: 'Helvetica-Bold', color: COLOURS.brand },
  brandSub: { fontSize: 8, color: COLOURS.soft, marginTop: 2 },
  refBlock: { alignItems: 'flex-end' },
  refNumber: { fontSize: 11, fontFamily: 'Helvetica-Bold' },
  refLabel: { fontSize: 7.5, color: COLOURS.soft, textTransform: 'uppercase', letterSpacing: 0.5 },

  sectionTitle: {
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    color: COLOURS.soft,
    marginBottom: 5,
  },
  section: { marginBottom: 14 },

  row: { flexDirection: 'row', marginBottom: 3 },
  label: { width: 110, color: COLOURS.soft },
  value: { flex: 1, fontFamily: 'Helvetica-Bold' },

  medicineBox: {
    borderWidth: 1.5,
    borderColor: COLOURS.brand,
    borderRadius: 4,
    padding: 12,
    marginBottom: 14,
  },
  medicineName: { fontSize: 14, fontFamily: 'Helvetica-Bold', marginBottom: 2 },
  medicineStrength: { fontSize: 11, color: COLOURS.brand, marginBottom: 8 },

  paymentPaid: {
    backgroundColor: '#DFF3E7',
    color: COLOURS.green,
    padding: 6,
    borderRadius: 3,
    fontFamily: 'Helvetica-Bold',
    textAlign: 'center',
  },
  paymentUnpaid: {
    backgroundColor: COLOURS.amberBg,
    color: COLOURS.amber,
    padding: 6,
    borderRadius: 3,
    fontFamily: 'Helvetica-Bold',
    textAlign: 'center',
  },

  flag: {
    backgroundColor: COLOURS.amberBg,
    borderLeftWidth: 3,
    borderLeftColor: COLOURS.amber,
    padding: 8,
    marginBottom: 12,
  },
  flagTitle: { fontFamily: 'Helvetica-Bold', color: COLOURS.amber, marginBottom: 2 },

  signatureGrid: { flexDirection: 'row', gap: 14, marginTop: 8 },
  signatureBox: {
    flex: 1,
    borderWidth: 1,
    borderColor: COLOURS.line,
    borderRadius: 3,
    padding: 8,
    minHeight: 62,
  },
  signatureLabel: { fontSize: 7.5, color: COLOURS.soft, marginBottom: 4 },
  signatureLine: {
    borderBottomWidth: 0.75,
    borderBottomColor: COLOURS.line,
    marginTop: 16,
    marginBottom: 3,
  },

  adviceItem: { flexDirection: 'row', marginBottom: 4 },
  bullet: { width: 10, color: COLOURS.brand },

  footer: {
    position: 'absolute',
    bottom: 24,
    left: 36,
    right: 36,
    borderTopWidth: 0.75,
    borderTopColor: COLOURS.line,
    paddingTop: 6,
    fontSize: 7,
    color: COLOURS.soft,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
});

export interface PrescriptionData {
  prescriptionNo: string;
  issuedAt: Date;

  patient: {
    fullName: string;
    dateOfBirth: Date;
    address: string;
    nhsNumber?: string | null;
  };

  medicine: {
    name: string;
    strength: string;
    dose: string;
    quantity: string;
    durationMonths?: number | null;
  };

  prescriber: {
    fullName: string;
    gphcNumber: string;
    qualification?: string | null;
  };

  branch: { name: string; address: string; phone?: string | null };

  payment: { amountFormatted: string; status: 'PAID' | 'UNPAID'; method?: string | null };

  consultation: {
    date: Date;
    summary: { question: string; answer: string }[];
    advice: string[];
    /** Surfaced prominently so the dispenser catches it at collection. */
    patientQuestion?: string | null;
    clinicalNote?: string | null;
  };
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

export function PrescriptionDocument({ data }: { data: PrescriptionData }) {
  const paid = data.payment.status === 'PAID';

  return (
    <Document
      title={`Prescription ${data.prescriptionNo}`}
      author="Karsons Pharmacy"
      subject="Private prescription"
    >
      {/* ── Front ───────────────────────────────────────────── */}
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <View>
            <Text style={styles.brand}>Karsons Pharmacy</Text>
            <Text style={styles.brandSub}>
              {data.branch.name} · {data.branch.address}
              {data.branch.phone ? ` · ${data.branch.phone}` : ''}
            </Text>
          </View>
          <View style={styles.refBlock}>
            <Text style={styles.refLabel}>Prescription</Text>
            <Text style={styles.refNumber}>{data.prescriptionNo}</Text>
            <Text style={styles.brandSub}>{formatDate(data.issuedAt)}</Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Patient</Text>
          <Field label="Name" value={data.patient.fullName} />
          <Field label="Date of birth" value={formatDate(data.patient.dateOfBirth)} />
          <Field label="Address" value={data.patient.address} />
          {data.patient.nhsNumber ? <Field label="NHS number" value={data.patient.nhsNumber} /> : null}
        </View>

        <View style={styles.medicineBox}>
          <Text style={styles.medicineName}>{data.medicine.name}</Text>
          <Text style={styles.medicineStrength}>{data.medicine.strength}</Text>
          <Field label="Dose" value={data.medicine.dose} />
          <Field label="Quantity" value={data.medicine.quantity} />
          {data.medicine.durationMonths ? (
            <Field
              label="Supply"
              value={`${data.medicine.durationMonths} month${data.medicine.durationMonths === 1 ? '' : 's'}`}
            />
          ) : null}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Payment</Text>
          <Field label="Amount" value={data.payment.amountFormatted} />
          {data.payment.method ? <Field label="Method" value={data.payment.method} /> : null}
          <View style={{ marginTop: 5 }}>
            <Text style={paid ? styles.paymentPaid : styles.paymentUnpaid}>
              {paid ? 'PAID' : 'PAYMENT DUE ON COLLECTION'}
            </Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Prescriber</Text>
          <Field label="Name" value={data.prescriber.fullName} />
          <Field label="GPhC number" value={data.prescriber.gphcNumber} />
          {data.prescriber.qualification ? (
            <Field label="Qualification" value={data.prescriber.qualification} />
          ) : null}

          <View style={styles.signatureGrid}>
            <View style={styles.signatureBox}>
              <Text style={styles.signatureLabel}>Prescriber signature</Text>
              <View style={styles.signatureLine} />
              <Text style={styles.signatureLabel}>
                {data.prescriber.fullName} · {formatDate(data.issuedAt)}
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Dispensing and collection</Text>
          <View style={styles.signatureGrid}>
            <View style={styles.signatureBox}>
              <Text style={styles.signatureLabel}>Dispensed and checked by</Text>
              <View style={styles.signatureLine} />
              <Text style={styles.signatureLabel}>Name, signature and date</Text>
            </View>
            <View style={styles.signatureBox}>
              <Text style={styles.signatureLabel}>Collected by</Text>
              <View style={styles.signatureLine} />
              <Text style={styles.signatureLabel}>Print name, signature and date</Text>
            </View>
          </View>
        </View>

        <View style={styles.footer} fixed>
          <Text>{data.prescriptionNo}</Text>
          <Text>Karsons Pharmacy · Isle of Man</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>

      {/* ── Back ────────────────────────────────────────────── */}
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <View>
            <Text style={styles.brand}>Consultation summary</Text>
            <Text style={styles.brandSub}>
              {data.patient.fullName} · {formatDate(data.consultation.date)}
            </Text>
          </View>
          <View style={styles.refBlock}>
            <Text style={styles.refNumber}>{data.prescriptionNo}</Text>
          </View>
        </View>

        {/*
          The patient's question is placed first and flagged, because the point
          of recording it is that the dispensing pharmacist catches it at
          collection — not that it exists somewhere in the file.
        */}
        {data.consultation.patientQuestion ? (
          <View style={styles.flag}>
            <Text style={styles.flagTitle}>The patient asked a question</Text>
            <Text>{data.consultation.patientQuestion}</Text>
            <Text style={{ marginTop: 4, fontSize: 8, color: COLOURS.soft }}>
              Please answer this when they collect.
            </Text>
          </View>
        ) : null}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>What the patient told us</Text>
          {data.consultation.summary.map((item, index) => (
            <View key={index} style={styles.row}>
              <Text style={[styles.label, { width: 190 }]}>{item.question}</Text>
              <Text style={styles.value}>{item.answer}</Text>
            </View>
          ))}
        </View>

        {data.consultation.advice.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Advice given</Text>
            {data.consultation.advice.map((item, index) => (
              <View key={index} style={styles.adviceItem}>
                <Text style={styles.bullet}>•</Text>
                <Text style={{ flex: 1 }}>{item}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {data.consultation.clinicalNote ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Clinical note</Text>
            <Text>{data.consultation.clinicalNote}</Text>
          </View>
        ) : null}

        <View style={styles.footer} fixed>
          <Text>{data.prescriptionNo}</Text>
          <Text>This document is a permanent record and must not be altered.</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}
