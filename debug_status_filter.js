const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, 'barkat.db');
const db = new Database(dbPath);

console.log('=== MAINTENANCE LETTER STATUS FILTER DEBUG ===');

// Check raw status values in database
console.log('1. Raw status values in database:');
const statusCounts = db.prepare(`
  SELECT status, COUNT(*) as count 
  FROM maintenance_letters 
  GROUP BY status
`).all();
console.log(JSON.stringify(statusCounts, null, 2));

// Check specific letters with their status and is_paid flag
console.log('\n2. Sample letters with status and is_paid:');
const sampleLetters = db.prepare(`
  SELECT id, status, is_paid, final_amount, unit_number, financial_year
  FROM maintenance_letters 
  LIMIT 5
`).all();
console.log(JSON.stringify(sampleLetters, null, 2));

// Test the filter logic manually
console.log('\n3. Testing filter logic:');
const testLetters = db.prepare(`
  SELECT l.*, u.unit_number, u.owner_name, p.name as project_name,
         COALESCE((SELECT SUM(addon_amount) FROM add_ons WHERE letter_id = l.id), 0) as add_ons_total
  FROM maintenance_letters l
  JOIN units u ON l.unit_id = u.id
  JOIN projects p ON l.project_id = p.id
  ORDER BY l.generated_date DESC, l.id DESC
  LIMIT 3
`).all();

testLetters.forEach((letter, index) => {
  const rawStatus = (letter.status || '').trim().toLowerCase();
  const isPendingLike =
    rawStatus === '' ||
    rawStatus === 'pending' ||
    rawStatus === 'generated' ||
    rawStatus === 'modified';
  
  const isOverdue = isPendingLike && letter.due_date && new Date(letter.due_date) < new Date();
  
  let displayStatus = 'Pending';
  if (rawStatus === 'paid' || !!letter.is_paid) {
    displayStatus = 'Paid';
  }
  if (isOverdue) {
    displayStatus = 'Overdue';
  }
  
  console.log(`Letter ${index + 1}:`);
  console.log(`  Raw status: '${rawStatus}'`);
  console.log(`  Is paid flag: ${letter.is_paid}`);
  console.log(`  Due date: ${letter.due_date}`);
  console.log(`  Is pending like: ${isPendingLike}`);
  console.log(`  Is overdue: ${isOverdue}`);
  console.log(`  Display status: ${displayStatus}`);
  console.log('---');
});

db.close();
console.log('\n=== END DEBUG ===');
