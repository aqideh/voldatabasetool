# Volunteer Database Management Tool

A static, single-page volunteer database management tool built with vanilla HTML, CSS, and JavaScript. It runs on GitHub Pages with no server, no build step, and no framework.

The app uses SheetJS from CDN for `.xlsx` import/export, Fuse.js from CDN for fuzzy name matching, browser `localStorage` for the working database, and JSON export/import for full backup and portability.

## Files

- `index.html` — the complete application
- `README.md` — this guide

## How to use the tool

Open the hosted page or open `index.html` directly in a browser.

### 1. Import a standard template

Go to **Upload**. Choose either **Volunteer roster** or **Attendance log**.

You can import data in either of these ways:

- Upload an Excel `.xlsx` or `.xls` workbook
- Paste copied spreadsheet cells from Excel or Google Sheets into the paste box

Both methods use the same strict validation. The first row must be the exact header row for the selected template. Column names and order must match exactly.

#### `volunteer_roster.xlsx`

Columns, in this exact order:

1. Name
2. Phone
3. Email
4. Emergency Contact Name
5. Emergency Contact Phone
6. T-Shirt Size
7. Dietary Requirements
8. Notes

#### `attendance_log.xlsx`

Columns, in this exact order:

1. Name
2. Phone
3. Email
4. Event Name
5. Date
6. Hours
7. Role

Rows are flagged as invalid when they do not have Name and at least one of Phone or Email. Invalid rows are previewed but not imported.

### 2. Review before committing

After upload or pasted-cell preview, click **Prepare Merge Review**.

The review is split into three buckets:

- **Clean additions** — new rows or high-confidence merges without field conflicts
- **Conflicts** — same person, but fields differ; choose existing, incoming, or type a correction
- **Suspected duplicates** — medium or low confidence matches requiring a human decision

Nothing is written to the database until **Confirm Import** is clicked.

For suspected duplicates, choose one of:

- **Confirm merge** — merge into the existing volunteer
- **Keep separate** — create a separate volunteer record
- **Skip for now** — keep the item in the persistent Suspected Duplicates queue

### 3. Use the Central Database

Go to **Central Database**.

You can search, filter by T-shirt size, filter by attendance activity, click a row to expand a full profile, edit personal particulars inline, view the volunteer's full attendance log, edit attendance rows inline, and add or delete attendance rows.

The table shows Name, Phone, Email, T-Shirt, Dietary, Total Hours, and Last Active.

### 4. Export and back up

Go to **Export**.

Available exports:

- **Export database.xlsx** — creates an Excel workbook with two sheets: Volunteer Particulars and Attendance Log
- **Export merge log.xlsx** — exports merge and conflict review history
- **Export JSON save file** — exports the full local database, suspected duplicate queue, and merge log

You can also import a JSON save file to restore or move the database to another browser.

### 5. Resolve suspected duplicates later

Go to **Suspected Duplicates**. This page shows unresolved fuzzy or medium-confidence matches that were skipped during import.

## Pasted-cell import rules

When pasting cells, copy the full table from Excel or Google Sheets, including the header row. The app treats tabs as column separators and line breaks as row separators. It does not infer, rename, reorder, or map columns.

The pasted first row must exactly match the selected template headers. If the pasted headers do not match, the preview is rejected.

## Deduplication logic

The tool normalises data before matching:

- Names are lowercased
- Name titles such as Mr, Mrs, Ms, and Dr are stripped
- Comma-flipped names are handled, for example `Tan, Jane` becomes `Jane Tan`
- Phone spaces, dashes, brackets, `+65`, and leading `65` prefixes are stripped
- Emails are lowercased and trimmed

Match priority:

1. **Name + Phone** — high confidence, prepared for auto-merge
2. **Name + Email** — high confidence, prepared for auto-merge
3. **Phone + Email but name differs** — medium confidence, sent to human review
4. **Fuzzy name match only** — low confidence, always sent to human review and never auto-merged

High-confidence auto-merges are not committed immediately. They are only applied after the user clicks **Confirm Import**.

## Browser storage note

The database is stored in the browser's `localStorage` under this key:

```text
volunteerDatabaseTool.v1
```

Data is local to the browser and device. Clearing browser data may erase the database. GitHub Pages does not store the database centrally. Regular JSON exports are recommended as backups.

## Hosting on GitHub Pages

This repository is ready for GitHub Pages because it contains a static `index.html` file at the repository root.

To enable GitHub Pages:

1. Open the repository on GitHub: `aqideh/voldatabasetool`
2. Go to **Settings**
3. Go to **Pages**
4. Under **Build and deployment**, choose **Deploy from a branch**
5. Select branch **main** and folder **/** root
6. Click **Save**
7. Wait for GitHub Pages to publish the site

The site should become available at:

```text
https://aqideh.github.io/voldatabasetool/
```

## How to add a new volunteer field

The volunteer schema is defined near the top of `index.html` in the clearly labelled section:

```js
const VOLUNTEER_SCHEMA = [
  { key:'name', label:'Name', type:'text' },
  ...
];
```

To add a new field:

1. Add a new object to `VOLUNTEER_SCHEMA`.

Example:

```js
{ key:'preferredLanguage', label:'Preferred Language', type:'text' }
```

2. If the field should be imported from `volunteer_roster.xlsx`, add the exact Excel header to `ROSTER_HEADERS`.

3. Update `mapRosterRow()` so the new column is read into the matching field key.

Example:

```js
preferredLanguage: cleanText(row[8])
```

4. Update `exportDatabaseXlsx()` if the field should appear in the exported workbook.

5. Test with a sample roster file using the new exact header order.

## Development notes

- No framework is used.
- No backend is used.
- No build command is required.
- All application logic is in `index.html`.
- Every function has a plain-English comment above it.
- The code favours direct, readable control flow over abstractions.

## Limitations

This is a browser-local tool. It is suitable for lightweight volunteer data management, import review, deduplication, and exports. It is not a multi-user system and does not provide authentication, role-based access control, server-side backups, or audit-grade data integrity.
