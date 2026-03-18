import { notification } from 'antd'
import { useNavigate } from 'react-router-dom'
import { Button } from 'antd'

/**
 * Provides consistent next-step guidance across all sections
 */
export const showNextStep = (
  section: 'projects' | 'units' | 'billing' | 'payments' | 'reports',
  navigate: ReturnType<typeof useNavigate>,
  customMessage?: string
): void => {
  const nextSteps = {
    projects: {
      message: customMessage || 'Next Step: Add Units',
      description: 'Project has been created successfully. You can now add units to this project.',
      action: () => navigate('/units'),
      buttonLabel: 'Go to Units'
    },
    units: {
      message: customMessage || 'Next Step: Generate Maintenance Letters',
      description:
        'Units have been imported successfully. You can now generate maintenance letters for these units.',
      action: () => navigate('/billing'),
      buttonLabel: 'Go to Maintenance Letters'
    },
    billing: {
      message: customMessage || 'Next Step: Record Payments',
      description:
        'Letters are created with Pending status. Status changes to Paid only after recording payment in the Payments & Receipts page.',
      action: () => navigate('/payments'),
      buttonLabel: 'Go to Payments & Receipts'
    },
    payments: {
      message: customMessage || 'Next Step: View Reports',
      description:
        'Payments have been recorded successfully. You can now view financial reports to analyze collections.',
      action: () => navigate('/reports'),
      buttonLabel: 'Go to Reports'
    },
    reports: {
      message: customMessage || 'Export Complete',
      description:
        'Financial report has been exported successfully. You can share this file with stakeholders or archive it for future reference.',
      action: undefined, // Reports is typically an end-of-workflow step
      buttonLabel: ''
    }
  }

  const nextStep = nextSteps[section]
  if (nextStep) {
    const notificationConfig = {
      message: nextStep.message,
      description: nextStep.description,
      duration: 10,
      btn: undefined as React.ReactNode
    }

    if (nextStep.action && nextStep.buttonLabel) {
      notificationConfig.btn = (
        <Button
          type="primary"
          size="small"
          onClick={() => nextStep.action!()}
          style={{ marginLeft: 8 }}
        >
          {nextStep.buttonLabel}
        </Button>
      )
    }

    notification.info(notificationConfig)
  }
}

/**
 * Shows completion message with optional next-step guidance
 */
export const showCompletionWithNextStep = (
  section: 'projects' | 'units' | 'billing' | 'payments' | 'reports',
  action: string,
  navigate: ReturnType<typeof useNavigate>,
  details?: string
): void => {
  // Show success message first
  notification.success({
    message: action,
    description: details,
    duration: 4.5
  })

  // Show next-step guidance after a short delay
  setTimeout(() => {
    showNextStep(section, navigate)
  }, 1000)
}
