// Minimal OpenAI-compatible mock of NVIDIA's API for testing.
// The organize handler groups by the *text excerpts* it receives, so it only works if contents were read.
import http from 'http';

function parseItems(text) {
  const items = [];
  for (const line of text.split('\n')) {
    const m = line.match(/^\[(file|folder)\] ([^\t]+)\t(.*)$/);
    if (m) items.push({ kind: m[1], name: m[2], meta: m[3], text: '' });
    else if (line.startsWith('  text: ') && items.length) items.at(-1).text = line;
  }
  return items;
}

export function startMock(port = 8765) {
  const log = [];
  const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const send = (status, obj) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (req.headers.authorization !== 'Bearer nvapi-test-123') return send(401, { detail: 'Unauthorized' });
    if (req.url === '/v1/models') return send(200, { data: [{ id: 'meta/llama-3.3-70b-instruct' }] });
    const json = JSON.parse(body);
    log.push(json);
    const msgs = json.messages;
    const reply = content => send(200, { choices: [{ message: { role: 'assistant', content } }] });

    if (msgs[0].content.includes('You organize a messy folder')) {
      const items = parseItems(msgs[1].content);
      const by = re => items.filter(i => re.test(i.text) || re.test(i.name)).map(i => i.name);
      const groups = [
        { folder: 'Invoices', reason: 'Text shows invoices', items: items.filter(i => i.kind === 'file' && /invoice/i.test(i.text)).map(i => i.name) },
        { folder: 'Contracts', reason: 'Employment agreement', items: items.filter(i => /agreement/i.test(i.text)).map(i => i.name) },
        { folder: 'Budget', reason: 'Budget spreadsheet', items: items.filter(i => /budget/i.test(i.text)).map(i => i.name) },
        { folder: 'Course - Machine Learning', reason: 'Lecture slides', items: items.filter(i => /neural/i.test(i.text)).map(i => i.name) },
        { folder: 'Projects', reason: 'Code projects', items: items.filter(i => i.kind === 'folder' && /package\.json|src/.test(i.meta)).map(i => i.name) },
        // Bad suggestion: moving the Invoices folder (a target) into Finance must be dropped.
        { folder: 'Finance', reason: 'money', items: items.filter(i => i.kind === 'folder' && i.name === 'Invoices').map(i => i.name) },
      ].filter(g => g.items.length);
      return reply('```json\n' + JSON.stringify({ groups }) + '\n```');
    }
    // Chat: read the PDF via fs_read, then answer from its text.
    const toolMsg = msgs.find(m => m.role === 'tool');
    if (json.tools && !toolMsg) {
      return send(200, { choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'fs_read', arguments: JSON.stringify({ path: 'scan_001.pdf' }) } }] } }] });
    }
    return reply(`The file says: ${JSON.parse(toolMsg.content)}`);
  });
  return new Promise(r => server.listen(port, '127.0.0.1', () => r({ server, log })));
}
