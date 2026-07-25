-- 0000_extensions.sql
-- Enable extensions required for UUID generation.

create extension if not exists pgcrypto;
