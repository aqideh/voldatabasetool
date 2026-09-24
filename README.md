# MakLom

MakLom is MENDAKI's higher-security volunteer operations database.

## Architecture

MakLom has one production frontend:

- React + TypeScript
- Mantine
- TanStack Query
- Supabase Auth + PostgreSQL
- Supabase Edge Functions for server-side integrations
- Vercel for hosting and deployment

The production site is `voldatabasetool.vercel.app`.

Keluarga and MakLom share the volunteer data platform in Supabase, while MakLom access remains separately controlled through `app_members`.

## Product areas

- Overview
- Volunteer Leads
- Central Database
- Events & Shifts
- Attendance
- Form Attendance
- Data Operations

Prospective volunteer leads enter through FormSG and remain separate from canonical volunteer records until an authorised MakLom user accepts and converts them.

## Repository layout

```
src/                  React application
public/               static brand assets
supabase/migrations/  database migrations
supabase/functions/   Edge Functions, including the FormSG lead webhook
docs/                 operational and integration documentation
```

The previous static/vanilla-JavaScript UI, Web Awesome adapter layer, and nested React prototype were retired during the React cutover. Their history remains available in Git.

## Development

```bash
npm install
npm run typecheck
npm run dev
npm run build
```

Production is deployed from `main`.
