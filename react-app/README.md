# MakLom v2

Parallel React + TypeScript + Mantine rebuild of MakLom. The current root application remains production until v2 reaches functional parity.

## Stack

- React 19
- TypeScript
- Vite
- Mantine 9
- TanStack Query
- TanStack Table
- Supabase JS

## Current slice

- Supabase password authentication
- `app_members` authorization check
- Mantine AppShell/navigation
- live dashboard counts
- server-paginated Central Database
- debounced server-side search
- tag/year filtering
- server-side sorting
- volunteer detail drawer

The v2 client uses the existing Supabase publishable key and relies on existing RLS policies. No service-role credentials belong in this frontend.
