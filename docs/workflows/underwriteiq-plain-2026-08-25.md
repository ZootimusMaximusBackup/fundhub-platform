# UnderwriteIQ — plain review

**Date:** 2026-08-25  
**Kind:** Read-only writeup. No fix. No live credit pull.

---

## 1. What UnderwriteIQ is

UnderwriteIQ is a first-look guess. It looks at the credit file (the report of cards, loans, and scores) and prints a dollar number. That number is **not** a lender saying yes. It is **not** several cleanup rounds. It is one pass.

---

## 2. How we get the number

**Personal pile** (the person’s cards and loans):

- **Cards:** take the highest **open** card that is at least **$5,000** and at least **24 months** old. Times **5.5**.
- **Loans:** take the highest loan (installment, auto, or house) that is at least **$10,000**, at least **24 months** old, and has **no late pays**. Times **3**.
- **One bureau only:** a bureau is one of the three companies that keep credit reports. If only **one** of them is “ready,” we cut the **personal** pile to **one-third**.

**Business pile** (the company):

- Under **12 months** old → **half** the card pile.
- **12 to 23** months → **full** card pile.
- **24 months or more** → **twice** the card pile.
- Age unknown → **$0**.
- Each saved company gets its own slice. We **add** them.

Alec never wrote the 5.5, the 3, or the one-third cut. Those are ours.

### Tiny fake example

A **$10,000** card that is **30 months** old. Card pile = **$55,000** ($10,000 × 5.5).

One company, also **30 months** old (twice the card pile):

- Company pile = **$110,000**.
- If only one bureau is ready, the personal pile becomes about **$18,333** ($55,000 ÷ 3). Company pile stays **$110,000**.

Two companies, both **30 months** old:

- We add the company slice twice → **$220,000**.
- Alec would pick the **strongest one**, not add them.

---



## 3. What we ignore

We do **not** use these for the dollars:

- An **extra owner** (a second person who owns part of the company).
- **Income** (what they make or what the company sells).
- **Experian Business** (the company’s credit file, including any date on it).
- **LLC dollars** (LLC = a type of company on paper). We have no LLC field, so LLC does not change the number.

---



## 4. Us vs Alec

Only the **8 worst**. Alec = the teacher whose playbook we compared.


| Thing                                                                                                                                                                        | Match | We do something else | We skip |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | -------------------- | ------- |
| Money from card × 5.5 (Alec never taught this)                                                                                                                               |       | Yes                  |         |
| A **23-month** company still gets paid (Alec: under 24 months = no line of credit / term loan)                                                                               |       | Yes                  |         |
| We stack a **$5,000** card (Alec wants **$10,000** to call it strong)                                                                                                        |       | x the                |         |
| We call **15%** used “ready” (Alec’s strong list wants each card near **0–10%**)                                                                                             |       | Yes                  |         |
| **3 looks** in 6 months (a look = someone checked credit). Alec: almost sure no. We can still say ready.                                                                     |       | Yes                  |         |
| Extra owner, income, Experian Business                                                                                                                                       |       |                      | Yes     |
| Two companies: we **add**. Alec: fund **one**, the strongest.                                                                                                                |       | Yes                  |         |
| “Ready” and the dollar fight. A 670–680 file can be “not ready” and still show a big number. A 720 file with one bureau is ready, but personal dollars are cut to one-third. |       | Yes                  |         |


**Match on the 8 worst:** none.

---



## 5. Why the number can look off

We do **one** pass. We do **not** run lots of cleanup rounds and then print a new number.

If you see words like “after optimization,” that is **not** a real second pass. The dollar you see is still the first-look guess.

That is why a file can look “not ready” and still show a big number. Ready and dollars do not always move together.

---

**Nothing for you to click.** This is the review sheet only. No fix in this pass.