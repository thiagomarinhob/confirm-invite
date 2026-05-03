/**
 * Funde o conteúdo do WAL no arquivo principal (rsvp.sqlite).
 * Rode antes de commitar/push para a Vercel, senão o deploy leva só o .sqlite “antigo”.
 */
import Database from 'better-sqlite3';
import { existsSync, unlinkSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = join(__dirname, '..', 'server', 'data', 'rsvp.sqlite');

if (!existsSync(dbPath)) {
  console.error('Arquivo não encontrado:', dbPath);
  process.exit(1);
}

const db = new Database(dbPath);
const mode = db.pragma('journal_mode', { simple: true });
if (mode === 'wal') {
  db.pragma('wal_checkpoint(TRUNCATE)');
}
db.close();

for (const ext of ['-wal', '-shm']) {
  const side = dbPath + ext;
  if (existsSync(side)) {
    try {
      unlinkSync(side);
    } catch {
      /* pode estar em uso; próximo open recria */
    }
  }
}

console.log('OK: WAL fundido em server/data/rsvp.sqlite. Faça commit só desse arquivo e push.');
