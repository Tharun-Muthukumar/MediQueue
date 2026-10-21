import { execSync } from 'node:child_process';
import path from 'node:path';

/** Drops and recreates the MySQL test database (`<your database>_test`) from the committed migrations. */
export default function setup() {
  execSync('npx tsx scripts/db.ts fresh test', { cwd: path.resolve(__dirname, '..'), stdio: 'pipe' });
}
