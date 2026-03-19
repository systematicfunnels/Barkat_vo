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

  /**
   * Get project-specific contact information
   */
  private getProjectContactInfo(projectId: number): { email: string; phone: string } {
    // Get project details for contact information
    const project = dbService.get<{ 
      name: string;
      account_name?: string;
    }>(
      'SELECT name, account_name FROM projects WHERE id = ?',
      [projectId]
    )

    // Use project name to create realistic email and use environment for phone
    const projectName = project?.name || 'Society'
    const emailDomain = projectName.toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .replace(/\s+/g, '') + 'chs.com'
    
    return {
      email: process.env.CONTACT_EMAIL || `accounts@${emailDomain}`,
      phone: process.env.CONTACT_PHONE || '+91-XXXXXXXXXX'
    }
  }

  /**
   * Resolve QR code path with multiple fallback locations
   */
  private resolveQrCodePath(qrCodePath: string): string | null {
    if (!qrCodePath) return null
    
    console.log('🔍 QR Code Path Resolution Debug:')
    console.log('  Input path:', qrCodePath)
    
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
    
    console.log('  Attempting paths:')
    const foundPath = possiblePaths.find((p, i) => {
      const exists = fs.existsSync(p)
      console.log(`    ${i + 1}. ${p} - ${exists ? '✅ EXISTS' : '❌ NOT FOUND'}`)
      if (exists) {
        console.log('  ✅ Found QR code at:', p)
        return true
      }
      return false
    })
    
    if (foundPath) {
      return foundPath
    }
    
    for (const possiblePath of possiblePaths) {
      if (fs.existsSync(possiblePath)) {
        return possiblePath
      }
    }
    
    console.log('  ❌ QR code not found in any location')
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

          // Note: Standard charges (N.A. Tax, Solar, Cable) are already included in final_amount
          // Don't add them as separate add-ons to prevent double counting
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
    this.drawLetterhead(letter)

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
    this.layout.currentY -= 20
    this.drawAmountTable(letter, addOns)

    // Payment details
    this.layout.currentY -= 40
    this.drawPaymentDetails(letter)

    // Bank details
    this.layout.currentY -= 40
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

  /**
   * Wrap text to fit within specified line length
   */
  private wrapText(text: string, maxLength: number): string[] {
    if (text.length <= maxLength) {
      return [text]
    }

    const words = text.split(' ')
    const lines: string[] = []
    let currentLine = ''

    for (const word of words) {
      if ((currentLine + ' ' + word).length <= maxLength) {
        currentLine = currentLine ? currentLine + ' ' + word : word
      } else {
        if (currentLine) {
          lines.push(currentLine)
          currentLine = word
        } else {
          // Word is longer than max length, split it
          for (let i = 0; i < word.length; i += maxLength) {
            lines.push(word.substring(i, i + maxLength))
          }
        }
      }
    }

    if (currentLine) {
      lines.push(currentLine)
    }

    return lines
  }

  private drawLetterhead(letter: MaintenanceLetter): void {
    // Get project details for dynamic heading
    const project = dbService.get<{ 
      name: string; 
      address?: string; 
      city?: string; 
      state?: string;
    }>(
      'SELECT name, address, city, state FROM projects WHERE id = ?',
      [letter.project_id]
    )

    // Society name with period and sectors (like your sample)
    const societyName = project?.name || 'Society'
    const financialYear = letter.financial_year
    const [startYear, endYear] = financialYear.split('-')
    const period = `${this.getMonthName(startYear)} ${startYear} – ${this.getMonthName(endYear)} ${endYear}`
    
    this.page.drawText(societyName.toUpperCase(), {
      x: this.MARGIN,
      y: this.layout.currentY,
      size: 18,
      font: this.fonts.bold,
      color: this.COLORS.PRIMARY
    })

    this.layout.currentY -= 20
    
    // Period information (like your sample)
    this.page.drawText(`This is a Maintenance Letter for the period of ${period}`, {
      x: this.MARGIN,
      y: this.layout.currentY,
      size: 12,
      font: this.fonts.regular,
      color: this.COLORS.TEXT
    })

    this.layout.currentY -= 20
    
    // Site address
    if (project?.address) {
      const cityState = [project.city, project.state].filter(Boolean).join(', ')
      const fullAddress = cityState ? `${project.address}, ${cityState}` : project.address
      
      // Split long address into multiple lines
      const maxLineLength = 60
      const addressLines = this.wrapText(fullAddress, maxLineLength)
      
      addressLines.forEach((line) => {
        this.page.drawText(line, {
          x: this.MARGIN,
          y: this.layout.currentY,
          size: 10,
          font: this.fonts.regular,
          color: this.COLORS.TEXT
        })
        this.layout.currentY -= 12
      })
    } else {
      this.page.drawText('Property Management & Maintenance Services', {
        x: this.MARGIN,
        y: this.layout.currentY,
        size: 10,
        font: this.fonts.regular,
        color: this.COLORS.GRAY
      })
      this.layout.currentY -= 12
    }

    this.layout.currentY -= 10
    const contactInfo = this.getProjectContactInfo(letter.project_id)
    this.page.drawText(`Email: ${contactInfo.email} | Phone: ${contactInfo.phone}`, {
      x: this.MARGIN,
      y: this.layout.currentY,
      size: 9,
      font: this.fonts.regular,
      color: this.COLORS.GRAY
    })

    this.drawDivider()
  }

  /**
   * Get month name from financial year month
   */
  private getMonthName(month: string): string {
    const months: { [key: string]: string } = {
      '01': 'January', '02': 'February', '03': 'March', '04': 'April',
      '05': 'May', '06': 'June', '07': 'July', '08': 'August',
      '09': 'September', '10': 'October', '11': 'November', '12': 'December'
    }
    return months[month] || 'April'
  }

  private drawRecipientSection(letter: MaintenanceLetter): void {
    // Get unit details with more information
    const unit = dbService.get<{
      unit_number: string;
      owner_name: string;
      contact_number?: string;
      email?: string;
      area_sqft?: number;
      sector_code?: string;
    }>(
      'SELECT unit_number, owner_name, contact_number, email, area_sqft, sector_code FROM units WHERE id = ?',
      [letter.unit_id]
    )

    // Format like your sample: "The letter is addressed to [Owners] for plot [Unit]"
    const owners = letter.owner_name || unit?.owner_name || 'N/A'
    const plotNumber = letter.unit_number || unit?.unit_number || 'N/A'
    const sector = unit?.sector_code ? `Sector "${unit.sector_code}"` : ''
    
    this.page.drawText(`The letter is addressed to ${owners} for plot ${plotNumber}${sector ? ` from ${sector}` : ''}.`, {
      x: this.MARGIN,
      y: this.layout.currentY,
      size: 11,
      font: this.fonts.regular,
      color: this.COLORS.TEXT
    })

    this.layout.currentY -= 25
    
    // Add plot area information
    const plotArea = unit?.area_sqft || 0
    this.page.drawText(`Payment Breakdown`, {
      x: this.MARGIN,
      y: this.layout.currentY,
      size: 12,
      font: this.fonts.bold,
      color: this.COLORS.PRIMARY
    })

    this.layout.currentY -= 20
    this.page.drawText(`The maintenance fees are calculated based on a plot area of ${plotArea.toLocaleString()} Sqft.`, {
      x: this.MARGIN,
      y: this.layout.currentY,
      size: 10,
      font: this.fonts.regular,
      color: this.COLORS.TEXT
    })

    this.layout.currentY -= 35
  }

  private drawAmountTable(letter: MaintenanceLetter, addOns: LetterAddOn[]): void {
    // Get maintenance rate for this financial year
    const rate = dbService.get<{ rate_per_sqft: number }>(
      'SELECT rate_per_sqft FROM maintenance_rates WHERE project_id = ? AND financial_year = ?',
      [letter.project_id, letter.financial_year]
    )

    // Get project charges configuration
    const chargesConfig = projectService.getChargesConfig(letter.project_id)

    // Enhanced billing table matching your sample format
    const headers = ['Particulars', 'Amount', 'Before 30th June 2025', 'After 30th June 2025']
    const rows: string[][] = []

    // Base maintenance charges with plot details
    const ratePerSqft = rate?.rate_per_sqft || 0
    const discountPercentage = chargesConfig.early_payment_discount_percentage || 10
    
    // Use stored base_amount, don't recalculate
    const maintenanceAmount = letter.base_amount
    const maintenanceAfterDiscount = maintenanceAmount - (maintenanceAmount * discountPercentage / 100)
    
    rows.push([
      `Current Maintenance (at Rs. ${ratePerSqft.toFixed(2)}/sqft)`,
      this.formatCurrency(maintenanceAmount),
      this.formatCurrency(maintenanceAfterDiscount),
      this.formatCurrency(maintenanceAmount)
    ])

    // Only add add-ons from database (don't recalculate standard charges)
    // This prevents double counting
    addOns.forEach((addon) => {
      rows.push([
        addon.addon_name,
        this.formatCurrency(addon.addon_amount),
        this.formatCurrency(addon.addon_amount),
        this.formatCurrency(addon.addon_amount)
      ])
    })

    // Add arrears if applicable (use stored value)
    if (letter.arrears && letter.arrears > 0) {
      rows.push([
        'Previous Arrears',
        this.formatCurrency(letter.arrears),
        this.formatCurrency(letter.arrears),
        this.formatCurrency(letter.arrears)
      ])
    }

    // Calculate totals using stored final_amount
    const totalFromAddOns = addOns.reduce((sum, addon) => sum + addon.addon_amount, 0)
    const arrearsAmount = letter.arrears || 0
    const totalBeforeDiscount = maintenanceAmount + totalFromAddOns + arrearsAmount
    const totalAfterDiscount = maintenanceAfterDiscount + totalFromAddOns + arrearsAmount

    // Total row
    rows.push([
      'Total Amount Payable',
      '',
      this.formatCurrency(totalBeforeDiscount),
      this.formatCurrency(totalAfterDiscount)
    ])

    this.drawTable(headers, rows)
  }

  private drawPaymentDetails(letter: MaintenanceLetter): void {
    // Get project charges configuration for discount/penalty calculations
    const chargesConfig = projectService.getChargesConfig(letter.project_id)
    
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
      `Late Payment Charges: ${chargesConfig.penalty_percentage || 21}% per annum`
    ]

    paymentInfo.forEach((info, index) => {
      this.page.drawText(info, {
        x: this.MARGIN,
        y: this.layout.currentY - index * 15,
        size: 9,
        font: this.fonts.regular,
        color: this.COLORS.TEXT
      })
    })

    this.layout.currentY -= (paymentInfo.length * 15) + 25
  }

  private async drawBankDetails(letter: MaintenanceLetter): Promise<void> {
    this.page.drawText('------------------------------', {
      x: this.MARGIN,
      y: this.layout.currentY,
      size: 10,
      font: this.fonts.regular,
      color: this.COLORS.TEXT
    })

    this.layout.currentY -= 20

    this.page.drawText('New Bank Details for Payment', {
      x: this.MARGIN,
      y: this.layout.currentY,
      size: 12,
      font: this.fonts.bold,
      color: this.COLORS.PRIMARY
    })

    this.layout.currentY -= 20

    this.page.drawText('The society has updated its banking information. Please ensure payments are made to the following account:', {
      x: this.MARGIN,
      y: this.layout.currentY,
      size: 10,
      font: this.fonts.regular,
      color: this.COLORS.TEXT
    })

    this.layout.currentY -= 25

    const bankInfo = [
      `* Account Name: ${letter.account_name || 'Please update account name'}`,
      `* Account No: ${letter.account_no || 'Please update account number'}`,
      `* Bank Name: ${letter.bank_name || 'Please update bank name'}`,
      `* IFSC Code: ${letter.ifsc_code || 'Please update IFSC code'}`,
      `* Branch: ${letter.branch || 'Please update branch details'}`
    ]

    bankInfo.forEach((info, index) => {
      this.page.drawText(info, {
        x: this.MARGIN,
        y: this.layout.currentY - index * 18,
        size: 10,
        font: this.fonts.regular,
        color: this.COLORS.TEXT
      })
    })

    this.layout.currentY -= (bankInfo.length * 18) + 30

    // Add QR code based on template type
    const qrCodePath =
      letter.template_type === 'sector_legacy' ? letter.sector_qr_code : letter.project_qr_code

    if (qrCodePath) {
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
        console.log('🔍 QR Code Debug - Looking for:', qrCodePath)
        const resolvedQrPath = this.resolveQrCodePath(qrCodePath)
        
        if (resolvedQrPath) {
          console.log('✅ QR Code Debug - Found at:', resolvedQrPath)
          const qrExt = path.extname(resolvedQrPath).toLowerCase()
          const isSupportedImage = qrExt === '.png' || qrExt === '.jpg' || qrExt === '.jpeg'
          
          if (isSupportedImage) {
            console.log('📷 QR Code Debug - Reading image file...')
            const qrImageBytes = fs.readFileSync(resolvedQrPath)
            console.log('📊 QR Code Debug - Image size:', qrImageBytes.length, 'bytes')
            
            const qrImage = qrExt === '.png' 
              ? await this.pdfDoc.embedPng(qrImageBytes)
              : await this.pdfDoc.embedJpg(qrImageBytes)
            
            // Calculate proper QR code position - ensure it fits within page bounds
            const qrSize = 80
            const qrX = this.layout.width - this.MARGIN - qrSize - 20 // 20px from right margin
            const qrY = this.layout.currentY - 20
            
            console.log('🎯 QR Code Debug - Drawing at position:', {
              x: qrX,
              y: qrY,
              width: qrSize,
              height: qrSize,
              currentY: this.layout.currentY,
              pageWidth: this.layout.width,
              margin: this.MARGIN,
              maxX: this.layout.width - this.MARGIN
            })
            
            this.page.drawImage(qrImage, {
              x: qrX,
              y: qrY,
              width: qrSize,
              height: qrSize
            })
            
            this.page.drawText('Scan to Pay', {
              x: qrX + 10,
              y: qrY - 15,
              size: 8,
              font: this.fonts.regular,
              color: this.COLORS.TEXT
            })
            console.log('✅ QR Code Debug - Successfully embedded')
          } else {
            console.warn(`Unsupported QR code format: ${qrExt}. Supported formats: PNG, JPG, JPEG`)
          }
        } else {
          // Show placeholder when QR code is missing
          console.warn('❌ QR Code Debug - File not found, showing placeholder')
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

    this.layout.currentY -= 20

    // Add penalty question like your sample
    this.page.drawText('Would you like me to calculate the penalty amount if payment is made significantly after the June deadline?', {
      x: this.MARGIN,
      y: this.layout.currentY,
      size: 10,
      font: this.fonts.italic,
      color: this.COLORS.SECONDARY
    })
  }
}

export const maintenanceLetterService = new MaintenanceLetterService()
