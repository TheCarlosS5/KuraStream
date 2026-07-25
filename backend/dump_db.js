import { db } from './db.js';

const stmt = db.prepare("SELECT id, title, filepath FROM episodes");
const rows = stmt.all();
console.log("Episodes in Database:");
rows.forEach(r => {
  console.log(`- ID: "${r.id}" | Title: "${r.title}" | Filepath: "${r.filepath}"`);
});
