---
name: Multisend
description: Compact dark Ethereum token transfer workbench
colors:
  page: "#141a20"
  panel: "#1b242e"
  header: "#202f3e"
  text: "#edf1f5"
  muted: "#adbac7"
  primary: "#aedcbc"
  primary-ink: "#17271f"
  warning: "#f0c477"
  error: "#ffaaa7"
  line: "#364657"
  input: "#141e29"
  selected: "#1e3331"
typography:
  headline:
    fontFamily: "Segoe UI, Roboto, Helvetica, Arial, sans-serif"
    fontSize: "28px"
    fontWeight: 620
    lineHeight: 1.2
    letterSpacing: "-0.025em"
  title:
    fontSize: "18px"
    fontWeight: 600
  body:
    fontFamily: "Segoe UI, Roboto, Helvetica, Arial, sans-serif"
    fontSize: "14px"
    lineHeight: 1.6
  label:
    fontSize: "12px"
rounded:
  control: "4px"
  button: "5px"
  panel: "7px"
spacing:
  tight: "8px"
  related: "12px"
  group: "20px"
  workspace: "30px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-ink}"
    rounded: "{rounded.button}"
    padding: "9px 13px"
  input:
    backgroundColor: "{colors.input}"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
    padding: "10px"
---

## Overview

User-confirmed dark operational screen for recurring reward-token batches. Inventory and review remain the primary work areas; setup is an inline disclosure. No marketing landing page or decorative imagery.

## Colors

Slate-blue surfaces establish the shell. Pale green carries selection, readiness, actions and focus. Amber identifies approval requirements and pending setup; pale red identifies errors. Token value is never inferred from a color or price absence.

## Typography

System UI type supports dense scanning. Addresses use Consolas; balances and amounts use tabular numerals. Titles are 18px, labels and hints 12px, body 14px, main heading 28px (25px below 600px). Paragraph measure is capped at 75ch.

## Layout

Container maximum is 1450px with 32px horizontal padding, reduced to 16px on mobile. Desktop workspace uses a fluid inventory column and 330px review column separated by 30px. At 1000px the review stacks below inventory. At 600px setup fields stack and toolbar wraps. Populated tables scroll horizontally on narrow devices; the empty table fits without clipping its message.

## Elevation & Depth

Tonal layering and dividers provide structure. There are no box shadows or decorative glows. The desktop review rail is sticky; narrow-screen review stays in document flow.

## Shapes

Small control radii, simple rectangular rows and one 7px review panel. Checkbox selection tints a complete row. No nested card layouts.

## Components

Buttons have explicit disabled, hover and keyboard focus states. All selects reserve 34px on the right and use a consistent SVG chevron positioned 12px from the edge. Inputs retain text while editing; editing amounts invalidates the reviewed batch without replacing the active DOM subtree. Wallet, token-set and recipient controls use familiar web affordances.

Settings and discovery diagnostics are collapsed disclosures. Optional indexer keys live inside Advanced. Contract deployment is CLI-only and never appears as an app control. Post-confirmation messages distinguish transaction success from a failed balance refresh.

## Do's and Don'ts

- Keep token amounts and addresses precise; preserve tiny balances.
- Distinguish ready, approval-required, busy and failed states in text as well as color.
- Keep the recurring token set usable without an indexer key.
- Do not introduce fees, hidden per-token fallback sends, marketing sections or web deployment.
- Respect reduced motion; the sole activity dot animation becomes static.
