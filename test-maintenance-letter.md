# Maintenance Letter Testing Checklist

## 🧪 Test Scenarios to Verify Proper Functionality

### 1. **Project Setup Testing**
- [ ] Create new project with all details (name, address, bank info, charges config)
- [ ] Add multiple units with different areas and owners
- [ ] Configure maintenance rates for financial year
- [ ] Set up add-on templates
- [ ] Configure project charges (N.A. Tax, Solar, Cable, penalties)

### 2. **Letter Creation Testing**
- [ ] Create maintenance letters for multiple units
- [ ] Verify calculations are correct:
  - Base amount = area × rate_per_sqft
  - N.A. Tax = area × na_tax_rate_per_sqft
  - Solar = fixed amount
  - Cable = fixed amount
  - Arrears = previous unpaid + penalty
  - Final amount = sum of all charges
- [ ] Check add-ons are properly stored
- [ ] Verify no double counting occurs

### 3. **Data Integrity Testing**
- [ ] Verify `base_amount` matches calculation
- [ ] Verify `final_amount` includes all charges
- [ ] Verify `arrears` includes penalty calculations
- [ ] Check add-ons are stored separately
- [ ] Ensure no duplicate charges

### 4. **PDF Generation Testing**
- [ ] Generate PDF for different unit types
- [ ] Verify header shows correct project name and address
- [ ] Verify recipient section shows correct owner and plot details
- [ ] Check billing table displays:
  - Correct maintenance amount with rate
  - All add-ons from database
  - Correct before/after discount amounts
  - Proper totals calculation
- [ ] Verify payment details section
- [ ] Check bank details show project account info
- [ ] Verify QR code integration

### 5. **Edge Cases Testing**
- [ ] Units with zero area
- [ ] Units with missing owner info
- [ ] Projects with no configured rates
- [ ] Letters with no add-ons
- [ ] Letters with maximum arrears
- [ ] Projects with missing bank details

### 6. **Data Validation Testing**
- [ ] Invalid financial year format
- [ ] Negative rates or amounts
- [ ] Missing required project fields
- [ ] Invalid unit IDs
- [ ] Database constraint violations

## 🎯 Expected Results

### **Header Section**
- Society name: From project.name
- Period: "Maintenance Letter for period of [Month Year] – [Month Year]"
- Address: Full project address
- Contact: Project-specific email/phone

### **Billing Table**
- Maintenance: "Current Maintenance (at Rs. X.XX/sqft)"
- N.A. Tax: "N.A Tax 2025-26 (at Rs. X.XX/sqft)"
- Solar: "Solar Contribution (as per AGM)"
- Add-ons: From database with correct amounts
- Totals: Correct before/after discount calculations

### **Bank Details**
- Account info: From project.bank_* fields
- QR code: Based on template type
- Format: Bullet points with asterisks

## 🔍 Debug Points to Check

1. **Database Queries**: Verify all SQL queries return expected data
2. **Calculations**: Double-check all mathematical operations
3. **Data Types**: Ensure TypeScript interfaces match database schema
4. **Null Handling**: Verify all optional fields handled properly
5. **PDF Layout**: Check for overlapping content and spacing issues

## ⚠️ Common Issues to Watch For

1. **Double Counting**: Charges stored as add-ons AND recalculated
2. **Mismatched Data**: Display vs stored values differ
3. **Missing Defaults**: Fallback values for missing data
4. **Type Errors**: Undefined/null access issues
5. **Layout Problems**: Overlapping text or incorrect spacing

## 📝 Test Data Example

```javascript
// Test Project Data
{
  name: "Beverly Hills Sector B & C Plot Owners Co-operative Housing Society Ltd",
  address: "Changyacha Pada, Kharade, Shahapur",
  na_tax_rate_per_sqft: 0.09,
  solar_contribution: 3000,
  cable_charges: 1000,
  early_payment_discount_percentage: 10,
  penalty_percentage: 21
}

// Test Unit Data
{
  unit_number: "B-20",
  owner_name: "Sharad Mehta & Srividya Mehta",
  area_sqft: 2582.4,
  sector_code: "B"
}

// Expected Calculations
Base Maintenance: 2582.4 × 3.60 = 9,296.64
N.A. Tax: 2582.4 × 0.09 = 232.42
Solar: 3,000.00
Cable: 1,000.00
Total Before Discount: 13,529.06
Discount (10%): 1,352.91
Total After Discount: 12,176.15
```
