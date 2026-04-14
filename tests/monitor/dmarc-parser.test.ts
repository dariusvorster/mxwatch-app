import { describe, it, expect } from 'vitest';
import { parseDmarcReport } from '../../packages/monitor/src/dmarc-parser';

const SAMPLE = `<?xml version="1.0"?>
<feedback>
  <report_metadata>
    <org_name>google.com</org_name>
    <email>noreply-dmarc@google.com</email>
    <report_id>1234567890</report_id>
    <date_range>
      <begin>1712016000</begin>
      <end>1712102400</end>
    </date_range>
  </report_metadata>
  <policy_published>
    <domain>example.com</domain>
    <p>reject</p>
  </policy_published>
  <record>
    <row>
      <source_ip>192.0.2.1</source_ip>
      <count>5</count>
      <policy_evaluated>
        <disposition>none</disposition>
        <dkim>pass</dkim>
        <spf>pass</spf>
      </policy_evaluated>
    </row>
    <identifiers>
      <header_from>example.com</header_from>
    </identifiers>
  </record>
  <record>
    <row>
      <source_ip>198.51.100.7</source_ip>
      <count>2</count>
      <policy_evaluated>
        <disposition>quarantine</disposition>
        <dkim>fail</dkim>
        <spf>fail</spf>
      </policy_evaluated>
    </row>
    <identifiers>
      <header_from>example.com</header_from>
    </identifiers>
  </record>
</feedback>`;

describe('parseDmarcReport', () => {
  it('extracts metadata and rows', () => {
    const r = parseDmarcReport(SAMPLE);
    expect(r.orgName).toBe('google.com');
    expect(r.reportId).toBe('1234567890');
    expect(r.domain).toBe('example.com');
    expect(r.policy).toBe('reject');
    expect(r.dateRangeBegin.getTime()).toBe(1712016000 * 1000);
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]).toMatchObject({ sourceIp: '192.0.2.1', count: 5, spfResult: 'pass' });
    expect(r.rows[1]).toMatchObject({ sourceIp: '198.51.100.7', disposition: 'quarantine' });
  });

  it('throws on invalid XML missing feedback', () => {
    expect(() => parseDmarcReport('<not-feedback></not-feedback>')).toThrow();
  });

  it('handles single-record feedback (non-array)', () => {
    const single = SAMPLE.replace(/<record>[\s\S]*?<\/record>\s*<record>[\s\S]*?<\/record>/, `<record>
      <row><source_ip>1.1.1.1</source_ip><count>3</count><policy_evaluated><disposition>none</disposition><dkim>pass</dkim><spf>pass</spf></policy_evaluated></row>
      <identifiers><header_from>example.com</header_from></identifiers>
    </record>`);
    const r = parseDmarcReport(single);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].sourceIp).toBe('1.1.1.1');
  });
});
