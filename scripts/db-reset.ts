/**
 * Deletes the local database so the next start reseeds from scratch.
 * Refuses to run against a non-file database path.
 */
import fs from "node:fs";
import path from "node:path";

const configured = process.env.DATABASE_PATH ?? "data/leadforge.db";
const absolute = path.isAbsolute(configured) ? configured : path.join(process.cwd(), configured);

if (!absolute.endsWith(".db")) {
  console.error(`Refusing to delete ${absolute} — DATABASE_PATH does not look like a SQLite file.`);
  process.exit(1);
}

for (const suffix of ["", "-wal", "-shm"]) {
  const file = `${absolute}${suffix}`;
  if (fs.existsSync(file)) {
    fs.rmSync(file);
    console.log(`Removed ${file}`);
  }
}
console.log("Database reset. Run `npm run db:seed` to rebuild the demo workspace.");
