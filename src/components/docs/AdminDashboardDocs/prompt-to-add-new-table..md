# Admin Dashboard Expansion Guide

Use the prompt template below to quickly add new tables to the CRUD dashboard. Copy and paste it whenever you want to expand the system.

## Fast-Track Prompt Template

> **Prompt:**
> I want to add a new table to the Admin Dashboard.
>
> **Table Name:** `[table_name_here]`
> **Categories:** `[category_1, category_2, ...]`
> **Display Columns:** `[column_1, column_2, ...]`
> **Editable Fields:** `[field_1, field_2, ...]`
> **Special Requirements:** `[e.g., 'Auto-fill user_id from env', 'Add a toggle for boolean fields']`
>
> Please update `adminService.ts`, `AdminDashboardView.tsx`, and `FactEditModal.tsx` to integrate this new table into the existing CRUD UI.

---

## Technical instructions for Antigravity

When this prompt is used, I will follow these steps:

1.  **`adminService.ts`**:
    *   Add the new table name to the `TableType` union.
    *   Update `createFactAdmin` if any table-specific defaults (like IDs) are needed.
2.  **`AdminDashboardView.tsx`**:
    *   Add the table to the `activeTable` state and the header toggle.
    *   Define the new table's specific categories list.
    *   Optionally define unique `columns` if they differ significantly from the "Fact" structure.
3.  **`FactEditModal.tsx`**:
    *   Add the new categories to the dynamic selection logic.
    *   Update the form fields if the new table needs inputs other than `key` and `value`.
