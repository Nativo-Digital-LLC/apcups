import { Client } from 'ssh2';
import type { SwarmNode } from './db';

/**
 * Test SSH connectivity to a node.
 * Returns true if connection and auth succeed.
 */
export function testConnection(node: SwarmNode): Promise<{ ok: boolean; message: string }> {
  return new Promise((resolve) => {
    const conn = new Client();
    const timeout = setTimeout(() => {
      conn.destroy();
      resolve({ ok: false, message: 'Timeout: no se pudo conectar en 10 segundos' });
    }, 10_000);

    conn.on('ready', () => {
      clearTimeout(timeout);
      conn.end();
      resolve({ ok: true, message: 'Conexión SSH exitosa' });
    });

    conn.on('error', (err) => {
      clearTimeout(timeout);
      resolve({ ok: false, message: err.message });
    });

    conn.connect(buildConnectConfig(node));
  });
}

/**
 * Execute a command on a remote node via SSH.
 * Resolves with stdout, rejects on non-zero exit or connection error.
 */
export function execCommand(node: SwarmNode, command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    let output = '';

    const timeout = setTimeout(() => {
      conn.destroy();
      reject(new Error('SSH timeout'));
    }, 30_000);

    conn.on('ready', () => {
      conn.exec(command, (err, stream) => {
        if (err) {
          clearTimeout(timeout);
          conn.end();
          return reject(err);
        }

        stream.on('data', (data: Buffer) => { output += data.toString(); });
        stream.stderr.on('data', (data: Buffer) => { output += data.toString(); });

        stream.on('close', (code: number) => {
          clearTimeout(timeout);
          conn.end();
          if (code === 0 || code === null) {
            resolve(output.trim());
          } else {
            reject(new Error(`SSH command exited with code ${code}: ${output.trim()}`));
          }
        });
      });
    });

    conn.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    conn.connect(buildConnectConfig(node));
  });
}

function buildConnectConfig(node: SwarmNode) {
  return {
    host: node.host,
    port: node.port || 22,
    username: node.user,
    ...(node.private_key
      ? { privateKey: node.private_key }
      : { password: node.password || '' }),
    readyTimeout: 10_000,
  };
}
