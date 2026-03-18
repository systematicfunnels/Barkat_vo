const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, 'barkat.db');
const db = new Database(dbPath);

console.log('Checking add_ons table...');
const addOnsCount = db.prepare('SELECT COUNT(*) as count FROM add_ons').get();
console.log(`Total add_ons records: ${addOnsCount.count}`);

console.log('\nSample add_ons records:');
const addOns = db.prepare('SELECT * FROM add_ons LIMIT 5').all();
console.log(JSON.stringify(addOns, null, 2));

console.log('\nChecking maintenance_letters with add_ons...');
const lettersWithAddOns = db.prepare(`
  SELECT l.id, l.unit_number, l.financial_year, COUNT(ao.id) as addon_count
  FROM maintenance_letters l
  LEFT JOIN add_ons ao ON l.id = ao.letter_id
  GROUP BY l.id
  LIMIT 5
`).all();
console.log(JSON.stringify(lettersWithAddOns, null, 2));

db.close();
