// Starts the Vite dev server, then launches Electron pointed at it.
import { createServer } from 'vite';
import { spawn } from 'child_process';
import electron from 'electron';

const server = await createServer();
await server.listen();
const url = server.resolvedUrls.local[0];

const child = spawn(electron, ['.'], {
  stdio: 'inherit',
  env: { ...process.env, VITE_DEV_SERVER_URL: url },
});

child.on('close', async code => {
  await server.close();
  process.exit(code ?? 0);
});
