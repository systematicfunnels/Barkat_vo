const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, 'barkat.db');
const db = new Database(dbPath);

console.log('=== ADD-ONS INVESTIGATION ===');

// Check if add_ons table exists and has data
console.log('1. Table structure:');
const tableInfo = db.prepare("PRAGMA table_info(add_ons)").all();
console.log(JSON.stringify(tableInfo, null, 2));

// Check for existing letters
console.log('\n2. Maintenance letters with add_ons:');
const lettersWithAddOns = db.prepare(`
  SELECT l.id, l.unit_number, l.financial_year, 
         COUNT(ao.id) as addon_count,
         COALESCE(SUM(ao.addon_amount), 0) as total_addons
  FROM maintenance_letters l
  LEFT JOIN add_ons ao ON l.id = ao.letter_id
  GROUP BY l.id
  LIMIT 3
`).all();
console.log(JSON.stringify(lettersWithAddOns, null, 2));

// Check specific letter add-ons
console.log('\n3. Sample add_ons records:');
const sampleAddOns = db.prepare('SELECT * FROM add_ons LIMIT 5').all();
console.log(JSON.stringify(sampleAddOns, null, 2));

// Test the query that MaintenanceLetterService.getAll() uses
console.log('\n4. Testing getAll() query:');
const allLetters = db.prepare(`
  SELECT l.*, u.unit_number, u.owner_name, p.name as project_name,
         COALESCE((SELECT SUM(addon_amount) FROM add_ons WHERE letter_id = l.id), 0) as add_ons_total
  FROM maintenance_letters l
  JOIN units u ON l.unit_id = u.id
  JOIN projects p ON l.project_id = p.id
  ORDER BY l.generated_date DESC, l.id DESC
  LIMIT 2
`).all();
console.log(JSON.stringify(allLetters, null, 2));

db.close();
console.log('\n=== END INVESTIGATION ===');
