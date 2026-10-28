import { describe, expect, it } from 'vitest';
import {
  extractMessageArtifacts,
  formatSessionTitle,
  parseCsvPreview,
  renderSafeRemoteMarkdown,
} from './remote-agent-markdown.js';

describe('remote-agent-markdown', () => {
  it('renders Markdown tables, headings, and code blocks while escaping raw HTML and file:// URLs', () => {
    const input = [
      '## 节点连通性汇总',
      '',
      '| 节点 | 协议 | 状态 |',
      '| --- | --- | --- |',
      '| us-ca-80 | UDP | 可用 |',
      '',
      '<img src="file:///private" onerror="window.__unsafe=true">',
      '',
      '```python',
      'print("ok")',
      '```',
    ].join('\n');

    const html = renderSafeRemoteMarkdown(input);
    expect(html).toContain('<h2>节点连通性汇总</h2>');
    expect(html).toContain('<table>');
    expect(html).toContain('<td>us-ca-80</td>');
    expect(html).toContain('remote-code-block');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('onerror="');
    expect(html).toContain('&lt;img src=&quot;file:///private&quot;');
  });

  it('extracts explicit deliverables and inline file links into previewable artifacts', () => {
    const msg = {
      id: '42',
      role: 'assistant',
      text: '已生成报告 [openvpn_nodes_test.csv](</home/bobbik/dsh_projects/network/openvpn_nodes_test.csv>) 与脚本 `/home/bobbik/dsh_projects/network/run_probe.py`。',
      artifacts: [
        {
          path: '/home/bobbik/dsh_projects/network/openvpn_nodes_test.csv',
          name: 'openvpn_nodes_test.csv',
          description: '489 条 remote 记录的 TCP 连通性测试结果',
          kind: 'csv',
        },
      ],
    };
    const artifacts = extractMessageArtifacts(msg);
    expect(artifacts).toHaveLength(2);
    expect(artifacts[0].name).toBe('openvpn_nodes_test.csv');
    expect(artifacts[0].kind).toBe('csv');
    expect(artifacts[1].name).toBe('run_probe.py');
    expect(artifacts[1].kind).toBe('code');
  });

  it('formats untitled UUID session names and CSV previews cleanly', () => {
    expect(formatSessionTitle({ sessionId: 's1', title: 'session-a09f1adb-cb47-4604-a7c5-025615f7d0ae' })).toBe('会话 #a09f1a');
    expect(formatSessionTitle({ sessionId: 's2', title: '测试 OpenVPN 节点连通性并导出 CSV' })).toBe('测试 OpenVPN 节点连通性并导出 CSV');

    const csv = parseCsvPreview('Node,Port,Status\nus-ca-80,1194,OK\nus-ga-225,443,OK');
    expect(csv.headers).toEqual(['Node', 'Port', 'Status']);
    expect(csv.rows).toHaveLength(2);
  });
});
