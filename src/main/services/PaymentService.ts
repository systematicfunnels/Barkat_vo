import { dbService } from '../db/database'
import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import { BasePDFGenerator } from './BasePDFGenerator'

export interface Payment {
  id?: number
  project_id: number
  unit_id: number
  letter_id?: number
  payment_date: string
  payment_amount: number
  payment_mode: string // Cash, Cheque, UPI
  cheque_number?: string
  remarks?: string
  payment_status?: string // Received, Pending
  created_at?: string
  unit_number?: string
  owner_name?: string
  project_name?: string
  receipt_number?: string
  financial_year?: string
  contact_number?: string
  account_name?: string
  bank_name?: string
  account_no?: string
  ifsc_code?: string
  branch?: string
  branch_address?: string
}

export interface Receipt {
  id?: number
  payment_id: number
  receipt_number: string
  receipt_date: string
}

class PaymentService extends BasePDFGenerator {
  private updateLetterStatus(letterId: number): void {
    const letter = dbService.get<{
      id: number
      final_amount: number
      unit_id: number
      financial_year: string
    }>('SELECT id, final_amount, unit_id, financial_year FROM maintenance_letters WHERE id = ?', [
      letterId
    ])
    if (!letter) return

    // Calculate total payments for this specific letter
    const letterPayments =
      dbService.get<{ total: number }>(
        'SELECT COALESCE(SUM(payment_amount), 0) as total FROM payments WHERE letter_id = ?',
        [letterId]
      )?.total || 0

    // Calculate payments without letter_id but matching unit and financial year
    const unlinkedPayments =
      dbService.get<{ total: number }>(
        `SELECT COALESCE(SUM(payment_amount), 0) as total
       FROM payments 
       WHERE letter_id IS NULL 
         AND unit_id = ? 
         AND TRIM(COALESCE(financial_year, '')) = TRIM(?)`,
        [letter.unit_id, letter.financial_year]
      )?.total || 0

    const totalPaid = letterPayments + unlinkedPayments
    const isPaid = totalPaid + 0.01 >= letter.final_amount

    dbService.run('UPDATE maintenance_letters SET status = ?, is_paid = ? WHERE id = ?', [
      isPaid ? 'Paid' : 'Pending',
      isPaid ? 1 : 0,
      letterId
    ])
  }

  private updateLetterStatusByUnitYear(unitId: number, financialYear?: string): void {
    if (!financialYear) return
    const letter = dbService.get<{ id: number }>(
      'SELECT id FROM maintenance_letters WHERE unit_id = ? AND TRIM(financial_year) = TRIM(?)',
      [unitId, financialYear]
    )
    if (!letter) return
    this.updateLetterStatus(letter.id)
  }

  public async generateReceiptPdf(paymentId: number): Promise<string> {
    try {
      console.log('🧾 Generating receipt for payment:', paymentId)
      
      const payment = dbService.get<Payment>(
        `
        SELECT p.*, u.unit_number, u.owner_name, u.contact_number, u.sector_code, 
               pr.name as project_name, pr.account_name, pr.bank_name, pr.account_no, 
               pr.ifsc_code, pr.branch, pr.branch_address, r.receipt_number
        FROM payments p
        JOIN units u ON p.unit_id = u.id
        JOIN projects pr ON p.project_id = pr.id
        LEFT JOIN receipts r ON p.id = r.payment_id
        WHERE p.id = ?
      `,
        [paymentId]
      )

      if (!payment) {
        throw new Error(`Payment not found: ${paymentId}`)
      }

      console.log('📋 Payment data retrieved:', {
        id: payment.id,
        receipt_number: payment.receipt_number,
        unit_number: payment.unit_number,
        amount: payment.payment_amount,
        financial_year: payment.financial_year
      })

      await this.initializePDF()

      // Header
      this.drawHeader(payment.project_name?.toUpperCase() || 'PAYMENT RECEIPT', 'PAYMENT RECEIPT')

      // Receipt header section
      this.layout.currentY -= 20
      this.drawSectionHeader('PAYMENT RECEIPT')

      // Receipt details
      this.layout.currentY -= 10
      const receiptDetailsLeft = ['Receipt Number:', 'Payment Date:', 'Financial Year:']
      const receiptDetailsRight = [payment.receipt_number || 'N/A', this.formatDate(payment.payment_date), payment.financial_year || 'N/A']
      this.drawInfoGrid(receiptDetailsLeft, receiptDetailsRight)

    // Recipient section with better formatting
    this.layout.currentY -= 20
    this.drawSectionHeader('RECIPIENT DETAILS')
    this.layout.currentY -= 10
    
    const recipientDetailsLeft = ['Unit Number:', 'Owner Name:', 'Contact:', 'Project:']
    const recipientDetailsRight = [payment.unit_number || 'N/A', payment.owner_name || 'N/A', payment.contact_number || 'N/A', payment.project_name || 'N/A']
    this.drawInfoGrid(recipientDetailsLeft, recipientDetailsRight)

    // Payment amount table
    this.layout.currentY -= 20
    this.drawSectionHeader('PAYMENT DETAILS')
    this.layout.currentY -= 10
    
    const paymentTableHeaders = ['Particulars', 'Amount (Rs.)']
    const paymentTableRows = [
      ['Maintenance Payment', this.formatCurrency(payment.payment_amount)]
    ]
    
    // Add payment mode details
    if (payment.payment_mode || payment.cheque_number) {
      paymentTableRows.push([
        `Payment Mode (${payment.payment_mode})`,
        payment.cheque_number ? `Cheque No: ${payment.cheque_number}` : ''
      ])
    }
    
    this.drawTable(paymentTableHeaders, paymentTableRows)

    // Remarks section
    if (payment.remarks) {
      this.layout.currentY -= 20
      this.drawSectionHeader('REMARKS')
      this.layout.currentY -= 10
      this.page.drawText(payment.remarks, {
        x: this.MARGIN,
        y: this.layout.currentY,
        size: 9,
        font: this.fonts.regular,
        color: this.COLORS.TEXT
      })
      this.layout.currentY -= 20
    }

    // Footer with signature
    this.drawFooter('Receiver\'s Signature')

    // Bank details section
    this.layout.currentY -= 30
    this.drawBankDetails({
      account_name: payment.account_name,
      bank_name: payment.bank_name,
      account_no: payment.account_no,
      ifsc_code: payment.ifsc_code,
      branch: payment.branch,
      branch_address: payment.branch_address
    })

    console.log('📄 Generating PDF document...')
    const pdfBytes = await this.pdfDoc.save()
    
    console.log('📁 Creating receipts directory...')
    const pdfDir = path.join(app.getPath('userData'), 'receipts')
    if (!fs.existsSync(pdfDir)) {
      console.log('📂 Creating directory:', pdfDir)
      await fs.promises.mkdir(pdfDir, { recursive: true })
    }

    const fileName = `Receipt_${payment.receipt_number || paymentId}.pdf`
    const filePath = path.join(pdfDir, fileName)
    
    console.log('💾 Writing receipt to:', filePath)
    console.log('📊 File size:', pdfBytes.length, 'bytes')
    
    await fs.promises.writeFile(filePath, pdfBytes)
    
    console.log('✅ Receipt generated successfully:', filePath)
    return filePath
  } catch (error) {
    console.error('❌ Receipt generation failed:', error)
    console.error('🔍 Error details:', {
      paymentId,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : 'No stack available'
    })
    throw new Error(`Failed to generate receipt: ${error instanceof Error ? error.message : String(error)}`)
  }
  }

  public update(id: number, payment: Partial<Payment>): boolean {
    return dbService.transaction(() => {
      const existingPayment = dbService.get<Payment>('SELECT * FROM payments WHERE id = ?', [id])
      if (!existingPayment) {
        throw new Error('Payment not found')
      }

      // Prepare update data with validation
      const updateData = {
        project_id: payment.project_id ?? existingPayment.project_id,
        unit_id: payment.unit_id ?? existingPayment.unit_id,
        letter_id: payment.letter_id ?? existingPayment.letter_id,
        payment_date: payment.payment_date ?? existingPayment.payment_date,
        payment_amount: payment.payment_amount ?? existingPayment.payment_amount,
        payment_mode: payment.payment_mode ?? existingPayment.payment_mode,
        cheque_number: payment.cheque_number ?? existingPayment.cheque_number,
        remarks: payment.remarks ?? existingPayment.remarks,
        financial_year: payment.financial_year ?? existingPayment.financial_year
      };

      // Validate required fields
      if (!updateData.project_id || !updateData.unit_id || !updateData.payment_date || 
          !updateData.payment_amount || !updateData.payment_mode || !updateData.financial_year) {
        throw new Error('Missing required fields for payment update');
      }

      // Update payment record
      const params = [
        updateData.project_id,
        updateData.unit_id,
        updateData.letter_id,
        updateData.payment_date,
        updateData.payment_amount,
        updateData.payment_mode,
        updateData.cheque_number,
        updateData.remarks,
        updateData.financial_year,
        id
      ];

      console.log('SQL Parameters:', params);
      console.log('Parameter count:', params.length);
      
      dbService.run(
        'UPDATE payments SET project_id = ?, unit_id = ?, letter_id = ?, payment_date = ?, payment_amount = ?, payment_mode = ?, cheque_number = ?, remarks = ?, financial_year = ? WHERE id = ?',
        params
      )

      // Update letter status if letter_id or financial_year changed
      const shouldUpdateLetterStatus = 
        payment.letter_id !== undefined && payment.letter_id !== existingPayment.letter_id ||
        payment.financial_year !== undefined && payment.financial_year !== existingPayment.financial_year

      if (shouldUpdateLetterStatus) {
        if (payment.letter_id) {
          this.updateLetterStatus(payment.letter_id)
        } else if (payment.unit_id && payment.financial_year) {
          this.updateLetterStatusByUnitYear(payment.unit_id, payment.financial_year)
        }
      }

      return true
    })
  }

  public getAll(): Payment[] {
    return dbService.query<Payment>(`
      SELECT p.*, u.unit_number, u.owner_name, pr.name as project_name, r.receipt_number,
             COALESCE(p.financial_year, l.financial_year) as financial_year
      FROM payments p
      JOIN units u ON p.unit_id = u.id
      JOIN projects pr ON p.project_id = pr.id
      LEFT JOIN receipts r ON p.id = r.payment_id
      LEFT JOIN maintenance_letters l ON p.letter_id = l.id
      ORDER BY p.payment_date DESC, p.id DESC
    `)
  }

  public getById(id: number): Payment | undefined {
    return dbService.get<Payment>(
      `
      SELECT p.*, u.unit_number, u.owner_name, pr.name as project_name, r.receipt_number,
             COALESCE(p.financial_year, l.financial_year) as financial_year
      FROM payments p
      JOIN units u ON p.unit_id = u.id
      JOIN projects pr ON p.project_id = pr.id
      LEFT JOIN receipts r ON p.id = r.payment_id
      LEFT JOIN maintenance_letters l ON p.letter_id = l.id
      WHERE p.id = ?
    `,
      [id]
    )
  }

  public create(payment: Payment): number {
    return dbService.transaction(() => {
      let resolvedLetterId = payment.letter_id
      let resolvedFinancialYear = payment.financial_year

      // Validate and resolve financial year
      if (!resolvedFinancialYear) {
        // If no financial year provided, try to get it from the letter
        if (resolvedLetterId) {
          resolvedFinancialYear = dbService.get<{ financial_year: string }>(
            'SELECT financial_year FROM maintenance_letters WHERE id = ?',
            [resolvedLetterId]
          )?.financial_year
        }

        // If still no financial year, try to get it from the unit's latest letter
        if (!resolvedFinancialYear) {
          resolvedFinancialYear = dbService.get<{ financial_year: string }>(
            'SELECT financial_year FROM maintenance_letters WHERE unit_id = ? ORDER BY financial_year DESC LIMIT 1',
            [payment.unit_id]
          )?.financial_year
        }

        // If still no financial year, use current financial year
        if (!resolvedFinancialYear) {
          const currentYear =
            new Date().getMonth() < 3 ? new Date().getFullYear() - 1 : new Date().getFullYear()
          resolvedFinancialYear = `${currentYear}-${(currentYear + 1).toString().slice(2)}`
        }
      }

      // Validate and resolve letter ID
      if (!resolvedLetterId && resolvedFinancialYear) {
        resolvedLetterId = dbService.get<{ id: number }>(
          'SELECT id FROM maintenance_letters WHERE unit_id = ? AND TRIM(financial_year) = TRIM(?)',
          [payment.unit_id, resolvedFinancialYear]
        )?.id
      }

      // Validate financial year format
      if (!resolvedFinancialYear || !resolvedFinancialYear.match(/^\d{4}-\d{2}$/)) {
        throw new Error(
          'Invalid or missing financial year. Please provide a valid financial year (e.g., 2024-25).'
        )
      }

      const result = dbService.run(
        `INSERT INTO payments (
          project_id, unit_id, letter_id, financial_year, payment_date, payment_amount, 
          payment_mode, cheque_number, remarks, payment_status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          payment.project_id,
          payment.unit_id,
          resolvedLetterId,
          resolvedFinancialYear,
          payment.payment_date,
          payment.payment_amount,
          payment.payment_mode,
          payment.cheque_number,
          payment.remarks,
          payment.payment_status || 'Received'
        ]
      )

      const paymentId = result.lastInsertRowid as number

      // Automatically generate a receipt number if not provided
      if (payment.payment_status !== 'Pending') {
        const receiptNumber = payment.receipt_number || `REC-${paymentId}`
        try {
          console.log('🧾 Creating receipt record:', receiptNumber)
          dbService.run(
            `INSERT INTO receipts (payment_id, receipt_number, receipt_date)
             VALUES (?, ?, ?)`,
            [paymentId, receiptNumber, payment.payment_date]
          )
          console.log('✅ Receipt record created successfully:', receiptNumber)
        } catch (error) {
          console.error('❌ Failed to create receipt record:', error)
          // Don't fail the payment, just log the error
        }
      }

      if (resolvedLetterId) {
        this.updateLetterStatus(resolvedLetterId)
      } else {
        this.updateLetterStatusByUnitYear(payment.unit_id, resolvedFinancialYear)
      }

      return paymentId
    })
  }

  /**
   * Draw bank details section
   */
  private drawBankDetails(bank: {
    account_name?: string
    bank_name?: string
    account_no?: string
    ifsc_code?: string
    branch?: string
    branch_address?: string
  }): void {
    this.page.drawText('Bank Details for Payment:', {
      x: this.MARGIN,
      y: this.layout.currentY,
      size: 10,
      font: this.fonts.bold,
      color: this.COLORS.PRIMARY
    })

    this.layout.currentY -= 20

    const bankInfo = [
      `Account Name: ${bank.account_name || 'BARKAT MANAGEMENT SOLUTIONS LLP'}`,
      `Bank Name: ${bank.bank_name || 'Please update bank details'}`,
      `Branch: ${bank.branch || 'Please update branch details'}`,
      `Account Number: ${bank.account_no || 'Please update account number'}`,
      `IFSC Code: ${bank.ifsc_code || 'Please update IFSC code'}`
    ]

    bankInfo.forEach((info) => {
      this.page.drawText(info, {
        x: this.MARGIN,
        y: this.layout.currentY,
        size: 9,
        font: this.fonts.regular,
        color: this.COLORS.TEXT
      })
      this.layout.currentY -= 12
    })
  }

  public delete(id: number): boolean {
    return dbService.transaction(() => {
      try {
        const payment = dbService.get<Payment>('SELECT * FROM payments WHERE id = ?', [id])
        const result = dbService.run('DELETE FROM payments WHERE id = ?', [id])

        if (result.changes > 0 && payment) {
          if (payment.letter_id) {
            this.updateLetterStatus(payment.letter_id)
          } else {
            this.updateLetterStatusByUnitYear(payment.unit_id, payment.financial_year)
          }
        }

        return result.changes > 0
      } catch (error) {
        console.error(`Error deleting payment ${id}:`, error)
        throw error
      }
    })
  }

  public bulkDelete(ids: number[]): boolean {
    return dbService.transaction(() => {
      let allDeleted = true
      for (const id of ids) {
        if (!this.delete(id)) {
          allDeleted = false
        }
      }
      return allDeleted
    })
  }
}

export const paymentService = new PaymentService()
