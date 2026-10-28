import { createApp, ref, h, provide } from 'vue';
import { createI18n } from 'vue-i18n';
import WorkView from '../../src/views/WorkView.vue';
import RemoteAgentConnections from '../../src/components/work/RemoteAgentConnections.vue';
import zh from '../../src/locales/zh-CN.json';
import en from '../../src/locales/en-US.json';
import '../../src/index.css';

// Test-only fixture. Not a production bridge and not a connected remote host.
window.__remoteFixtureCalls = [];
let live = null;
const params = new URLSearchParams(location.search);
const coreMode = params.get('adapter') === 'bob-core';
const initialView = params.get('view') || 'work';
let unlocked = true;
let profiles = [
  {
    id: 'p1',
    name: 'x1t-dsh',
    adapter: 'dsh',
    endpoint: 'https://x1t-dsh.bobbik.org/',
    sessionId: 's-openvpn',
    autoReconnect: true,
    uncertainSessions: [],
  },
];

const currentTheme = ref(params.get('theme') === 'light' ? 'light' : 'dark');
document.documentElement.dataset.theme = currentTheme.value;
document.body.style.background = 'var(--bg-primary)';
document.body.style.margin = '0';

let browserApproved = false;
const coreConnection = () => ({
  connectionId: 'core-fixture',
  profileId: 'core1',
  adapter: 'bob-core',
  endpoint: 'https://fixture.invalid',
  capabilities: { catalog: true, history: true, send: false, approvals: false },
});
const connection = () => ({
  connectionId: 'fixture',
  profileId: 'p1',
  adapter: 'dsh',
  endpoint: 'https://x1t-dsh.bobbik.org/',
  capabilities: { catalog: true, history: true, send: true, approvals: true },
});

const artifactPreviews = {
  '/home/bobbik/dsh_projects/network/openvpn_reachable_nodes.csv': [
    'Node,City,Protocol,Port,LatencyMs,ThroughputMbps,Verdict',
    'us-ca-80,Los Angeles,UDP,80,142,86.4,Recommended (Champion)',
    'us-co-144,Denver,UDP,1194,158,71.2,Available',
    'us-ga-225,Atlanta,TCP,443,179,64.8,Fastest TCP',
    'us-tx-199,Dallas,TCP,443,168,58.1,Available',
    'us-fl-358,Miami,TCP,8443,191,49.5,Backup',
    'nl-free-01,Amsterdam,UDP,1194,245,0.0,Unreachable (Timeout)',
  ].join('\n'),
  '/home/bobbik/dsh_projects/network/run_probe.py': [
    '#!/usr/bin/env python3',
    'import socket, csv, time',
    '',
    'def probe_endpoint(host: str, port: int, timeout: float = 2.5) -> tuple[bool, float]:',
    '    t0 = time.perf_counter()',
    '    try:',
    '        with socket.create_connection((host, port), timeout=timeout):',
    '            return True, round((time.perf_counter() - t0) * 1000, 1)',
    '    except OSError:',
    '        return False, -1.0',
  ].join('\n'),
  '/home/bobbik/dsh_projects/network/network_audit_report.md': [
    '# OpenVPN 节点连通性与吞吐量复核报告',
    '',
    '## 核心结论',
    '- **UDP 首选冠军**：`us-ca-80`（端口 `80`，实测吞吐 **86.4 Mbps**，握手仅 `142ms`）。',
    '- **TCP 最快备选**：`us-ga-225`（端口 `443`，实测吞吐 **64.8 Mbps**）。',
    '',
    '## 部署建议',
    '1. 路由器看门狗已配置为优先尝试 UDP 候选池，全部超时后自动平滑回退至 TCP。',
    '2. 隧道重连时会自动触发 `99-dnsflush` 清理 `dnsmasq` 缓存。',
  ].join('\n'),
};

const sessionHistories = {
  's-openvpn': {
    sessionId: 's-openvpn',
    hasMore: false,
    omittedRecords: 0,
    messages: [
      {
        id: '1',
        role: 'user',
        text: '请帮我批量测试 OpenVPN 节点的 TCP/UDP 连通性，整理出最快可用节点汇总表，并生成路由器自动故障转移脚本。',
      },
      {
        id: '2',
        role: 'assistant',
        reasoning: '1. 扫描 Proton_OpenWrt 目录下的 228 个 .ovpn 配置文件，提取 remote IP 与端口并进行去重；\n2. 分别执行 TCP 三次握手与 UDP TLS ClientHello 探针；\n3. 对存活节点运行 4 轮 A/B 吞吐量基准测试并导出 CSV 与 Markdown 汇总报告。',
        tools: [
          { name: 'bash', summary: 'python3 /home/bobbik/dsh_projects/network/run_probe.py --concurrency 32' },
          { name: 'write_file', summary: '/home/bobbik/dsh_projects/network/openvpn_reachable_nodes.csv' },
          { name: 'present', summary: '3 files presented' },
        ],
        text: [
          '已完成全部 **228 个节点** 的去重探测与 4 轮吞吐量实测！以下是核心汇总结果：',
          '',
          '### 🏆 存活最快节点 Top 5',
          '',
          '| 节点名称 | 城市 | 协议/端口 | 握手延迟 | 实测吞吐 | 推荐等级 |',
          '| --- | --- | --- | --- | --- | --- |',
          '| **us-ca-80** | Los Angeles | `UDP :80` | 142 ms | **86.4 Mbps** | ⭐ 主力首选 |',
          '| **us-co-144** | Denver | `UDP :1194` | 158 ms | 71.2 Mbps | 候选二号 |',
          '| **us-ga-225** | Atlanta | `TCP :443` | 179 ms | **64.8 Mbps** | TCP 最快 |',
          '| **us-tx-199** | Dallas | `TCP :443` | 168 ms | 58.1 Mbps | 稳定备选 |',
          '',
          '所有原始 CSV 数据、探测脚本及完整报告已打包为下方成果卡片，点击即可直接在线预览表格或代码：',
          '- 汇总表：[openvpn_reachable_nodes.csv](</home/bobbik/dsh_projects/network/openvpn_reachable_nodes.csv>)',
          '- 探测脚本：`/home/bobbik/dsh_projects/network/run_probe.py`',
        ].join('\n'),
        artifacts: [
          {
            path: '/home/bobbik/dsh_projects/network/openvpn_reachable_nodes.csv',
            name: 'openvpn_reachable_nodes.csv',
            description: '新旧合并后可用节点的城市、延迟与吞吐量汇总表 (CSV 表格)',
            kind: 'csv',
          },
          {
            path: '/home/bobbik/dsh_projects/network/network_audit_report.md',
            name: 'network_audit_report.md',
            description: 'OpenVPN 节点连通性与看门狗部署完整报告 (Markdown)',
            kind: 'markdown',
          },
          {
            path: '/home/bobbik/dsh_projects/network/run_probe.py',
            name: 'run_probe.py',
            description: '并发 TCP/UDP 连通性测试脚本 (Python)',
            kind: 'code',
          },
        ],
      },
    ],
  },
  's-token': {
    sessionId: 's-token',
    hasMore: false,
    omittedRecords: 0,
    messages: [
      { id: '10', role: 'user', text: '我一般要怎么在 x1t 上获得最新的 DSH 连接 token？' },
      {
        id: '11',
        role: 'assistant',
        tools: [{ name: 'bash', summary: 'grep -o "token=[^ ]*" ~/dsh_web.log | tail -n 1' }],
        text: [
          '在 `x1t` 上查看当前生效的 DSH Token 只需运行以下命令：',
          '',
          '```bash',
          'grep -E "http://127.0.0.1:3080/\\?token=" ~/dsh_web.log | tail -n 1',
          '```',
          '',
          '安全边界检查：`<img src="file:///private" onerror="window.__unsafe=true">` 会被转义为普通文本展示，绝不执行脚本或读取本地私有文件。',
        ].join('\n'),
      },
    ],
  },
};

window.appAPI = {
  __artifactPreviews: artifactPreviews,
  listenEvent: async () => () => {},
  remoteAgentProfiles: async () => ({ unlocked, profiles: structuredClone(profiles) }),
  remoteAgentUnlock: async () => { unlocked = true; return { unlocked, profiles: structuredClone(profiles) }; },
  remoteAgentLock: async () => { unlocked = false; },
  remoteAgentSave: async (_, name) => {
    profiles = [{ id: 'p1', name, endpoint: 'https://x1t-dsh.bobbik.org/', sessionId: 's-openvpn', autoReconnect: true, uncertainSessions: [] }];
    return connection();
  },
  remoteAgentReconnect: async () => (coreMode ? coreConnection() : connection()),
  remoteAgentCorePairBegin: async () => ({
    pairingId: 'pair-fixture',
    userCode: 'ABCD123456',
    verificationUri: 'https://fixture.invalid/client-connect?user_code=ABCD123456',
    challengeFingerprint: 'fixture-public-fingerprint',
    expiresAt: new Date(Date.now() + 600000).toISOString(),
    intervalMs: 5000,
  }),
  openExternal: async url => { window.__remoteFixtureCalls.push(['open-browser', url]); browserApproved = true; },
  remoteAgentCorePairPoll: async () => {
    if (!browserApproved) return { status: 'pending' };
    profiles = [{ id: 'core1', adapter: 'bob-core', name: 'Core demo', endpoint: 'https://fixture.invalid', autoReconnect: false, uncertainSessions: [] }];
    return { status: 'connected', connection: coreConnection() };
  },
  remoteAgentCorePairCancel: async () => { window.__remoteFixtureCalls.push(['cancel-pairing']); },
  remoteAgentCoreRevoke: async id => { profiles = profiles.filter(p => p.id !== id); window.__remoteFixtureCalls.push(['revoke', id]); },
  remoteAgentProfileUpdate: async (id, patch) => { Object.assign(profiles.find(p => p.id === id), patch); },
  remoteAgentForget: async id => { profiles = profiles.filter(p => p.id !== id); },
  remoteAgentConnect: async () => connection(),
  remoteAgentCatalog: async () => ({
    workspaces: [
      { workspaceId: 'w-net', title: 'dsh_projects / network (网络与隧道)', sessionIds: ['s-openvpn', 's-token', 's-uuid-1'] },
      { workspaceId: 'w-dos', title: 'dsh_projects / retro (逆向与恢复)', sessionIds: ['s-dos', 's-history', 's-uuid-2'] },
    ],
    sessions: [
      { sessionId: 's-openvpn', title: '测试 OpenVPN 节点连通性并导出 CSV', running: false, updatedAt: Date.now() - 180000 },
      { sessionId: 's-token', title: '获取DSH连接token的命令', running: false, updatedAt: Date.now() - 3600000 },
      { sessionId: 's-uuid-1', title: 'session-a09f1adb-cb47-4604-a7c5-025615f7d0ae', running: true, updatedAt: Date.now() - 60000 },
      { sessionId: 's-dos', title: '从DOS游戏EXE还原源代码', running: false, updatedAt: Date.now() - 86400000 * 2 },
      { sessionId: 's-history', title: '寻找丢失的历史会话记录', running: false, updatedAt: Date.now() - 86400000 * 4 },
      { sessionId: 's-uuid-2', title: 'session-3898dff4-3e8a-468b-9c0e-8a4a3d8d8182', running: false, updatedAt: Date.now() - 86400000 * 7 },
    ],
  }),
  remoteAgentHistory: async (_, sessionId) => (
    sessionHistories[sessionId] || {
      sessionId,
      hasMore: false,
      omittedRecords: 0,
      messages: [
        { id: '1', role: 'user', text: `查看会话 ${sessionId} 的执行进展。` },
        { id: '2', role: 'assistant', text: `### 会话已恢复\n当前会话 ID 为 \`${sessionId}\`，标题已自动美化显示。` },
      ],
    }
  ),
  remoteAgentDisconnect: async id => { window.__remoteFixtureCalls.push(['disconnect', id]); },
  remoteAgentWatch: async (_, sessionId) => {
    const hist = sessionHistories[sessionId] || sessionHistories['s-openvpn'];
    live = {
      watchId: `watch-${sessionId}`,
      sessionId,
      ready: true,
      phase: 'idle',
      messages: hist.messages,
      interactions: [],
      hasMore: false,
      omittedRecords: 0,
    };
    return { ...live };
  },
  remoteAgentLive: async () => ({ ...live }),
  remoteAgentAction: async (_, input) => {
    window.__remoteFixtureCalls.push([input.kind, input.watchId]);
    if (input.kind === 'send') {
      live = {
        ...live,
        phase: 'running',
        reasoning: '正在分析你的指令并准备调用远端脚本验证节点延迟…',
        draft: '收到指令：**' + input.text + '**\n\n正在 `x1t-dsh` 上执行实时探测，请确认下方的执行授权卡片：',
        interactions: [
          {
            eventId: 'approval1',
            agentId: live.sessionId,
            kind: 'approval',
            request: { toolName: 'bash', reason: '运行节点连通性复测脚本 run_probe.py' },
            status: 'pending',
          },
        ],
      };
    } else if (input.kind === 'answer') {
      live = { ...live, phase: 'completed', interactions: live.interactions.map(i => ({ ...i, status: 'answered' })) };
    } else if (input.kind === 'cancel') {
      live = { ...live, phase: 'cancel_requested' };
    }
    return { ...live };
  },
};

const isMobileSim = ref(params.get('device') ? params.get('device') === 'mobile' : innerWidth <= 720);

const app = createApp({
  setup() {
    const active = ref(initialView);
    provide('activeDrawer', active);
    provide('isMobile', isMobileSim);
    provide('openRemoteConnections', () => { active.value = 'settings'; });

    function toggleTheme() {
      currentTheme.value = currentTheme.value === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = currentTheme.value;
    }

    return () => h('div', { style: 'display:flex;flex-direction:column;height:100dvh;background:var(--bg-primary);color:var(--text-primary);font-family:system-ui,sans-serif;' }, [
      h('header', {
        style: 'display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px;padding:8px 16px;border-bottom:1px solid var(--border-color);background:var(--bg-secondary);font-size:13px;',
      }, [
        h('div', { style: 'display:flex;align-items:center;gap:8px;' }, [
          h('strong', 'Bob Work 实时预览台 (HMR)'),
          h('span', { style: 'color:var(--text-secondary);font-size:12px;' }, '· 模拟 x1t-dsh 真实会话与 Artifacts'),
        ]),
        h('div', { style: 'display:flex;align-items:center;gap:8px;' }, [
          h('button', {
            type: 'button',
            style: 'padding:5px 10px;border-radius:8px;border:1px solid var(--border-color);background:var(--bg-primary);color:var(--text-primary);cursor:pointer;',
            onClick: () => { isMobileSim.value = !isMobileSim.value; },
          }, isMobileSim.value ? '📱 当前：手机视图 (390×844) → 切桌面' : '🖥 当前：桌面宽屏 → 切手机视图'),
          h('button', {
            type: 'button',
            style: 'padding:5px 10px;border-radius:8px;border:1px solid var(--border-color);background:var(--bg-primary);color:var(--text-primary);cursor:pointer;',
            onClick: toggleTheme,
          }, currentTheme.value === 'dark' ? '🌙 暗色 → 切亮色' : '☀️ 亮色 → 切暗色'),
          ...['work', 'settings'].map(id => h('button', {
            'data-nav': id,
            type: 'button',
            style: `padding:5px 12px;border-radius:8px;border:1px solid var(--border-color);cursor:pointer;background:${active.value === id ? 'var(--accent-primary)' : 'var(--bg-primary)'};color:${active.value === id ? 'var(--bg-primary)' : 'var(--text-primary)'};`,
            onClick: () => { active.value = id; },
          }, id === 'work' ? '工作台 (Work)' : '节点设置 (Settings)')),
        ]),
      ]),
      h('main', {
        style: 'flex:1;min-height:0;display:flex;justify-content:center;align-items:stretch;overflow:hidden;padding:0;',
      }, [
        h('div', {
          style: isMobileSim.value
            ? 'width:min(100%,440px);height:100%;border-inline:1px solid var(--border-color);overflow:hidden;display:flex;flex-direction:column;'
            : 'width:100%;height:100%;display:flex;flex-direction:column;',
        }, [
          h('div', { style: active.value === 'settings' ? 'flex:1;overflow:auto;padding:16px;' : 'display:none' }, [h(RemoteAgentConnections)]),
          h('div', { style: active.value === 'work' ? 'flex:1;min-height:0;display:flex;' : 'display:none' }, [h(WorkView)]),
        ]),
      ]),
    ]);
  },
});

app.use(createI18n({
  legacy: false,
  locale: params.get('lang') || 'zh-CN',
  messages: { 'zh-CN': zh, 'en-US': en },
}));
app.mount('#app');
