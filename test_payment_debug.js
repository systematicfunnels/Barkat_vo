const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, 'barkat.db');
const db = new Database(dbPath);

console.log('=== PAYMENT CREATION TEST ===');

// Test 1: Check if payments table exists and has data
const payments = db.prepare('SELECT COUNT(*) as count FROM payments').get();
console.log('Total payments in database:', payments.count);

// Test 2: Try to create a simple payment
try {
  const testPayment = {
    project_id: 1,
    unit_id: 1,
    payment_date: '2024-03-18',
    payment_amount: 1000,
    payment_mode: 'Transfer',
    remarks: 'Test payment'
  };
  
  console.log('Test payment data:', testPayment);
  
  const result = db.prepare(`
    INSERT INTO payments (project_id, unit_id, payment_date, payment_amount, payment_mode, remarks) 
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    testPayment.project_id,
    testPayment.unit_id,
    testPayment.payment_date,
    testPayment.payment_amount,
    testPayment.payment_mode,
    testPayment.remarks
  );
  
  console.log('Insert result:', result);
  console.log('Last insert ID:', result.lastInsertRowid);
  
} catch (error) {
  console.error('Error creating payment:', error.message);
  console.error('Error details:', error);
}

db.close();
