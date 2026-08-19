# Cloud flows in detail — Contoso AG / Production

> **Generated file.** Edits are lost on the next run.
> Generated 2026-08-19 12:07. Overview: `graph.md`. Rebuild with:
>
> ```
> node scripts/sample-report.mjs
> ```

## Contracts | Approve renewal
- State: Enabled · Solution: Contract Management
- Trigger: item created or modified — only when Decision == 'Approved'
- Trigger source: SharePoint Contracts/RenewalTasks
- creates: SharePoint Contracts/ContractHistory (Create item - History)
- updates: SharePoint Contracts/Contracts (Update item - extend)
- Connectors: Sharepointonline

## Contracts | Archive expired
- State: Enabled · Solution: Contract Management
- Trigger: every day at 06:00
- creates: SharePoint Archive/ArchivedContracts (Create item - Archived contract)
- deletes: SharePoint Contracts/Contracts (Delete item - expired contract)
- reads: SharePoint Contracts/Contracts (Get items - expired)
- Connectors: Sharepointonline

## Contracts | Link to account
- State: Enabled · Solution: Contract Management
- Trigger: item created
- Trigger source: SharePoint Contracts/Contracts
- updates: SharePoint Contracts/Contracts (Update item - account link)
- reads: Dataverse account (Get a row by ID - account)
- Connectors: Commondataservice, Sharepointonline

## Contracts | Renewal reminder
- State: Enabled · Solution: Contract Management
- Trigger: every day at 06:00
- reads: SharePoint Contracts/Contracts (Get items - expiring)
- creates: SharePoint Contracts/RenewalTasks (Create item - Renewal task)
- creates: SharePoint Customer Portal/Notifications (Create item - Notification)
- Connectors: Sharepointonline

## Contracts | Sync signed documents
- State: Enabled · Solution: Contract Management
- Trigger: item created
- Trigger source: SharePoint Customer Portal/Documents
- updates: SharePoint Contracts/Contracts (Update item - document link)
- Connectors: Sharepointonline

## Field Service | Close work order
- State: Enabled · Solution: Field Service
- Trigger: item created or modified — only when Outcome != ''
- Trigger source: SharePoint Field Service/Assignments
- creates: SharePoint Field Service/TimeEntries (Create item - Time entry)
- updates: SharePoint Field Service/WorkOrders (Update item - close)
- called by: Field Technician App
- Connectors: Sharepointonline

## Field Service | Dispatch work order
- State: Enabled · Solution: Field Service
- Trigger: item created or modified — only when Status == 'Ready'
- Trigger source: SharePoint Field Service/WorkOrders
- creates: SharePoint Field Service/Assignments (Create item - Assignment)
- reads: SharePoint Field Service/Technicians (Get items - available technicians)
- updates: SharePoint Field Service/WorkOrders (Update item - assign technician)
- Connectors: Sharepointonline

## Field Service | Escalate overdue orders
- State: Enabled · Solution: Field Service
- Trigger: every day at 06:00
- reads: SharePoint Field Service/WorkOrders (Get items - overdue)
- updates: SharePoint Field Service/WorkOrders (Update item - escalate)
- creates: SharePoint Customer Portal/Notifications (Create item - Notification)
- Connectors: Sharepointonline

## Field Service | Notify technician
- State: Enabled · Solution: Field Service
- Trigger: item created
- Trigger source: SharePoint Field Service/Assignments
- updates: SharePoint Field Service/Assignments (Update item - notified)
- reads: SharePoint Field Service/Technicians (Get item - technician)
- Connectors: Sharepointonline

## Field Service | Sync customer data
- State: Enabled · Solution: Field Service
- Trigger: every day at 06:00
- updates: SharePoint Field Service/Customers (Update item - customer)
- reads: Dataverse account (List rows - accounts)
- Connectors: Commondataservice, Sharepointonline

## Field Service | Weekly utilisation report
- State: Enabled · Solution: Field Service
- Trigger: every day at 06:00
- creates: SharePoint Field Service/Reports (Create item - Report)
- reads: SharePoint Field Service/TimeEntries (Get items - last week)
- Connectors: Sharepointonline

## HR Onboarding | Close onboarding
- State: Enabled · Solution: HR Onboarding
- Trigger: item created or modified — only when Progress == 100
- Trigger source: SharePoint Human Resources/NewStarters
- creates: SharePoint Archive/ArchivedStarters (Create item - Archived starter)
- updates: SharePoint Human Resources/NewStarters (Update item - complete)
- Connectors: Sharepointonline

## HR Onboarding | Create starter record
- State: Enabled · Solution: HR Onboarding
- Trigger: item created
- Trigger source: SharePoint Human Resources/NewStarters
- creates: SharePoint Human Resources/OnboardingTasks (Create item - Onboarding task)
- creates: SharePoint IT Services/EquipmentRequests (Create item - Equipment request)
- creates: Dataverse contact (Add a new row - contact)
- Connectors: Sharepointonline, Commondataservice

## HR Onboarding | Order equipment
- State: Enabled · Solution: HR Onboarding
- Trigger: item created
- Trigger source: SharePoint IT Services/EquipmentRequests
- updates: SharePoint IT Services/EquipmentRequests (Update item - ordered)
- creates: SharePoint Purchasing/PurchaseRequests (Create item - Purchase request)
- Connectors: Sharepointonline

## HR Onboarding | Reminder for open tasks
- State: Enabled · Solution: HR Onboarding
- Trigger: every day at 06:00
- reads: SharePoint Human Resources/OnboardingTasks (Get items - open)
- creates: SharePoint Customer Portal/Notifications (Create item - Notification)
- Connectors: Sharepointonline

## HR Onboarding | Track task completion
- State: Enabled · Solution: HR Onboarding
- Trigger: item created or modified — only when Status == 'Done'
- Trigger source: SharePoint Human Resources/OnboardingTasks
- updates: SharePoint Human Resources/NewStarters (Update item - progress)
- Connectors: Sharepointonline

## HR Onboarding | Welcome email
- State: Enabled · Solution: HR Onboarding
- Trigger: item created or modified — only when StartDate == utcNow('yyyy-MM-dd')
- Trigger source: SharePoint Human Resources/NewStarters
- creates: SharePoint Customer Portal/Notifications (Create item - Notification)
- called by: Onboarding Portal
- Connectors: Sharepointonline

## Portal | Clean up read notifications
- State: Enabled · Solution: Customer Portal
- Trigger: every day at 06:00
- deletes: SharePoint Customer Portal/Notifications (Delete item - read)
- Connectors: Sharepointonline

## Portal | Feedback follow-up
- State: Enabled · Solution: Customer Portal
- Trigger: item created or modified
- Trigger source: SharePoint Customer Portal/7e2b0f4a-1c33-4d1e-9a77-2f5c8b6d0a91 ⚠ unresolved
- creates: SharePoint Customer Portal/Notifications (Create item - Notification)
- Connectors: Sharepointonline

## Portal | Index documents
- State: Enabled · Solution: Customer Portal
- Trigger: item created or modified
- Trigger source: SharePoint Customer Portal/Documents
- updates: SharePoint Customer Portal/DocumentIndex (Update item - index entry)
- Connectors: Sharepointonline

## Portal | Publish notification
- State: Enabled · Solution: Customer Portal
- Trigger: item created
- Trigger source: SharePoint Customer Portal/Notifications
- updates: SharePoint Customer Portal/Notifications (Update item - published)
- called by: Customer Portal
- Connectors: Sharepointonline

## Portal | Rebuild search index
- State: Enabled · Solution: Customer Portal
- Trigger: from a canvas app ⚠ no caller found
- updates: SharePoint Customer Portal/DocumentIndex (Update item - rebuild)
- Connectors: Sharepointonline

## Purchase Requests | 10 Requester revision
- State: Enabled · Solution: Purchase Requests
- Trigger: item created or modified — only when Action == 'Create approval task' and StatusNumber == 10
- Trigger source: SharePoint Purchasing/PurchaseRequests
- creates: SharePoint Purchasing/ApprovalTasks (Create item - Approval task)
- updates: SharePoint Purchasing/ApprovalTasks (Update item - assign approver)
- updates: SharePoint Purchasing/PurchaseRequests (Update item - advance status)
- Connectors: Sharepointonline

## Purchase Requests | 20 Team lead check
- State: Enabled · Solution: Purchase Requests
- Trigger: item created or modified — only when Action == 'Create approval task' and StatusNumber == 20
- Trigger source: SharePoint Purchasing/PurchaseRequests
- creates: SharePoint Purchasing/ApprovalTasks (Create item - Approval task)
- updates: SharePoint Purchasing/ApprovalTasks (Update item - assign approver)
- updates: SharePoint Purchasing/PurchaseRequests (Update item - advance status)
- Connectors: Sharepointonline

## Purchase Requests | 30 Department approval
- State: Enabled · Solution: Purchase Requests
- Trigger: item created or modified — only when Action == 'Create approval task' and StatusNumber == 30
- Trigger source: SharePoint Purchasing/PurchaseRequests
- creates: SharePoint Purchasing/ApprovalTasks (Create item - Approval task)
- updates: SharePoint Purchasing/ApprovalTasks (Update item - assign approver)
- updates: SharePoint Purchasing/PurchaseRequests (Update item - advance status)
- Connectors: Sharepointonline

## Purchase Requests | 40 Finance review
- State: Enabled · Solution: Purchase Requests
- Trigger: item created or modified — only when Action == 'Create approval task' and StatusNumber == 40
- Trigger source: SharePoint Purchasing/PurchaseRequests
- creates: SharePoint Purchasing/ApprovalTasks (Create item - Approval task)
- updates: SharePoint Purchasing/ApprovalTasks (Update item - assign approver)
- updates: SharePoint Purchasing/PurchaseRequests (Update item - advance status)
- Connectors: Sharepointonline

## Purchase Requests | 50 Controlling review
- State: Enabled · Solution: Purchase Requests
- Trigger: item created or modified — only when Action == 'Create approval task' and StatusNumber == 50
- Trigger source: SharePoint Purchasing/PurchaseRequests
- creates: SharePoint Purchasing/ApprovalTasks (Create item - Approval task)
- updates: SharePoint Purchasing/ApprovalTasks (Update item - assign approver)
- updates: SharePoint Purchasing/PurchaseRequests (Update item - advance status)
- Connectors: Sharepointonline

## Purchase Requests | 60 CFO approval
- State: Enabled · Solution: Purchase Requests
- Trigger: item created or modified — only when Action == 'Create approval task' and StatusNumber == 60
- Trigger source: SharePoint Purchasing/PurchaseRequests
- creates: SharePoint Purchasing/ApprovalTasks (Create item - Approval task)
- updates: SharePoint Purchasing/ApprovalTasks (Update item - assign approver)
- updates: SharePoint Purchasing/PurchaseRequests (Update item - advance status)
- Connectors: Sharepointonline

## Purchase Requests | 70 CEO approval
- State: Enabled · Solution: Purchase Requests
- Trigger: item created or modified — only when Action == 'Create approval task' and StatusNumber == 70
- Trigger source: SharePoint Purchasing/PurchaseRequests
- creates: SharePoint Purchasing/ApprovalTasks (Create item - Approval task)
- updates: SharePoint Purchasing/ApprovalTasks (Update item - assign approver)
- updates: SharePoint Purchasing/PurchaseRequests (Update item - advance status)
- Connectors: Sharepointonline

## Purchase Requests | 90 Rejected
- State: Enabled · Solution: Purchase Requests
- Trigger: item created or modified — only when Action == 'Create approval task' and StatusNumber == 90
- Trigger source: SharePoint Purchasing/PurchaseRequests
- creates: SharePoint Purchasing/ApprovalTasks (Create item - Approval task)
- updates: SharePoint Purchasing/ApprovalTasks (Update item - assign approver)
- updates: SharePoint Purchasing/PurchaseRequests (Update item - advance status)
- Connectors: Sharepointonline

## Purchase Requests | Archive closed requests
- State: Enabled · Solution: Purchase Requests
- Trigger: every day at 06:00
- creates: SharePoint Archive/ArchivedRequests (Create item - Archived request)
- reads: SharePoint Purchasing/PurchaseRequests (Get items - closed)
- Connectors: Sharepointonline

## Purchase Requests | Generate PDF
- State: Enabled · Solution: Purchase Requests
- Trigger: item created or modified — only when Action == 'Generate PDF'
- Trigger source: SharePoint Purchasing/PurchaseRequests
- updates: SharePoint Purchasing/PurchaseRequests (Update item - attach PDF)
- called by: Purchase Request App
- Connectors: Sharepointonline

## Purchase Requests | Notify approver
- State: Enabled · Solution: Purchase Requests
- Trigger: item created
- Trigger source: SharePoint Purchasing/ApprovalTasks
- creates: SharePoint Customer Portal/Notifications (Create item - Notification)
- Connectors: Sharepointonline

## Purchase Requests | Process task outcome
- State: Enabled · Solution: Purchase Requests
- Trigger: item created or modified — only when Outcome != ''
- Trigger source: SharePoint Purchasing/ApprovalTasks
- creates: SharePoint Purchasing/AuditTrail (Create item - Audit entry)
- updates: SharePoint Purchasing/PurchaseRequests (Update item - next stage)
- Connectors: Sharepointonline

## Purchase Requests | Request deleted
- State: Enabled · Solution: Purchase Requests
- Trigger: item deleted
- Trigger source: SharePoint Purchasing/PurchaseRequests
- deletes: SharePoint Purchasing/ApprovalTasks (Delete item - Approval task)
- deletes: SharePoint Purchasing/AuditTrail (Delete item - Audit entry)
- Connectors: Sharepointonline

## Purchase Requests | Send initial email
- State: Enabled · Solution: Purchase Requests
- Trigger: item created or modified — only when Action == 'Send email' and StatusNumber == 0 and Draft == 'no'
- Trigger source: SharePoint Purchasing/PurchaseRequests
- updates: SharePoint Purchasing/PurchaseRequests (Update item - mark sent)
- Connectors: Sharepointonline

## Quality Audits | Close audit
- State: Enabled · Solution: Quality Audits
- Trigger: item created or modified — only when Status == 'Closed'
- Trigger source: SharePoint Quality Management/Actions
- updates: SharePoint Quality Management/Audits (Update item - close)
- reads: SharePoint Quality Management/Findings (Get items - open findings)
- Connectors: Sharepointonline

## Quality Audits | Create action items
- State: Enabled · Solution: Quality Audits
- Trigger: item created
- Trigger source: SharePoint Quality Management/Findings
- creates: SharePoint Quality Management/Actions (Create item - Action)
- Connectors: Sharepointonline

## Quality Audits | Legacy score export
- State: Disabled · Solution: Quality Audits
- Trigger: every day at 06:00
- reads: SharePoint Quality Management/Findings (Get items)
- Connectors: Sharepointonline

## Quality Audits | Publish audit report
- State: Enabled · Solution: Quality Audits
- Trigger: manual or child flow
- creates: SharePoint Customer Portal/Documents (Create item - Document)
- reads: SharePoint Quality Management/Audits (Get item - audit)
- Connectors: Sharepointonline

## Quality Audits | Recalculate scores
- State: Enabled · Solution: Quality Audits
- Trigger: item created or modified
- Trigger source: SharePoint Quality Management/Findings
- updates: SharePoint Quality Management/Audits (Update item - roll-up)
- updates: SharePoint Quality Management/Findings (Update item - score)
- Connectors: Sharepointonline

## Quality Audits | Yearly audit plan
- State: Enabled · Solution: Quality Audits
- Trigger: every day at 06:00
- creates: SharePoint Quality Management/Audits (Create item - Audit)
- Connectors: Sharepointonline

