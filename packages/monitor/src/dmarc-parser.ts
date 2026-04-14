import { XMLParser } from 'fast-xml-parser';
import type { ParsedDmarcReport } from '@mxwatch/types';

export function parseDmarcReport(xml: string): ParsedDmarcReport {
  const parser = new XMLParser({ ignoreAttributes: false, parseTagValue: true });
  const result = parser.parse(xml);
  const feedback = result.feedback;
  if (!feedback) throw new Error('Invalid DMARC report: missing <feedback>');

  const metadata = feedback.report_metadata;
  const policyPublished = feedback.policy_published;
  const records = feedback.record
    ? Array.isArray(feedback.record) ? feedback.record : [feedback.record]
    : [];

  return {
    reportId: String(metadata.report_id),
    orgName: String(metadata.org_name),
    email: String(metadata.email ?? ''),
    dateRangeBegin: new Date(Number(metadata.date_range.begin) * 1000),
    dateRangeEnd: new Date(Number(metadata.date_range.end) * 1000),
    domain: String(policyPublished.domain),
    policy: String(policyPublished.p),
    rows: records.map((record: any) => ({
      sourceIp: String(record.row.source_ip),
      count: Number(record.row.count),
      disposition: record.row.policy_evaluated?.disposition,
      dkimResult: record.row.policy_evaluated?.dkim,
      spfResult: record.row.policy_evaluated?.spf,
      headerFrom: record.identifiers?.header_from,
    })),
  };
}
