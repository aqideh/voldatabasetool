# MakLom

MakLom is a browser-local volunteer database tool for importing volunteer rosters, importing attendance logs, reviewing merges, managing a central database, analysing volunteer statistics, batch-editing visible volunteers, resolving suspected duplicates, and exporting backups or Excel workbooks.

The browser title and product label are **MakLom | Volunteer Data Management**. Where clarity is needed, this README refers to the product as the **MakLom Volunteer Database Tool**.

MakLom is static and runs on GitHub Pages with no backend, no framework, and no build step. Volunteer data is stored in the browser's `localStorage` on the user's device/browser profile.

## Current app structure

- `index.html` — static page shell, navigation, main view markup, privacy notice, Info panel markup, favicon reference, dashboard view, and script/style references
- `assets/app.css` — app styling, responsive layout, Info panel styling, and batch edit styling
- `assets/profile-edit.css` — profile edit/review styling
- `assets/brand.css` — MakLom logo styling inside the Info panel
- `assets/dashboard.css` — analytics dashboard KPI and chart styling
- `assets/app.js` — core app logic: imports, validation, merge review, database view, exports, JSON restore, deduplication, and attendance editing
- `assets/programmes.js` — Programmes Registered schema extension, import/export support, and programme display logic
- `assets/profile-edit.js` — reviewed profile edit flow
- `assets/batch-edit.js` — Central Database batch edit feature
- `assets/empty-filters.js` — Central Database no-value filter support
- `assets/dashboard.js` — analytics dashboard calculations and rendering
- `assets/info.js` — Info tab open/close behaviour
- `assets/maklom-logo.svg` — MakLom logo shown in the Info panel
- `assets/maklom-favicon.svg` — MakLom favicon used by the browser tab
- `vendor/xlsx-0.18.5.full.min.js` — vendored SheetJS browser build for Excel import/export
- `vendor/fuse-6.6.2.min.js` — vendored Fuse.js browser build for fuzzy matching
- `README.md` — this guide

## Branding assets

MakLom uses SVG brand assets stored in the repo:

- `assets/maklom-logo.svg` for the Info panel logo
- `assets/maklom-favicon.svg` for the browser favicon
- `assets/brand.css` for the Info panel logo sizing and spacing

The Info panel loads the full MakLom logo using:

```html
<div class="info-brand"><img src="assets/maklom-logo.svg" alt="MakLom logo"></div>
```

The favicon is declared in `index.html` using:

```html
<link rel="icon" type="image/svg+xml" href="assets/maklom-favicon.svg">
```

The current checked-in assets are SVG files. This keeps the site static, self-contained, and easy to serve from GitHub Pages.

## Core features

- Strict volunteer roster and attendance import templates
- Excel workbook upload and pasted spreadsheet-cell import
- Import preview with row-level validation
- Merge Review before anything is committed to the local database
- High-confidence merge preparation using name plus phone/email matching
- Medium/low-confidence duplicate review using phone/email and fuzzy name matching
- Persistent suspected duplicate queue
- Programme categorisation through **Programmes Registered**
- Analytics dashboard with volunteer KPIs, recruited-by-year counts, deployed-by-year counts, and programme counts
- Pre-merge tags and batch edits for staged import rows
- Central Database search, filters, no-value filter, sorting, reviewed profile editing, and attendance editing
- Central Database batch edit for currently visible volunteers, including programme batch edits
- Full Excel export, redacted roster export, merge log export, and JSON backup/restore
- Formula-safe spreadsheet exports
- Browser-local privacy warning and export confirmations
- Info tab explaining how MakLom works, with the MakLom logo displayed at the top

## Security and privacy posture

MakLom is a browser-local tool. Volunteer data is stored in the browser's `localStorage`, not on GitHub Pages or any backend server. The data stays on the device/browser profile, but it is not encrypted by the app.

Do not use shared devices for real volunteer personal data. Exported files may contain personal data and should be stored and transmitted securely.

Current hardening controls:

- Repository-owned vendored JavaScript libraries instead of runtime CDN dependencies
- Content Security Policy meta tag
- File import size limit: 5 MB
- Pasted-cell size limit: 1 MB
- JSON restore file size limit: 10 MB
- Import row limit: 5,000 rows per import
- Volunteer record limit on JSON restore: 20,000 volunteers
- Attendance limit on JSON restore: 2,000 attendance rows per volunteer
- Standard text field length limit: 500 characters
- Long text field length limit: 2,000 characters for Address, Interests, Languages Spoken, Programmes Registered, and Notes
- Tag limit: 50 tags per volunteer
- Tag length limit: 60 characters
- Attendance hours constrained between 0 and 100
- JSON restore schema-normalised before replacing local data
- XLSX exports neutralise formula-like values beginning with `=`, `+`, `-`, `@`, tab, or carriage return
- Full XLSX and JSON exports require confirmation
- Redacted roster export is available for lower-risk sharing

Known residual risks:

- The browser-local database is still unencrypted in `localStorage`
- Inline event handlers and some inline-generated UI remain, so the CSP still allows inline scripts
- There is no authentication or role-based access control
- There is no audit log for manual edits by design
- This is not a multi-user system; each browser profile has its own local database

For production-grade handling of sensitive volunteer PII, use an authenticated backend with access control, server-side validation, encrypted storage, backups, and audit logging.

## Navigation

MakLom has these top-level tabs:

- **Upload** — import roster or attendance files, or paste spreadsheet cells
- **Merge Review** — review clean rows, conflicts, suspected duplicates, staged tags, and staged batch edits before committing
- **Central Database** — search, filter, edit, batch-edit, and manage attendance
- **Dashboard** — view important volunteer statistics and charts
- **Export** — export full/redacted Excel files, merge logs, and JSON backups
- **Suspected Duplicates** — resolve duplicate candidates skipped during import
- **Info** — right-aligned blue button in the nav bar explaining how MakLom works

The Info panel includes the MakLom logo, a short explanation of the app flow, and the footer text:

```text
designed and maintained by @aqideh 2026
```

## Import workflow

Go to **Upload** and choose either **Volunteer roster** or **Attendance log**.

You can import data in either of these ways:

- Upload an Excel `.xlsx` or `.xls` workbook
- Paste copied spreadsheet cells from Excel or Google Sheets

Both methods use strict template validation. The first row must be the exact header row for the selected template. Column names and order must match exactly. MakLom does not infer, rename, reorder, or map columns.

### Volunteer roster template

The roster template must use this exact header order:

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
14. Programmes Registered
15. Notes

`Programmes Registered` accepts comma-separated values from the allowed programme list:

```text
#amPowered, RSL, Befrienders, Community Volunteers
```

Values outside the allowed list are ignored during normalisation.

### Attendance log template

The attendance template must use this exact header order:

1. Name
2. Phone
3. Email
4. Event Name
5. Date
6. Hours
7. Role

### Import validation

Rows are flagged as invalid when they do not have:

- Name
- At least one of Phone or Email

Additional validation and normalisation:

- Email format is checked when email is provided
- Chat Session Date Conducted should use `YYYY-MM-DD`
- Excel date values are normalised when possible
- Hours are constrained between 0 and 100
- Standard text fields are trimmed and capped at 500 characters
- Address, Interests, Languages Spoken, Programmes Registered, and Notes are capped at 2,000 characters
- Programmes Registered is normalised to the allowed programme list
- Invalid rows are previewed but not imported

## Programmes Registered

MakLom includes a structured **Programmes Registered** volunteer field for tracking programme involvement.

Allowed programme categories:

- `#amPowered`
- `RSL`
- `Befrienders`
- `Community Volunteers`

The field can be edited in these places:

- Volunteer roster imports
- Expanded volunteer profile via **Edit profile**
- Central Database batch edit
- JSON restore/import if the field exists in saved data

Multiple programmes are stored as comma-separated text, for example:

```text
#amPowered, RSL
```

The Central Database displays programmes as pill-style labels. The dashboard counts volunteers by programme category.

## Dashboard

The **Dashboard** tab analyses the current browser-local database.

Dashboard KPI cards include:

- Total Volunteers
- Recruited
- Active / Deployed
- Total Hours
- Deployment Rows
- Inactive

Dashboard charts include:

- Volunteers Recruited by Year
- Volunteers Deployed by Year
- Programmes Registered
- Recruited and Deployed by Year table

Definitions used by the dashboard:

- **Total Volunteers** — all records in `appData.volunteers`
- **Recruited** — volunteers with a valid year in `Chat Session Date Conducted`
- **Volunteers Recruited by Year** — grouped by the year in `Chat Session Date Conducted`
- **Active / Deployed** — volunteers with at least one attendance row
- **Volunteers Deployed by Year** — volunteers with attendance in that year; a volunteer is counted once per year even if they have multiple attendance rows in that year
- **Deployment Rows** — total attendance rows across all volunteers
- **Total Hours** — sum of recorded attendance hours
- **Programmes Registered** — volunteers grouped by the allowed programme categories

The dashboard is dependency-free. It uses HTML/CSS bars rather than a charting library.

## Merge Review workflow

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

## Pre-merge tags and batch edit

In **Merge Review**, use **Pre-merge tags and batch edit** before clicking **Confirm Import**.

You can apply changes to:

- All pending rows
- Clean additions
- Conflicts
- Suspected duplicates

### Add tags before merge

Enter comma-separated tags, for example:

```text
youth, logistics, befriender
```

Then click **Add tags to selected rows**.

The tags are staged on incoming import rows. They are not saved to the database until **Confirm Import** is clicked.

If a staged row is merged into an existing volunteer, the staged tags are added to that existing volunteer. If a staged row is kept separate or imported as a new volunteer, the staged tags are saved on the new volunteer record.

### Batch edit staged import rows

Choose a field, enter the new value, and click **Apply batch edit**.

For roster imports, supported pre-merge batch-edit fields are:

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

For attendance imports, supported pre-merge batch-edit fields are:

- Event Name
- Date
- Hours
- Role

Name, Phone, and Email are not batch-edited in Merge Review because they are used for deduplication and matching. Change those in the source file or pasted cells before preparing the Merge Review.

## Deduplication logic

MakLom normalises data before matching:

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

## Central Database

Go to **Central Database** after confirming imports.

You can:

- Search volunteers by name, phone, email, gender, address, chat session, interests, languages, programmes, notes, dietary requirements, and tags
- Filter by tag
- Filter by gender
- Filter by T-shirt size
- Filter by activity status
- Filter by no-value status across displayed data columns, including Programmes Registered
- Sort by Name A-Z, Tag then name, Total hours high-low, or Last active newest
- Click a volunteer row to expand the full profile
- Edit volunteer profile fields through the reviewed edit flow
- Edit attendance rows inline
- Add attendance rows
- Delete attendance rows

The table shows:

- Name
- Phone
- Email
- Gender
- Address
- Chat Session
- Chat Session Date Conducted
- Interests
- Languages Spoken
- Programmes Registered
- Tags
- T-Shirt Size
- Dietary Requirements
- Total Hours
- Last Active

## Reviewed profile edit flow

Expanded volunteer profiles are read-only by default. Click **Edit profile** to make changes.

Profile edits are stored in a temporary draft until they are reviewed and confirmed. Typing into fields does not immediately save the database and does not re-render the table on every keystroke.

The edit flow is:

1. Click **Edit profile**.
2. Change profile fields.
3. Click **Review changes**.
4. Review the changed fields table.
5. Click **Confirm edits**, **Back**, or **Discard edits**.

Confirming edits validates and saves once. Discarding edits abandons the draft.

## Central Database no-value filter

The **No value filter** dropdown can identify volunteers with missing values in displayed Central Database columns.

Supported no-value filter fields:

- Name
- Phone
- Email
- Gender
- Address
- Chat Session
- Chat Session Date Conducted
- Interests
- Languages Spoken
- Programmes Registered
- Tags
- T-Shirt Size
- Dietary Requirements
- Total Hours
- Last Active

For **Programmes Registered**, no value means no recognised programme category. For **Tags**, no value means no tags. For **Total Hours**, no value means total hours is `0`. For **Last Active**, no value means no attendance date.

## Central Database batch edit

The **Batch Edit Visible Volunteers** card is shown in the Central Database view above the table. It is minimised by default. Click **Open** to expand it and **Minimise** to collapse it again.

Batch edit applies only to volunteers currently visible after the current search, filters, and sort. This is intentional: filter or search first, preview the affected records, then apply the edit.

Before using batch edit on real data, export a JSON backup.

Supported batch-edit fields:

- Tags
- Programmes Registered
- Gender
- Chat Session
- Chat Session Date Conducted
- Interests
- Languages Spoken
- T-Shirt Size
- Dietary Requirements
- Notes

Supported actions:

- Tags: Add tags, Replace tags, Clear tags
- Programmes Registered: Add programmes, Replace programmes, Clear programmes
- Interests, Languages Spoken, Dietary Requirements, Notes: Replace value, Append value, Clear value
- Gender, Chat Session, Chat Session Date Conducted, T-Shirt Size: Replace value, Clear value

Batch edit validation:

- Tags are parsed, normalised to lowercase, deduplicated, and capped by the existing tag limits
- Programmes Registered is parsed against the allowed programme categories
- Chat Session Date Conducted must use `YYYY-MM-DD`
- Text values use existing field limits
- Preview shows the first 50 affected rows
- Apply requires confirmation
- Changes are saved to localStorage and then the table is re-rendered

## Tags

Tags are managed in each volunteer's expanded profile and through batch edit features.

To assign tags manually:

1. Go to **Central Database**
2. Click a volunteer row to expand the profile
3. Click **Edit profile**
4. Edit the **Tags** field
5. Click **Review changes**
6. Confirm or discard the edits

Enter comma-separated tags, for example:

```text
youth, logistics, befriender
```

Tags are normalised to lowercase, deduplicated, and stored with the volunteer record.

To recall volunteers by tag:

1. Go to **Central Database**
2. Use the **Recall by tag** dropdown
3. Select a tag to show only volunteers with that tag

You can also search by tag in the search box and sort by tag using **Tag then name**.

## Export and backup

Go to **Export**.

Available exports:

- **Export database.xlsx** — creates a full Excel workbook with Volunteer Particulars and Attendance Log sheets
- **Export redacted roster.xlsx** — creates a lower-risk roster without phone, email, address, emergency contact, and notes fields
- **Export merge log.xlsx** — exports merge and conflict review history
- **Export JSON save file** — exports the full local database, suspected duplicate queue, and merge log

Full XLSX and JSON exports show a confirmation warning before download.

### Full Excel export

The full workbook includes:

- Volunteer particulars
- Tags
- Programmes Registered
- Gender
- Address
- Chat Session
- Chat Session Date Conducted
- Interests
- Languages Spoken
- Emergency contact fields
- T-Shirt size
- Dietary requirements
- Notes
- Total hours
- Last active date
- Attendance log rows

### Redacted roster export

The redacted roster excludes higher-risk contact and address fields. It includes:

- Name
- Gender
- Chat Session
- Chat Session Date Conducted
- Interests
- Languages Spoken
- Programmes Registered
- Tags
- T-Shirt Size
- Dietary Requirements
- Total Hours
- Last Active

### Formula-safe exports

Spreadsheet exports neutralise formula-like values by prefixing values that begin with these characters:

```text
= + - @ tab carriage-return
```

This reduces formula injection risk when exported files are opened in spreadsheet software.

## JSON backup and restore

Use JSON export for full backups and moving the local database between browsers/devices.

Use **Import JSON save file** only with files exported by MakLom.

Before restore, the app validates and normalises:

- Volunteer array shape
- Volunteer field types and length limits
- Programmes Registered
- Tags
- Attendance rows
- Suspected duplicate queue
- Merge log rows

Invalid or oversized JSON restore files are rejected. Valid restores replace the current browser-local database after confirmation.

## Suspected Duplicates queue

Go to **Suspected Duplicates** to review unresolved fuzzy or medium-confidence matches that were skipped during import.

Each queued item can be resolved by choosing:

- Confirm merge
- Keep separate
- Skip for now

Resolving a queued duplicate updates the local database and removes that item from the queue.

## Browser storage

MakLom currently stores the database in the browser's `localStorage` under this existing key:

```text
volunteerDatabaseTool.v1
```

The key is intentionally unchanged during the MakLom rebrand so existing browser-local data remains readable.

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

## Development notes

- No framework is used
- No backend is used
- No build command is required
- The app is split into HTML, CSS, JavaScript, SVG assets, and vendored browser libraries
- `assets/app.js` contains the core application logic
- `assets/programmes.js` contains the Programmes Registered schema extension and related import/export/display overrides
- `assets/profile-edit.js` contains the reviewed profile edit flow
- `assets/batch-edit.js` contains the Central Database batch edit feature
- `assets/empty-filters.js` contains Central Database no-value filtering
- `assets/dashboard.js` contains analytics dashboard calculations and rendering
- `assets/dashboard.css` contains dashboard KPI and bar chart styling
- `assets/info.js` contains Info tab behaviour
- `assets/brand.css` contains MakLom brand/logo styling
- `assets/maklom-logo.svg` and `assets/maklom-favicon.svg` contain the current brand artwork
- Vendor browser libraries are stored in `vendor/`
- The code favours direct, readable control flow over abstractions

## How to add a new volunteer field

The volunteer schema is defined near the top of `assets/app.js`, and additional fields may also be installed through extension scripts such as `assets/programmes.js`.

The current extended roster fields include:

```js
{ key:'gender', label:'Gender', type:'text' }
{ key:'address', label:'Address', type:'textarea' }
{ key:'chatSession', label:'Chat Session', type:'text' }
{ key:'chatSessionDate', label:'Chat Session Date Conducted', type:'date' }
{ key:'interests', label:'Interests', type:'textarea' }
{ key:'languagesSpoken', label:'Languages Spoken', type:'textarea' }
{ key:'programmesRegistered', label:'Programmes Registered', type:'textarea' }
```

To add another new field:

1. Add a new object to `VOLUNTEER_SCHEMA` in `assets/app.js` or install it through a clearly named extension script.
2. If the field should be imported from the roster template, add the exact Excel header to `ROSTER_HEADERS`.
3. Update `mapRosterRow()` so the new column is read into the matching field key.
4. Update `sanitizeVolunteerRow()` and JSON validation if the field needs special validation.
5. Update `findFieldConflicts()` if the field should be included in merge conflict review.
6. Update Central Database search/table/profile rendering if the field should be visible or searchable.
7. Update `assets/profile-edit.js` if the field should support reviewed profile edits.
8. Update `assets/batch-edit.js` if the field should support Central Database batch edits.
9. Update `assets/empty-filters.js` if the field should support no-value filtering.
10. Update `exportDatabaseXlsx()` and `exportRedactedXlsx()` if the field should appear in exports.
11. Update `downloadSampleRoster()` if the sample template should include the field.
12. Test with a sample roster file using the new exact header order.

## How to update MakLom brand assets

To update the logo or favicon:

1. Replace `assets/maklom-logo.svg` for the Info panel logo.
2. Replace `assets/maklom-favicon.svg` for the browser favicon.
3. Adjust `assets/brand.css` if the logo needs different sizing or spacing.
4. Confirm `index.html` still points to the correct asset paths.
5. Keep assets local to the repository. Do not use external image URLs.

## Limitations

MakLom is a browser-local tool. It is suitable for lightweight volunteer data management, import review, deduplication, tagging, programme categorisation, analytics, batch edits, and exports. It is not a multi-user system and does not provide authentication, role-based access control, encrypted shared storage, server-side backups, or audit-grade data integrity.
