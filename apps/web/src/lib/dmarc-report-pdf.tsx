import { Document, Page, StyleSheet, Text, View, renderToBuffer } from '@react-pdf/renderer';
import React from 'react';

const styles = StyleSheet.create({
  page: { padding: 36, fontSize: 10, color: '#111' },
  header: { marginBottom: 16 },
  h1: { fontSize: 18, fontWeight: 700 },
  subtle: { fontSize: 9, color: '#666' },
  section: { marginTop: 16 },
  h2: { fontSize: 12, fontWeight: 700, marginBottom: 6 },
  statsRow: { flexDirection: 'row', gap: 12 },
  stat: { flex: 1, padding: 8, border: '1pt solid #ddd', borderRadius: 4 },
  statLabel: { fontSize: 8, color: '#666', textTransform: 'uppercase' },
  statValue: { fontSize: 14, fontWeight: 700, marginTop: 2 },
  table: { marginTop: 6 },
  row: { flexDirection: 'row', borderBottom: '0.5pt solid #ddd', paddingVertical: 4 },
  rowHead: { flexDirection: 'row', borderBottom: '1pt solid #999', paddingBottom: 4, marginBottom: 2 },
  cell: { flex: 1, fontSize: 9 },
  cellRight: { flex: 1, fontSize: 9, textAlign: 'right' },
  cellWide: { flex: 2, fontSize: 9 },
  footer: { position: 'absolute', left: 36, right: 36, bottom: 24, fontSize: 8, color: '#888', textAlign: 'center' },
});

export interface PdfReport {
  orgName: string;
  receivedAt: Date;
  totalMessages: number | null;
  passCount: number | null;
  failCount: number | null;
}

export interface PdfSourceIp {
  sourceIp: string;
  total: number;
  spfPass: number;
  dkimPass: number;
  quarantine: number;
  reject: number;
}

export interface DmarcReportPdfProps {
  domain: string;
  windowDays: number;
  generatedAt: Date;
  totals: {
    reports: number;
    messages: number;
    pass: number;
    fail: number;
    passRate: number | null;
  };
  sourceIps: PdfSourceIp[];
  reports: PdfReport[];
}

function formatNumber(n: number | null | undefined) {
  if (n == null) return '—';
  return n.toLocaleString('en-US');
}

function DmarcReportDocument(props: DmarcReportPdfProps) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.h1}>MxWatch DMARC report</Text>
          <Text style={styles.subtle}>
            {props.domain} · last {props.windowDays} days · generated {props.generatedAt.toISOString()}
          </Text>
        </View>

        <View style={styles.statsRow}>
          <View style={styles.stat}>
            <Text style={styles.statLabel}>Reports</Text>
            <Text style={styles.statValue}>{formatNumber(props.totals.reports)}</Text>
          </View>
          <View style={styles.stat}>
            <Text style={styles.statLabel}>Messages</Text>
            <Text style={styles.statValue}>{formatNumber(props.totals.messages)}</Text>
          </View>
          <View style={styles.stat}>
            <Text style={styles.statLabel}>Pass rate</Text>
            <Text style={styles.statValue}>
              {props.totals.passRate != null ? `${(props.totals.passRate * 100).toFixed(1)}%` : '—'}
            </Text>
          </View>
          <View style={styles.stat}>
            <Text style={styles.statLabel}>Fail</Text>
            <Text style={styles.statValue}>{formatNumber(props.totals.fail)}</Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.h2}>Source IP breakdown</Text>
          {props.sourceIps.length > 0 ? (
            <View style={styles.table}>
              <View style={styles.rowHead}>
                <Text style={styles.cellWide}>Source IP</Text>
                <Text style={styles.cellRight}>Messages</Text>
                <Text style={styles.cellRight}>SPF pass</Text>
                <Text style={styles.cellRight}>DKIM pass</Text>
                <Text style={styles.cellRight}>Quarantined</Text>
                <Text style={styles.cellRight}>Rejected</Text>
              </View>
              {props.sourceIps.map((r) => (
                <View style={styles.row} key={r.sourceIp}>
                  <Text style={styles.cellWide}>{r.sourceIp}</Text>
                  <Text style={styles.cellRight}>{formatNumber(r.total)}</Text>
                  <Text style={styles.cellRight}>{formatNumber(r.spfPass)}</Text>
                  <Text style={styles.cellRight}>{formatNumber(r.dkimPass)}</Text>
                  <Text style={styles.cellRight}>{formatNumber(r.quarantine)}</Text>
                  <Text style={styles.cellRight}>{formatNumber(r.reject)}</Text>
                </View>
              ))}
            </View>
          ) : (
            <Text style={styles.subtle}>No source IP data.</Text>
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.h2}>Reports received ({props.reports.length})</Text>
          {props.reports.length > 0 ? (
            <View style={styles.table}>
              <View style={styles.rowHead}>
                <Text style={styles.cellWide}>Reporter</Text>
                <Text style={styles.cell}>Received</Text>
                <Text style={styles.cellRight}>Messages</Text>
                <Text style={styles.cellRight}>Pass</Text>
                <Text style={styles.cellRight}>Fail</Text>
              </View>
              {props.reports.map((r, i) => (
                <View style={styles.row} key={i}>
                  <Text style={styles.cellWide}>{r.orgName}</Text>
                  <Text style={styles.cell}>{new Date(r.receivedAt).toISOString().slice(0, 10)}</Text>
                  <Text style={styles.cellRight}>{formatNumber(r.totalMessages)}</Text>
                  <Text style={styles.cellRight}>{formatNumber(r.passCount)}</Text>
                  <Text style={styles.cellRight}>{formatNumber(r.failCount)}</Text>
                </View>
              ))}
            </View>
          ) : (
            <Text style={styles.subtle}>No reports in this window.</Text>
          )}
        </View>

        <Text style={styles.footer} fixed>
          Generated by MxWatch · {props.domain}
        </Text>
      </Page>
    </Document>
  );
}

export async function renderDmarcReportPdf(props: DmarcReportPdfProps): Promise<Buffer> {
  return renderToBuffer(<DmarcReportDocument {...props} />);
}
