import { dbService } from '../db/database'
import { projectService } from './ProjectService'
import { addonTemplateService } from './AddonTemplateService'
import { BasePDFGenerator } from './BasePDFGenerator'
import fs from 'fs'
import path from 'path'
import { app } from 'electron'

export interface MaintenanceLetter {
  id?: number
  project_id: number
  unit_id: number
  financial_year: string
  base_amount: number
  arrears?: number
  discount_amount: number
  final_amount: number
  is_paid?: boolean
  is_sent?: boolean
  due_date?: string
  status: string
  pdf_path?: string
  generated_date?: string
  unit_number?: string
  owner_name?: string
  contact_number?: string
  project_name?: string
  sector_code?: string
  unit_type?: string
  letterhead_path?: string
  account_name?: string
  bank_name?: string
  account_no?: string
  ifsc_code?: string
  branch?: string
  branch_address?: string
  qr_code_path?: string
  project_qr_code?: string
  sector_qr_code?: string
  template_type?: string
  add_ons_total?: number
}

export interface LetterAddOn {
  id?: number
  letter_id: number
  addon_name: string
  addon_amount: number
  remarks?: string
  created_at?: string
}

class MaintenanceLetterService extends BasePDFGenerator {
  protected readonly contactInfo = {
    email: process.env.CONTACT_EMAIL || 'info@barkatmanagement.com',
    phone: process.env.CONTACT_PHONE || '+91-XXXXXXXXXX'
  }

  /**
   * Resolve QR code path with multiple fallback locations
   */
  private resolveQrCodePath(qrCodePath: string): string | null {
    if (!qrCodePath) return null
    
    // Try multiple possible locations
    const possiblePaths = [
      // Original path (absolute)
      qrCodePath,
      // Resolved path (relative to current working directory)
      path.resolve(qrCodePath),
      // Relative to app directory
      path.join(process.cwd(), qrCodePath),
      // Relative to user data directory
      path.join(app.getPath('userData'), qrCodePath),
      // Relative to user data directory assets folder
      path.join(app.getPath('userData'), 'assets', qrCodePath),
      // If path is already relative to user data directory
      qrCodePath.startsWith('assets/') 
        ? path.join(app.getPath('userData'), qrCodePath)
        : null
    ].filter((path): path is string => Boolean(path))
    
    for (const possiblePath of possiblePaths) {
      if (fs.existsSync(possiblePath)) {
        return possiblePath
      }
    }
    
    return null
  }

  public getAll(): MaintenanceLetter[] {
    return dbService.query<MaintenanceLetter>(`
      SELECT l.*, u.unit_number, u.owner_name, u.unit_type, p.name as project_name,
             COALESCE((SELECT SUM(addon_amount) FROM add_ons WHERE letter_id = l.id), 0) as add_ons_total
      FROM maintenance_letters l
      JOIN units u ON l.unit_id = u.id
      JOIN projects p ON l.project_id = p.id
      ORDER BY l.generated_date DESC, l.id DESC
    `)
  }

  public getById(id: number): MaintenanceLetter | undefined {
    return dbService.get<MaintenanceLetter>(
      `
      SELECT l.*, u.unit_number, u.owner_name, u.contact_number, u.unit_type, u.sector_code, p.name as project_name,
             p.account_name, p.bank_name, p.branch, p.branch_address, p.account_no, p.ifsc_code,
             p.qr_code_path as project_qr_code,
             pspc.qr_code_path as sector_qr_code,
             p.template_type,
             COALESCE((SELECT SUM(addon_amount) FROM add_ons WHERE letter_id = l.id), 0) as add_ons_total
      FROM maintenance_letters l
      JOIN units u ON l.unit_id = u.id
      JOIN projects p ON l.project_id = p.id
      LEFT JOIN project_sector_payment_configs pspc ON p.id = pspc.project_id 
        AND u.sector_code = pspc.sector_code
      WHERE l.id = ?
    `,
      [id]
    )
  }

  public createBatch(
    projectId: number,
    financialYear: string,
    letterDate: string,
    dueDate: string,
    unitIds: number[],
    addOns: Array<{ addon_name: string; addon_amount: number; remarks?: string }>
  ): boolean {
    return dbService.transaction(() => {
      try {
        const createdLetters: number[] = []
        const chargesConfig = projectService.getChargesConfig(projectId)

        for (const unitId of unitIds) {
          // Get unit details for calculation
          const unit = dbService.get<{ area_sqft: number; unit_type: string }>(
            'SELECT area_sqft, unit_type FROM units WHERE id = ?',
            [unitId]
          )

          if (!unit) {
            throw new Error(`Unit not found: ${unitId}`)
          }

          // Get maintenance rate for this project and financial year
          const rate = dbService.get<{ rate_per_sqft: number }>(
            'SELECT rate_per_sqft FROM maintenance_rates WHERE project_id = ? AND financial_year = ?',
            [projectId, financialYear]
          )

          if (!rate) {
            throw new Error(
              `Maintenance rate not found for project ${projectId} and financial year ${financialYear}`
            )
          }

          // 1. Current Year Maintenance (Base)
          const baseAmount = unit.area_sqft * rate.rate_per_sqft

          // 2. Additional Project Charges (N.A. Tax, Solar, Cable)
          const naTax = unit.area_sqft * (chargesConfig.na_tax_rate_per_sqft || 0)
          const solar = chargesConfig.solar_contribution || 0
          const cable = chargesConfig.cable_charges || 0

          // 3. Manual Add-ons
          const addOnsTotal = addOns?.reduce((sum, addon) => sum + addon.addon_amount, 0) || 0

          // 4. Arrears from previous years (Unpaid balance)
          const previousLetters = dbService.query<{ final_amount: number; id: number }>(
            'SELECT id, final_amount FROM maintenance_letters WHERE unit_id = ? AND financial_year < ?',
            [unitId, financialYear]
          )

          let totalArrears = 0
          for (const prev of previousLetters) {
            const paid =
              dbService.get<{ total: number }>(
                'SELECT SUM(payment_amount) as total FROM payments WHERE letter_id = ?',
                [prev.id]
              )?.total || 0
            const outstanding = Math.max(0, prev.final_amount - paid)
            if (outstanding > 0.01) {
              // Add penalty if configured
              const penalty = outstanding * ((chargesConfig.penalty_percentage || 0) / 100)
              totalArrears += outstanding + penalty
            }
          }

          // Calculate final amount (Total excluding discount)
          const finalAmount = baseAmount + naTax + solar + cable + addOnsTotal + totalArrears

          const result = dbService.run(
            `
            INSERT INTO maintenance_letters (
              project_id, unit_id, financial_year, base_amount, 
              arrears, final_amount, due_date, status, generated_date
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
            [
              projectId,
              unitId,
              financialYear,
              baseAmount,
              totalArrears,
              finalAmount,
              dueDate,
              'Generated',
              letterDate
            ]
          )

          const letterId = result.lastInsertRowid as number
          createdLetters.push(letterId)

          // Add add-ons if provided
          if (addOns && addOns.length > 0) {
            for (const addon of addOns) {
              dbService.run(
                `
                INSERT INTO add_ons (letter_id, addon_name, addon_amount, remarks)
                VALUES (?, ?, ?, ?)
              `,
                [letterId, addon.addon_name, addon.addon_amount, addon.remarks]
              )
            }
          }

          // Add addon templates as add-ons for transparency
          const addonTemplates = addonTemplateService.getEnabledTemplates(projectId)
          
          for (const template of addonTemplates) {
            let amount = template.amount
            
            // If it's a rate_per_sqft type, calculate based on unit area
            if (template.addon_type === 'rate_per_sqft') {
              const unit = dbService.get<{ area_sqft: number }>('SELECT area_sqft FROM units WHERE id = ?', [unitId])
              amount = template.amount * (unit?.area_sqft || 0)
            }
            
            if (amount > 0) {
              dbService.run(
                `
                INSERT INTO add_ons (letter_id, addon_name, addon_amount, remarks)
                VALUES (?, ?, ?, ?)
              `,
                [letterId, template.addon_name, amount, 'Pre-configured add-on']
              )
            }
          }

          // Also add standard charges as add-ons for transparency if they are non-zero
          const standardCharges = [
            { name: 'N.A. Tax', amount: naTax },
            { name: 'Solar Contribution', amount: solar },
            { name: 'Cable Charges', amount: cable }
          ]

          for (const charge of standardCharges) {
            if (charge.amount > 0) {
              dbService.run(
                `
                INSERT INTO add_ons (letter_id, addon_name, addon_amount, remarks)
                VALUES (?, ?, ?, ?)
              `,
                [letterId, charge.name, charge.amount, 'Standard project charge']
              )
            }
          }
        }

        return createdLetters.length > 0
      } catch (error) {
        console.error('Error creating maintenance letters:', error)
        throw error
      }
    })
  }

  public delete(id: number): boolean {
    return dbService.transaction(() => {
      try {
        const result = dbService.run('DELETE FROM maintenance_letters WHERE id = ?', [id])
        return result.changes > 0
      } catch (error) {
        console.error(`Error deleting maintenance letter ${id}:`, error)
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

  public async generatePdf(id: number): Promise<string> {
    const letter = this.getById(id)
    if (!letter) throw new Error('Maintenance letter not found')

    // Get add-ons for this letter
    const addOns = this.getAddOns(id)

    await this.initializePDF()

    // Letterhead
    this.drawLetterhead()

    // Letter details
    this.layout.currentY -= 20
    this.page.drawText(`Financial Year: ${letter.financial_year}`, {
      x: this.MARGIN,
      y: this.layout.currentY,
      size: 10,
      font: this.fonts.bold,
      color: this.COLORS.PRIMARY
    })
    this.page.drawText(`Due Date: ${this.formatDate(letter.due_date || '')}`, {
      x: this.layout.width - this.MARGIN - 120,
      y: this.layout.currentY,
      size: 10,
      font: this.fonts.bold,
      color: this.COLORS.PRIMARY
    })

    // Recipient section
    this.layout.currentY -= 40
    this.drawRecipientSection(letter)

    // Subject line
    this.layout.currentY -= 30
    this.drawSectionHeader('Maintenance Demand Notice')

    // Amount details table
    this.layout.currentY -= 10
    this.drawAmountTable(letter, addOns)

    // Payment details
    this.layout.currentY -= 30
    this.drawPaymentDetails(letter)

    // Bank details
    this.layout.currentY -= 30
    await this.drawBankDetails(letter)

    // Footer
    this.drawFooter('Authorized Signature')

    const pdfBytes = await this.pdfDoc.save()
    const pdfDir = path.join(app.getPath('userData'), 'maintenance-letters')
    if (!fs.existsSync(pdfDir)) fs.mkdirSync(pdfDir)

    const fileName = `MaintenanceLetter_${letter.id}.pdf`
    const filePath = path.join(pdfDir, fileName)
    fs.writeFileSync(filePath, pdfBytes)

    // Update PDF path in database
    dbService.run('UPDATE maintenance_letters SET pdf_path = ? WHERE id = ?', [filePath, id])

    return filePath
  }

  public getAddOns(letterId: number): LetterAddOn[] {
    return dbService.query<LetterAddOn>('SELECT * FROM add_ons WHERE letter_id = ?', [letterId])
  }

  public getAllAddOns(): LetterAddOn[] {
    return dbService.query<LetterAddOn>('SELECT * FROM add_ons')
  }

  public addAddOn(params: {
    unit_id: number
    financial_year: string
    addon_name: string
    addon_amount: number
    remarks?: string
  }): boolean {
    return dbService.transaction(() => {
      // Find the letter for this unit and financial year
      const letter = dbService.get<{ id: number; final_amount: number }>(
        'SELECT id, final_amount FROM maintenance_letters WHERE unit_id = ? AND financial_year = ?',
        [params.unit_id, params.financial_year]
      )

      if (!letter) {
        throw new Error('Maintenance letter not found for the specified unit and financial year')
      }

      // Add the add-on
      dbService.run(
        `
        INSERT INTO add_ons (letter_id, addon_name, addon_amount, remarks)
        VALUES (?, ?, ?, ?)
      `,
        [letter.id, params.addon_name, params.addon_amount, params.remarks]
      )

      // Update the final amount
      const newFinalAmount = letter.final_amount + params.addon_amount
      dbService.run('UPDATE maintenance_letters SET final_amount = ? WHERE id = ?', [
        newFinalAmount,
        letter.id
      ])

      return true
    })
  }

  public deleteAddOn(id: number): boolean {
    return dbService.transaction(() => {
      // Get the add-on details before deletion
      const addon = dbService.get<{ letter_id: number; addon_amount: number }>(
        'SELECT letter_id, addon_amount FROM add_ons WHERE id = ?',
        [id]
      )

      if (!addon) {
        throw new Error('Add-on not found')
      }

      // Delete the add-on
      const result = dbService.run('DELETE FROM add_ons WHERE id = ?', [id])

      if (result.changes > 0) {
        // Update the letter's final amount
        dbService.run(
          `
          UPDATE maintenance_letters 
          SET final_amount = final_amount - ? 
          WHERE id = ?
        `,
          [addon.addon_amount, addon.letter_id]
        )
      }

      return result.changes > 0
    })
  }

  private drawLetterhead(): void {
    // Company name and address
    this.page.drawText('BARKAT MANAGEMENT SOLUTIONS LLP', {
      x: this.MARGIN,
      y: this.layout.currentY,
      size: 16,
      font: this.fonts.bold,
      color: this.COLORS.PRIMARY
    })

    this.layout.currentY -= 20
    this.page.drawText('Property Management & Maintenance Services', {
      x: this.MARGIN,
      y: this.layout.currentY,
      size: 10,
      font: this.fonts.regular,
      color: this.COLORS.GRAY
    })

    this.layout.currentY -= 15
    this.page.drawText(`Email: ${this.contactInfo.email} | Phone: ${this.contactInfo.phone}`, {
      x: this.MARGIN,
      y: this.layout.currentY,
      size: 9,
      font: this.fonts.regular,
      color: this.COLORS.GRAY
    })

    this.drawDivider()
  }

  private drawRecipientSection(letter: MaintenanceLetter): void {
    // Recipient details in a proper format
    const recipientLines = [
      `To,`,
      `${letter.owner_name || 'N/A'}`,
      `${letter.unit_number || 'N/A'}`,
      `${letter.project_name || 'N/A'}`
    ]

    recipientLines.forEach((line, index) => {
      this.page.drawText(line, {
        x: this.MARGIN,
        y: this.layout.currentY - index * 12,
        size: index === 0 ? 10 : 9,
        font: index === 0 ? this.fonts.bold : this.fonts.regular,
        color: this.COLORS.TEXT
      })
    })

    this.layout.currentY -= recipientLines.length * 12 + 20
  }

  private drawAmountTable(letter: MaintenanceLetter, addOns: LetterAddOn[]): void {
    // Create amount breakdown table
    const headers = ['Particulars', 'Amount (Rs.)']
    const rows = [['Maintenance Charges', this.formatCurrency(letter.base_amount)]]

    // Add add-ons if any
    addOns.forEach((addon) => {
      rows.push([addon.addon_name, this.formatCurrency(addon.addon_amount)])
    })

    // Add discount if applicable
    if (letter.discount_amount > 0) {
      rows.push(['Discount', `(${this.formatCurrency(letter.discount_amount)})`])
    }

    // Add arrears if applicable
    if (letter.arrears && letter.arrears > 0) {
      rows.push(['Arrears', this.formatCurrency(letter.arrears)])
    }

    // Total
    rows.push(['Total Amount Due', this.formatCurrency(letter.final_amount)])

    this.drawTable(headers, rows)
  }

  private drawPaymentDetails(letter: MaintenanceLetter): void {
    this.page.drawText('Payment Details:', {
      x: this.MARGIN,
      y: this.layout.currentY,
      size: 10,
      font: this.fonts.bold,
      color: this.COLORS.PRIMARY
    })

    this.layout.currentY -= 20

    const paymentInfo = [
      `Due Date: ${this.formatDate(letter.due_date || '')}`,
      `Payment Mode: Cheque/Cash/Online Transfer`,
      `Late Payment Charges: 21% per annum`
    ]

    paymentInfo.forEach((info, index) => {
      this.page.drawText(info, {
        x: this.MARGIN,
        y: this.layout.currentY - index * 12,
        size: 9,
        font: this.fonts.regular,
        color: this.COLORS.TEXT
      })
    })

    this.layout.currentY -= paymentInfo.length * 12 + 20
  }

  private async drawBankDetails(letter: MaintenanceLetter): Promise<void> {
    this.page.drawText('Bank Details for Payment:', {
      x: this.MARGIN,
      y: this.layout.currentY,
      size: 10,
      font: this.fonts.bold,
      color: this.COLORS.PRIMARY
    })

    this.layout.currentY -= 20

    const bankInfo = [
      `Account Name: ${letter.account_name || 'BARKAT MANAGEMENT SOLUTIONS LLP'}`,
      `Bank Name: ${letter.bank_name || 'Please update bank details'}`,
      `Branch: ${letter.branch || 'Please update branch details'}`,
      `Account Number: ${letter.account_no || 'Please update account number'}`,
      `IFSC Code: ${letter.ifsc_code || 'Please update IFSC code'}`
    ]

    bankInfo.forEach((info, index) => {
      this.page.drawText(info, {
        x: this.MARGIN,
        y: this.layout.currentY - index * 12,
        size: 9,
        font: this.fonts.regular,
        color: this.COLORS.TEXT
      })
    })

    // Add QR code based on template type
    const qrCodePath =
      letter.template_type === 'sector_legacy' ? letter.sector_qr_code : letter.project_qr_code

    if (qrCodePath) {
      this.layout.currentY -= bankInfo.length * 12 + 30
      const qrLabel =
        letter.template_type === 'sector_legacy'
          ? `Scan QR Code for Sector ${letter.sector_code} Payment:`
          : 'Scan QR Code for Payment:'

      this.page.drawText(qrLabel, {
        x: this.MARGIN,
        y: this.layout.currentY,
        size: 9,
        font: this.fonts.bold,
        color: this.COLORS.PRIMARY
      })

      // Implement enhanced QR code embedding with better path resolution
      try {
        const resolvedQrPath = this.resolveQrCodePath(qrCodePath)
        
        if (resolvedQrPath) {
          const qrExt = path.extname(resolvedQrPath).toLowerCase()
          const isSupportedImage = qrExt === '.png' || qrExt === '.jpg' || qrExt === '.jpeg'
          
          if (isSupportedImage) {
            const qrImageBytes = fs.readFileSync(resolvedQrPath)
            const qrImage = qrExt === '.png' 
              ? await this.pdfDoc.embedPng(qrImageBytes)
              : await this.pdfDoc.embedJpg(qrImageBytes)
            
            this.page.drawImage(qrImage, {
              x: 450,
              y: this.layout.currentY - 20,
              width: 80,
              height: 80
            })
            
            this.page.drawText('Scan to Pay', {
              x: 460,
              y: this.layout.currentY - 35,
              size: 8,
              font: this.fonts.regular,
              color: this.COLORS.TEXT
            })
          } else {
            console.warn(`Unsupported QR code format: ${qrExt}. Supported formats: PNG, JPG, JPEG`)
          }
        } else {
          // Show placeholder when QR code is missing
          this.page.drawText('QR Code: File not found - Please update QR code path in project settings', {
            x: this.MARGIN,
            y: this.layout.currentY,
            size: 8,
            font: this.fonts.regular,
            color: this.COLORS.SECONDARY
          })
          console.warn(`QR code file not found: ${qrCodePath}`)
        }
      } catch (error) {
        console.error('Failed to embed QR code:', error)
        // Show error message in PDF
        this.page.drawText('QR Code: Error loading - Please check file path', {
          x: this.MARGIN,
          y: this.layout.currentY,
          size: 8,
          font: this.fonts.regular,
          color: this.COLORS.ERROR
        })
      }
    }

    this.layout.currentY -= bankInfo.length * 12 + 20
  }
}

export const maintenanceLetterService = new MaintenanceLetterService()
