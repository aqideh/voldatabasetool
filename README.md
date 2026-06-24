# Volunteer Database Management Tool

A static, single-page volunteer database management tool built with vanilla HTML, CSS, and JavaScript. It runs on GitHub Pages with no server, no build step, and no framework.

The app uses SheetJS from CDN for `.xlsx` import/export, Fuse.js from CDN for fuzzy name matching, browser `localStorage` for the working database, and JSON export/import for full backup and portability.

## Files

- `index.html` — the complete application
- `README.md` — this guide

## Security and privacy posture

This is a browser-local tool. Volunteer data is stored in the browser's `localStorage`, not on GitHub Pages. This means the data stays on the device/browser profile, but it is not encrypted by the app.

Do not use shared devices for real volunteer personal data. Exported files contain personal data and should be stored and transmitted securely.

Current hardening controls:

- Content Security Policy meta tag added
- File import size limit: 5 MB
- Pasted-cell size limit: 1 MB
- JSON restore file size limit: 10 MB
- Import row limit: 5,000 rows per import
- Volunteer record limit on JSON restore: 20,000 volunteers
- Attendance limit on JSON restore: 2,000 attendance rows per volunteer
- Standard text field length limit: 500 characters
- Address and Notes length limit: 2,000 characters
- Tag limit: 50 tags per volunteer
- Tag length limit: 60 characters
- Attendance hours are constrained between 0 and 100
- JSON restore is schema-normalised before replacing local data
- XLSX exports neutralise formula-like values beginning with `=`, `+`, `-`, `@`, tab, or carriage return
- Full XLSX and JSON exports require confirmation
- Redacted roster export is available for lower-risk sharing

Known residual risks:

- The browser-local database is still unencrypted in `localStorage`
- SheetJS and Fuse.js are still loaded from CDN
- The current single-file structure still uses inline scripts and inline event handlers, so the CSP must allow inline scripts
- There is no authentication or role-based access control
- There is no audit log for manual edits by design

For production-grade handling of sensitive volunteer PII, use an authenticated backend with access control, server-side validation, encrypted storage, and audit logging.

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
4. Gender
5. Address
6. Chat Session
7. Chat Session Date Conducted
8. Interests
9. Languages Spoken
10. Emergency Contact Name
11. Emergency Contact Phone
12. T-Shirt Size
13. Dietary Requirements
14. Notes

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

Data validation checks Name, Phone or Email, email format, field length limits, tag limits, hours limits, and date-like values for Chat Session Date Conducted. Use YYYY-MM-DD for Chat Session Date Conducted.

### 2. Review before committing

After upload or pasted-cell preview, click **Prepare Merge Review**.

The review is split into these areas:

- **Pre-merge tags and batch edit** — apply tags or batch field changes to staged rows before saving
- **Clean additions** — new rows or high-confidence merges without field conflicts
- **Conflicts** — same person, but fields differ; choose existing, incoming, or type a correction
- **Suspected duplicates** — medium or low confidence matches requiring a human decision

Nothing is written to the database until **Confirm Import** is clicked.

For suspected duplicates, choose one of:

- **Confirm merge** — merge into the existing volunteer
- **Keep separate** — create a separate volunteer record
- **Skip for now** — keep the item in the persistent Suspected Duplicates queue

### 3. Add tags and batch edit before merge

In **Merge Review**, use **Pre-merge tags and batch edit** before clicking **Confirm Import**.

You can apply changes to:

- All pending rows
- Clean additions
- Conflicts
- Suspected duplicates

#### Add tags before merge

Enter comma-separated tags, for example:

```text
youth, logistics, befriender
```

Then click **Add tags to selected rows**.

The tags are staged on the incoming import rows. They are not saved to the database until **Confirm Import** is clicked.

If a staged row is merged into an existing volunteer, the staged tags are added to that existing volunteer. If a staged row is kept separate or imported as a new volunteer, the staged tags are saved on the new volunteer record.

#### Batch edit before merge

Choose a field, enter the new value, and click **Apply batch edit**.

For roster imports, supported batch-edit fields are:

- Gender
- Address
- Chat Session
- Chat Session Date Conducted
- Interests
- Languages Spoken
- Emergency Contact Name
- Emergency Contact Phone
- T-Shirt Size
- Dietary Requirements
- Notes

For attendance imports, supported batch-edit fields are:

- Event Name
- Date
- Hours
- Role

Name, Phone, and Email are not batch-edited in Merge Review because they are used for deduplication and matching. Change those in the source file or pasted cells before preparing the Merge Review.

### 4. Use the Central Database

Go to **Central Database**.

You can search, filter by tag, filter by gender, filter by T-shirt size, filter by attendance activity, click a row to expand a full profile, edit personal particulars inline, view the volunteer's full attendance log, edit attendance rows inline, and add or delete attendance rows.

The table shows Name, Phone, Email, Gender, Address, Chat Session, Chat Session Date Conducted, Interests, Languages Spoken, Tags, T-Shirt, Dietary, Total Hours, and Last Active.

### 5. Assign and recall tags after import

Tags are managed in each volunteer's expanded profile.

To assign tags:

1. Go to **Central Database**
2. Click a volunteer row to expand the profile
3. Edit the **Tags** field
4. Enter comma-separated tags, for example:

```text
youth, logistics, befriender
```

Tags are normalised to lowercase, deduplicated, and stored with the volunteer record.

To recall volunteers by tag:

1. Go to **Central Database**
2. Use the **Recall by tag** dropdown
3. Select a tag to show only volunteers with that tag

You can also search by tag in the search box.

To sort by tags, use the **Sort** dropdown and choose **Tag then name**. Other sort options include Name A-Z, Total hours high-low, and Last active newest.

Tags, gender, address, chat session details, interests, and languages spoken are included in:

- The Central Database table
- Volunteer profile editing
- Search text
- Full `database.xlsx` export
- JSON save files

### 6. Export and back up

Go to **Export**.

Available exports:

- **Export database.xlsx** — creates a full Excel workbook with Volunteer Particulars and Attendance Log sheets
- **Export redacted roster.xlsx** — creates a lower-risk roster without phone, email, address, emergency contact, and notes fields
- **Export merge log.xlsx** — exports merge and conflict review history
- **Export JSON save file** — exports the full local database, suspected duplicate queue, merge log, tags, gender, and address

Full XLSX and JSON exports show a confirmation warning before download.

### 7. Restore from JSON

Use **Import JSON save file** only with files exported by this tool.

Before restore, the app validates and normalises:

- Volunteer array shape
- Volunteer field types and length limits
- Tags
- Attendance rows
- Suspected duplicate queue
- Merge log rows

Invalid or oversized JSON restore files are rejected.

### 8. Resolve suspected duplicates later

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

Gender, Address, Chat Session, Chat Session Date Conducted, Interests, and Languages Spoken are included in the schema and roster import template:

```js
{ key:'gender', label:'Gender', type:'text' }
{ key:'address', label:'Address', type:'textarea' }
{ key:'chatSession', label:'Chat Session', type:'text' }
{ key:'chatSessionDate', label:'Chat Session Date Conducted', type:'date' }
{ key:'interests', label:'Interests', type:'textarea' }
{ key:'languagesSpoken', label:'Languages Spoken', type:'textarea' }
```

To add another new field:

1. Add a new object to `VOLUNTEER_SCHEMA`.
2. If the field should be imported from `volunteer_roster.xlsx`, add the exact Excel header to `ROSTER_HEADERS`.
3. Update `mapRosterRow()` so the new column is read into the matching field key.
4. Update `exportDatabaseXlsx()` if the field should appear in the exported workbook.
5. Update JSON validation if the new field needs a different length or type rule.
6. Test with a sample roster file using the new exact header order.

## Development notes

- No framework is used.
- No backend is used.
- No build command is required.
- All application logic is in `index.html`.
- The code favours direct, readable control flow over abstractions.

## Limitations

This is a browser-local tool. It is suitable for lightweight volunteer data management, import review, deduplication, tagging, and exports. It is not a multi-user system and does not provide authentication, role-based access control, encrypted shared storage, server-side backups, or audit-grade data integrity.
