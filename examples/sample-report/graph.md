# Environment graph — Contoso AG / Production

> **Generated file.** Edits are lost on the next run.
> Generated 2026-08-19 12:07. Rebuild with:
>
> ```
> node scripts/sample-report.mjs
> ```

**Scope:** 8 SharePoint sites · 26 SharePoint lists · 2 Dataverse tables · 42 cloud flows · 8 canvas apps

**Read from:** Dataverse ✓ () · Power Automate ✓ () · Power Apps ✓ () · SharePoint list names ✓ (8/8 sites read)

**Unresolved:**
- "Portal | Rebuild search index" has a PowerApps trigger, but no canvas app and no cloud flow refers to it. Most common cause: the flow was renamed after it was added to the app, which still holds the old name.

## 1. Triggers — which list or table starts which cloud flow

| Trigger source | Cloud flow | Trigger | Trigger condition | State |
|---|---|---|---|---|
| SharePoint Contracts/Contracts | Contracts \| Link to account | item created | — | Enabled |
| SharePoint Contracts/RenewalTasks | Contracts \| Approve renewal | item created or modified | Decision == 'Approved' | Enabled |
| SharePoint Customer Portal/7e2b0f4a-1c33-4d1e-9a77-2f5c8b6d0a91 ⚠ unresolved | Portal \| Feedback follow-up | item created or modified | — | Enabled |
| SharePoint Customer Portal/Documents | Contracts \| Sync signed documents | item created | — | Enabled |
| SharePoint Customer Portal/Documents | Portal \| Index documents | item created or modified | — | Enabled |
| SharePoint Customer Portal/Notifications | Portal \| Publish notification | item created | — | Enabled |
| SharePoint Field Service/Assignments | Field Service \| Close work order | item created or modified | Outcome != '' | Enabled |
| SharePoint Field Service/Assignments | Field Service \| Notify technician | item created | — | Enabled |
| SharePoint Field Service/WorkOrders | Field Service \| Dispatch work order | item created or modified | Status == 'Ready' | Enabled |
| SharePoint Human Resources/NewStarters | HR Onboarding \| Close onboarding | item created or modified | Progress == 100 | Enabled |
| SharePoint Human Resources/NewStarters | HR Onboarding \| Create starter record | item created | — | Enabled |
| SharePoint Human Resources/NewStarters | HR Onboarding \| Welcome email | item created or modified | StartDate == utcNow('yyyy-MM-dd') | Enabled |
| SharePoint Human Resources/OnboardingTasks | HR Onboarding \| Track task completion | item created or modified | Status == 'Done' | Enabled |
| SharePoint IT Services/EquipmentRequests | HR Onboarding \| Order equipment | item created | — | Enabled |
| SharePoint Purchasing/ApprovalTasks | Purchase Requests \| Notify approver | item created | — | Enabled |
| SharePoint Purchasing/ApprovalTasks | Purchase Requests \| Process task outcome | item created or modified | Outcome != '' | Enabled |
| SharePoint Purchasing/PurchaseRequests | Purchase Requests \| 10 Requester revision | item created or modified | Action == 'Create approval task' and StatusNumber == 10 | Enabled |
| SharePoint Purchasing/PurchaseRequests | Purchase Requests \| 20 Team lead check | item created or modified | Action == 'Create approval task' and StatusNumber == 20 | Enabled |
| SharePoint Purchasing/PurchaseRequests | Purchase Requests \| 30 Department approval | item created or modified | Action == 'Create approval task' and StatusNumber == 30 | Enabled |
| SharePoint Purchasing/PurchaseRequests | Purchase Requests \| 40 Finance review | item created or modified | Action == 'Create approval task' and StatusNumber == 40 | Enabled |
| SharePoint Purchasing/PurchaseRequests | Purchase Requests \| 50 Controlling review | item created or modified | Action == 'Create approval task' and StatusNumber == 50 | Enabled |
| SharePoint Purchasing/PurchaseRequests | Purchase Requests \| 60 CFO approval | item created or modified | Action == 'Create approval task' and StatusNumber == 60 | Enabled |
| SharePoint Purchasing/PurchaseRequests | Purchase Requests \| 70 CEO approval | item created or modified | Action == 'Create approval task' and StatusNumber == 70 | Enabled |
| SharePoint Purchasing/PurchaseRequests | Purchase Requests \| 90 Rejected | item created or modified | Action == 'Create approval task' and StatusNumber == 90 | Enabled |
| SharePoint Purchasing/PurchaseRequests | Purchase Requests \| Generate PDF | item created or modified | Action == 'Generate PDF' | Enabled |
| SharePoint Purchasing/PurchaseRequests | Purchase Requests \| Request deleted | item deleted | — | Enabled |
| SharePoint Purchasing/PurchaseRequests | Purchase Requests \| Send initial email | item created or modified | Action == 'Send email' and StatusNumber == 0 and Draft == 'no' | Enabled |
| SharePoint Quality Management/Actions | Quality Audits \| Close audit | item created or modified | Status == 'Closed' | Enabled |
| SharePoint Quality Management/Findings | Quality Audits \| Create action items | item created | — | Enabled |
| SharePoint Quality Management/Findings | Quality Audits \| Recalculate scores | item created or modified | — | Enabled |

## 2. Write access — which triggers it fires

Two levels deep. Where a chain reaches a source with its own section, ↦ points there.

### SharePoint Contracts/Contracts
- ▶ **Contracts | Link to account** (item created)
  - updates → SharePoint Contracts/Contracts — no trigger

### SharePoint Contracts/RenewalTasks
- ▶ **Contracts | Approve renewal** (item created or modified) — only when Decision == 'Approved'
  - creates → SharePoint Contracts/ContractHistory — no trigger
  - updates → SharePoint Contracts/Contracts — no trigger

### SharePoint Customer Portal/7e2b0f4a-1c33-4d1e-9a77-2f5c8b6d0a91 ⚠ unresolved
- ▶ **Portal | Feedback follow-up** (item created or modified)
  - creates → SharePoint Customer Portal/Notifications
    - ▶ **Portal | Publish notification** (item created)
      - updates → SharePoint Customer Portal/Notifications — no trigger

### SharePoint Customer Portal/Documents
- ▶ **Contracts | Sync signed documents** (item created)
  - updates → SharePoint Contracts/Contracts — no trigger
- ▶ **Portal | Index documents** (item created or modified)
  - updates → SharePoint Customer Portal/DocumentIndex — no trigger

### SharePoint Customer Portal/Notifications
- ▶ **Portal | Publish notification** (item created)
  - updates → SharePoint Customer Portal/Notifications — no trigger

### SharePoint Field Service/Assignments
- ▶ **Field Service | Notify technician** (item created)
  - updates → SharePoint Field Service/Assignments ↻ (back into a source of this chain)
- ▶ **Field Service | Close work order** (item created or modified) — only when Outcome != ''
  - creates → SharePoint Field Service/TimeEntries — no trigger
  - updates → SharePoint Field Service/WorkOrders
    - ▶ **Field Service | Dispatch work order** (item created or modified) — only when Status == 'Ready'
      - creates → SharePoint Field Service/Assignments ↻ (back into a source of this chain)
      - updates → SharePoint Field Service/WorkOrders ↻ (back into a source of this chain)

### SharePoint Field Service/WorkOrders
- ▶ **Field Service | Dispatch work order** (item created or modified) — only when Status == 'Ready'
  - creates → SharePoint Field Service/Assignments
    - ▶ **Field Service | Notify technician** (item created)
      - updates → SharePoint Field Service/Assignments ↻ (back into a source of this chain)
    - ▶ **Field Service | Close work order** (item created or modified) — only when Outcome != ''
      - creates → SharePoint Field Service/TimeEntries — no trigger
      - updates → SharePoint Field Service/WorkOrders ↻ (back into a source of this chain)
  - updates → SharePoint Field Service/WorkOrders ↻ (back into a source of this chain)

### SharePoint Human Resources/NewStarters
- ▶ **HR Onboarding | Create starter record** (item created)
  - creates → SharePoint Human Resources/OnboardingTasks
    - ▶ **HR Onboarding | Track task completion** (item created or modified) — only when Status == 'Done'
      - updates → SharePoint Human Resources/NewStarters ↻ (back into a source of this chain)
  - creates → SharePoint IT Services/EquipmentRequests
    - ▶ **HR Onboarding | Order equipment** (item created)
      - updates → SharePoint IT Services/EquipmentRequests — no trigger
      - creates → SharePoint Purchasing/PurchaseRequests ↦ own section "SharePoint Purchasing/PurchaseRequests"
  - creates → Dataverse contact — no trigger
- ▶ **HR Onboarding | Welcome email** (item created or modified) — only when StartDate == utcNow('yyyy-MM-dd')
  - creates → SharePoint Customer Portal/Notifications
    - ▶ **Portal | Publish notification** (item created)
      - updates → SharePoint Customer Portal/Notifications — no trigger
- ▶ **HR Onboarding | Close onboarding** (item created or modified) — only when Progress == 100
  - creates → SharePoint Archive/ArchivedStarters — no trigger
  - updates → SharePoint Human Resources/NewStarters ↻ (back into a source of this chain)

### SharePoint Human Resources/OnboardingTasks
- ▶ **HR Onboarding | Track task completion** (item created or modified) — only when Status == 'Done'
  - updates → SharePoint Human Resources/NewStarters
    - ▶ **HR Onboarding | Welcome email** (item created or modified) — only when StartDate == utcNow('yyyy-MM-dd')
      - creates → SharePoint Customer Portal/Notifications ↦ own section "SharePoint Customer Portal/Notifications"
    - ▶ **HR Onboarding | Close onboarding** (item created or modified) — only when Progress == 100
      - creates → SharePoint Archive/ArchivedStarters — no trigger
      - updates → SharePoint Human Resources/NewStarters ↻ (back into a source of this chain)

### SharePoint IT Services/EquipmentRequests
- ▶ **HR Onboarding | Order equipment** (item created)
  - updates → SharePoint IT Services/EquipmentRequests — no trigger
  - creates → SharePoint Purchasing/PurchaseRequests
    - ▶ **Purchase Requests | 10 Requester revision** (item created or modified) — only when Action == 'Create approval task' and StatusNumber == 10
      - creates → SharePoint Purchasing/ApprovalTasks ↦ own section "SharePoint Purchasing/ApprovalTasks"
      - updates → SharePoint Purchasing/ApprovalTasks ↦ own section "SharePoint Purchasing/ApprovalTasks"
      - updates → SharePoint Purchasing/PurchaseRequests ↻ (back into a source of this chain)
    - ▶ **Purchase Requests | 20 Team lead check** (item created or modified) — only when Action == 'Create approval task' and StatusNumber == 20
      - creates → SharePoint Purchasing/ApprovalTasks ↦ own section "SharePoint Purchasing/ApprovalTasks"
      - updates → SharePoint Purchasing/ApprovalTasks ↦ own section "SharePoint Purchasing/ApprovalTasks"
      - updates → SharePoint Purchasing/PurchaseRequests ↻ (back into a source of this chain)
    - ▶ **Purchase Requests | 30 Department approval** (item created or modified) — only when Action == 'Create approval task' and StatusNumber == 30
      - creates → SharePoint Purchasing/ApprovalTasks ↦ own section "SharePoint Purchasing/ApprovalTasks"
      - updates → SharePoint Purchasing/ApprovalTasks ↦ own section "SharePoint Purchasing/ApprovalTasks"
      - updates → SharePoint Purchasing/PurchaseRequests ↻ (back into a source of this chain)
    - ▶ **Purchase Requests | 40 Finance review** (item created or modified) — only when Action == 'Create approval task' and StatusNumber == 40
      - creates → SharePoint Purchasing/ApprovalTasks ↦ own section "SharePoint Purchasing/ApprovalTasks"
      - updates → SharePoint Purchasing/ApprovalTasks ↦ own section "SharePoint Purchasing/ApprovalTasks"
      - updates → SharePoint Purchasing/PurchaseRequests ↻ (back into a source of this chain)
    - ▶ **Purchase Requests | 50 Controlling review** (item created or modified) — only when Action == 'Create approval task' and StatusNumber == 50
      - creates → SharePoint Purchasing/ApprovalTasks ↦ own section "SharePoint Purchasing/ApprovalTasks"
      - updates → SharePoint Purchasing/ApprovalTasks ↦ own section "SharePoint Purchasing/ApprovalTasks"
      - updates → SharePoint Purchasing/PurchaseRequests ↻ (back into a source of this chain)
    - ▶ **Purchase Requests | 60 CFO approval** (item created or modified) — only when Action == 'Create approval task' and StatusNumber == 60
      - creates → SharePoint Purchasing/ApprovalTasks ↦ own section "SharePoint Purchasing/ApprovalTasks"
      - updates → SharePoint Purchasing/ApprovalTasks ↦ own section "SharePoint Purchasing/ApprovalTasks"
      - updates → SharePoint Purchasing/PurchaseRequests ↻ (back into a source of this chain)
    - ▶ **Purchase Requests | 70 CEO approval** (item created or modified) — only when Action == 'Create approval task' and StatusNumber == 70
      - creates → SharePoint Purchasing/ApprovalTasks ↦ own section "SharePoint Purchasing/ApprovalTasks"
      - updates → SharePoint Purchasing/ApprovalTasks ↦ own section "SharePoint Purchasing/ApprovalTasks"
      - updates → SharePoint Purchasing/PurchaseRequests ↻ (back into a source of this chain)
    - ▶ **Purchase Requests | 90 Rejected** (item created or modified) — only when Action == 'Create approval task' and StatusNumber == 90
      - creates → SharePoint Purchasing/ApprovalTasks ↦ own section "SharePoint Purchasing/ApprovalTasks"
      - updates → SharePoint Purchasing/ApprovalTasks ↦ own section "SharePoint Purchasing/ApprovalTasks"
      - updates → SharePoint Purchasing/PurchaseRequests ↻ (back into a source of this chain)
    - ▶ **Purchase Requests | Generate PDF** (item created or modified) — only when Action == 'Generate PDF'
      - updates → SharePoint Purchasing/PurchaseRequests ↻ (back into a source of this chain)
    - ▶ **Purchase Requests | Send initial email** (item created or modified) — only when Action == 'Send email' and StatusNumber == 0 and Draft == 'no'
      - updates → SharePoint Purchasing/PurchaseRequests ↻ (back into a source of this chain)

### SharePoint Purchasing/ApprovalTasks
- ▶ **Purchase Requests | Process task outcome** (item created or modified) — only when Outcome != ''
  - creates → SharePoint Purchasing/AuditTrail — no trigger
  - updates → SharePoint Purchasing/PurchaseRequests
    - ▶ **Purchase Requests | 10 Requester revision** (item created or modified) — only when Action == 'Create approval task' and StatusNumber == 10
      - creates → SharePoint Purchasing/ApprovalTasks ↻ (back into a source of this chain)
      - updates → SharePoint Purchasing/ApprovalTasks ↻ (back into a source of this chain)
      - updates → SharePoint Purchasing/PurchaseRequests ↻ (back into a source of this chain)
    - ▶ **Purchase Requests | 20 Team lead check** (item created or modified) — only when Action == 'Create approval task' and StatusNumber == 20
      - creates → SharePoint Purchasing/ApprovalTasks ↻ (back into a source of this chain)
      - updates → SharePoint Purchasing/ApprovalTasks ↻ (back into a source of this chain)
      - updates → SharePoint Purchasing/PurchaseRequests ↻ (back into a source of this chain)
    - ▶ **Purchase Requests | 30 Department approval** (item created or modified) — only when Action == 'Create approval task' and StatusNumber == 30
      - creates → SharePoint Purchasing/ApprovalTasks ↻ (back into a source of this chain)
      - updates → SharePoint Purchasing/ApprovalTasks ↻ (back into a source of this chain)
      - updates → SharePoint Purchasing/PurchaseRequests ↻ (back into a source of this chain)
    - ▶ **Purchase Requests | 40 Finance review** (item created or modified) — only when Action == 'Create approval task' and StatusNumber == 40
      - creates → SharePoint Purchasing/ApprovalTasks ↻ (back into a source of this chain)
      - updates → SharePoint Purchasing/ApprovalTasks ↻ (back into a source of this chain)
      - updates → SharePoint Purchasing/PurchaseRequests ↻ (back into a source of this chain)
    - ▶ **Purchase Requests | 50 Controlling review** (item created or modified) — only when Action == 'Create approval task' and StatusNumber == 50
      - creates → SharePoint Purchasing/ApprovalTasks ↻ (back into a source of this chain)
      - updates → SharePoint Purchasing/ApprovalTasks ↻ (back into a source of this chain)
      - updates → SharePoint Purchasing/PurchaseRequests ↻ (back into a source of this chain)
    - ▶ **Purchase Requests | 60 CFO approval** (item created or modified) — only when Action == 'Create approval task' and StatusNumber == 60
      - creates → SharePoint Purchasing/ApprovalTasks ↻ (back into a source of this chain)
      - updates → SharePoint Purchasing/ApprovalTasks ↻ (back into a source of this chain)
      - updates → SharePoint Purchasing/PurchaseRequests ↻ (back into a source of this chain)
    - ▶ **Purchase Requests | 70 CEO approval** (item created or modified) — only when Action == 'Create approval task' and StatusNumber == 70
      - creates → SharePoint Purchasing/ApprovalTasks ↻ (back into a source of this chain)
      - updates → SharePoint Purchasing/ApprovalTasks ↻ (back into a source of this chain)
      - updates → SharePoint Purchasing/PurchaseRequests ↻ (back into a source of this chain)
    - ▶ **Purchase Requests | 90 Rejected** (item created or modified) — only when Action == 'Create approval task' and StatusNumber == 90
      - creates → SharePoint Purchasing/ApprovalTasks ↻ (back into a source of this chain)
      - updates → SharePoint Purchasing/ApprovalTasks ↻ (back into a source of this chain)
      - updates → SharePoint Purchasing/PurchaseRequests ↻ (back into a source of this chain)
    - ▶ **Purchase Requests | Generate PDF** (item created or modified) — only when Action == 'Generate PDF'
      - updates → SharePoint Purchasing/PurchaseRequests ↻ (back into a source of this chain)
    - ▶ **Purchase Requests | Send initial email** (item created or modified) — only when Action == 'Send email' and StatusNumber == 0 and Draft == 'no'
      - updates → SharePoint Purchasing/PurchaseRequests ↻ (back into a source of this chain)
- ▶ **Purchase Requests | Notify approver** (item created)
  - creates → SharePoint Customer Portal/Notifications
    - ▶ **Portal | Publish notification** (item created)
      - updates → SharePoint Customer Portal/Notifications — no trigger

### SharePoint Purchasing/PurchaseRequests
- ▶ **Purchase Requests | 10 Requester revision** (item created or modified) — only when Action == 'Create approval task' and StatusNumber == 10
  - creates → SharePoint Purchasing/ApprovalTasks
    - ▶ **Purchase Requests | Process task outcome** (item created or modified) — only when Outcome != ''
      - creates → SharePoint Purchasing/AuditTrail — no trigger
      - updates → SharePoint Purchasing/PurchaseRequests ↻ (back into a source of this chain)
    - ▶ **Purchase Requests | Notify approver** (item created)
      - creates → SharePoint Customer Portal/Notifications ↦ own section "SharePoint Customer Portal/Notifications"
  - updates → SharePoint Purchasing/ApprovalTasks
    - ▶ **Purchase Requests | Process task outcome** (item created or modified) — only when Outcome != ''
      - creates → SharePoint Purchasing/AuditTrail — no trigger
      - updates → SharePoint Purchasing/PurchaseRequests ↻ (back into a source of this chain)
  - updates → SharePoint Purchasing/PurchaseRequests ↻ (back into a source of this chain)
- ▶ **Purchase Requests | 20 Team lead check** (item created or modified) — only when Action == 'Create approval task' and StatusNumber == 20
  - creates → SharePoint Purchasing/ApprovalTasks
    - ▶ **Purchase Requests | Process task outcome** (item created or modified) — only when Outcome != ''
      - creates → SharePoint Purchasing/AuditTrail — no trigger
      - updates → SharePoint Purchasing/PurchaseRequests ↻ (back into a source of this chain)
    - ▶ **Purchase Requests | Notify approver** (item created)
      - creates → SharePoint Customer Portal/Notifications ↦ own section "SharePoint Customer Portal/Notifications"
  - updates → SharePoint Purchasing/ApprovalTasks
    - ▶ **Purchase Requests | Process task outcome** (item created or modified) — only when Outcome != ''
      - creates → SharePoint Purchasing/AuditTrail — no trigger
      - updates → SharePoint Purchasing/PurchaseRequests ↻ (back into a source of this chain)
  - updates → SharePoint Purchasing/PurchaseRequests ↻ (back into a source of this chain)
- ▶ **Purchase Requests | 30 Department approval** (item created or modified) — only when Action == 'Create approval task' and StatusNumber == 30
  - creates → SharePoint Purchasing/ApprovalTasks
    - ▶ **Purchase Requests | Process task outcome** (item created or modified) — only when Outcome != ''
      - creates → SharePoint Purchasing/AuditTrail — no trigger
      - updates → SharePoint Purchasing/PurchaseRequests ↻ (back into a source of this chain)
    - ▶ **Purchase Requests | Notify approver** (item created)
      - creates → SharePoint Customer Portal/Notifications ↦ own section "SharePoint Customer Portal/Notifications"
  - updates → SharePoint Purchasing/ApprovalTasks
    - ▶ **Purchase Requests | Process task outcome** (item created or modified) — only when Outcome != ''
      - creates → SharePoint Purchasing/AuditTrail — no trigger
      - updates → SharePoint Purchasing/PurchaseRequests ↻ (back into a source of this chain)
  - updates → SharePoint Purchasing/PurchaseRequests ↻ (back into a source of this chain)
- ▶ **Purchase Requests | 40 Finance review** (item created or modified) — only when Action == 'Create approval task' and StatusNumber == 40
  - creates → SharePoint Purchasing/ApprovalTasks
    - ▶ **Purchase Requests | Process task outcome** (item created or modified) — only when Outcome != ''
      - creates → SharePoint Purchasing/AuditTrail — no trigger
      - updates → SharePoint Purchasing/PurchaseRequests ↻ (back into a source of this chain)
    - ▶ **Purchase Requests | Notify approver** (item created)
      - creates → SharePoint Customer Portal/Notifications ↦ own section "SharePoint Customer Portal/Notifications"
  - updates → SharePoint Purchasing/ApprovalTasks
    - ▶ **Purchase Requests | Process task outcome** (item created or modified) — only when Outcome != ''
      - creates → SharePoint Purchasing/AuditTrail — no trigger
      - updates → SharePoint Purchasing/PurchaseRequests ↻ (back into a source of this chain)
  - updates → SharePoint Purchasing/PurchaseRequests ↻ (back into a source of this chain)
- ▶ **Purchase Requests | 50 Controlling review** (item created or modified) — only when Action == 'Create approval task' and StatusNumber == 50
  - creates → SharePoint Purchasing/ApprovalTasks
    - ▶ **Purchase Requests | Process task outcome** (item created or modified) — only when Outcome != ''
      - creates → SharePoint Purchasing/AuditTrail — no trigger
      - updates → SharePoint Purchasing/PurchaseRequests ↻ (back into a source of this chain)
    - ▶ **Purchase Requests | Notify approver** (item created)
      - creates → SharePoint Customer Portal/Notifications ↦ own section "SharePoint Customer Portal/Notifications"
  - updates → SharePoint Purchasing/ApprovalTasks
    - ▶ **Purchase Requests | Process task outcome** (item created or modified) — only when Outcome != ''
      - creates → SharePoint Purchasing/AuditTrail — no trigger
      - updates → SharePoint Purchasing/PurchaseRequests ↻ (back into a source of this chain)
  - updates → SharePoint Purchasing/PurchaseRequests ↻ (back into a source of this chain)
- ▶ **Purchase Requests | 60 CFO approval** (item created or modified) — only when Action == 'Create approval task' and StatusNumber == 60
  - creates → SharePoint Purchasing/ApprovalTasks
    - ▶ **Purchase Requests | Process task outcome** (item created or modified) — only when Outcome != ''
      - creates → SharePoint Purchasing/AuditTrail — no trigger
      - updates → SharePoint Purchasing/PurchaseRequests ↻ (back into a source of this chain)
    - ▶ **Purchase Requests | Notify approver** (item created)
      - creates → SharePoint Customer Portal/Notifications ↦ own section "SharePoint Customer Portal/Notifications"
  - updates → SharePoint Purchasing/ApprovalTasks
    - ▶ **Purchase Requests | Process task outcome** (item created or modified) — only when Outcome != ''
      - creates → SharePoint Purchasing/AuditTrail — no trigger
      - updates → SharePoint Purchasing/PurchaseRequests ↻ (back into a source of this chain)
  - updates → SharePoint Purchasing/PurchaseRequests ↻ (back into a source of this chain)
- ▶ **Purchase Requests | 70 CEO approval** (item created or modified) — only when Action == 'Create approval task' and StatusNumber == 70
  - creates → SharePoint Purchasing/ApprovalTasks
    - ▶ **Purchase Requests | Process task outcome** (item created or modified) — only when Outcome != ''
      - creates → SharePoint Purchasing/AuditTrail — no trigger
      - updates → SharePoint Purchasing/PurchaseRequests ↻ (back into a source of this chain)
    - ▶ **Purchase Requests | Notify approver** (item created)
      - creates → SharePoint Customer Portal/Notifications ↦ own section "SharePoint Customer Portal/Notifications"
  - updates → SharePoint Purchasing/ApprovalTasks
    - ▶ **Purchase Requests | Process task outcome** (item created or modified) — only when Outcome != ''
      - creates → SharePoint Purchasing/AuditTrail — no trigger
      - updates → SharePoint Purchasing/PurchaseRequests ↻ (back into a source of this chain)
  - updates → SharePoint Purchasing/PurchaseRequests ↻ (back into a source of this chain)
- ▶ **Purchase Requests | 90 Rejected** (item created or modified) — only when Action == 'Create approval task' and StatusNumber == 90
  - creates → SharePoint Purchasing/ApprovalTasks
    - ▶ **Purchase Requests | Process task outcome** (item created or modified) — only when Outcome != ''
      - creates → SharePoint Purchasing/AuditTrail — no trigger
      - updates → SharePoint Purchasing/PurchaseRequests ↻ (back into a source of this chain)
    - ▶ **Purchase Requests | Notify approver** (item created)
      - creates → SharePoint Customer Portal/Notifications ↦ own section "SharePoint Customer Portal/Notifications"
  - updates → SharePoint Purchasing/ApprovalTasks
    - ▶ **Purchase Requests | Process task outcome** (item created or modified) — only when Outcome != ''
      - creates → SharePoint Purchasing/AuditTrail — no trigger
      - updates → SharePoint Purchasing/PurchaseRequests ↻ (back into a source of this chain)
  - updates → SharePoint Purchasing/PurchaseRequests ↻ (back into a source of this chain)
- ▶ **Purchase Requests | Generate PDF** (item created or modified) — only when Action == 'Generate PDF'
  - updates → SharePoint Purchasing/PurchaseRequests ↻ (back into a source of this chain)
- ▶ **Purchase Requests | Send initial email** (item created or modified) — only when Action == 'Send email' and StatusNumber == 0 and Draft == 'no'
  - updates → SharePoint Purchasing/PurchaseRequests ↻ (back into a source of this chain)
- ▶ **Purchase Requests | Request deleted** (item deleted)
  - deletes → SharePoint Purchasing/ApprovalTasks — no trigger
  - deletes → SharePoint Purchasing/AuditTrail — no trigger

### SharePoint Quality Management/Actions
- ▶ **Quality Audits | Close audit** (item created or modified) — only when Status == 'Closed'
  - updates → SharePoint Quality Management/Audits — no trigger

### SharePoint Quality Management/Findings
- ▶ **Quality Audits | Recalculate scores** (item created or modified)
  - updates → SharePoint Quality Management/Audits — no trigger
  - updates → SharePoint Quality Management/Findings ↻ (back into a source of this chain)
- ▶ **Quality Audits | Create action items** (item created)
  - creates → SharePoint Quality Management/Actions
    - ▶ **Quality Audits | Close audit** (item created or modified) — only when Status == 'Closed'
      - updates → SharePoint Quality Management/Audits — no trigger

## 3. Self-triggers — cloud flows that write into their own trigger source

These cloud flows write into their own trigger source with an action, and their trigger
listens for exactly that kind of write. Without a trigger condition they fire indefinitely.

_Not listed are cloud flows whose write does not fire their own trigger — for example an update
to a list whose trigger is "item created"._

- **Field Service | Dispatch work order** ↻ SharePoint Field Service/WorkOrders — updates · with a trigger condition
- **HR Onboarding | Close onboarding** ↻ SharePoint Human Resources/NewStarters — updates · with a trigger condition
- **Purchase Requests | 10 Requester revision** ↻ SharePoint Purchasing/PurchaseRequests — updates · with a trigger condition
- **Purchase Requests | 20 Team lead check** ↻ SharePoint Purchasing/PurchaseRequests — updates · with a trigger condition
- **Purchase Requests | 30 Department approval** ↻ SharePoint Purchasing/PurchaseRequests — updates · with a trigger condition
- **Purchase Requests | 40 Finance review** ↻ SharePoint Purchasing/PurchaseRequests — updates · with a trigger condition
- **Purchase Requests | 50 Controlling review** ↻ SharePoint Purchasing/PurchaseRequests — updates · with a trigger condition
- **Purchase Requests | 60 CFO approval** ↻ SharePoint Purchasing/PurchaseRequests — updates · with a trigger condition
- **Purchase Requests | 70 CEO approval** ↻ SharePoint Purchasing/PurchaseRequests — updates · with a trigger condition
- **Purchase Requests | 90 Rejected** ↻ SharePoint Purchasing/PurchaseRequests — updates · with a trigger condition
- **Purchase Requests | Generate PDF** ↻ SharePoint Purchasing/PurchaseRequests — updates · with a trigger condition
- **Purchase Requests | Send initial email** ↻ SharePoint Purchasing/PurchaseRequests — updates · with a trigger condition
- **Quality Audits | Recalculate scores** ↻ SharePoint Quality Management/Findings — updates · ⚠ **no trigger condition**

## 4. Cloud flow index

One section per cloud flow: `graph-flows.md` in the same folder.

| Cloud flow | Trigger | State | Solution |
|---|---|---|---|
| Contracts \| Approve renewal | SharePoint Contracts/RenewalTasks: item created or modified | Enabled | Contract Management |
| Contracts \| Archive expired | every day at 06:00 | Enabled | Contract Management |
| Contracts \| Link to account | SharePoint Contracts/Contracts: item created | Enabled | Contract Management |
| Contracts \| Renewal reminder | every day at 06:00 | Enabled | Contract Management |
| Contracts \| Sync signed documents | SharePoint Customer Portal/Documents: item created | Enabled | Contract Management |
| Field Service \| Close work order | SharePoint Field Service/Assignments: item created or modified | Enabled | Field Service |
| Field Service \| Dispatch work order | SharePoint Field Service/WorkOrders: item created or modified | Enabled | Field Service |
| Field Service \| Escalate overdue orders | every day at 06:00 | Enabled | Field Service |
| Field Service \| Notify technician | SharePoint Field Service/Assignments: item created | Enabled | Field Service |
| Field Service \| Sync customer data | every day at 06:00 | Enabled | Field Service |
| Field Service \| Weekly utilisation report | every day at 06:00 | Enabled | Field Service |
| HR Onboarding \| Close onboarding | SharePoint Human Resources/NewStarters: item created or modified | Enabled | HR Onboarding |
| HR Onboarding \| Create starter record | SharePoint Human Resources/NewStarters: item created | Enabled | HR Onboarding |
| HR Onboarding \| Order equipment | SharePoint IT Services/EquipmentRequests: item created | Enabled | HR Onboarding |
| HR Onboarding \| Reminder for open tasks | every day at 06:00 | Enabled | HR Onboarding |
| HR Onboarding \| Track task completion | SharePoint Human Resources/OnboardingTasks: item created or modified | Enabled | HR Onboarding |
| HR Onboarding \| Welcome email | SharePoint Human Resources/NewStarters: item created or modified | Enabled | HR Onboarding |
| Portal \| Clean up read notifications | every day at 06:00 | Enabled | Customer Portal |
| Portal \| Feedback follow-up | SharePoint Customer Portal/7e2b0f4a-1c33-4d1e-9a77-2f5c8b6d0a91 ⚠ unresolved: item created or modified | Enabled | Customer Portal |
| Portal \| Index documents | SharePoint Customer Portal/Documents: item created or modified | Enabled | Customer Portal |
| Portal \| Publish notification | SharePoint Customer Portal/Notifications: item created | Enabled | Customer Portal |
| Portal \| Rebuild search index | from a canvas app ⚠ no caller found | Enabled | Customer Portal |
| Purchase Requests \| 10 Requester revision | SharePoint Purchasing/PurchaseRequests: item created or modified | Enabled | Purchase Requests |
| Purchase Requests \| 20 Team lead check | SharePoint Purchasing/PurchaseRequests: item created or modified | Enabled | Purchase Requests |
| Purchase Requests \| 30 Department approval | SharePoint Purchasing/PurchaseRequests: item created or modified | Enabled | Purchase Requests |
| Purchase Requests \| 40 Finance review | SharePoint Purchasing/PurchaseRequests: item created or modified | Enabled | Purchase Requests |
| Purchase Requests \| 50 Controlling review | SharePoint Purchasing/PurchaseRequests: item created or modified | Enabled | Purchase Requests |
| Purchase Requests \| 60 CFO approval | SharePoint Purchasing/PurchaseRequests: item created or modified | Enabled | Purchase Requests |
| Purchase Requests \| 70 CEO approval | SharePoint Purchasing/PurchaseRequests: item created or modified | Enabled | Purchase Requests |
| Purchase Requests \| 90 Rejected | SharePoint Purchasing/PurchaseRequests: item created or modified | Enabled | Purchase Requests |
| Purchase Requests \| Archive closed requests | every day at 06:00 | Enabled | Purchase Requests |
| Purchase Requests \| Generate PDF | SharePoint Purchasing/PurchaseRequests: item created or modified | Enabled | Purchase Requests |
| Purchase Requests \| Notify approver | SharePoint Purchasing/ApprovalTasks: item created | Enabled | Purchase Requests |
| Purchase Requests \| Process task outcome | SharePoint Purchasing/ApprovalTasks: item created or modified | Enabled | Purchase Requests |
| Purchase Requests \| Request deleted | SharePoint Purchasing/PurchaseRequests: item deleted | Enabled | Purchase Requests |
| Purchase Requests \| Send initial email | SharePoint Purchasing/PurchaseRequests: item created or modified | Enabled | Purchase Requests |
| Quality Audits \| Close audit | SharePoint Quality Management/Actions: item created or modified | Enabled | Quality Audits |
| Quality Audits \| Create action items | SharePoint Quality Management/Findings: item created | Enabled | Quality Audits |
| Quality Audits \| Legacy score export | every day at 06:00 | Disabled | Quality Audits |
| Quality Audits \| Publish audit report | manual or child flow | Enabled | Quality Audits |
| Quality Audits \| Recalculate scores | SharePoint Quality Management/Findings: item created or modified | Enabled | Quality Audits |
| Quality Audits \| Yearly audit plan | every day at 06:00 | Enabled | Quality Audits |

## 5. Canvas apps

### Approval Inbox
- Solution: Purchase Requests
- Bound data sources: SharePoint Purchasing/ApprovalTasks
- Calls cloud flows: —

### Audit App
- Solution: Quality Audits
- Bound data sources: SharePoint Quality Management/Actions, SharePoint Quality Management/Audits, SharePoint Quality Management/Findings
- Calls cloud flows: —

### Contract Desk
- Solution: Contract Management
- Bound data sources: SharePoint Contracts/Contracts, SharePoint Contracts/RenewalTasks, Dataverse account
- Calls cloud flows: —

### Customer Portal
- Solution: Customer Portal
- Bound data sources: SharePoint Customer Portal/Documents, SharePoint Customer Portal/Notifications
- Calls cloud flows: Portal | Publish notification

### Dispatch Board
- Solution: Field Service
- Bound data sources: SharePoint Field Service/Technicians, SharePoint Field Service/WorkOrders
- Calls cloud flows: —

### Field Technician App
- Solution: Field Service
- Bound data sources: SharePoint Field Service/Assignments, SharePoint Field Service/TimeEntries, SharePoint Field Service/WorkOrders, Dataverse account
- Calls cloud flows: Field Service | Close work order

### Onboarding Portal
- Solution: HR Onboarding
- Bound data sources: SharePoint Human Resources/NewStarters, SharePoint Human Resources/OnboardingTasks, Dataverse contact
- Calls cloud flows: HR Onboarding | Welcome email

### Purchase Request App
- Solution: Purchase Requests
- Bound data sources: SharePoint Purchasing/ApprovalTasks, SharePoint Purchasing/CostCentres, SharePoint Purchasing/PurchaseRequests
- Calls cloud flows: Purchase Requests | Generate PDF

## 6. Lists and tables without a trigger

A write fires no trigger here. Read and write access remains possible.

- **Dataverse account** — Field Technician App binds; Contract Desk binds; Field Service | Sync customer data reads; Contracts | Link to account reads
- **SharePoint Archive/ArchivedContracts** — Contracts | Archive expired creates
- **SharePoint Archive/ArchivedRequests** — Purchase Requests | Archive closed requests creates
- **SharePoint Archive/ArchivedStarters** — HR Onboarding | Close onboarding creates
- **SharePoint Quality Management/Audits** — Audit App binds; Quality Audits | Recalculate scores updates; Quality Audits | Close audit updates; Quality Audits | Publish audit report reads; Quality Audits | Yearly audit plan creates
- **SharePoint Purchasing/AuditTrail** — Purchase Requests | Process task outcome creates; Purchase Requests | Request deleted deletes
- **Dataverse contact** — Onboarding Portal binds; HR Onboarding | Create starter record creates
- **SharePoint Contracts/ContractHistory** — Contracts | Approve renewal creates
- **SharePoint Purchasing/CostCentres** — Purchase Request App binds
- **SharePoint Field Service/Customers** — Field Service | Sync customer data updates
- **SharePoint Customer Portal/DocumentIndex** — Portal | Index documents updates; Portal | Rebuild search index updates
- **SharePoint Field Service/Reports** — Field Service | Weekly utilisation report creates
- **SharePoint Field Service/Technicians** — Dispatch Board binds; Field Service | Dispatch work order reads; Field Service | Notify technician reads
- **SharePoint Field Service/TimeEntries** — Field Technician App binds; Field Service | Close work order creates; Field Service | Weekly utilisation report reads

## 7. Shared lists and tables — used by more than one solution

These lists and tables hang off more than one solution. Writes take effect across the solution
boundary, and this is where dependencies break on export and import.

- **Dataverse account** — Contract Management (2), Field Service (2)
- **SharePoint Customer Portal/Documents** — Customer Portal (2), Contract Management (1), Quality Audits (1)
- **SharePoint Customer Portal/Notifications** — Customer Portal (5), HR Onboarding (2), Contract Management (1), Field Service (1), Purchase Requests (1)
- **SharePoint Purchasing/PurchaseRequests** — Purchase Requests (24), HR Onboarding (1)

