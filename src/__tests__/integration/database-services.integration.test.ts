/**
 * Integration tests for Database Services interactions
 * Tests data flow, service communication, and module interactions
 */

import { DatabaseService } from '../../main/services/DatabaseService'
import { ProjectService } from '../../main/services/ProjectService'
import { UnitService } from '../../main/services/UnitService'
import { PaymentService } from '../../main/services/PaymentService'
import { BillingService } from '../../main/services/BillingService'

// Mock better-sqlite3
jest.mock('better-sqlite3', () => ({
  Database: jest.fn().mockImplementation(() => ({
    prepare: jest.fn().mockReturnValue({
      run: jest.fn().mockReturnValue({ lastInsertRowid: 1 }),
      all: jest.fn().mockReturnValue([]),
      get: jest.fn().mockReturnValue(null)
    }),
    exec: jest.fn(),
    close: jest.fn(),
    pragma: jest.fn()
  }))
}))

describe('Database Services Integration Tests', () => {
  let dbService: DatabaseService
  let projectService: ProjectService
  let unitService: UnitService
  let paymentService: PaymentService
  let billingService: BillingService

  beforeEach(() => {
    dbService = new DatabaseService(':memory:')
    projectService = new ProjectService(dbService)
    unitService = new UnitService(dbService)
    paymentService = new PaymentService(dbService)
    billingService = new BillingService(dbService)

    jest.clearAllMocks()
  })

  afterEach(() => {
    dbService.close()
    jest.restoreAllMocks()
  })

  describe('Service Interdependency Integration', () => {
    test('should handle project-unit-payment workflow', () => {
      // Create project
      const projectId = projectService.createProject({
        name: 'Integration Test Society',
        address: '123 Test Street',
        city: 'Test City',
        state: 'Test State',
        pincode: '123456',
        status: 'active',
        account_name: 'Test Account',
        bank_name: 'Test Bank',
        account_no: '1234567890',
        ifsc_code: 'TEST123',
        branch: 'Test Branch'
      })

      // Create unit
      const unitId = unitService.createUnit({
        project_id: projectId,
        unit_number: 'A-001',
        sector_code: 'A',
        owner_name: 'John Doe',
        area_sqft: 1200,
        unit_type: 'flat',
        contact_number: '9876543210',
        email: 'john@example.com',
        status: 'active',
        penalty: 500
      })

      // Create billing letter
      const billingId = billingService.createBillingLetter({
        project_id: projectId,
        unit_id: unitId,
        financial_year: '2024-25',
        letter_type: 'maintenance',
        amount: 5000,
        status: 'pending',
        generated_date: '2024-03-18'
      })

      // Create payment
      const paymentId = paymentService.createPayment({
        project_id: projectId,
        unit_id: unitId,
        payment_date: '2024-03-18',
        payment_amount: 5000,
        payment_mode: 'transfer',
        remarks: 'Integration test payment'
      })

      // Verify complete workflow
      expect(projectId).toBe(1)
      expect(unitId).toBe(1)
      expect(billingId).toBe(1)
      expect(paymentId).toBe(1)

      // Verify data relationships
      const project = projectService.getProject(projectId)
      const units = unitService.getUnitsByProject(projectId)
      const billingLetters = billingService.getBillingLettersByProjectAndYear(projectId, '2024-25')
      const payments = paymentService.getPaymentsByDateRange('2024-03-18', '2024-03-18')

      expect(project).toBeDefined()
      expect(units).toHaveLength(1)
      expect(billingLetters).toHaveLength(1)
      expect(payments).toHaveLength(1)

      expect(units[0].project_id).toBe(projectId)
      expect(billingLetters[0].project_id).toBe(projectId)
      expect(billingLetters[0].unit_id).toBe(unitId)
      expect(payments[0].project_id).toBe(projectId)
      expect(payments[0].unit_id).toBe(unitId)
    })

    test('should handle cascading delete operations', () => {
      // Create project with multiple units and payments
      const projectId = projectService.createProject({
        name: 'Cascade Test Society',
        address: '123 Test Street',
        city: 'Test City',
        state: 'Test State',
        pincode: '123456',
        status: 'active',
        account_name: 'Test Account',
        bank_name: 'Test Bank',
        account_no: '1234567890',
        ifsc_code: 'TEST123',
        branch: 'Test Branch'
      })

      // Create multiple units
      const unitIds = []
      for (let i = 1; i <= 3; i++) {
        const unitId = unitService.createUnit({
          project_id: projectId,
          unit_number: `A-00${i}`,
          sector_code: 'A',
          owner_name: `Owner ${i}`,
          area_sqft: 1200,
          unit_type: 'flat',
          contact_number: '9876543210',
          email: `owner${i}@example.com`,
          status: 'active',
          penalty: 500
        })
        unitIds.push(unitId)
      }

      // Create billing letters and payments
      unitIds.forEach((unitId, index) => {
        billingService.createBillingLetter({
          project_id: projectId,
          unit_id: unitId,
          financial_year: '2024-25',
          letter_type: 'maintenance',
          amount: 5000 + (index * 100),
          status: 'pending',
          generated_date: '2024-03-18'
        })

        paymentService.createPayment({
          project_id: projectId,
          unit_id: unitId,
          payment_date: '2024-03-18',
          payment_amount: 5000 + (index * 100),
          payment_mode: 'transfer',
          remarks: `Payment ${index + 1}`
        })
      })

      // Verify data exists before deletion
      expect(unitService.getUnitsByProject(projectId)).toHaveLength(3)
      expect(billingService.getBillingLettersByProjectAndYear(projectId, '2024-25')).toHaveLength(3)
      expect(paymentService.getPaymentsByDateRange('2024-03-18', '2024-03-18')).toHaveLength(3)

      // Delete project (should cascade delete related data)
      const deleteResult = projectService.deleteProject(projectId)
      expect(deleteResult).toBe(true)

      // Verify cascading deletion
      expect(projectService.getProject(projectId)).toBeUndefined()
      expect(unitService.getUnitsByProject(projectId)).toHaveLength(0)
      expect(billingService.getBillingLettersByProjectAndYear(projectId, '2024-25')).toHaveLength(0)
      expect(paymentService.getPaymentsByDateRange('2024-03-18', '2024-03-18')).toHaveLength(0)
    })
  })

  describe('Transaction Integration', () => {
    test('should handle multi-service transaction success', () => {
      const result = dbService.transaction(() => {
        const projectId = projectService.createProject({
          name: 'Transaction Test Society',
          address: '123 Test Street',
          city: 'Test City',
          state: 'Test State',
          pincode: '123456',
          status: 'active',
          account_name: 'Test Account',
          bank_name: 'Test Bank',
          account_no: '1234567890',
          ifsc_code: 'TEST123',
          branch: 'Test Branch'
        })

        const unitId = unitService.createUnit({
          project_id: projectId,
          unit_number: 'A-001',
          sector_code: 'A',
          owner_name: 'John Doe',
          area_sqft: 1200,
          unit_type: 'flat',
          contact_number: '9876543210',
          email: 'john@example.com',
          status: 'active',
          penalty: 500
        })

        const billingId = billingService.createBillingLetter({
          project_id: projectId,
          unit_id: unitId,
          financial_year: '2024-25',
          letter_type: 'maintenance',
          amount: 5000,
          status: 'pending',
          generated_date: '2024-03-18'
        })

        const paymentId = paymentService.createPayment({
          project_id: projectId,
          unit_id: unitId,
          payment_date: '2024-03-18',
          payment_amount: 5000,
          payment_mode: 'transfer',
          remarks: 'Transaction test payment'
        })

        return { projectId, unitId, billingId, paymentId }
      })

      expect(result).toEqual({
        projectId: 1,
        unitId: 1,
        billingId: 1,
        paymentId: 1
      })

      // Verify all data was committed
      expect(projectService.getProject(1)).toBeDefined()
      expect(unitService.getUnitsByProject(1)).toHaveLength(1)
      expect(billingService.getBillingLettersByProjectAndYear(1, '2024-25')).toHaveLength(1)
      expect(paymentService.getPaymentsByDateRange('2024-03-18', '2024-03-18')).toHaveLength(1)
    })

    test('should handle multi-service transaction rollback', () => {
      // Mock database error on unit creation
      const mockStmt = (dbService as any).db.prepare
      const originalRun = mockStmt().run
      let callCount = 0

      mockStmt.mockReturnValue({
        run: jest.fn().mockImplementation(() => {
          callCount++
          if (callCount === 2) { // Second call (unit creation)
            throw new Error('NOT NULL constraint failed')
          }
          return originalRun()
        }),
        all: jest.fn().mockReturnValue([]),
        get: jest.fn().mockReturnValue(null)
      })

      expect(() => {
        dbService.transaction(() => {
          projectService.createProject({
            name: 'Rollback Test Society',
            address: '123 Test Street',
            city: 'Test City',
            state: 'Test State',
            pincode: '123456',
            status: 'active',
            account_name: 'Test Account',
            bank_name: 'Test Bank',
            account_no: '1234567890',
            ifsc_code: 'TEST123',
            branch: 'Test Branch'
          })

          unitService.createUnit({
            project_id: 1,
            unit_number: '', // Invalid - will cause error
            sector_code: 'A',
            owner_name: 'John Doe',
            area_sqft: 1200,
            unit_type: 'flat',
            contact_number: '9876543210',
            email: 'john@example.com',
            status: 'active',
            penalty: 500
          })
        })
      }).toThrow('NOT NULL constraint failed')

      // Verify rollback - no data should exist
      expect(projectService.getProject(1)).toBeUndefined()
      expect(unitService.getUnitsByProject(1)).toHaveLength(0)
    })
  })

  describe('Data Consistency Integration', () => {
    test('should maintain data consistency across services', () => {
      // Create project
      const projectId = projectService.createProject({
        name: 'Consistency Test Society',
        address: '123 Test Street',
        city: 'Test City',
        state: 'Test State',
        pincode: '123456',
        status: 'active',
        account_name: 'Test Account',
        bank_name: 'Test Bank',
        account_no: '1234567890',
        ifsc_code: 'TEST123',
        branch: 'Test Branch'
      })

      // Create unit
      const unitId = unitService.createUnit({
        project_id: projectId,
        unit_number: 'A-001',
        sector_code: 'A',
        owner_name: 'John Doe',
        area_sqft: 1200,
        unit_type: 'flat',
        contact_number: '9876543210',
        email: 'john@example.com',
        status: 'active',
        penalty: 500
      })

      // Update project status
      const updateResult = projectService.updateProject(projectId, {
        status: 'inactive'
      })
      expect(updateResult).toBe(true)

      // Verify consistency
      const updatedProject = projectService.getProject(projectId)
      const units = unitService.getUnitsByProject(projectId)

      expect(updatedProject?.status).toBe('inactive')
      expect(units).toHaveLength(1)
      expect(units[0].project_id).toBe(projectId)
    })

    test('should handle concurrent data modifications', () => {
      // Create project
      const projectId = projectService.createProject({
        name: 'Concurrent Test Society',
        address: '123 Test Street',
        city: 'Test City',
        state: 'Test State',
        pincode: '123456',
        status: 'active',
        account_name: 'Test Account',
        bank_name: 'Test Bank',
        account_no: '1234567890',
        ifsc_code: 'TEST123',
        branch: 'Test Branch'
      })

      // Create multiple units
      const unitIds = []
      for (let i = 1; i <= 5; i++) {
        const unitId = unitService.createUnit({
          project_id: projectId,
          unit_number: `A-00${i}`,
          sector_code: 'A',
          owner_name: `Owner ${i}`,
          area_sqft: 1200,
          unit_type: 'flat',
          contact_number: '9876543210',
          email: `owner${i}@example.com`,
          status: 'active',
          penalty: 500
        })
        unitIds.push(unitId)
      }

      // Update all units concurrently
      const updateResults = unitIds.map((unitId, index) => {
        return unitService.updateUnit(unitId, {
          owner_name: `Updated Owner ${index + 1}`,
          status: index % 2 === 0 ? 'inactive' : 'active'
        })
      })

      expect(updateResults.every(result => result === true)).toBe(true)

      // Verify all updates were applied
      const updatedUnits = unitService.getUnitsByProject(projectId)
      expect(updatedUnits).toHaveLength(5)

      updatedUnits.forEach((unit, index) => {
        expect(unit.owner_name).toBe(`Updated Owner ${index + 1}`)
        expect(unit.status).toBe(index % 2 === 0 ? 'inactive' : 'active')
      })
    })
  })

  describe('Performance Integration', () => {
    test('should handle bulk operations efficiently', () => {
      const startTime = Date.now()

      // Create project
      const projectId = projectService.createProject({
        name: 'Bulk Test Society',
        address: '123 Test Street',
        city: 'Test City',
        state: 'Test State',
        pincode: '123456',
        status: 'active',
        account_name: 'Test Account',
        bank_name: 'Test Bank',
        account_no: '1234567890',
        ifsc_code: 'TEST123',
        branch: 'Test Branch'
      })

      // Create bulk units
      const unitIds = []
      for (let i = 1; i <= 100; i++) {
        const unitId = unitService.createUnit({
          project_id: projectId,
          unit_number: `A-${i.toString().padStart(3, '0')}`,
          sector_code: 'A',
          owner_name: `Owner ${i}`,
          area_sqft: 1200,
          unit_type: 'flat',
          contact_number: '9876543210',
          email: `owner${i}@example.com`,
          status: 'active',
          penalty: 500
        })
        unitIds.push(unitId)
      }

      // Create bulk billing letters
      unitIds.forEach((unitId, index) => {
        billingService.createBillingLetter({
          project_id: projectId,
          unit_id: unitId,
          financial_year: '2024-25',
          letter_type: 'maintenance',
          amount: 5000,
          status: 'pending',
          generated_date: '2024-03-18'
        })
      })

      // Create bulk payments
      unitIds.forEach((unitId, index) => {
        paymentService.createPayment({
          project_id: projectId,
          unit_id: unitId,
          payment_date: '2024-03-18',
          payment_amount: 5000,
          payment_mode: 'transfer',
          remarks: `Bulk payment ${index + 1}`
        })
      })

      const endTime = Date.now()
      const duration = endTime - startTime

      expect(duration).toBeLessThan(2000) // Should complete within 2 seconds
      expect(unitIds).toHaveLength(100)

      // Verify data integrity
      const units = unitService.getUnitsByProject(projectId)
      const billingLetters = billingService.getBillingLettersByProjectAndYear(projectId, '2024-25')
      const payments = paymentService.getPaymentsByDateRange('2024-03-18', '2024-03-18')

      expect(units).toHaveLength(100)
      expect(billingLetters).toHaveLength(100)
      expect(payments).toHaveLength(100)
    })

    test('should handle large dataset queries efficiently', () => {
      // Create large dataset
      const projectIds = []
      for (let i = 1; i <= 50; i++) {
        const projectId = projectService.createProject({
          name: `Large Test Project ${i}`,
          address: `${i} Test Street`,
          city: 'Test City',
          state: 'Test State',
          pincode: '123456',
          status: 'active',
          account_name: 'Test Account',
          bank_name: 'Test Bank',
          account_no: '1234567890',
          ifsc_code: 'TEST123',
          branch: 'Test Branch'
        })
        projectIds.push(projectId)
      }

      const startTime = Date.now()
      const allProjects = projectService.getAllProjects()
      const endTime = Date.now()

      expect(allProjects).toHaveLength(50)
      expect(endTime - startTime).toBeLessThan(500) // Should complete within 500ms
    })
  })

  describe('Error Handling Integration', () => {
    test('should handle foreign key constraint violations', () => {
      // Try to create unit with non-existent project
      expect(() => {
        unitService.createUnit({
          project_id: 999, // Non-existent project
          unit_number: 'A-001',
          sector_code: 'A',
          owner_name: 'John Doe',
          area_sqft: 1200,
          unit_type: 'flat',
          contact_number: '9876543210',
          email: 'john@example.com',
          status: 'active',
          penalty: 500
        })
      }).toThrow()
    })

    test('should handle unique constraint violations', () => {
      // Create project
      const projectId = projectService.createProject({
        name: 'Unique Test Society',
        address: '123 Test Street',
        city: 'Test City',
        state: 'Test State',
        pincode: '123456',
        status: 'active',
        account_name: 'Test Account',
        bank_name: 'Test Bank',
        account_no: '1234567890',
        ifsc_code: 'TEST123',
        branch: 'Test Branch'
      })

      // Try to create another project with same name
      expect(() => {
        projectService.createProject({
          name: 'Unique Test Society', // Duplicate name
          address: '456 Test Street',
          city: 'Test City',
          state: 'Test State',
          pincode: '123456',
          status: 'active',
          account_name: 'Test Account',
          bank_name: 'Test Bank',
          account_no: '1234567890',
          ifsc_code: 'TEST123',
          branch: 'Test Branch'
        })
      }).toThrow()
    })

    test('should handle check constraint violations', () => {
      // Try to create project with invalid pincode
      expect(() => {
        projectService.createProject({
          name: 'Constraint Test Society',
          address: '123 Test Street',
          city: 'Test City',
          state: 'Test State',
          pincode: 'invalid', // Invalid pincode format
          status: 'active',
          account_name: 'Test Account',
          bank_name: 'Test Bank',
          account_no: '1234567890',
          ifsc_code: 'TEST123',
          branch: 'Test Branch'
        })
      }).toThrow()
    })
  })

  describe('Data Flow Integration', () => {
    test('should handle complete billing workflow', () => {
      // Create project
      const projectId = projectService.createProject({
        name: 'Billing Workflow Test',
        address: '123 Test Street',
        city: 'Test City',
        state: 'Test State',
        pincode: '123456',
        status: 'active',
        account_name: 'Test Account',
        bank_name: 'Test Bank',
        account_no: '1234567890',
        ifsc_code: 'TEST123',
        branch: 'Test Branch'
      })

      // Create unit
      const unitId = unitService.createUnit({
        project_id: projectId,
        unit_number: 'A-001',
        sector_code: 'A',
        owner_name: 'John Doe',
        area_sqft: 1200,
        unit_type: 'flat',
        contact_number: '9876543210',
        email: 'john@example.com',
        status: 'active',
        penalty: 500
      })

      // Generate billing letter
      const billingId = billingService.createBillingLetter({
        project_id: projectId,
        unit_id: unitId,
        financial_year: '2024-25',
        letter_type: 'maintenance',
        amount: 5000,
        status: 'pending',
        generated_date: '2024-03-18'
      })

      // Update billing letter status
      const updateResult = billingService.updateBillingLetterStatus(billingId, 'generated')
      expect(updateResult).toBe(true)

      // Record payment
      const paymentId = paymentService.createPayment({
        project_id: projectId,
        unit_id: unitId,
        payment_date: '2024-03-18',
        payment_amount: 5000,
        payment_mode: 'transfer',
        remarks: 'Billing workflow payment'
      })

      // Verify complete workflow
      const billingLetters = billingService.getBillingLettersByProjectAndYear(projectId, '2024-25')
      const payments = paymentService.getPaymentsByDateRange('2024-03-18', '2024-03-18')
      const summary = paymentService.getPaymentsSummaryByProject(projectId)

      expect(billingLetters).toHaveLength(1)
      expect(billingLetters[0].status).toBe('generated')
      expect(payments).toHaveLength(1)
      expect(summary).toBeDefined()
    })

    test('should handle data transformation between services', () => {
      // Create project with specific data
      const projectId = projectService.createProject({
        name: 'Transformation Test',
        address: '123 Test Street',
        city: 'Test City',
        state: 'Test State',
        pincode: '123456',
        status: 'active',
        account_name: 'Test Account',
        bank_name: 'Test Bank',
        account_no: '1234567890',
        ifsc_code: 'TEST123',
        branch: 'Test Branch'
      })

      // Create unit with calculated penalty
      const unitId = unitService.createUnit({
        project_id: projectId,
        unit_number: 'A-001',
        sector_code: 'A',
        owner_name: 'John Doe',
        area_sqft: 1200,
        unit_type: 'flat',
        contact_number: '9876543210',
        email: 'john@example.com',
        status: 'active',
        penalty: 500
      })

      // Generate billing with calculated amount
      const billingId = billingService.createBillingLetter({
        project_id: projectId,
        unit_id: unitId,
        financial_year: '2024-25',
        letter_type: 'maintenance',
        amount: 5000, // Calculated based on area and rate
        status: 'pending',
        generated_date: '2024-03-18'
      })

      // Verify data flow
      const project = projectService.getProject(projectId)
      const unit = unitService.getUnitsByProject(projectId)[0]
      const billing = billingService.getBillingLettersByProjectAndYear(projectId, '2024-25')[0]

      expect(project?.name).toBe('Transformation Test')
      expect(unit.penalty).toBe(500)
      expect(billing.amount).toBe(5000)
      expect(billing.project_id).toBe(projectId)
      expect(billing.unit_id).toBe(unitId)
    })
  })
})
