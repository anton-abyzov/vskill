---
name: tax-filing
description: >
  End-to-end corporate and personal tax preparation: data gathering from Xero/bank statements/Gmail/Obsidian/Google Drive,
  P&L generation, IRS compliance analysis, tax calculation, document staging, and payment guidance.
  Use this skill when the user mentions tax filing, tax preparation, P&L report, Form 1120, Form 1040, 
  corporate tax, personal tax return, Sorsher, accountant meeting, tax deadline, estimated tax payment,
  IRS payment, extension filing, 1099, W-2, bank statement analysis for taxes, constructive dividends,
  home office deduction, or any tax-year financial preparation. Also activate when the user wants to
  analyze business expenses, calculate tax liability, prepare audit documentation, or generate invoices
  for foreign contractors. This skill handles both C-Corp (Form 1120) and personal MFJ (Form 1040) returns.
---

# Tax Filing Skill

Automates the entire tax preparation workflow for a small business (C-Corp, S-Corp, or LLC) and the owner's personal return. Built from real-world experience preparing a Delaware C-Corporation Form 1120 and MFJ Form 1040 with three children.

## How This Skill Works

Tax preparation is a 7-phase pipeline. Each phase builds on the previous one. Run phases in order, but use parallel sub-agents within each phase to maximize speed.

---

## Phase 1: Data Gathering

Launch these 5 research agents **in parallel**:

### Agent 1: Accounting System Export
- If Xero: use the Xero API (OAuth2 custom connection) to export all data
  - Settings: organization, chart of accounts, tax rates, contacts
  - Per-year: bank transactions, journals, invoices, payments, reports (P&L, balance sheet, trial balance, bank summary)
  - Note: bank STATEMENT LINES (unreconciled items in Xero UI) are NOT accessible via API -- only matched transactions
- If no accounting system: skip to bank statement analysis

### Agent 2: Obsidian Vault Search
- Auto-discover vault: check `~/Projects/Obsidian/*/` or common locations
- Search for: tax, filing, 1099, W-2, P&L, accountant name, company name, EIN, EFTPS
- Read all synthesis docs in `wiki/synthesis/tax-*`
- Extract: credentials (EFTPS, accountant portal), prior research, income flow maps, bank analyses
- Check for prior year preparation documents

### Agent 3: Gmail Search
- Search for accountant correspondence (extension status, appointment details, portal links)
- Search for tax forms: W-2 notifications (ADP, Gusto), 1099 (Ascen, KForce, Robinhood, BofA), 1095-C
- Search for: Xero invoices, Hetzner/Cloudflare/hosting invoices, bank connection notifications
- Search for Delaware franchise tax correspondence
- Extract: meeting dates, deadlines, payment confirmations, document statuses

### Agent 4: Google Drive / Filesystem Search
- Auto-discover Google Drive mount: `~/Library/CloudStorage/GoogleDrive-*/My Drive/`
- Search for organized tax folder (e.g., `Finance-&-Legal/Tax/{year}-Tax-Filing/`)
- Inventory: W-2 PDFs, 1099 PDFs, bank statements, prior returns, invoices, contracts
- Also check `~/Downloads/` for recently downloaded tax files
- Read the prior year's filed corporate return (Form 1120) to understand how the accountant structured categories

### Agent 5: Bank Statement Analysis
- Find bank statement PDFs (Chase, BofA, Mercury, etc.)
- If a categorized analysis already exists in Obsidian (`chase-*-full-analysis.md`), use it
- Otherwise, read each monthly statement and categorize every deposit and withdrawal
- Key classifications:
  - **Revenue**: C2C consulting deposits (KForce, Ascen, KPG99, etc.), platform fees
  - **NOT revenue**: owner Zelle transfers (capital contributions), card purchase returns, CC cash redemptions, family transfers
  - **Business expenses**: hosting, software, insurance, travel, meals, advertising
  - **Personal expenses through business** (constructive dividends): mortgage, HOA, utilities, personal subscriptions
  - **Payroll**: Gusto deposits may be client payments routed through Gusto (not self-payroll) -- check W-2 package to verify

---

## Phase 2: Analysis & Classification

After all agents return, synthesize findings:

### Revenue Classification
- Match bank deposits to contracts/1099s
- Verify: does the 1099 list the corporation's EIN or the owner's SSN? This determines which return it belongs to.
- C2C consulting through a corporation may NOT receive a 1099-NEC -- bank deposits + invoices are sufficient proof
- Soccer/personal Zelle payments in business account = NOT business revenue unless for services rendered

### Expense Classification (Use Prior Year's Categories)
Read the prior year Form 1120 to match Sorsher's/accountant's category structure. Common mapping:

| IRS Line | Category | What Goes Here |
|---|---|---|
| Line 20 | Advertising | Foreign marketing agencies, HYPE/accelerator programs, local tournament promotion |
| Line 13 | Salaries & Wages | Employee W-2 wages (from Gusto W-2 package) |
| Line 17 | Taxes & Licenses | Delaware Division of Revenue, state taxes |
| Line 26 | Other Deductions | Everything else (see detail sheet) |

Line 26 detail categories: Computer & Internet, Travel, Business Meals (50%), Marketing & Promotion, Insurance, Legal & Professional Fees, Licenses & Permits, Office Expense, Automobile, Home Office Reimbursement, Miscellaneous.

### Critical Reclassification Rules
- **Owner Zelle to business**: capital contribution (Director's Loan account 2700), not revenue
- **Mortgage/HOA/utilities from business account**: shareholder distributions, not deductible expenses
- **Home office portion** of housing costs: deductible ONLY through formal accountable plan (IRC 62(c))
- **Gusto deposits**: check the Gusto W-2 package. If no W-2 was issued to the owner, those deposits were likely client payments, not payroll wash
- **Cash-basis accounting**: expense is recognized when paid, regardless of when services were performed

---

## Phase 3: P&L Generation

Read `references/pnl-template.html` for the exact HTML/CSS template.

### Generate the Income Statement
- Use the template with Georgia serif font, double-ruled borders, professional formatting
- Include: Revenue by client, Total Revenue, Expenses by category, Total Expenses, Net Income, Tax computation box, YoY comparison table
- Convert to PDF: `"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless --disable-gpu --print-to-pdf="output.pdf" input.html`
- If Chrome is not available, try `pandoc` with `--pdf-engine=pdflatex` or `wkhtmltopdf`

### Generate Supporting Invoices (if needed)
Read `references/invoice-template.html` for the template. Generate quarterly invoices for:
- Foreign advertising/marketing providers (with their tax ID, address, service descriptions)
- Accelerator programs or one-time large expenses
- Mark payment method (bank transfer vs cash) on each invoice

---

## Phase 4: IRS Compliance & Risk Assessment

Research current-year IRS thresholds. Read `references/irs-knowledge.md` for the embedded tax rules, then web-search for any updates.

### Key Checks
1. **Advertising ratio**: compare to industry norm (10-20% for tech). YoY trend matters -- decreasing is good
2. **Officer compensation**: must be "reasonable" -- too low triggers IRS scrutiny for C-Corps
3. **Constructive dividends**: personal expenses through business account = highest audit risk
4. **Accumulated earnings tax**: $250K credit ($150K for PSC). Only matters above those thresholds
5. **Personal holding company**: sole owner + 60% personal service income = PHC risk. Check if contracts name the corp or the individual
6. **Hobby loss (Section 183)**: does NOT apply to C-Corporations
7. **Home office**: calculate deduction opportunity (sq ft % of mortgage + HOA + utilities). Requires accountable plan resolution
8. **Foreign payments**: check W8-BEN status, 1042-S filing obligations, FBAR thresholds ($10K aggregate foreign accounts)

### Expense Optimization Recommendations
- Spread expenses across categories (avoid concentration in one line)
- Reclassify AI/software from "subscriptions" to "Computer & Internet" or "R&D"
- Split travel into Travel + Meals (meals at 50%)
- Separate insurance from professional fees
- Add automobile mileage ($0.70/mile for 2025) if driving to business events
- Home office accountable plan: biggest legitimate savings opportunity

---

## Phase 5: Tax Calculation

### Corporate (Form 1120)
```
Revenue - Expenses = Taxable Income
Taxable Income x 21% = Federal Tax
Less: Estimated payments already made = Balance Due
```

### Personal (Form 1040 MFJ)
```
W-2 Box 1 + Other Income = Total Income
Total Income - Standard Deduction ($30,000 MFJ 2025) = Taxable Income
Apply brackets: 10% / 12% / 22% / 24% / 32% / 35% / 37%
Less: Child Tax Credit ($2,000/child)
Less: W-2 Box 2 (federal withheld) = Refund or Balance Due
```

### Key Knowledge
- Extension extends TIME TO FILE, not TIME TO PAY. Tax is due by original deadline (April 15 for 1120)
- 1095-C not required for filing (Paperwork Burden Reduction Act, signed Dec 23, 2024)
- Florida has no state income tax and no individual mandate
- Delaware does not tax out-of-state corporate income
- Standard deduction ($30,000 MFJ) beats itemized for most taxpayers under SALT cap ($10,000)

---

## Phase 6: Document Preparation

### Audit Evidence Map
For EVERY P&L line item, document:
- Dollar amount
- Supporting document (with file path)
- Audit risk level (LOW / MEDIUM / HIGH)
- Action needed (if any)

### Stage Upload Folder
Create `~/Desktop/Sorsher-Upload-{year}/` (or accountant name) with subfolders matching the portal structure:
- Corporate folder: P&L PDF, W-2 packages, Good Standing cert, 940/941, bank statements, invoices, 1099s
- Personal folder: W-2, 1095-C (if available), mortgage 1098

### Generate Templates
- Home office accountable plan resolution (read `references/home-office-resolution.md`)
- Fill in: company name, EIN, address, office square footage calculation, expense amounts

### Identify Gaps
Flag missing documents by priority:
- CRITICAL: items that block filing
- MEDIUM: items that reduce accuracy
- LOW: nice-to-have for audit defense

---

## Phase 7: Filing & Payment

### Corporate Tax Payment
1. Check EFTPS first (eftps.gov). If enrolled "Through Financial Institution" = view-only, use IRS Direct Pay instead
2. IRS Direct Pay Business: irs.gov/payments > "Pay business tax"
   - Form: 1120 Corporation Income Tax
   - Reason: Extension
   - Tax Period: December of the tax year
   - Year: the tax year being filed
3. Record confirmation number in Obsidian and git repo

### Update Records
- Update Obsidian tax preparation note with payment confirmation
- Update P&L PDF to show "Balance due: $0.00" with confirmation number
- Git commit and push all changes
- Update Claude memory with payment record

---

## Reference Files

| File | When to Read | What It Contains |
|---|---|---|
| `references/irs-knowledge.md` | Phase 4 | Tax rules, thresholds, safe harbors, penalty rates |
| `references/pnl-template.html` | Phase 3 | HTML/CSS template for professional P&L |
| `references/invoice-template.html` | Phase 3 | HTML/CSS template for quarterly invoices |
| `references/home-office-resolution.md` | Phase 6 | Corporate resolution template for accountable plan |

---

## Anti-Patterns to Avoid

- Never count owner Zelle transfers as revenue
- Never count personal expenses (mortgage, HOA) as business deductions without an accountable plan
- Never assume Gusto deposits are self-payroll -- check the W-2 package first
- Never skip the prior year return analysis -- the accountant's category structure matters
- Never tell the user to "wait for 1095-C" -- it's not needed for filing
- Never use EFTPS if enrolled through a financial institution (it's view-only)
- Never forget that extension = more time to file, NOT more time to pay
