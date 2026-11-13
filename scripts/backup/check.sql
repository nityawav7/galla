-- Compare a restored backup with production (docs/restore.md). Run it against both and the
-- numbers should match, as of the backup's time (production may have moved on since).
-- Counts and dates only: no names, phones or other personal data are printed.
select 'businesses' as what, count(*)::text as value from businesses
union all select 'users', count(*)::text from users
union all select 'customers', count(*)::text from customers
union all select 'products', count(*)::text from products
union all select 'invoices issued', count(*)::text from invoices where status <> 'DRAFT'
union all select 'invoice lines', count(*)::text from invoice_lines
union all select 'credit notes', count(*)::text from credit_notes
union all select 'payments', count(*)::text from payments
union all select 'refunds', count(*)::text from refunds
union all select 'audit rows', count(*)::text from audit_logs
union all select 'newest invoice issued at', coalesce(max(issued_at)::text, '-') from invoices
-- Gapless numbering survives: every series' next number, added up.
union all select 'sum of next invoice/credit note numbers', coalesce(sum(next_value), 0)::text
  from number_sequences
union all select 'migrations applied', count(*)::text from drizzle.__drizzle_migrations;
