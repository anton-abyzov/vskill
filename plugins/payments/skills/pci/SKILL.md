---
description: PCI DSS SAQ type selection, compliance level determination, and audit requirements. Use when choosing payment integration architecture or scoping PCI compliance obligations.
---

# PCI Compliance

## SAQ Type Selection Guide

| SAQ Type | Integration Pattern | Card Data Touches Your Systems? | Questionnaire Size |
|----------|--------------------|---------------------------------|--------------------|
| **SAQ A** | Full redirect (Stripe Checkout, PayPal hosted page) | No - customer leaves your site entirely | ~22 questions |
| **SAQ A-EP** | Embedded iframe or JS (Stripe Elements, Braintree Drop-in) | No card data on server, but your page JS controls the form | ~191 questions |
| **SAQ D** | Direct API card handling (raw PAN hits your server) | Yes - you transmit, process, or store card data | ~329 questions |

**Decision flow:**
1. Can you use a hosted payment page (full redirect)? -> **SAQ A** (strongly preferred)
2. Must embed payment form in your UI? Use iframe/JS SDK -> **SAQ A-EP**
3. Must handle raw card numbers server-side? -> **SAQ D** (avoid if possible)

**Common mistake:** Using Stripe Elements (SAQ A-EP) but assuming you qualify for SAQ A.
The distinction is whether your page's JavaScript can influence the payment form. If your
JS loads on the same page as the card input, it is SAQ A-EP even though card data never
hits your server.

**SAQ A-EP gotchas:**
- Your page must serve over HTTPS (TLS 1.2+)
- You must confirm your scripts cannot intercept card data from the iframe
- Third-party scripts on the payment page (analytics, chat widgets) can disqualify SAQ A
- Content Security Policy headers are strongly recommended to limit script sources

## Compliance Levels by Transaction Volume

| Level | Annual Transactions | Validation Requirement |
|-------|--------------------|-----------------------|
| **Level 1** | >6 million (any channel) | Annual **ROC** by QSA + quarterly ASV network scan |
| **Level 2** | 1-6 million | Annual **SAQ** + quarterly ASV scan |
| **Level 3** | 20,000 - 1 million e-commerce | Annual **SAQ** + quarterly ASV scan |
| **Level 4** | <20,000 e-commerce OR <1 million total | Annual **SAQ** (ASV scan if applicable to SAQ type) |

### What Each Level Requires

**Level 1 (>6M transactions):**
- On-site audit by Qualified Security Assessor (QSA) producing Report on Compliance (ROC)
- Quarterly network vulnerability scan by Approved Scanning Vendor (ASV)
- Annual penetration test
- Typical cost: $50K-$500K+ depending on environment complexity

**Level 2 (1-6M transactions):**
- Self-Assessment Questionnaire (SAQ) completed annually
- Some acquirers require QSA sign-off on the SAQ
- Quarterly ASV scan
- Typical cost: $5K-$50K (mostly internal effort)

**Level 3 (20K-1M e-commerce):**
- SAQ completed annually
- Quarterly ASV scan
- Lower scrutiny but same technical requirements apply

**Level 4 (<20K e-commerce or <1M total):**
- SAQ completed annually
- ASV scan recommended but may not be required depending on SAQ type
- Most startups and small businesses fall here

**Key details:**
- Thresholds are per card brand (Visa, Mastercard count separately; acquirers usually use combined)
- A breach at any level can force upgrade to Level 1 requirements immediately
- Level determination is based on the acquiring bank's classification of your merchant account

## Scope Reduction Quick Reference

**Best approach (in order of preference):**
1. **SAQ A**: Use hosted payment page -- zero card data exposure, minimal compliance burden
2. **SAQ A-EP**: Use payment JS SDK/iframe -- no server-side card data, moderate compliance
3. **Tokenize at entry**: If card data must touch your system, tokenize at point of capture
4. **Network segmentation**: Isolate cardholder data environment to reduce assessment scope

**Never store (post-authorization):**
- CVV/CVC/CVV2
- Full magnetic stripe data
- PIN or PIN block

**Can store (if encrypted and access-controlled):**
- Truncated PAN (first 6 + last 4)
- Cardholder name
- Expiration date
- Token reference from payment processor
